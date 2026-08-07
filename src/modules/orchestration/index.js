import {
  registerRetrievers,
} from "./retrievers/bootstrapRetrievers.js";

let initialized = false;

/**
 * Initialize the orchestration module.
 *
 * This should be called once when the application starts.
 */
export function initializeOrchestration() {
  if (initialized) {
    return;
  }

  registerRetrievers();

  initialized = true;
}

export {
  orchestrateKnowledgeRetrieval,
} from "./orchestration.service.js";