import fsp from "node:fs/promises";

import {
  FRAME_ADMISSION_MODE,
  processFrame,
} from "../index.js";


export async function analyzeVisualEvidence(
  req,
  res,
) {
  if (!req.file) {
    return res.status(400).json({
      success: false,

      error: {
        code: "IMAGE_REQUIRED",
        message: "Please upload an image.",
      },
    });
  }


  try {
    const result =
      await processFrame({
        frameId:
          req.file.originalname,

        imageInput:
          req.file.path,

        mode:
          FRAME_ADMISSION_MODE
            .GENERAL_CAPTION,

        source: {
          videoId: null,

          timestampSeconds:
            null,

          framePath:
            req.file.path,
        },
      });


    return res.status(200).json({
      success: true,

      data: {
        file: {
          name:
            req.file.originalname,

          size:
            req.file.size,

          mimeType:
            req.file.mimetype,
        },


        quality: {
          status:
            result.frameQuality.status,

          usable:
            result.frameQuality.usable,

          qualityScore:
            result.frameQuality.qualityScore,

          issues:
            result.frameQuality.issues,

          metrics:
            result.frameQuality.metrics,
        },


        interpretability:
          result.interpretability
            ? {
                status:
                  result.interpretability.status,

                obstructionDetected:
                  result.interpretability
                    .obstructionDetected,

                interpretable:
                  result.interpretability
                    .interpretable,

                evidenceEligible:
                  result.interpretability
                    .evidenceEligible,

                reason:
                  result.interpretability.reason,
              }
            : null,


        admission: {
          eligible:
            result.admission.eligible,

          reasons:
            result.admission.reasons ??
            [],

          reason:
            result.admission.reason ??
            null,
        },


        caption: {
          status:
            result.caption.status,

          text:
            result.caption.caption ??
            null,

          reason:
            result.caption.reason ??
            null,
        },


        verification: {
          status:
            result.verification.status,

          evidenceEligible:
            result.verification
              .evidenceEligible,

          issues:
            result.verification.issues ??
            [],
        },


        trustedEvidence: {
          status:
            result.trustedEvidence.status,

          evidenceEligible:
            result.trustedEvidence
              .evidenceEligible,
        },


        searchable:
          result.trustedEvidence
            .evidenceEligible === true,
      },
    });
  } finally {
    // Browser uploads are temporary.
    await fsp
      .unlink(req.file.path)
      .catch(() => {});
  }
}