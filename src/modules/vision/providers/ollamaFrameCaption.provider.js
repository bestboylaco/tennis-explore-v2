import {
  readFile,
} from "node:fs/promises";

import {
  chatConfig,
} from "../../chat/chat.config.js";

import {
  createFrameCaptionProvider,
} from "./frameCaption.provider.js";

import {
  FRAME_CAPTION_PROMPT,
} from "../prompts/frameCaption.prompt.js";


async function imageToBase64(imageInput) {
  if (Buffer.isBuffer(imageInput)) {
    return imageInput.toString(
      "base64",
    );
  }


  const buffer =
    await readFile(
      imageInput,
    );


  return buffer.toString(
    "base64",
  );
}


export function createOllamaFrameCaptionProvider() {
  return createFrameCaptionProvider({
    name:
      "ollama",

    model:
      chatConfig.visionModel,

    generate:
      async ({
        imageInput,
      }) => {
        const image =
          await imageToBase64(
            imageInput,
          );


        const url =
          `${chatConfig.ollamaBaseUrl}/api/chat`;


        let response;


        try {
          response =
            await fetch(
              url,
              {
                method:
                  "POST",

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
                        role:
                          "user",

                        content:
                          FRAME_CAPTION_PROMPT,

                        images: [
                          image,
                        ],
                      },
                    ],

                    stream:
                      false,
                  }),
              },
            );
        } catch (error) {
          throw new Error(
            `Could not reach Ollama at ${url}: ${error.message}`,
          );
        }


        if (!response.ok) {
          const body =
            await response
              .text()
              .catch(
                () => "",
              );


          throw new Error(
            `Ollama vision request failed with status ${response.status}: ${body}`,
          );
        }


        const result =
          await response.json();


        const caption =
          result.message
            ?.content
            ?.trim();


        if (!caption) {
          throw new Error(
            "Ollama vision model returned an empty caption.",
          );
        }


        return caption;
      },
  });
}