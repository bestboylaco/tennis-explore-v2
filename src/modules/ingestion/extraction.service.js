import fs from "fs/promises";
import path from "path";
import { PDFParse } from "pdf-parse";

export async function extractTextFromFile(file) {
  if (!file?.path) {
    throw new Error("A valid uploaded file is required.");
  }

  const extension = path.extname(file.originalname).toLowerCase();

  switch (extension) {
    case ".txt":
    case ".md":
    case ".json":
    case ".csv":
      return extractPlainText(file.path);

    case ".pdf":
      return extractPdfText(file.path);

    default:
      throw new Error(
        `Unsupported file type: ${extension || "unknown"}`
      );
  }
}

async function extractPdfText(filePath) {
  const buffer = await fs.readFile(filePath);

  const parser = new PDFParse({
    data: buffer,
  });

  try {
    const result = await parser.getText();

    const cleanedText = result.text?.trim();

    if (!cleanedText) {
      throw new Error(
        "The uploaded PDF contains no readable text."
      );
    }

    return {
      text: cleanedText,
      characterCount: cleanedText.length,
      pageCount: result.total ?? null,
    };
  } finally {
    await parser.destroy();
  }
}

async function extractPlainText(filePath) {
  const text = await fs.readFile(filePath, "utf8");

  const cleanedText = text.trim();

  if (!cleanedText) {
    throw new Error(
      "The uploaded file contains no readable text."
    );
  }

  return {
    text: cleanedText,
    characterCount: cleanedText.length,
  };
}