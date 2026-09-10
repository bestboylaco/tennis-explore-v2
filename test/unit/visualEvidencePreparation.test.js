import test from "node:test";

import assert from "node:assert/strict";

import {
  prepareVisualEvidence,
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