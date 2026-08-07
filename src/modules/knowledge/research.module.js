import {
  retrieveResearchKnowledge,
} from "../orchestration/retrievers/researchRetriever.js";

/**
 * Research knowledge-module definition.
 *
 * This object is the single source of truth for:
 * - module identity
 * - display information
 * - supported source types
 * - retrieval implementation
 */
export const researchModule =
  Object.freeze({
    moduleId:
      "research",

    label:
      "Research Papers",

    description:
      "Peer-reviewed and evidence-based tennis research.",

    sourceTypes: [
      "research_paper",
    ],


    keywords: [
        "research",
        "study",
        "evidence",
        "scientific",
        "paper",
        "journal",
        "experiment",
        "analysis",
        "biomechanics",
        "training load",
    ],


    retriever:
      retrieveResearchKnowledge,

    isEnabled:
      true,
  });

export default researchModule;