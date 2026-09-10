import {
  readFile,
} from "node:fs/promises";

import {
  chatConfig,
} from "../../chat/chat.config.js";


export const CAPTION_GROUNDING_PROMPT_VERSION =
  "caption-grounding-v1";


const VALID_STATUSES =
  new Set([
    "supported",
    "uncertain",
    "unsupported",
  ]);


const GROUNDING_SCHEMA =
  Object.freeze({
    type: "object",

    properties: {
      claims: {
        type: "array",

        items: {
          type: "object",

          properties: {
            claim: {
              type: "string",
            },

            status: {
              type: "string",

              enum: [
                "supported",
                "uncertain",
                "unsupported",
              ],
            },

            reason: {
              type: "string",
            },
          },

          required: [
            "claim",
            "status",
            "reason",
          ],

          additionalProperties: false,
        },
      },
    },

    required: [
      "claims",
    ],

    additionalProperties: false,
  });


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


async function imageToBase64(
  imagePath,
) {
  const buffer =
    await readFile(
      imagePath,
    );

  return buffer.toString(
    "base64",
  );
}


function buildGroundingPrompt(
  caption,
) {
  return `
You are verifying visual evidence.

Look at the image and evaluate the generated caption below.

Generated caption:
${caption}

Instructions:

1. Split the caption into small atomic visual claims.
2. Check every claim directly against the image.
3. Do not use outside knowledge.
4. Do not guess identity, brand, event, location, intention, or context.
5. Text claims are supported only when the text is visibly readable.
6. If an object or detail cannot be seen clearly enough, mark it uncertain.
7. Mark a claim unsupported when the image does not support it.
8. Preserve the meaning of the original claim.
9. Do not silently correct or rewrite unsupported information.
10. Keep each reason brief and factual.

Return JSON only.

Use exactly this structure:

{
  "claims": [
    {
      "claim": "one visual claim",
      "status": "supported",
      "reason": "brief visual reason"
    }
  ]
}

Allowed status values:

supported
uncertain
unsupported
`.trim();
}


function validateClaims(
  claims,
) {
  if (!Array.isArray(claims)) {
    throw new Error(
      "Grounding result must contain a claims array.",
    );
  }

  if (claims.length === 0) {
    throw new Error(
      "Grounding result must contain at least one claim.",
    );
  }

  return claims.map(
    (claim, index) => {
      if (
        !isNonEmptyString(
          claim?.claim,
        )
      ) {
        throw new Error(
          `Claim ${index + 1} has invalid text.`,
        );
      }

      if (
        !VALID_STATUSES.has(
          claim.status,
        )
      ) {
        throw new Error(
          `Claim ${index + 1} has invalid status: ${claim.status}`,
        );
      }

      if (
        typeof claim.reason !==
        "string"
      ) {
        throw new Error(
          `Claim ${index + 1} has invalid reason.`,
        );
      }

      return {
        claim:
          claim.claim.trim(),

        status:
          claim.status,

        reason:
          claim.reason.trim(),
      };
    },
  );
}


export function summarizeCaptionGrounding(
  claims,
) {
  const supported =
    claims.filter(
      (claim) =>
        claim.status ===
        "supported",
    ).length;

  const uncertain =
    claims.filter(
      (claim) =>
        claim.status ===
        "uncertain",
    ).length;

  const unsupported =
    claims.filter(
      (claim) =>
        claim.status ===
        "unsupported",
    ).length;

  const evidenceEligible =
    claims.length > 0 &&
    uncertain === 0 &&
    unsupported === 0;

  return {
    status:
      evidenceEligible
        ? "verified"
        : "unreliable",

    supported,
    uncertain,
    unsupported,

    totalClaims:
      claims.length,

    evidenceEligible,
  };
}


export async function groundFrameCaption({
  imagePath,
  caption,
} = {}) {
  if (!isNonEmptyString(imagePath)) {
    throw new TypeError(
      "imagePath is required.",
    );
  }

  if (!isNonEmptyString(caption)) {
    throw new TypeError(
      "caption is required.",
    );
  }

  const image =
    await imageToBase64(
      imagePath,
    );

  const response =
    await fetch(
      `${chatConfig.ollamaBaseUrl}/api/chat`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            model:
              chatConfig.visionModel,

            messages: [
              {
                role: "user",

                content:
                  buildGroundingPrompt(
                    caption,
                  ),

                images: [
                  image,
                ],
              },
            ],

            format:
              GROUNDING_SCHEMA,

            think: false,
            stream: false,

            options: {
              temperature: 0,
              num_predict: 2048,
            },
          }),
      },
    );

  if (!response.ok) {
    const body =
      await response
        .text()
        .catch(
          () => "",
        );

    throw new Error(
      `Caption grounding request failed with status ${response.status}: ${body}`,
    );
  }

  const result =
    await response.json();

  const groundingText =
    result.message
      ?.content
      ?.trim() ||
    result.message
      ?.thinking
      ?.trim();

  if (!groundingText) {
    throw new Error(
      "Caption grounding model returned no usable response.",
    );
  }

  let parsed;

  try {
    parsed =
      JSON.parse(
        groundingText,
      );
  } catch (error) {
    throw new Error(
      `Caption grounding model returned invalid JSON: ${groundingText}`,
      {
        cause: error,
      },
    );
  }

  const claims =
    validateClaims(
      parsed.claims,
    );

  return {
    provider: "ollama",

    model:
      chatConfig.visionModel,

    promptVersion:
      CAPTION_GROUNDING_PROMPT_VERSION,

    claims,

    summary:
      summarizeCaptionGrounding(
        claims,
      ),
  };
}
