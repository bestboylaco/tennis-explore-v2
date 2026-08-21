import {
  bootstrapActions,
  getAvailableActions,
} from "../src/modules/actions/index.js";

import { env } from "../src/config/env.js";


await bootstrapActions({
  structuredSourceDirs: env.structuredSourceDirs,
});

const enabledActions =
  getAvailableActions();

const allActions =
  getAvailableActions({
    includeDisabled: true,
  });


console.log(
  "\n=== ALL REGISTERED ACTIONS ==="
);

allActions.forEach((action) => {
  console.log({
    id: action.id,
    name: action.name,
    isEnabled: action.isEnabled,
  });
});


console.log(
  "\n=== ENABLED ACTIONS ==="
);

enabledActions.forEach((action) => {
  console.log({
    id: action.id,
    name: action.name,
    isEnabled: action.isEnabled,
  });
});


console.log(
  "\nAction framework test complete."
);