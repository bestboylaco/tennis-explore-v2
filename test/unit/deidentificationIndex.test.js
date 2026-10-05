// E2-08 end to end: a real index is built from a small invented corpus with
// de-identification on, and then everything on disk is searched for the names.
//
// every build runs in its own child process. retrievalConfig is frozen from
// the environment at first import, so "built with de-identification off, then
// appended with it on" cannot happen inside one process -- the same reason
// test/unit/chunkingConfig.test.js runs children.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const moduleUrl = (relative) => pathToFileURL(path.join(projectRoot, relative)).href;

const BUILDER = moduleUrl("src/modules/ingestion/indexBuilder.service.js");
const DEID = moduleUrl("src/modules/ingestion/deidentification.service.js");
const BM25 = moduleUrl("src/modules/retrieval/bm25.service.js");
const STORE = moduleUrl("src/infrastructure/vector/vectorStore.service.js");
const TABLES = moduleUrl("src/modules/structured/tableStore.service.js");
const METADATA = moduleUrl("src/modules/ingestion/metadata.service.js");

const SECRET = "e2e-test-secret-0123456789abcdef";
const OTHER_SECRET = "e2e-other-secret-fedcba9876543210";
const MARK = "<<<RESULT>>>";

// invented names. lower case, because every check below is case-insensitive.
const RAW = ["zorvath", "quillane", "mirelda", "ostrovyne", "pellam", "varrow"];

let workDir;

before(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "deid-index-test-"));
});

after(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

let counter = 0;

function scratch(prefix) {
  counter += 1;

  const dir = path.join(workDir, `${prefix}-${counter}`);

  fs.mkdirSync(dir, { recursive: true });

  return dir;
}

/** a csv naming three athletes, and a note that names one in body AND file name. */
function corpus() {
  const dir = scratch("src");

  fs.writeFileSync(
    path.join(dir, "rankings.csv"),
    [
      "playerId,playerFamilyName,playerGivenName,profileLink,rank,points",
      "800000001,Quillane,Zorvath,/en/players/zorvath-quillane/800000001/aus/,1,3601",
      "800000002,Ostrovyne,Mirelda,/en/players/mirelda-ostrovyne/800000002/nzl/,2,3400",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(dir, "matches.csv"),
    [
      "match_id,opponent_name,partner_name,score",
      "M-1,Pellam Varrow,Not available,6-2 6-0",
      "M-2,Zorvath Quillane,Mirelda Ostrovyne,7-5 6-4",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(dir, "Zorvath Quillane training notes.txt"),
    "Session report. Zorvath Quillane completed the serve block with high first-serve " +
      "percentages. Later in the week Quillane reported fatigue, and the coach reduced " +
      "volume. ZORVATH QUILLANE will rejoin Mirelda Ostrovyne for doubles practice. " +
      "Pellam Varrow was the sparring partner on court two. ".repeat(3),
  );

  return dir;
}

function runInChild(code, env = {}) {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    // a directory with no .env, so dotenv cannot bring a developer's settings in.
    cwd: workDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      // env.js validates these at import; CI has no .env. see indexAppend.test.js.
      PORT: "3000",
      MONGODB_URI: "mongodb://unused-in-this-test/db",
      EMBEDDING_PROVIDER: "hash",
      EMBEDDING_MODEL: "bge-m3",
      EMBEDDING_DIMENSION: "1024",
      CONTEXTUAL_ENABLED: "true",
      CONTEXTUAL_MODE: "template",
      ...env,
    },
  });

  const parts = output.split(MARK);

  assert.equal(parts.length, 3, `child printed no fenced result:\n${output}`);

  return JSON.parse(parts[1]);
}

const DEID_ON = { DEID_ENABLED: "true", DEID_SECRET: SECRET };

/** builds (or appends to) an index in a child and reports back. errors come back as data. */
function build({ sourceDir, outputDir, append = false, env = {} }) {
  const code = `
    const { buildIndex, configFingerprint } = await import(${JSON.stringify(BUILDER)});
    let result;
    try {
      await buildIndex({ sourceDirs: [${JSON.stringify(sourceDir)}], outputDir: ${JSON.stringify(outputDir)}, append: ${append} });
      result = { ok: true, fingerprint: configFingerprint() };
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify(result) + ${JSON.stringify(MARK)});
  `;

  return runInChild(code, env);
}

/** every byte of every file in the index directory, lower-cased. */
function readEverything(dir) {
  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;

    const full = path.join(entry.parentPath ?? entry.path, entry.name);

    out.push({ file: path.relative(dir, full), text: fs.readFileSync(full).toString("latin1").toLowerCase() });
  }

  return out;
}

// ---------------------------------------------------------------------------

describe("a de-identified index", () => {
  let outputDir;
  let probe;

  before(() => {
    const sourceDir = corpus();

    outputDir = scratch("out");

    const built = build({ sourceDir, outputDir, env: DEID_ON });

    assert.equal(built.ok, true, built.error);

    probe = runInChild(
      `
      const { BM25Index } = await import(${JSON.stringify(BM25)});
      const { VectorStore } = await import(${JSON.stringify(STORE)});
      const { pseudonym } = await import(${JSON.stringify(DEID)});
      const dir = ${JSON.stringify(outputDir)};
      const store = await VectorStore.load(dir);
      const bm25 = await BM25Index.load(dir, store.chunks.map((chunk) => chunk.chunk_id));
      const search = (query) => bm25.search(query).length;
      const fake = pseudonym("athlete_name", "Zorvath Quillane", { secret: ${JSON.stringify(SECRET)}, prefix: "ATHLETE" });
      process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify({
        searches: Object.fromEntries(${JSON.stringify(RAW)}.map((name) => [name, search(name)])),
        pseudonym: fake,
        pseudonymHits: search(fake),
        chunkCount: store.chunks.length,
      }) + ${JSON.stringify(MARK)});
      `,
      DEID_ON,
    );
  });

  it("returns nothing from bm25 for any of the original names", () => {
    for (const [name, hits] of Object.entries(probe.searches)) {
      assert.equal(hits, 0, `bm25 found "${name}"`);
    }
  });

  it("holds none of the original names in ANY file in the index directory", () => {
    // chunks jsonl, bm25 vocabulary, manifest, build report -- all of it.
    const files = readEverything(outputDir);

    assert.ok(files.some((file) => file.file.startsWith("chunks-")));
    assert.ok(files.some((file) => file.file === "bm25-vocab.txt"));

    for (const { file, text } of files) {
      for (const name of RAW) {
        assert.equal(text.includes(name), false, `"${name}" found in ${file}`);
      }
    }
  });

  it("does hold the pseudonym, findable by search", () => {
    const chunks = readEverything(outputDir)
      .filter((file) => file.file.startsWith("chunks-"))
      .map((file) => file.text)
      .join("\n");

    assert.ok(chunks.includes(probe.pseudonym.toLowerCase()));
    assert.ok(probe.pseudonymHits > 0);
  });

  it("records the settings in the manifest -- and never the secret", () => {
    const raw = fs.readFileSync(path.join(outputDir, "manifest.json"), "utf8");
    const manifest = JSON.parse(raw);

    assert.equal(manifest.deidentification.enabled, true);
    assert.deepEqual(manifest.deidentification.fields, ["athlete_name"]);
    assert.match(manifest.deidentification.keyId, /^[0-9a-f]{8}$/);
    assert.equal(raw.includes(SECRET), false);
  });

  it("appends a new document, then recognises it as already indexed", () => {
    // the doc_id on disk is the transformed one. the duplicate check derives
    // it the same way -- comparing the raw id would never match, and the
    // second append would quietly write every chunk again.
    const more = scratch("more");

    fs.writeFileSync(
      path.join(more, "Mirelda Ostrovyne recovery log.txt"),
      "Recovery log. Mirelda Ostrovyne slept nine hours and reported low soreness. ".repeat(4),
    );

    const first = build({ sourceDir: more, outputDir, append: true, env: DEID_ON });

    assert.equal(first.ok, true, first.error);

    const second = build({ sourceDir: more, outputDir, append: true, env: DEID_ON });

    assert.equal(second.ok, false);
    assert.match(second.error, /already in the index/);
    // and the refusal itself names the file by its pseudonymised name.
    assert.equal(/mirelda|ostrovyne/i.test(second.error), false);
  });
});

describe("the append guard and de-identification", () => {
  function sourceWithOneNote() {
    const dir = scratch("note");

    fs.writeFileSync(path.join(dir, "note.md"), "A note long enough to survive the minimum chunk length. ".repeat(8));

    return dir;
  }

  it("refuses a de-identified append to an index built from raw data", () => {
    const outputDir = scratch("raw-index");

    assert.equal(build({ sourceDir: corpus(), outputDir }).ok, true);

    const appended = build({ sourceDir: sourceWithOneNote(), outputDir, append: true, env: DEID_ON });

    assert.equal(appended.ok, false);
    assert.match(appended.error, /de-identification/);
  });

  it("refuses a raw append to a de-identified index", () => {
    const outputDir = scratch("deid-index");

    assert.equal(build({ sourceDir: corpus(), outputDir, env: DEID_ON }).ok, true);

    const appended = build({ sourceDir: sourceWithOneNote(), outputDir, append: true });

    assert.equal(appended.ok, false);
    assert.match(appended.error, /de-identification/);
  });

  it("refuses an append under a different secret", () => {
    const outputDir = scratch("deid-index");

    assert.equal(build({ sourceDir: corpus(), outputDir, env: DEID_ON }).ok, true);

    const appended = build({
      sourceDir: sourceWithOneNote(),
      outputDir,
      append: true,
      env: { DEID_ENABLED: "true", DEID_SECRET: OTHER_SECRET },
    });

    assert.equal(appended.ok, false);
    assert.match(appended.error, /de-identification/);
  });
});

describe("the default -- de-identification unset", () => {
  it("leaves the fingerprint and the manifest exactly as they were", () => {
    // the regression guard for the committed index and for teammates' half-
    // finished builds: neither may notice this story exists until it is
    // switched on.
    const outputDir = scratch("default");
    const built = build({ sourceDir: corpus(), outputDir });

    assert.equal(built.ok, true, built.error);

    const { schemaVersion } = runInChild(
      `const { SCHEMA_VERSION } = await import(${JSON.stringify(METADATA)});
       process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify({ schemaVersion: SCHEMA_VERSION }) + ${JSON.stringify(MARK)});`,
    );

    assert.equal(
      built.fingerprint,
      `schema:${schemaVersion}|provider:hash|model:bge-m3|dim:1024|chunk:1600/200|contextual:template`,
    );

    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, "manifest.json"), "utf8"));

    assert.equal("deidentification" in manifest, false);

    // and the raw-scan above is not passing vacuously: the same corpus built
    // without the transform does contain the names, in the same files.
    const chunks = readEverything(outputDir).filter((file) => file.file.startsWith("chunks-"));

    assert.ok(chunks.some((file) => file.text.includes("quillane")));
  });

  it("adds the de-identification key to the fingerprint only when enabled", () => {
    const outputDir = scratch("fp");
    const built = build({ sourceDir: corpus(), outputDir, env: DEID_ON });

    assert.match(built.fingerprint, /\|deid:athlete_name:[0-9a-f]{8}$/);
  });
});

describe("the table store", () => {
  it("serves pseudonyms, matching the index, never the raw names", () => {
    const sourceDir = corpus();

    const result = runInChild(
      `
      const { loadTables } = await import(${JSON.stringify(TABLES)});
      const { pseudonym } = await import(${JSON.stringify(DEID)});
      const tables = await loadTables([${JSON.stringify(sourceDir)}]);
      process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify({
        rows: tables.flatMap((table) => table.rows),
        names: tables.map((table) => table.name),
        expected: pseudonym("athlete_name", "Zorvath Quillane", { secret: ${JSON.stringify(SECRET)}, prefix: "ATHLETE" }),
      }) + ${JSON.stringify(MARK)});
      `,
      DEID_ON,
    );

    const text = JSON.stringify(result.rows).toLowerCase();

    for (const name of RAW) assert.equal(text.includes(name), false, `"${name}" reached the table store`);

    const ranked = result.rows.find((row) => row.playerId === 800000001);
    const match = result.rows.find((row) => row.match_id === "M-2");

    assert.equal(ranked.playerFamilyName, result.expected);
    // the same athlete, in two files, still joins.
    assert.equal(match.opponent_name, result.expected);
  });

  it("serves the raw values when de-identification is off", () => {
    const sourceDir = corpus();

    const result = runInChild(
      `
      const { loadTables } = await import(${JSON.stringify(TABLES)});
      const tables = await loadTables([${JSON.stringify(sourceDir)}]);
      process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify(tables.flatMap((table) => table.rows)) + ${JSON.stringify(MARK)});
      `,
    );

    assert.ok(result.some((row) => row.opponent_name === "Zorvath Quillane"));
  });
});
