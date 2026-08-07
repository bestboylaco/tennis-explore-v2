import {
  archiveSource,
  createSource,
  getAllSources,
  getSourceById,
} from "../services/source.service.js";

import {
  runIngestion,
} from "../../ingestion/ingestion.service.js";

import {
  uploadSourceFile,
} from "../services/upload.service.js";


export async function createSourceController(
  req,
  res
) {
  const source =
    await createSource(req.body);

  return res.status(201).json({
    success: true,
    data: source,
  });
}


export async function getAllSourcesController(
  req,
  res
) {
  const sources =
    await getAllSources();

  return res.status(200).json({
    success: true,
    data: sources,

    meta: {
      count:
        sources.length,
    },
  });
}


export async function getSourceByIdController(
  req,
  res
) {
  const source =
    await getSourceById(
      req.params.sourceId
    );

  if (!source) {
    return res.status(404).json({
      success: false,

      error: {
        code:
          "SOURCE_NOT_FOUND",

        message:
          "Source not found.",
      },
    });
  }

  return res.status(200).json({
    success: true,
    data: source,
  });
}


/*
 * Trigger telemetry-aware ingestion.
 *
 * This endpoint is used by the telemetry instrumentation
 * introduced by the team.
 */
export async function ingestSourceController(
  req,
  res
) {
  const result =
    await runIngestion(
      req.params.sourceId
    );

  return res.status(202).json({
    success: true,

    message:
      "Ingestion run recorded.",

    data: result,
  });
}


export async function archiveSourceController(
  req,
  res
) {
  const source =
    await archiveSource(
      req.params.sourceId
    );

  if (!source) {
    return res.status(404).json({
      success: false,

      error: {
        code:
          "SOURCE_NOT_FOUND",

        message:
          "Source not found.",
      },
    });
  }

  return res.status(200).json({
    success: true,

    message:
      "Source archived successfully.",

    data: source,
  });
}


export async function uploadSourceFileController(
  req,
  res
) {
  const {
    sourceId,
  } = req.params;

  if (!req.file) {
    return res.status(400).json({
      success: false,

      error: {
        code:
          "FILE_REQUIRED",

        message:
          "Please upload a file.",
      },
    });
  }

  const result =
    await uploadSourceFile({
      sourceId,
      file: req.file,
    });

  return res.status(200).json({
    success: true,

    message:
      "File uploaded to S3 and processed successfully.",

    data: result,
  });
}