import {
  archiveSource,
  createSource,
  getAllSources,
  getSourceById,
} from "../services/source.service.js";
import { runIngestion } from "../../ingestion/ingestion.service.js";

export async function createSourceController(req, res) {
  const source = await createSource(req.body);

  return res.status(201).json({
    success: true,
    data: source,
  });
}

export async function getAllSourcesController(req, res) {
  const sources = await getAllSources();

  return res.status(200).json({
    success: true,
    data: sources,
    meta: {
      count: sources.length,
    },
  });
}

export async function getSourceByIdController(req, res) {
  const source = await getSourceById(req.params.sourceId);

  if (!source) {
    return res.status(404).json({
      success: false,
      error: {
        code: "SOURCE_NOT_FOUND",
        message: "Source not found.",
      },
    });
  }

  return res.status(200).json({
    success: true,
    data: source,
  });
}

// Triggers an instrumented ingestion run. The pipeline stages themselves belong
// to Epic 2; this exists so an ingestion run can be observed producing a
// telemetry record (TENISE-26 definition of done).
export async function ingestSourceController(req, res) {
  const result = await runIngestion(req.params.sourceId);

  return res.status(202).json({
    success: true,
    message: "Ingestion run recorded.",
    data: result,
  });
}

export async function archiveSourceController(req, res) {
  const source = await archiveSource(req.params.sourceId);

  if (!source) {
    return res.status(404).json({
      success: false,
      error: {
        code: "SOURCE_NOT_FOUND",
        message: "Source not found.",
      },
    });
  }

  return res.status(200).json({
    success: true,
    message: "Source archived successfully.",
    data: source,
  });
}