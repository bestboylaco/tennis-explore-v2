import "dotenv/config";
import fs from "fs/promises";

import {
  generateStorageKey,
} from "./src/infrastructure/storage/storageKey.service.js";

import {
  uploadFile,
} from "./src/infrastructure/storage/storage.service.js";

async function main() {
  try {
    const filePath =
      "./Differentiating_Stroke_and_Movement_Accelerometer.pdf";

    const fileBuffer =
      await fs.readFile(filePath);

    const storageKey =
      generateStorageKey({
        sourceType:
          "research_paper",

        originalFilename:
          "Differentiating_Stroke_and_Movement_Accelerometer.pdf",
      });

    const result =
      await uploadFile({
        fileBuffer,
        storageKey,
        mimeType:
          "application/pdf",
      });

    console.log(
      "✅ Upload successful"
    );

    console.log(result);
  } catch (error) {
    console.error(
      "❌ Upload failed:",
      error
    );
  }
}

main();