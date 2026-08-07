import {
  retrieveConferenceKnowledge,
} from "../orchestration/retrievers/conferenceRetriever.js";

export const conferenceModule =
  Object.freeze({
    moduleId:
      "conference",

    label:
      "Conference Transcripts",

    description:
      "Tennis conference presentations, talks, and transcripts.",

    sourceTypes: [
      "conference_transcript",
    ],


    label:
        "Conference Content",

        keywords: [
        "conference",
        "presentation",
        "speaker",
        "seminar",
        "workshop",
        "session",
    ],


    retriever:
      retrieveConferenceKnowledge,

    isEnabled:
      true,
  });

export default conferenceModule;