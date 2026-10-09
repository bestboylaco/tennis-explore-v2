// E2-08: the de-identification transform, as pure functions.
//
// every name in here is invented. the real partner data never enters a test.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";

// retrieval.config.js is imported (indirectly) by the service. the pure
// functions below never touch env.js, but the PORT/MONGODB_URI pair is set
// anyway so this file keeps passing if that ever changes -- CI has no .env.
// see test/unit/indexAppend.test.js.
process.env.PORT ||= "3000";
process.env.MONGODB_URI ||= "mongodb://unused-in-this-test/db";

// dotenv 17 prints a banner with a RANDOM tip when it loads. imported from a
// `before` hook, that banner lands on stdout while the test runner is already
// streaming its serialised results over the same pipe, and under the full
// suite's load roughly one run in four failed with "Unable to deserialize
// cloned data" -- no assertion involved. silencing it removes the race.
process.env.DOTENV_CONFIG_QUIET ??= "true";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const CONFIG = pathToFileURL(path.join(projectRoot, "src/config/retrieval.config.js")).href;

let deid;

before(async () => {
  deid = await import("../../src/modules/ingestion/deidentification.service.js");
});

const SECRET = "test-secret-0123456789abcdef";
const OTHER_SECRET = "another-secret-fedcba9876543210";

const ATHLETE = {
  name: "athlete_name",
  prefix: "ATHLETE",
  columns: ["opponent_name", "partner_name", "player name"],
  compositeColumns: [["playerGivenName", "playerFamilyName"]],
  freeText: true,
};

const CONFIG_ONE = { secret: SECRET, fields: [ATHLETE] };

const PSEUDONYM = /^ATHLETE_[0-9a-f]{10}$/;

function rankingTable(records) {
  return { kind: "records", docId: "rankings", title: "Rankings", fileName: "rankings.csv", records };
}

const RANKINGS = rankingTable([
  {
    playerGivenName: "Zorvath",
    playerFamilyName: "Quillane",
    profileLink: "/en/players/zorvath-quillane/800000001/aus/",
    rank: "1",
  },
  {
    playerGivenName: "Mirelda",
    playerFamilyName: "Ostrovyne",
    profileLink: "/en/players/mirelda-ostrovyne/800000002/nzl/",
    rank: "2",
  },
  // two people share a surname, so the surname alone identifies nobody.
  { playerGivenName: "Talen", playerFamilyName: "Brask", profileLink: "", rank: "3" },
  { playerGivenName: "Ysolde", playerFamilyName: "Brask", profileLink: "", rank: "4" },
  // a surname too short to match on its own.
  { playerGivenName: "Corvin", playerFamilyName: "Ng", profileLink: "", rank: "5" },
  // "Sousa" exists so the word-boundary test has something to not match.
  { playerGivenName: "Dario", playerFamilyName: "Sousa", profileLink: "", rank: "6" },
]);

const MATCHES = {
  kind: "records",
  docId: "matches",
  title: "Matches",
  fileName: "matches.csv",
  records: [
    { match_id: "M-1", opponent_name: "Zorvath Quillane", partner_name: "Not available", score: "6-2 6-0" },
    { match_id: "M-2", opponent_name: "Pellam Varrow", partner_name: "Mirelda Ostrovyne", score: "7-5 6-4" },
  ],
};

const RAW_NAMES = ["zorvath", "quillane", "mirelda", "ostrovyne", "pellam", "varrow"];

function dictionary(config = CONFIG_ONE, tables = [RANKINGS, MATCHES]) {
  return deid.createDictionary(tables, config);
}

function assertNoRawNames(value, names = RAW_NAMES) {
  const text = JSON.stringify(value).toLowerCase();

  for (const name of names) {
    assert.equal(text.includes(name), false, `"${name}" survived de-identification`);
  }
}

// ---------------------------------------------------------------------------

describe("pseudonym -- keyed, deterministic, one-way", () => {
  it("gives the same value the same pseudonym under the same secret", () => {
    const a = deid.pseudonym("athlete_name", "Zorvath Quillane", { secret: SECRET, prefix: "ATHLETE" });
    const b = deid.pseudonym("athlete_name", "Zorvath Quillane", { secret: SECRET, prefix: "ATHLETE" });

    assert.match(a, PSEUDONYM);
    assert.equal(a, b);
  });

  it("gives a different pseudonym under a different secret", () => {
    const a = deid.pseudonym("athlete_name", "Zorvath Quillane", { secret: SECRET, prefix: "ATHLETE" });
    const b = deid.pseudonym("athlete_name", "Zorvath Quillane", { secret: OTHER_SECRET, prefix: "ATHLETE" });

    assert.notEqual(a, b);
  });

  it("normalises case, spacing and punctuation before hashing", () => {
    const options = { secret: SECRET, prefix: "ATHLETE" };
    const expected = deid.pseudonym("athlete_name", "Zorvath Quillane", options);

    for (const variant of ["  ZORVATH   quillane ", "zorvath-quillane", "Zorvath\nQuillane", "ｚｏｒｖａｔｈ Quillane"]) {
      assert.equal(deid.pseudonym("athlete_name", variant, options), expected, variant);
    }
  });

  it("keys the field name in, so two fields never share a pseudonym", () => {
    const athlete = deid.pseudonym("athlete_name", "Zorvath Quillane", { secret: SECRET, prefix: "X" });
    const coach = deid.pseudonym("coach_name", "Zorvath Quillane", { secret: SECRET, prefix: "X" });

    assert.notEqual(athlete, coach);
  });

  it("refuses to run without a secret", () => {
    assert.throws(() => deid.pseudonym("athlete_name", "Zorvath Quillane", { secret: "", prefix: "ATHLETE" }));
    assert.throws(() => deid.createDictionary([RANKINGS], { secret: "", fields: [ATHLETE] }));
  });

  it("derives a key id that identifies the secret without containing it", () => {
    const id = deid.keyIdFor(SECRET);

    assert.match(id, /^[0-9a-f]{8}$/);
    assert.equal(deid.keyIdFor(SECRET), id);
    assert.notEqual(deid.keyIdFor(OTHER_SECRET), id);
    assert.equal(SECRET.includes(id), false);
  });
});

describe("deidentifyExtracted -- structured columns", () => {
  it("replaces configured columns whole, and leaves null markers alone", () => {
    const out = deid.deidentifyExtracted(MATCHES, dictionary(), CONFIG_ONE);

    assert.match(out.records[0].opponent_name, PSEUDONYM);
    assert.match(out.records[1].partner_name, PSEUDONYM);
    // "Not available" is the absence of a partner, not a partner called that.
    assert.equal(out.records[0].partner_name, "Not available");
    assert.equal(out.records[0].score, "6-2 6-0");
    assertNoRawNames(out);
  });

  it("gives a composite name one pseudonym, the same one a plain column gets", () => {
    const dict = dictionary();
    const ranked = deid.deidentifyExtracted(RANKINGS, dict, CONFIG_ONE);
    const matches = deid.deidentifyExtracted(MATCHES, dict, CONFIG_ONE);

    const [first] = ranked.records;

    assert.match(first.playerGivenName, PSEUDONYM);
    assert.equal(first.playerGivenName, first.playerFamilyName);
    // the join that has to survive: the ranking row and the match row are the
    // same person, and they still say so.
    assert.equal(first.playerFamilyName, matches.records[0].opponent_name);
  });

  it("catches a name inside a column that is not a name column -- the profile slug", () => {
    const out = deid.deidentifyExtracted(RANKINGS, dictionary(), CONFIG_ONE);

    assert.match(out.records[0].profileLink, /^\/en\/players\/ATHLETE_[0-9a-f]{10}\/800000001\/aus\/$/);
    assert.equal(out.records[0].profileLink.includes(out.records[0].playerFamilyName), true);
  });

  it("de-identifies every sheet of a workbook and keeps records in step", () => {
    const workbook = {
      kind: "records",
      docId: "book",
      title: "Book",
      fileName: "book.xlsx",
      sheets: [
        { sheetName: "Zorvath Quillane", headers: ["Player Name"], records: [{ "Player Name": "Zorvath Quillane" }] },
      ],
      records: [{ "Player Name": "Zorvath Quillane" }],
    };

    const out = deid.deidentifyExtracted(workbook, dictionary(), CONFIG_ONE);

    // header matched case-insensitively: config says "player name".
    assert.match(out.sheets[0].records[0]["Player Name"], PSEUDONYM);
    assert.deepEqual(out.records, out.sheets[0].records);
    assertNoRawNames(out);
  });

  it("does not modify its input", () => {
    const input = structuredClone(MATCHES);

    deid.deidentifyExtracted(input, dictionary(), CONFIG_ONE);

    assert.deepEqual(input, MATCHES);
  });

  it("works without a dictionary entry -- a column value is hashed directly", () => {
    const empty = deid.createDictionary([], CONFIG_ONE);
    const out = deid.deidentifyExtracted(MATCHES, empty, CONFIG_ONE);

    assert.equal(
      out.records[1].opponent_name,
      deid.pseudonym("athlete_name", "Pellam Varrow", { secret: SECRET, prefix: "ATHLETE" }),
    );
  });
});

describe("deidentifyExtracted -- free text", () => {
  const document = {
    kind: "document",
    docId: "Zorvath_Quillane_training_notes",
    title: "Training notes for Zorvath Quillane",
    fileName: "Zorvath Quillane training notes.txt",
    sourceUri: "C:/corpus/Zorvath Quillane training notes.txt",
    pages: [
      "ZORVATH QUILLANE served well. Later Quillane tired. Quillane, Zorvath (AUS). " +
        "Partner: mirelda ostrovyne. Brask won; Ng lost. Played the Sousaphone.",
    ],
    tables: [{ page: 1, index: 0, title: "Zorvath Quillane stats", grid: [["Player"], ["Zorvath Quillane"]] }],
  };

  it("removes every variant of a name from every text field", () => {
    const out = deid.deidentifyExtracted(document, dictionary(), CONFIG_ONE);

    assertNoRawNames(out, ["zorvath", "quillane", "mirelda", "ostrovyne"]);
    assert.match(out.docId, /^ATHLETE_[0-9a-f]{10}_training_notes$/);
    assert.match(out.fileName, /^ATHLETE_[0-9a-f]{10} training notes\.txt$/);
    assert.match(out.sourceUri, /^C:\/corpus\/ATHLETE_[0-9a-f]{10} training notes\.txt$/);
  });

  it("maps full name, reversed order, upper case and the surname alone to one pseudonym", () => {
    const dict = dictionary();
    const expected = deid.pseudonym("athlete_name", "Zorvath Quillane", { secret: SECRET, prefix: "ATHLETE" });
    const out = deid.deidentifyExtracted(document, dict, CONFIG_ONE);

    // full upper case, surname alone, and "Family, Given" -- three mentions.
    assert.equal(out.pages[0].split(expected).length - 1, 3);
  });

  it("does not match a surname shared by two people, or one that is too short", () => {
    const out = deid.deidentifyExtracted(document, dictionary(), CONFIG_ONE);

    assert.match(out.pages[0], /Brask won/);
    assert.match(out.pages[0], /Ng lost/);
  });

  it("matches whole words only -- Sousa is not inside Sousaphone", () => {
    const dict = dictionary();

    assert.equal(deid.replaceNames("Played the Sousaphone.", dict), "Played the Sousaphone.");
    assert.match(deid.replaceNames("Sousa played.", dict), /^ATHLETE_[0-9a-f]{10} played\.$/);
  });

  it("leaves a lower-case surname alone, where it is more likely an ordinary word", () => {
    const dict = dictionary();

    assert.equal(deid.replaceNames("the quillane was rough", dict), "the quillane was rough");
    // a full name is matched in any case.
    assert.match(deid.replaceNames("zorvath quillane", dict), PSEUDONYM);
  });

  it("prefers the longest name when one is a prefix of another", () => {
    const tables = [
      rankingTable([
        { playerGivenName: "Zorvath", playerFamilyName: "Quillane" },
        { playerGivenName: "Zorvath Quillane", playerFamilyName: "Ardent" },
      ]),
    ];
    const dict = deid.createDictionary(tables, CONFIG_ONE);
    const longer = deid.pseudonym("athlete_name", "Zorvath Quillane Ardent", { secret: SECRET, prefix: "ATHLETE" });

    assert.equal(deid.replaceNames("Zorvath Quillane Ardent won.", dict), `${longer} won.`);
  });

  it("does not join a name across a sentence boundary", () => {
    const dict = dictionary();
    const out = deid.replaceNames("Zorvath. Ostrovyne", dict);

    // "Zorvath" alone is a given name, never a match; Ostrovyne alone is.
    assert.match(out, /^Zorvath\. ATHLETE_[0-9a-f]{10}$/);
  });

  it("covers slides, transcripts, video titles and image text", () => {
    const media = {
      kind: "video",
      docId: "clip",
      title: "clip",
      fileName: "clip.json",
      sourceUri: "clip.json",
      slides: [{ number: 1, text: "Zorvath Quillane serve" }],
      segments: [{ index: 0, title: "Quillane practice", text: "coach says zorvath quillane rushes" }],
      videos: [{ title: "Zorvath Quillane", source_path: "Zorvath Quillane.mp4", segments: [] }],
      images: [{ path: "img.png", title: "Quillane", ocrText: "ZORVATH QUILLANE 6-2", legacyCaption: "" }],
    };

    const out = deid.deidentifyExtracted(media, dictionary(), CONFIG_ONE);
    const { source_path: sourcePath, ...video } = out.videos[0];

    assertNoRawNames([out.slides, out.segments, video, out.images[0].title, out.images[0].ocrText]);
    // the path the frame sampler still has to open is left alone here --
    // deidentifyChunk takes it out of the chunk metadata afterwards.
    assert.equal(sourcePath, "Zorvath Quillane.mp4");
  });

  it("marks what it did, without the secret", () => {
    const out = deid.deidentifyExtracted(document, dictionary(), CONFIG_ONE);

    assert.deepEqual(out.deidentified, { fields: ["athlete_name"], keyId: deid.keyIdFor(SECRET) });
    assert.equal(JSON.stringify(out).includes(SECRET), false);
  });
});

describe("deidentifyChunk -- the last pass", () => {
  it("scrubs every string, including paths and nested values", () => {
    const chunk = {
      chunk_id: "clip#v000",
      text: "a rally",
      media_path: "C:/media/Zorvath Quillane.mp4",
      image_path: "C:/media/frames/zorvath-quillane/0001.jpg",
      authors: ["Quillane Z"],
      quality_issues: [{ note: "Zorvath Quillane out of frame" }],
      page: 3,
    };

    const out = deid.deidentifyChunk(chunk, dictionary());

    assertNoRawNames(out, ["zorvath", "quillane"]);
    assert.equal(out.page, 3);
    assert.equal(out.text, "a rally");
  });
});

describe("a second field needs only configuration", () => {
  it("replaces both fields, each with its own prefix, with no code change", () => {
    const config = {
      secret: SECRET,
      fields: [
        ATHLETE,
        { name: "coach_name", prefix: "COACH", columns: ["coach"], freeText: true },
      ],
    };

    const sessions = {
      kind: "records",
      docId: "sessions",
      title: "Sessions",
      fileName: "sessions.csv",
      records: [
        { opponent_name: "Zorvath Quillane", coach: "Belvane Thorsk", note: "Belvane Thorsk watched Zorvath Quillane" },
      ],
    };

    const dict = deid.createDictionary([sessions], config);
    const out = deid.deidentifyExtracted(sessions, dict, config);
    const [row] = out.records;

    assert.match(row.opponent_name, PSEUDONYM);
    assert.match(row.coach, /^COACH_[0-9a-f]{10}$/);
    assert.equal(row.note, `${row.coach} watched ${row.opponent_name}`);
    assertNoRawNames(out, ["zorvath", "quillane", "belvane", "thorsk"]);
    assert.deepEqual(out.deidentified.fields, ["athlete_name", "coach_name"]);
  });
});

describe("extractForIngestion", () => {
  let workDir;

  before(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "deid-extract-test-"));
  });

  after(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("refuses to run enabled without a dictionary, rather than leaking free text", async () => {
    const file = path.join(workDir, "note.txt");

    fs.writeFileSync(file, "Zorvath Quillane trained.");

    await assert.rejects(
      () => deid.extractForIngestion(file, null, { enabled: true, ...CONFIG_ONE }),
      /no dictionary/,
    );
  });

  it("is plain extractFile when disabled", async () => {
    const file = path.join(workDir, "plain.txt");

    fs.writeFileSync(file, "Zorvath Quillane trained.");

    const out = await deid.extractForIngestion(file, null, { enabled: false, fields: [] });

    assert.equal(out.pages[0], "Zorvath Quillane trained.");
    assert.equal(out.deidentified, undefined);
  });
});

// ---------------------------------------------------------------------------
// the config block. retrievalConfig is frozen at first import, so every
// setting is read in its own process -- same approach and same reasons as
// test/unit/chunkingConfig.test.js.
// ---------------------------------------------------------------------------

describe("retrievalConfig.deidentification", () => {
  const sandboxCwd = fs.mkdtempSync(path.join(os.tmpdir(), "deid-config-test-"));
  const MARK = "<<<RESULT>>>";

  after(() => {
    fs.rmSync(sandboxCwd, { recursive: true, force: true });
  });

  function readConfig(env) {
    const code =
      `import("${CONFIG}")` +
      `.then((m) => { const d = m.retrievalConfig.deidentification; return JSON.stringify({` +
      ` enabled: d.enabled, fields: d.fields.map((f) => f.name), secretLength: d.secret.length,` +
      ` serialised: JSON.stringify(d) }); })` +
      `.catch((error) => JSON.stringify({ threw: error.message }))` +
      `.then((r) => process.stdout.write("${MARK}" + r + "${MARK}"));`;

    const output = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: sandboxCwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // pinned, not inherited: a developer's own DEID_* settings must not
      // decide whether this passes.
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        PORT: "3000",
        MONGODB_URI: "mongodb://unused-in-this-test/db",
        ...env,
      },
    });

    return JSON.parse(output.split(MARK)[1]);
  }

  it("is off by default", () => {
    assert.equal(readConfig({}).enabled, false);
  });

  it("throws when enabled with no secret, or a short one", () => {
    assert.match(readConfig({ DEID_ENABLED: "true" }).threw, /DEID_SECRET/);
    assert.match(readConfig({ DEID_ENABLED: "true", DEID_SECRET: "short" }).threw, /too short/);
  });

  it("loads the shipped field list when enabled", () => {
    const config = readConfig({ DEID_ENABLED: "true", DEID_SECRET: SECRET });

    assert.equal(config.enabled, true);
    assert.deepEqual(config.fields, ["athlete_name"]);
  });

  it("keeps the secret out of anything that serialises the config", () => {
    const config = readConfig({ DEID_ENABLED: "true", DEID_SECRET: SECRET });

    assert.equal(config.secretLength, SECRET.length);
    assert.equal(config.serialised.includes(SECRET), false);
  });

  it("throws on a config file with no usable fields", () => {
    const bad = path.join(sandboxCwd, "bad.json");

    fs.writeFileSync(bad, JSON.stringify({ fields: [{ name: "x", prefix: "lower", columns: ["a"] }] }));

    const config = readConfig({ DEID_ENABLED: "true", DEID_SECRET: SECRET, DEID_CONFIG_PATH: bad });

    assert.match(config.threw, /prefix/);
  });
});
