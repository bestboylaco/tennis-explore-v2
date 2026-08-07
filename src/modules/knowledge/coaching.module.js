import {
  retrieveCoachKnowledge,
} from "../orchestration/retrievers/coachRetriever.js";

export const coachingModule =
  Object.freeze({
    moduleId:
      "coaching",

    label:
      "Coach Interviews",

    description:
      "Coaching interviews, practitioner insights, and internal coaching notes.",

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


    retriever:
      retrieveCoachKnowledge,

    isEnabled:
      true,
  });

export default coachingModule;