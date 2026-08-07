import {
  researchModule,
} from "./research.module.js";

import {
  coachingModule,
} from "./coaching.module.js";

import {
  rankingModule,
} from "./ranking.module.js";

import {
  conferenceModule,
} from "./conference.module.js";

import {
  matchModule,
} from "./match.module.js";

export {
  researchModule,
  coachingModule,
  rankingModule,
  conferenceModule,
  matchModule,
};

export const knowledgeModules =
  Object.freeze([
    researchModule,
    coachingModule,
    rankingModule,
    conferenceModule,
    matchModule,
  ]);