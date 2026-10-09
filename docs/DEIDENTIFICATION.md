# De-identification

**E2-08.** Removes identifying values from the corpus before it is indexed, so
retrieval cannot return them. Today that is one field: **athlete name**.

---

## Where it runs

```
files -> extract -> DE-IDENTIFY -> chunk -> classify + acl -> embed -> write
                         |
                         +-> structured table store (loadTables)
```

The transform sits between extraction and chunking, in
[`deidentification.service.js`](../src/modules/ingestion/deidentification.service.js).
There is one entry point, `extractForIngestion(filePath, dictionary)`, and both
consumers of extracted content use it:

| Consumer | Why it needs the transform |
|---|---|
| [`indexBuilder.service.js`](../src/modules/ingestion/indexBuilder.service.js) `prepareFile` | Builds every chunk in the retrieval index. |
| [`tableStore.service.js`](../src/modules/structured/tableStore.service.js) `loadTables` | Reads the raw CSV/XLSX directly and never touches the index. De-identifying only the index would leave every statistics answer quoting real names. |

The build makes two passes:

1. **Dictionary.** `buildDictionary` reads only the CSV/XLSX files, which takes
   about 2 s for the full ITF export, and collects every value in the configured
   columns.
2. **Transform.** For each file, `deidentifyExtracted` replaces configured
   columns whole and scans every other string against the dictionary. Then
   `deidentifyChunk` makes a last pass over each finished chunk, which catches
   two things produced after extraction:
   - the media and image paths that had to stay intact so the files could be
     opened;
   - captions written by the vision model, which can read a name off a
     scoreboard.

### What is covered

| Kind | Fields |
|---|---|
| Configured columns, replaced whole | `opponent_name`, `partner_name`, `player name`, and `playerGivenName` + `playerFamilyName` as one composite name |
| Free text, scanned | PDF pages, Textract table cells and titles, slide text, video segment text and titles, image titles and OCR text, every unconfigured record column (this is what catches the `profileLink` slug `/en/players/ivan-ivanov/...`), plus `title`, `fileName`, `docId`, `sourceUri` |
| Chunk metadata, scanned | every string field of every chunk, including `source_uri`, `image_path`, `media_path`, `authors` |
| Index-directory files | `build-report.json` file names; the manifest records settings only |

A name is matched in several forms, and every form maps to the same pseudonym:

| Form | Example |
|---|---|
| Full name, any case | `Reilly Opelka`, `REILLY OPELKA` |
| Family name first | `Opelka, Reilly` |
| Slug or doc id | `reilly-opelka`, `Reilly_Opelka` |
| Possessive | `Opelka's` (becomes `ATHLETE_…'s`) |
| Surname alone | `Opelka`, under the rules below |

### Matching rules

- **Longest match first.** "Zorvath Quillane Ardent" wins over "Zorvath
  Quillane".
- **Whole tokens only.** "Sousa" never matches inside "Sousaphone".
- **Allowed gaps inside a name:** whitespace (including a PDF line wrap), `-`,
  `_`, an apostrophe, or one comma. A full stop is not allowed, so
  "…beat Reilly. Opelka then…" is two sentences, not one name.
- **Surname alone** is matched only when all of these hold:
  - exactly one person in the dictionary has that surname;
  - it is at least `familyNameMinLength` (4) characters;
  - it is nobody's given name;
  - it is not in `familyNameIgnore`;
  - it is **capitalised in the text**. Lower case, it is far more likely an
    ordinary word.
- The matcher is **not** one big regex. With ~10,000 names, an alternation would
  be tried name by name at every character of the corpus. It tokenises once and
  does map lookups, with the same behaviour as a sorted, word-bounded regex.

---

## The pseudonym: one-way HMAC

```
pseudonym = PREFIX + "_" + HMAC-SHA256(DEID_SECRET, field + "\0" + normalise(value))[0:10]
normalise = NFKC, lower case, split into letter/digit tokens, joined by single spaces
```

`Reilly Opelka` → `ATHLETE_3f9a1c02be`.

- **Deterministic.** The same athlete gets the same pseudonym in every file and
  every run, so counts, group-bys and joins still work. A ranking row and a
  match row for the same player still join.
- **Field-keyed.** A coach and an athlete with the same name get unrelated
  pseudonyms.
- **No mapping table**, by design. Nothing anywhere records which name produced
  which pseudonym.

### Why HMAC and not a hash or a lookup table

| Option | Problem |
|---|---|
| Plain SHA-256 of the name | Anyone can hash a list of player names (the ITF list is public) and reverse every pseudonym in minutes. |
| Random IDs plus a mapping table | Reversible, but the table becomes a second copy of the identifiable data that has to be stored, secured and retained. |
| **Keyed HMAC** (chosen) | Without the secret a pseudonym cannot be reversed, and a dictionary attack is impossible because there is nothing to hash candidates against. |

### Trade-offs, stated plainly

- **The secret is the access control.** Anyone holding `DEID_SECRET` can compute
  the pseudonym of a name they already know, and so confirm whether that person
  is in the corpus. It goes in `.env` and nowhere else. It is never written to
  the manifest, the evidence file or a log line. `retrievalConfig` holds it as a
  non-enumerable property, so serialising the config cannot leak it. It must be
  at least 16 characters.
- **Changing the key means a full rebuild.** Pseudonyms made under two keys do
  not match. The manifest records a `keyId` (the first 8 hex characters of
  `HMAC(secret, "key-id")`), which identifies the key without revealing it, and
  both the resume fingerprint and the append guard refuse a mismatch.
- **One-way also means unrecoverable.** If the secret is lost, nobody can say
  which pseudonym is which athlete, including the team. That is intended.

---

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DEID_ENABLED` | `false` | Turns the transform on. |
| `DEID_SECRET` | none | The HMAC key, at least 16 characters. Required when enabled; the config throws at import otherwise. |
| `DEID_CONFIG_PATH` | `config/deidentification.json` | The field list. |
| `DEID_DICTIONARY_DIRS` | none | Extra folders whose CSV/XLSX feed the dictionary without being indexed, separated by `;`. |

### Why it is off by default, for now

1. The committed `data/index` was built from raw data. Default-on would change
   the fingerprint and the append guard's view of every teammate's index, so
   every append and resume would refuse.
2. The E2-07 ground truth (`queries/chunking_questions.json`, CQ-09 to CQ-15) is
   written against real names.
3. CI has no secret.

`npm run build:index:test` and `npm run eval:deid` turn it on for themselves.
For the production rebuild, set `DEID_ENABLED=true` and a real `DEID_SECRET`;
that is what makes it the production default.

At the default, nothing changes: the fingerprint and the manifest are
byte-for-byte what they were. `test/unit/deidentificationIndex.test.js` asserts
this.

### Adding a second field (no code change)

Add an entry to `fields` in `config/deidentification.json`:

```json
{
  "name": "coach_name",
  "prefix": "COACH",
  "columns": ["coach", "coach_name"],
  "freeText": true
}
```

| Key | Meaning |
|---|---|
| `name` | Part of the HMAC input and the manifest. Changing it changes every pseudonym. |
| `prefix` | Upper-case letters and digits; becomes `COACH_…`. |
| `columns` | Header names, compared case-insensitively. Each cell is replaced whole. |
| `compositeColumns` | Groups of columns that together hold one name. The last column is the family name. |
| `freeText` | Whether these names are also scanned for in free text. |
| `familyNameAlone`, `familyNameMinLength`, `familyNameIgnore` | The surname-alone rule above. |

Adding a field changes the fingerprint (`deid:<fields>:<keyId>`) and the
manifest, so it is a full rebuild.
`deidentification.test.js` › "a second field needs only configuration" shows
two fields working from configuration alone.

---

## Evidence

```powershell
$env:DEID_SECRET = "<16+ chars>"; npm run eval:deid
```

This builds `data/index-deid-demo/` (gitignored, refused if it ever resolves to
`data/index`) from:

- the two smallest tables under `STRUCTURED_SOURCE_DIRS`;
- the four PDFs with the most full-name mentions out of an evenly spaced sample
  of 200.

The dictionary comes from all of `STRUCTURED_SOURCE_DIRS`. Embeddings use the
offline hash provider, because every probe is lexical.

It then takes 10 names that are present in those sources (5 from free text, 5
from tables) and, for each:

- scans every file in the index directory for the name in any spacing, case or
  slug form;
- runs BM25 and counts results that actually contain the name.

It writes `evidence/e2-08_deidentification.json`. That file holds **no raw
names**: a probe is recorded as its index and the SHA-256 of its normalised
form.

Result at the time of writing: **10/10 probes with 0 raw-scan hits and 0 BM25
hits**, over 9,736 chunks, 9,994 dictionary names, and 10,044 full-name
replacements in the sources.

To check by hand against the demo index:

```powershell
$env:INDEX_DIR = "data/index-deid-demo"; $env:EMBEDDING_PROVIDER = "hash"
npm run search -- --role analyst "<a real name>"      # no chunk containing it
npm run search -- --role analyst "ATHLETE_xxxxxxxxxx" # the chunks that hold it
```

Note that `tokenise()` keeps a trailing full stop inside a token. A pseudonym
(or a raw name) that ends a verbalised record, as in `opponent name X.`, is
indexed as `x.`, so searching for the bare pseudonym will not reach that
record. This predates E2-08 and affects raw names the same way.

---

## Known limitations

- **A name that appears only in free text** and in no configured column is not
  found. The dictionary is the configured columns; there is no named-entity
  recognition.
- **Surname-alone false positives.** With ~10,000 ITF juniors in the dictionary,
  some unique surnames are also ordinary words or paper authors. Over a sample
  of 250 PDFs the
  surname rule fired 5,717 times, and at least 846 of those were words also used
  in lower case in the same document ("Games", "Court", "Topic", "Western", …).
  `familyNameIgnore` lists the clearest of them. Author surnames in reference
  lists ("Kemp", "Moore", …) are still replaced, which costs retrieval quality on
  citations. If that cost is not acceptable, `familyNameAlone: false` turns the
  rule off; full names are still replaced.
- **`/api/assets` still serves the original files.** De-identification covers
  what the index and the table store return, not the source documents behind a
  citation. A document whose own path held a name now has a pseudonymised
  `source_uri`, so its citation link no longer resolves. In S3 mode its upload
  fails and is recorded in `uploadFailures`.
- **`manifest.sourceDirs` and the build checkpoint hold raw paths.** The table
  store has to open those folders, and `.build-state.json` exists only while a
  build is running.
- **The committed `data/index` and git history still contain real names** until
  the production rebuild. A rebuild removes them from the index going forward,
  not from history.
- **E2-07's evaluation is affected.** The CQ-09 to CQ-15 ground-truth spans
  contain real names, and an index built with this on will not contain them.
  Those questions need pseudonymised spans, or have to be scored on a raw index.
- **Quasi-identifiers are untouched:** `playerId`, birth year, nationality,
  ranking. Combined, they can still single out a player. Pseudonymising
  `playerId` is a natural second field.
