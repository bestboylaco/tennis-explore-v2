import {
  generateStorageKey,
} from "./src/infrastructure/storage/storageKey.service.js";

console.log(
  generateStorageKey({
    sourceType: "research_paper",
    originalFilename:
      "Tennis_Training.pdf",
  })
);

console.log(
  generateStorageKey({
    sourceType: "coach_interview",
    originalFilename:
      "Patrick.mp4",
  })
);

console.log(
  generateStorageKey({
    sourceType: "match_report",
    originalFilename:
      "Emma_vs_Iga.docx",
  })
);