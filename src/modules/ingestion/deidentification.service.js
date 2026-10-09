// E2-08: removes identifying values before anything is indexed.
//
//   files -> extract -> DE-IDENTIFY -> chunk -> embed -> write
//
// the transform sits between extraction and chunking so that every consumer of
// extracted content -- the retrieval index AND the structured table store --
// goes through the same code path. a name that never reaches a chunk cannot be
// retrieved, ranked, quoted or cited, whatever the query.
//
// the replacement is a keyed one-way pseudonym:
//
//   HMAC-SHA256(DEID_SECRET, field + "\0" + normalised value) -> ATHLETE_3f9a1c02be
//
// deterministic, so the same athlete gets the same pseudonym in every file and
// counts, group-bys and joins still work. one-way, and no mapping table is
// written anywhere: without the secret a pseudonym cannot be reversed, and
// cannot be confirmed by hashing a list of candidate names either. the secret
// IS the restricted access -- whoever holds it can compute the pseudonym of a
// name they already know, which is why it lives in .env and never in the
// manifest, the evidence file or a log line.
//
// names are found two ways:
//
//   columns    configured cells (opponent_name, playerGivenName + playerFamilyName,
//              ...) are replaced whole, whatever they contain.
//   free text  every other string -- pdf pages, slide text, transcripts, titles,
//              file names, doc ids, profile-link slugs -- is scanned against a
//              dictionary built from those same columns.
//
// what this cannot find is a name that only ever appears in free text and in no
// configured column. see docs/DEIDENTIFICATION.md for that and the other limits.

import crypto from "node:crypto";
import path from "node:path";

import { retrievalConfig } from "../../config/retrieval.config.js";
import { extractFile, listIngestableFiles } from "./extraction.service.js";

// values that mean "no data". the partner's match csv fills partner_name with
// "Not available" on every singles row -- pseudonymising that would put every
// such row under one fake athlete, and worse, put the phrase "not available"
// into the free-text dictionary.
const NULL_VALUES = new Set(["", "nan", "none", "null", "n/a", "na", "not available", "-", "unknown"]);

// a token is a run of letters, combining marks and digits. everything else --
// spaces, hyphens, underscores, slashes, apostrophes -- separates tokens, which
// is what makes "Reilly Opelka", "reilly-opelka" (a slug) and "Reilly_Opelka" (a
// doc id) the same two-token sequence to the matcher.
const TOKEN = /[\p{L}\p{M}\p{N}]+/gu;

// the only gaps a multi-word name may span. whitespace (including a line wrap
// in a pdf), "-" and "_" for slugs and doc ids, an apostrophe for O'Brien, or a
// single comma for "Family, Given". a full stop is deliberately NOT allowed:
// "...beat Reilly. Opelka then..." is two sentences, not one name.
const PHRASE_GAP = /^(?:[\s_'’-]+|\s*,\s*)$/u;

const CAPITALISED = /^\p{Lu}/u;
const HAS_LETTER = /\p{L}/u;

const TABLE_EXTENSIONS = new Set([".csv", ".xlsx", ".xls"]);

const FIELD_DEFAULTS = Object.freeze({
  columns: [],
  compositeColumns: [],
  freeText: true,
  // whether a surname on its own is matched in free text. it catches "Opelka
  // served..." after the full name was used once, and it is also the one rule
  // that produces false positives: a junior somewhere in the ITF list is
  // called Court, Western or Topic. familyNameIgnore lists those words.
  familyNameAlone: true,
  familyNameMinLength: 4,
  familyNameIgnore: [],
});

// ---------------------------------------------------------------------------
// normalisation and the pseudonym itself
// ---------------------------------------------------------------------------

function tokenKey(token) {
  return token.normalize("NFKC").toLowerCase();
}

/**
 * the tokens of a name, normalised. NFKC folds full-width and ligature forms,
 * lower-casing makes the match case-insensitive, and tokenising drops the
 * punctuation and spacing differences between "Opelka,  Reilly" and
 * "opelka reilly".
 */
export function nameTokens(value) {
  return (String(value ?? "").match(TOKEN) ?? []).map(tokenKey);
}

export function normaliseName(value) {
  return nameTokens(value).join(" ");
}

function hmacHex(secret, message) {
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * identifies the secret without revealing it. written into the manifest so a
 * changed secret is detectable: two indexes with different key ids hold
 * different pseudonyms for the same athlete and must never be merged.
 */
export function keyIdFor(secret) {
  if (!secret) throw new Error("keyIdFor() needs a secret.");

  return hmacHex(secret, "key-id").slice(0, 8);
}

/**
 * the pseudonym for one value of one field.
 *
 * the field name is part of the HMAC input, so a coach and an athlete who share
 * a name still get unrelated pseudonyms.
 */
export function pseudonym(fieldName, value, { secret, prefix }) {
  if (!secret) throw new Error("pseudonym() needs a secret -- refusing to produce an unkeyed hash.");

  return `${prefix}_${hmacHex(secret, `${fieldName}\0${normaliseName(value)}`).slice(0, 10)}`;
}

function isNullValue(value) {
  if (typeof value !== "string") return true;

  const trimmed = value.trim();

  return NULL_VALUES.has(trimmed.toLowerCase()) || !HAS_LETTER.test(trimmed);
}

function withDefaults(field) {
  return {
    ...FIELD_DEFAULTS,
    ...field,
    // headers are compared case-insensitively: "Player Name" and "player name"
    // are the same column to a human reading the sheet.
    columnSet: new Set((field.columns ?? []).map((column) => column.trim().toLowerCase())),
    compositeGroups: (field.compositeColumns ?? []).map((group) =>
      group.map((column) => column.trim().toLowerCase()),
    ),
    ignoreSet: new Set((field.familyNameIgnore ?? []).map((name) => normaliseName(name))),
  };
}

function recordSetsOf(extracted) {
  if (extracted?.kind !== "records") return [];

  return extracted.sheets?.length > 0
    ? extracted.sheets.map((sheet) => sheet.records ?? [])
    : [extracted.records ?? []];
}

/** the record's own key for each lower-cased header, built once per record. */
function headerLookup(record) {
  const lookup = new Map();

  for (const key of Object.keys(record)) lookup.set(key.trim().toLowerCase(), key);

  return lookup;
}

/**
 * the names in one record for one field, as { tokens, family } pairs.
 *
 * for a plain column the family name is taken to be the last token. for a
 * composite group the LAST column is the family name and the rest are given
 * names, which is how ["playerGivenName", "playerFamilyName"] reads.
 */
function namesInRecord(record, lookup, field) {
  const found = [];

  for (const group of field.compositeGroups) {
    const parts = group.map((column) => {
      const key = lookup.get(column);
      const value = key === undefined ? null : record[key];

      return isNullValue(value) ? [] : nameTokens(value);
    });

    const tokens = parts.flat();

    if (tokens.length === 0) continue;

    const family = parts[parts.length - 1].length > 0 ? parts[parts.length - 1] : tokens.slice(-1);

    found.push({ tokens, family });
  }

  for (const [lowered, key] of lookup) {
    if (!field.columnSet.has(lowered) || isNullValue(record[key])) continue;

    const tokens = nameTokens(record[key]);

    if (tokens.length > 0) found.push({ tokens, family: tokens.slice(-1) });
  }

  return found;
}

// ---------------------------------------------------------------------------
// the dictionary
// ---------------------------------------------------------------------------

/**
 * collects names from extracted tables, then compiles the lookups the matcher
 * and the column replacement use. kept as a builder so buildDictionary can
 * stream file by file: the ITF ranking exports alone are ~150k rows, and
 * holding every parsed table at once to read four columns would be wasteful.
 */
export function createDictionaryBuilder({ secret, fields }) {
  if (!secret) throw new Error("a de-identification dictionary needs DEID_SECRET.");

  const compiled = fields.map(withDefaults);
  // `${field}\0${full name key}` -> person. a person here is a distinct
  // (field, normalised full name) pair, which is exactly what one pseudonym is.
  const people = new Map();

  function add(extracted) {
    for (const records of recordSetsOf(extracted)) {
      for (const record of records) {
        const lookup = headerLookup(record);

        for (const field of compiled) {
          for (const { tokens, family } of namesInRecord(record, lookup, field)) {
            const key = tokens.join(" ");
            const id = `${field.name}\0${key}`;

            if (people.has(id)) continue;

            const given = tokens.slice(0, tokens.length - family.length);

            people.set(id, {
              field,
              key,
              given,
              familyKey: family.join(" "),
              reversedKey: given.length > 0 ? [...family, ...given].join(" ") : null,
              pseudonym: pseudonym(field.name, key, { secret, prefix: field.prefix }),
            });
          }
        }
      }
    }
  }

  function finish() {
    const byField = new Map(compiled.map((field) => [field.name, new Map()]));
    const phrases = new Map();
    const singles = new Map();

    // full names first, everywhere, so a reversed or surname-only variant can
    // never take a key that is some other person's actual name.
    for (const person of people.values()) {
      byField.get(person.field.name).set(person.key, person.pseudonym);
    }

    for (const person of people.values()) {
      const own = byField.get(person.field.name);

      if (person.reversedKey && !own.has(person.reversedKey)) own.set(person.reversedKey, person.pseudonym);
    }

    const freeTextPeople = [...people.values()].filter((person) => person.field.freeText);

    // a surname on its own is only safe to replace when it points at exactly
    // one person. "Ivanov" alone in a ranking list of four Ivanovs identifies
    // nobody, and replacing it with one of their pseudonyms would be wrong.
    const familyOwners = new Map();
    // a surname that is also someone's given name ("Thomas") would turn every
    // standalone mention of the given name into this person.
    const givenTokens = new Set();

    for (const person of freeTextPeople) {
      const owners = familyOwners.get(person.familyKey) ?? new Set();

      owners.add(person.pseudonym);
      familyOwners.set(person.familyKey, owners);

      for (const token of person.given) givenTokens.add(token);
    }

    const addPhrase = (key, value) => {
      if (key.includes(" ")) {
        if (!phrases.has(key)) phrases.set(key, value);
      } else if (!singles.has(key)) {
        singles.set(key, value);
      }
    };

    for (const person of freeTextPeople) {
      // a one-token "full name" (a mononym, or a surname-only cell) is held to
      // the same bar as a surname: long enough not to be an ordinary word.
      if (person.key.includes(" ") || person.key.length >= person.field.familyNameMinLength) {
        addPhrase(person.key, person.pseudonym);
      }
    }

    for (const person of freeTextPeople) {
      if (person.reversedKey) addPhrase(person.reversedKey, person.pseudonym);
    }

    for (const person of freeTextPeople) {
      const { familyKey, field } = person;

      if (!field.familyNameAlone || familyKey === person.key) continue;
      if (familyOwners.get(familyKey).size !== 1) continue;
      if (field.ignoreSet.has(familyKey)) continue;
      if (familyKey.length < field.familyNameMinLength) continue;
      if (!familyKey.includes(" ") && givenTokens.has(familyKey)) continue;

      addPhrase(familyKey, person.pseudonym);
    }

    const firstTokens = new Set();
    let maxTokens = 0;

    for (const key of [...phrases.keys(), ...singles.keys()]) {
      const tokens = key.split(" ");

      firstTokens.add(tokens[0]);
      maxTokens = Math.max(maxTokens, tokens.length);
    }

    return {
      keyId: keyIdFor(secret),
      fieldNames: compiled.map((field) => field.name),
      personCount: people.size,
      byField,
      phrases,
      singles,
      firstTokens,
      maxTokens,
    };
  }

  return { add, finish };
}

/** a dictionary from tables already in memory. */
export function createDictionary(tables, deid) {
  const builder = createDictionaryBuilder(deid);

  for (const table of tables) builder.add(table);

  return builder.finish();
}

/**
 * pass one: reads only the csv/xlsx files under sourceDirs, which is a few
 * seconds even for the full ITF export, and collects every configured name.
 */
export async function buildDictionary(sourceDirs, deid = retrievalConfig.deidentification) {
  const builder = createDictionaryBuilder(deid);
  const seen = new Set();

  for (const directory of sourceDirs) {
    for (const filePath of await listIngestableFiles(directory)) {
      const resolved = path.resolve(filePath);

      if (seen.has(resolved) || !TABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) continue;

      seen.add(resolved);

      // an unreadable table is skipped here exactly as the build skips it.
      const extracted = await extractFile(filePath).catch(() => null);

      if (extracted) builder.add(extracted);
    }
  }

  return builder.finish();
}

// ---------------------------------------------------------------------------
// the matcher
// ---------------------------------------------------------------------------

/**
 * replaces every dictionary name in a string with its pseudonym.
 *
 * NOT one big regex. the ITF exports hold tens of thousands of names, and an
 * alternation that size is tried name by name at every character of a 2,300-pdf
 * corpus. this tokenises once and does map lookups instead, with the same
 * behaviour a sorted, bounded regex would have:
 *
 *   - longest match first: "Reilly Opelka" wins over "Opelka".
 *   - case-insensitive for multi-word names.
 *   - whole tokens only: "Sousa" never matches inside "Sousaphone".
 *
 * a single-token entry (a unique surname) additionally has to be capitalised in
 * the text. lower case it is far more likely to be an ordinary word -- "price",
 * "young", "ball" -- than a reference to one specific athlete.
 *
 * `onMatch(pseudonym, matchedText)` is called per replacement; the evidence
 * script uses it to count occurrences in the raw sources.
 */
export function replaceNames(text, dictionary, onMatch = null) {
  if (typeof text !== "string" || text === "" || !dictionary || dictionary.maxTokens === 0) return text;

  const tokens = [];
  let candidate = false;

  for (const match of text.matchAll(TOKEN)) {
    const key = tokenKey(match[0]);

    if (dictionary.firstTokens.has(key)) candidate = true;

    tokens.push({ start: match.index, end: match.index + match[0].length, raw: match[0], key });
  }

  // the common case by far: nothing in this string could start a name.
  if (!candidate) return text;

  let output = "";
  let cursor = 0;

  for (let i = 0; i < tokens.length; ) {
    let length = 0;
    let replacement = null;

    if (dictionary.firstTokens.has(tokens[i].key)) {
      // how far a name starting here could reach before hitting a gap that
      // cannot sit inside a name.
      let reach = i;

      while (
        reach + 1 < tokens.length &&
        reach - i + 1 < dictionary.maxTokens &&
        PHRASE_GAP.test(text.slice(tokens[reach].end, tokens[reach + 1].start))
      ) {
        reach += 1;
      }

      for (let last = reach; last > i && replacement === null; last -= 1) {
        const hit = dictionary.phrases.get(
          tokens
            .slice(i, last + 1)
            .map((token) => token.key)
            .join(" "),
        );

        if (hit) {
          replacement = hit;
          length = last - i + 1;
        }
      }

      if (replacement === null) {
        const hit = dictionary.singles.get(tokens[i].key);

        if (hit && CAPITALISED.test(tokens[i].raw)) {
          replacement = hit;
          length = 1;
        }
      }
    }

    if (replacement === null) {
      i += 1;
      continue;
    }

    const end = tokens[i + length - 1].end;

    onMatch?.(replacement, text.slice(tokens[i].start, end));
    output += text.slice(cursor, tokens[i].start) + replacement;
    cursor = end;
    i += length;
  }

  return cursor === 0 ? text : output + text.slice(cursor);
}

// ---------------------------------------------------------------------------
// the transform
// ---------------------------------------------------------------------------

/**
 * a de-identified copy of one extracted file. pure: the input is not modified.
 *
 * paths the pipeline still has to OPEN -- images[].path, videos[].source_path,
 * segments[].sourcePath -- are deliberately left alone here, because the
 * captioning and frame-sampling stages read those files after this runs.
 * they are scrubbed out of the chunk metadata instead, by deidentifyChunk.
 */
export function deidentifyExtracted(extracted, dictionary, { secret, fields }) {
  if (!extracted) return extracted;

  const compiled = fields.map(withDefaults);
  const scrub = (value) => (typeof value === "string" ? replaceNames(value, dictionary) : value);

  const cellPseudonym = (field, tokens) => {
    const key = tokens.join(" ");

    return dictionary?.byField.get(field.name)?.get(key) ?? pseudonym(field.name, key, { secret, prefix: field.prefix });
  };

  const deidentifyRecord = (record) => {
    const lookup = headerLookup(record);
    const next = { ...record };
    const replaced = new Set();

    for (const field of compiled) {
      for (const group of field.compositeGroups) {
        const keys = group.map((column) => lookup.get(column)).filter((key) => key !== undefined);
        const present = keys.filter((key) => !isNullValue(record[key]));

        if (present.length === 0) continue;

        const value = cellPseudonym(field, present.flatMap((key) => nameTokens(record[key])));

        // every part of the name carries the person's pseudonym, so a
        // group-by on either column still groups by person.
        for (const key of present) next[key] = value;
        for (const key of keys) replaced.add(key);
      }

      for (const [lowered, key] of lookup) {
        if (!field.columnSet.has(lowered) || replaced.has(key)) continue;

        replaced.add(key);

        if (!isNullValue(record[key])) next[key] = cellPseudonym(field, nameTokens(record[key]));
      }
    }

    // every column nobody configured still gets the free-text pass. this is
    // what catches the slug in profileLink -- /en/players/ivan-ivanov/... --
    // which is a name in a column that is not a name column.
    for (const key of Object.keys(next)) {
      if (!replaced.has(key)) next[key] = scrub(next[key]);
    }

    return next;
  };

  const result = { ...extracted };

  for (const key of ["docId", "tableId", "title", "fileName", "sourceUri"]) {
    if (key in result) result[key] = scrub(result[key]);
  }

  if (Array.isArray(result.pages)) result.pages = result.pages.map(scrub);

  if (Array.isArray(result.tables)) {
    result.tables = result.tables.map((table) => ({
      ...table,
      title: scrub(table.title),
      grid: Array.isArray(table.grid) ? table.grid.map((row) => row.map(scrub)) : table.grid,
    }));
  }

  if (Array.isArray(result.slides)) {
    result.slides = result.slides.map((slide) => ({ ...slide, text: scrub(slide.text) }));
  }

  if (Array.isArray(result.segments)) {
    result.segments = result.segments.map((segment) => ({
      ...segment,
      title: scrub(segment.title),
      text: scrub(segment.text),
    }));
  }

  if (Array.isArray(result.videos)) {
    result.videos = result.videos.map((video) => ({
      ...video,
      title: scrub(video.title),
      source: scrub(video.source),
      segments: Array.isArray(video.segments)
        ? video.segments.map((segment) => ({ ...segment, description: scrub(segment.description) }))
        : video.segments,
    }));
  }

  if (Array.isArray(result.images)) {
    result.images = result.images.map((image) => ({
      ...image,
      title: scrub(image.title),
      sourceDocument: scrub(image.sourceDocument),
      legacyCaption: scrub(image.legacyCaption),
      ocrText: scrub(image.ocrText),
    }));
  }

  if (result.kind === "records") {
    if (Array.isArray(result.sheets) && result.sheets.length > 0) {
      result.sheets = result.sheets.map((sheet) => ({
        ...sheet,
        sheetName: scrub(sheet.sheetName),
        records: (sheet.records ?? []).map(deidentifyRecord),
      }));
      // extractFile's `records` is exactly the sheets flattened, so rebuilding
      // it keeps the two views identical instead of transforming twice.
      result.records = result.sheets.flatMap((sheet) => sheet.records);
    } else if (Array.isArray(result.records)) {
      result.records = result.records.map(deidentifyRecord);
    }
  }

  result.deidentified = { fields: compiled.map((field) => field.name), keyId: keyIdFor(secret) };

  return result;
}

function scrubDeep(value, dictionary) {
  if (typeof value === "string") return replaceNames(value, dictionary);
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, dictionary));

  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubDeep(item, dictionary)]));
  }

  return value;
}

/**
 * the last pass over a finished chunk, every string field included.
 *
 * most of a chunk is built from already de-identified extraction and this
 * changes nothing. it exists for what is produced AFTER extraction: the media
 * and image paths left intact above so the files could be read, and captions
 * written by the vision model, which can read a name off a scoreboard.
 */
export function deidentifyChunk(chunk, dictionary) {
  return scrubDeep(chunk, dictionary);
}

/**
 * extractFile, then de-identification when it is enabled. the one entry point
 * both the index build and the table store use, so the two cannot drift.
 *
 * enabled with no dictionary is refused rather than run with an empty one: the
 * columns would still be replaced, but every name in free text would pass
 * through untouched, and nothing about the output would say so.
 */
export async function extractForIngestion(filePath, dictionary = null, deid = retrievalConfig.deidentification) {
  const extracted = await extractFile(filePath);

  if (!extracted || !deid.enabled) return extracted;

  if (!dictionary) {
    throw new Error(
      "de-identification is enabled but no dictionary was built. call buildDictionary(sourceDirs) " +
        "first -- without it only the configured columns would be replaced and names in free text " +
        "would reach the index.",
    );
  }

  return deidentifyExtracted(extracted, dictionary, deid);
}

/**
 * the de-identification settings as they are written into a manifest, and as
 * the append guard compares them. never includes the secret.
 */
export function canonicalDeidentification(settings) {
  if (!settings?.enabled) return { enabled: false };

  return {
    enabled: true,
    fields: [...(settings.fields ?? [])].map((field) => (typeof field === "string" ? field : field.name)).sort(),
    keyId: settings.keyId ?? (settings.secret ? keyIdFor(settings.secret) : null),
  };
}
