import test, { describe, it } from "node:test";

import assert from "node:assert/strict";

import {
  prepareVisualEvidence,
  restructureTabularOcrText,
} from "../../src/modules/ingestion/visualEvidencePreparation.service.js";


function createImage() {
  return {
    index:
      0,

    imageId:
      "frame-001",

    title:
      "Test frame",

    path:
      "frames/frame_001.jpg",

    sourceDocument:
      "video-001",

    page:
      null,

    legacyCaption:
      "Old unverified caption.",

    ocrText:
      "VISIBLE OCR TEXT",

    videoId:
      "video-001",

    timestampSeconds:
      45,
  };
}


function createTrustedFrameResult({
  evidenceEligible =
    true,
} = {}) {
  return {
    trustedEvidence: {
      status:
        evidenceEligible
          ? "trusted"
          : "rejected",

      evidenceEligible,

      quality: {
        status:
          evidenceEligible
            ? "good"
            : "bad",

        usable:
          evidenceEligible,

        qualityScore:
          evidenceEligible
            ? 1
            : 0,

        issues:
          evidenceEligible
            ? []
            : [
                "severe_noise",
              ],
      },

      caption: {
        text:
          evidenceEligible
            ? "A trusted visual caption."
            : null,

        status:
          evidenceEligible
            ? "generated"
            : "abstained",
      },

      verification: {
        status:
          evidenceEligible
            ? "verified"
            : "abstained",

        evidenceEligible,
      },

      source: {
        videoId:
          "video-001",

        timestampSeconds:
          45,

        framePath:
          "C:\\test\\frames\\frame_001.jpg",
      },
    },
  };
}


test(
  "prepares trusted visual evidence for indexing",
  async () => {
    let receivedRequest =
      null;


    const processFrameFn =
      async (
        request,
      ) => {
        receivedRequest =
          request;

        return createTrustedFrameResult();
      };


    const result =
      await prepareVisualEvidence({
        image:
          createImage(),

        manifestPath:
          "C:\\test\\manifest.json",

        processFrameFn,
      });


    assert.ok(
      result,
    );

    assert.equal(
      result.evidenceEligible,
      true,
    );

    assert.equal(
      result.qualityStatus,
      "good",
    );

    assert.equal(
      result.verificationStatus,
      "verified",
    );

    assert.equal(
      receivedRequest.mode,
      "general_caption",
    );
  },
);


test(
  "uses trusted caption and OCR as searchable text",
  async () => {
    const result =
      await prepareVisualEvidence({
        image:
          createImage(),

        manifestPath:
          "C:\\test\\manifest.json",

        processFrameFn:
          async () =>
            createTrustedFrameResult(),
      });


    assert.equal(
      result.text,
      "A trusted visual caption. VISIBLE OCR TEXT",
    );
  },
);


test(
  "does not use legacy caption as searchable text",
  async () => {
    const result =
      await prepareVisualEvidence({
        image:
          createImage(),

        manifestPath:
          "C:\\test\\manifest.json",

        processFrameFn:
          async () =>
            createTrustedFrameResult(),
      });


    assert.equal(
      result.text.includes(
        "Old unverified caption",
      ),
      false,
    );
  },
);


test(
  "returns null when trusted evidence is rejected",
  async () => {
    const result =
      await prepareVisualEvidence({
        image:
          createImage(),

        manifestPath:
          "C:\\test\\manifest.json",

        processFrameFn:
          async () =>
            createTrustedFrameResult({
              evidenceEligible:
                false,
            }),
      });


    assert.equal(
      result,
      null,
    );
  },
);


test(
  "preserves quality metadata",
  async () => {
    const result =
      await prepareVisualEvidence({
        image:
          createImage(),

        manifestPath:
          "C:\\test\\manifest.json",

        processFrameFn:
          async () =>
            createTrustedFrameResult(),
      });


    assert.equal(
      result.qualityStatus,
      "good",
    );

    assert.equal(
      result.qualityScore,
      1,
    );

    assert.deepEqual(
      result.qualityIssues,
      [],
    );
  },
);


test(
  "preserves video and timestamp traceability",
  async () => {
    const result =
      await prepareVisualEvidence({
        image:
          createImage(),

        manifestPath:
          "C:\\test\\manifest.json",

        processFrameFn:
          async () =>
            createTrustedFrameResult(),
      });


    assert.equal(
      result.videoId,
      "video-001",
    );

    assert.equal(
      result.timestampSeconds,
      45,
    );

    assert.equal(
      result.framePath,
      "C:\\test\\frames\\frame_001.jpg",
    );
  },
);


// ---------------------------------------------------------------------------
// TENISE-66 -- a tabular figure's OCR text must not be flattened into a run
// of words a generation model can misread column-to-column.
// ---------------------------------------------------------------------------

describe("restructureTabularOcrText", () => {
  it("pairs each row's cells with their header instead of leaving them positional", () => {
    // reproduces the bug report: a stats graphic whose OCR text lines up
    // "Men" and "Women" with their figures only by column position.
    const ocrText =
      "Metric          Men     Women\n" +
      "Distance (km)   3.2     2.8\n" +
      "Avg speed (kph)  18      16";

    assert.equal(
      restructureTabularOcrText(ocrText),
      "Metric: Distance (km), Men: 3.2, Women: 2.8\n" +
        "Metric: Avg speed (kph), Men: 18, Women: 16",
    );
  });

  it("leaves a plain caption or a single OCR word untouched", () => {
    // no second line, so there is nothing to align against -- must not invent
    // a table out of one line of text.
    assert.equal(restructureTabularOcrText("VISIBLE OCR TEXT"), null);
    assert.equal(restructureTabularOcrText(""), null);
    assert.equal(restructureTabularOcrText(undefined), null);
  });

  it("refuses to guess when a row has a different number of cells than the header", () => {
    // a header with 3 cells and a body line with 2 cannot be paired without
    // inventing which cell went missing, so this must fall back rather than
    // produce a confidently wrong pairing.
    assert.equal(
      restructureTabularOcrText("Metric   Men   Women\nDistance (km)   3.2"),
      null,
    );
  });

  it("requires a number, so two wrapped caption lines are not mistaken for a table", () => {
    const wrappedCaption =
      "A chart showing the   relative split\n" + "between groups surveyed   recently";

    assert.equal(restructureTabularOcrText(wrappedCaption), null);
  });
});

describe("prepareVisualEvidence -- tabular figures", () => {
  it("TENISE-66: indexes a men's-vs-women's distance figure as label:value text, not a flattened column dump", async () => {
    const image = {
      ...createImage(),
      ocrText: "Metric          Men     Women\nDistance (km)   3.2     2.8",
    };

    const result = await prepareVisualEvidence({
      image,
      manifestPath: "C:\\test\\manifest.json",
      processFrameFn: async () => createTrustedFrameResult(),
    });

    // before this fix, result.text was
    // "A trusted visual caption. Metric          Men     Women\nDistance (km)   3.2     2.8"
    // -- a flattened figure whose only link between a number and its column
    // was whitespace, which is exactly what let a generation model pair
    // the women's figure with the men's header (and vice versa).
    assert.ok(result.text.includes("Men: 3.2"));
    assert.ok(result.text.includes("Women: 2.8"));

    // the acceptance condition: the two figures must never be readable as
    // attached to the other column's label.
    assert.ok(!result.text.includes("Men: 2.8"));
    assert.ok(!result.text.includes("Women: 3.2"));
  });

  it("still joins a non-tabular caption and OCR snippet exactly as before", async () => {
    // guards the existing behaviour above: a figure that is not a table must
    // not be run through the table pairing logic at all.
    const result = await prepareVisualEvidence({
      image: createImage(),
      manifestPath: "C:\\test\\manifest.json",
      processFrameFn: async () => createTrustedFrameResult(),
    });

    assert.equal(result.text, "A trusted visual caption. VISIBLE OCR TEXT");
  });
});