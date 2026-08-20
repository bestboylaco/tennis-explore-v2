import {
  registerAction,
} from "./actionRegistry.js";

import {
  documentsAction,
} from "./documents/documents.action.js";

import {
  statisticsAction,
  initializeStatisticsAction,
} from "./statistics/statistics.action.js";


let bootstrapped = false;


export async function bootstrapActions({
  structuredSourceDirs = null,
} = {}) {
  if (bootstrapped) {
    return;
  }


  /*
   * Check whether main's structured tables
   * actually exist before exposing Statistics
   * to the routing agent.
   *
   * Statistics remains unavailable if table
   * initialisation fails.
   */
  try {
  await initializeStatisticsAction({
    sourceDirs:
      structuredSourceDirs,
  });
} catch (error) {
  console.warn(
    "Statistics action could not be initialized:",
    error instanceof Error
      ? error.message
      : error
  );
}


  registerAction(
    documentsAction
  );

  registerAction(
    statisticsAction
  );


  bootstrapped = true;
}