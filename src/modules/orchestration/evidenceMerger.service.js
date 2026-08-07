import {
  rankRetrievalResults,
} from "../retrieval/ranking.service.js";

import {
  buildEvidenceSummary,
  analyseEvidenceConsensus,
} from "../evidence/index.js";

import {
  DEFAULT_ORCHESTRATION_OPTIONS,
} from "./orchestration.types.js";

/**
 * Merge successful retriever executions into one
 * ranked, diversified and analysed evidence collection.
 */
export function mergeRetrievedEvidence({
  executions = [],
  finalLimit =
    DEFAULT_ORCHESTRATION_OPTIONS.finalLimit,
  minimumScore =
    DEFAULT_ORCHESTRATION_OPTIONS.minimumScore,
  maxPerSource =
    DEFAULT_ORCHESTRATION_OPTIONS.maxPerSource,
  maxPerModule =
    DEFAULT_ORCHESTRATION_OPTIONS.maxPerModule,
} = {}) {
  if (!Array.isArray(executions)) {
    throw new TypeError(
      "Retriever executions must be an array."
    );
  }

  const candidates =
    executions.flatMap((execution) => {
      const moduleId =
        execution?.moduleId ||
        execution?.result?.moduleId ||
        null;

      const results =
        Array.isArray(
          execution?.result?.results
        )
          ? execution.result.results
          : [];

      return results.map((result) => ({
        ...result,
        moduleId,
      }));
    });

  const evidence =
    rankRetrievalResults({
      results:
        candidates,

      minimumScore,

      limit:
        finalLimit,

      maxPerSource,

      maxPerModule,
    });

  const summary =
    buildEvidenceSummary(
      evidence
    );

  const consensus =
    analyseEvidenceConsensus({
      evidence,
    });

  return {
    totalExecutions:
      executions.length,

    totalCandidates:
      candidates.length,

    totalEvidence:
      evidence.length,

    evidence,

    summary,

    consensus,
  };
}