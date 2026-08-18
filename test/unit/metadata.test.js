import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  contentHash,
  enforceSchema,
  extractAuthors,
  normaliseDate,
} from "../../src/modules/ingestion/metadata.service.js";
import { grantsForDocument } from "../../src/shared/constants/accessControl.js";

describe("date normalisation", () => {
  it("reads the partner's dd-mm-yyyy format as day first", () => {
    // the whole reason this function exists. javascript's Date() reads
    // "01-02-2025" as 2 january, american order, and a match date silently wrong
    // by ten months is a bug nobody notices until a coach does.
    assert.equal(normaliseDate("24-11-2025"), "2025-11-24");
    assert.equal(normaliseDate("01-02-2025"), "2025-02-01");
  });

  it("accepts slashes and iso", () => {
    assert.equal(normaliseDate("24/11/2025"), "2025-11-24");
    assert.equal(normaliseDate("2025-11-24"), "2025-11-24");
  });

  it("expands a bare year, which is all most papers give us", () => {
    assert.equal(normaliseDate("2022"), "2022-01-01");
  });

  it("rejects a date that is not on the calendar", () => {
    assert.equal(normaliseDate("31-02-2025"), null);
  });

  it("returns null for the partner's placeholder values", () => {
    for (const value of ["Not available", "", "n/a", "-", null]) {
      assert.equal(normaliseDate(value), null);
    }
  });
});

describe("author extraction", () => {
  it("reads a normal author line", () => {
    const authors = extractAuthors(
      "Thomas Perri,1,2 Machar Reid,2 Alistair Murphy,2 and Rob Duffield1\nSchool of Sport",
    );

    assert.deepEqual(authors, ["Thomas Perri", "Machar Reid", "Alistair Murphy", "Rob Duffield"]);
  });

  it("does not mistake the paper title for a list of people", () => {
    // the failure this was written against: every word of an academic title is
    // capitalised, so a naive pass returns "Determining Stroke" as an author.
    const authors = extractAuthors(
      "Original Research\nDetermining Stroke and Movement Profiles in Competitive Tennis Match-Play",
    );

    assert.deepEqual(authors, []);
  });

  it("reads the mdpi citation-block form", () => {
    const authors = extractAuthors("Citation: Perri, T.; Reid, M.; Murphy, A.; Howle, K.");

    assert.deepEqual(authors, ["T. Perri", "M. Reid", "A. Murphy", "K. Howle"]);
  });

  it("returns nothing rather than guessing", () => {
    assert.deepEqual(extractAuthors(""), []);
    assert.deepEqual(extractAuthors("Journal of Sports Sciences"), []);
  });
});

describe("the schema gate", () => {
  const valid = {
    chunk_id: "d#p0",
    doc_id: "d",
    modality: "document",
    source_type: "research_paper",
    title: "A paper",
    text: "some text",
    data_domain: "research",
    sensitivity: "public",
    program: "*",
    acl_groups: grantsForDocument({ domain: "research", sensitivity: "public", program: "*" }),
    authors: ["Thomas Perri"],
    event_date: "2022-01-01",
    ingested_at: new Date().toISOString(),
    content_hash: contentHash("some text"),
  };

  it("passes a well formed chunk", () => {
    assert.doesNotThrow(() => enforceSchema(valid));
  });

  it("rejects a chunk with no acl_groups", () => {
    assert.throws(() => enforceSchema({ ...valid, acl_groups: [] }), /acl_groups is empty/);
  });

  it("rejects acl_groups that contradict the classification", () => {
    // acl_groups is a denormalised copy of the classification. this catches
    // someone editing data_domain by hand and forgetting the grant string.
    assert.throws(
      () => enforceSchema({ ...valid, data_domain: "clinical" }),
      /does not match the classification/,
    );
  });

  it("requires event_date and authors to be present even when empty", () => {
    const { event_date: _date, ...noDate } = valid;
    const { authors: _authors, ...noAuthors } = valid;

    assert.throws(() => enforceSchema(noDate), /missing required key 'event_date'/);
    assert.throws(() => enforceSchema(noAuthors), /missing required key 'authors'/);
  });

  it("accepts a null event_date, because absent is different from forgotten", () => {
    assert.doesNotThrow(() => enforceSchema({ ...valid, event_date: null, authors: [] }));
  });
});

describe("content hashing", () => {
  it("collides for the same text extracted slightly differently", () => {
    // the corpus holds the same deck several times over, and two pdf
    // extractions of one page differ in whitespace and punctuation. if those
    // did not collide, deduplication would never fire on the duplicates that
    // actually exist.
    assert.equal(
      contentHash("Serve load rose 24% during tournaments."),
      contentHash("serve  load rose 24%   during tournaments"),
    );
  });

  it("differs for different text", () => {
    assert.notEqual(contentHash("serve load rose"), contentHash("serve load fell"));
  });
});
