import { readFile } from "node:fs/promises";

import {
  chatConfig,
} from "../../chat/chat.config.js";

import {
  FRAME_ADMISSION_MODE,
} from "../constants/frameAdmission.constants.js";

import {
  FRAME_INTERPRETABILITY_STATUS,
} from "../constants/frameInterpretability.constants.js";

import {
  createFrameInterpretabilityResult,
} from "../types/frameInterpretability.types.js";


const INTERPRETABILITY_SCHEMA = {
  type: "object",

  properties: {
    status: {
      type: "string",
      enum: Object.values(
        FRAME_INTERPRETABILITY_STATUS,
      ),
    },

    obstructionDetected: {
      type: "boolean",
    },

    reason: {
      type: "string",
    },
  },

  required: [
    "status",
    "obstructionDetected",
    "reason",
  ],

  additionalProperties: false,
};


function buildPrompt(mode) {
  if (
    mode ===
    FRAME_ADMISSION_MODE.GENERAL_CAPTION
  ) {
    return `
Evaluate whether this image is sufficiently interpretable.

Focus only on obstruction.

Use exactly one status:

clear
- Important visual information is not meaningfully blocked.

partially_obstructed
- Some information is blocked, but enough useful content remains.

insufficient
- Important visual information is blocked enough that the image should not be relied on.

Do not judge blur, brightness, noise, or compression.

Return JSON only.
`.trim();
  }


  if (
    mode ===
    FRAME_ADMISSION_MODE.PERSON_ANALYSIS
  ) {
    return `
Evaluate whether the person in this image is sufficiently visible.

Focus only on obstruction of the person.

Use exactly one status:

clear
- The person is not meaningfully obstructed.

partially_obstructed
- Part of the person is blocked, but enough remains visible.

insufficient
- Important parts of the person are blocked enough that reliable analysis should not be performed.

Do not identify the person.
Do not judge blur, brightness, noise, or compression.

Return JSON only.
`.trim();
  }


  throw new TypeError(
    `Unsupported interpretability mode: ${mode}`,
  );
}


async function imageToBase64(imageInput) {
  if (Buffer.isBuffer(imageInput)) {
    return imageInput.toString("base64");
  }


  if (
    typeof imageInput === "string" &&
    imageInput.trim().length > 0
  ) {
    const image =
      await readFile(imageInput);

    return image.toString("base64");
  }


  throw new TypeError(
    "Interpretability requires an image path or Buffer.",
  );
}


export async function evaluateFrameInterpretability({
  frameId,

  imageInput,

  mode =
    FRAME_ADMISSION_MODE.GENERAL_CAPTION,

  fetchFn = fetch,
} = {}) {
  if (
    typeof frameId !== "string" ||
    frameId.trim().length === 0
  ) {
    throw new TypeError(
      "Interpretability requires frameId.",
    );
  }


  const image =
    await imageToBase64(imageInput);


  const response =
    await fetchFn(
      `${chatConfig.ollamaBaseUrl}/api/chat`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          model:
            chatConfig.visionModel,

          messages: [
            {
              role: "user",

              content:
                buildPrompt(mode),

              images: [
                image,
              ],
            },
          ],

          format:
            INTERPRETABILITY_SCHEMA,

          think: false,

          stream: false,

          options: {
            temperature: 0,
            num_predict: 512,
          },
        }),
      },
    );


  if (!response.ok) {
    throw new Error(
      `Interpretability request failed with status ${response.status}`,
    );
  }


  const result =
    await response.json();


  const responseText =
    result.message?.content?.trim() ||
    result.message?.thinking?.trim();


  if (!responseText) {
    throw new Error(
      "Interpretability model returned no usable response.",
    );
  }


  let parsed;

  try {
    parsed =
      JSON.parse(responseText);
  } catch {
    throw new Error(
      `Interpretability model returned invalid JSON: ${responseText}`,
    );
  }


  return createFrameInterpretabilityResult({
    frameId,

    mode,

    status:
      parsed.status,

    obstructionDetected:
      parsed.obstructionDetected,

    reason:
      parsed.reason,
  });
}