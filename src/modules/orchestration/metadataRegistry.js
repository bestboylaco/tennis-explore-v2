export const KNOWLEDGE_MODULES = Object.freeze({
  RESEARCH: Object.freeze({
    id: "research",
    label: "Research Papers",

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
  }),

  COACHING: Object.freeze({
    id: "coaching",
    label: "Coach Interviews",

    sourceTypes: [
      "coach_interview",
      "internal_note",
    ],

    keywords: [
      "coach",
      "coaching",
      "drill",
      "practice",
      "training",
      "technique",
      "strategy",
      "tactical",
      "development",
    ],
  }),

  CONFERENCE: Object.freeze({
    id: "conference",
    label: "Conference Content",

    sourceTypes: [
      "conference_transcript",
    ],

    keywords: [
      "conference",
      "presentation",
      "speaker",
      "seminar",
      "workshop",
      "session",
    ],
  }),

  RANKINGS: Object.freeze({
    id: "rankings",
    label: "Ranking Data",

    sourceTypes: [
      "ranking_data",
    ],

    keywords: [
      "ranking",
      "rank",
      "points",
      "position",
      "seed",
      "standings",
    ],
  }),

  MATCHES: Object.freeze({
    id: "matches",
    label: "Match Reports",

    sourceTypes: [
      "match_report",
      "player_report",
    ],

    keywords: [
      "match",
      "score",
      "opponent",
      "performance",
      "serve percentage",
      "break point",
      "winner",
      "unforced error",
    ],
  }),
});

export function getKnowledgeModules() {
  return Object.values(
    KNOWLEDGE_MODULES
  );
}

export function getKnowledgeModuleById(
  moduleId
) {
  if (
    typeof moduleId !== "string" ||
    moduleId.trim().length === 0
  ) {
    return null;
  }

  const normalisedModuleId =
    moduleId.trim().toLowerCase();

  return (
    getKnowledgeModules().find(
      (knowledgeModule) =>
        knowledgeModule.id ===
        normalisedModuleId
    ) || null
  );
}