import {
  registerAction,
} from "./actionRegistry.js";

import {
  documentsAction,
} from "./documents/documents.action.js";

import {
  statisticsAction,
} from "./statistics/statistics.action.js";


let bootstrapped = false;


export function bootstrapActions() {
  if (bootstrapped) {
    return;
  }

  registerAction(
    documentsAction
  );

  registerAction(
    statisticsAction
  );

  bootstrapped = true;
}