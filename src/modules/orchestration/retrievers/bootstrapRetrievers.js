import {
  registerRetriever,
} from "./retrieverRegistry.js";

import {
  knowledgeModules,
} from "../../knowledge/index.js";

/**
 * Register every enabled knowledge module.
 *
 * This function should be called once
 * during application startup.
 */
export function registerRetrievers() {
  for (const module of knowledgeModules) {
    if (!module.isEnabled) {
      continue;
    }

    registerRetriever({
      moduleId:
        module.moduleId,

      retriever:
        module.retriever,
    });
  }
}