import mongoose from "mongoose";
import dotenv from "dotenv";

import Source from "../src/modules/sources/models/source.model.js";
import { ingestUploadedSource } from "../src/modules/ingestion/ingestion.service.js";

dotenv.config();

const sourceId = "6a6951b2ba18fc9146e37cdc";

try {
  await mongoose.connect(process.env.MONGODB_URI);

  const source = await Source.findById(sourceId);

  if (!source) {
    throw new Error("Source not found.");
  }

  console.log(
    JSON.stringify(source.toObject(), null, 2)
  );

  const result = await ingestUploadedSource(source);

  console.log("\n✅ INGESTION SUCCESSFUL");
  console.log("-----------------------");

  console.log("Source ID:", result.source.id);
  console.log(
    "Status:",
    result.source.processingStatus
  );

  console.log(
    "Character count:",
    result.document.characterCount
  );

  console.log(
    "Language:",
    result.document.technicalMetadata.language
  );

  console.log(
    "Word count:",
    result.document.technicalMetadata.wordCount
  );

  console.log(
    "Reading time:",
    result.document.technicalMetadata
      .estimatedReadingTimeMinutes,
    "minute(s)"
  );

  console.log(
    "Document type:",
    result.document.semanticMetadata.documentType
  );

  console.log("\n🎾 DOMAIN METADATA");
  console.log("------------------");

  console.log(
    "Domain metadata:",
    result.document.domainMetadata
  );

  console.log(
    "Players:",
    result.document.domainMetadata.players
  );

  console.log(
    "Score:",
    result.document.domainMetadata.score
  );

  console.log(
    "Winner:",
    result.document.domainMetadata.winner
  );

  console.log(
    "Tournament:",
    result.document.domainMetadata.tournament
  );

  console.log(
    "Round:",
    result.document.domainMetadata.round
  );

  console.log(
    "Match date:",
    result.document.domainMetadata.matchDate
  );

  console.log("\n🏗️ STRUCTURAL METADATA");
  console.log("----------------------");

  console.log(
    "Heading count:",
    result.document.structuralMetadata.headingCount
  );

  console.log(
    "Headings:",
    result.document.structuralMetadata.headings
  );

  console.log(
    "Paragraphs:",
    result.document.structuralMetadata.paragraphCount
  );

  console.log(
    "Blank lines:",
    result.document.structuralMetadata.blankLineCount
  );

  console.log(
    "Bullet items:",
    result.document.structuralMetadata.bulletListCount
  );

  console.log(
    "Numbered items:",
    result.document.structuralMetadata.numberedListCount
  );

  console.log("\n✅ DOMAIN VALIDATION");
  console.log("--------------------");

  console.log(
    "Domain validation:",
    result.document.domainValidation
  );

  console.log(
    "Metadata valid:",
    result.document.domainValidation.isValid
  );

  console.log(
    "Validation score:",
    result.document.domainValidation.score
  );

  console.log(
    "Validation warnings:",
    result.document.domainValidation.warnings
  );

  console.log(
    "Validation errors:",
    result.document.domainValidation.errors
  );

  console.log("\n📦 CHUNKING RESULT");
  console.log("------------------");

  console.log(
    "Chunking summary:",
    JSON.stringify(result.chunking, null, 2)
  );

  console.log(
    "Total chunks:",
    result.chunks.length
  );

  result.chunks.forEach((chunk) => {
    console.log("\n------------------");
    console.log(`Chunk ${chunk.index}`);
    console.log("ID:", chunk.id);

    console.log(
      "Section:",
      chunk.metadata.sectionTitle
    );

    console.log(
      "Characters:",
      chunk.characterCount
    );

    console.log(
      "Warnings:",
      chunk.metadata.validationWarnings || []
    );

    console.log(
      "Preview:",
      chunk.text.slice(0, 250)
    );
  });

  console.log("\n🧠 EMBEDDING RESULT");
  console.log("-------------------");

  console.log(
    "Embedding summary:",
    JSON.stringify(result.embedding, null, 2)
  );

  if (!result.embedding) {
    throw new Error(
      "Embedding summary was not added to the pipeline."
    );
  }

  console.log(
    "Provider:",
    result.embedding.provider
  );

  console.log(
    "Model:",
    result.embedding.model
  );

  console.log(
    "Dimensions:",
    result.embedding.dimensions
  );

  console.log(
    "Requested:",
    result.embedding.totalRequested
  );

  console.log(
    "Embedded:",
    result.embedding.totalEmbedded
  );

  console.log(
    "Failed:",
    result.embedding.totalFailed
  );

  result.chunks.forEach((chunk) => {
    const embedding = chunk.embedding;

    console.log("\n------------------");
    console.log(`Embedding for chunk ${chunk.index}`);
    console.log("Chunk ID:", chunk.id);

    console.log(
      "Section:",
      chunk.metadata.sectionTitle
    );

    console.log(
      "Embedding attached:",
      Boolean(embedding)
    );

    console.log(
      "Provider:",
      embedding?.provider || null
    );

    console.log(
      "Model:",
      embedding?.model || null
    );

    console.log(
      "Dimensions:",
      embedding?.dimensions || 0
    );

    console.log(
      "Vector preview:",
      embedding?.vector?.slice(0, 8) || []
    );
  });

  const chunksWithoutEmbeddings =
    result.chunks.filter(
      (chunk) =>
        !Array.isArray(chunk.embedding?.vector) ||
        chunk.embedding.vector.length === 0
    );

  console.log("\n🔎 EMBEDDING VERIFICATION");
  console.log("-------------------------");

  console.log(
    "Chunks without embeddings:",
    chunksWithoutEmbeddings.length
  );

  console.log(
    "All chunks embedded:",
    chunksWithoutEmbeddings.length === 0
  );

  if (chunksWithoutEmbeddings.length > 0) {
    console.log(
      "Missing chunk IDs:",
      chunksWithoutEmbeddings.map(
        (chunk) => chunk.id
      )
    );
  }

  console.log("\n📄 DOCUMENT PREVIEW");
  console.log("-------------------");

  console.log(
    result.document.text.slice(0, 500)
  );
} catch (error) {
  console.error(
    "\n❌ Ingestion failed:",
    error.message
  );

  console.error(error.stack);
} finally {
  await mongoose.disconnect();
}