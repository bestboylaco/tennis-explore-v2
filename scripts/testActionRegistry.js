import {
  bootstrapActions,
  getAvailableActions,
} from "../src/modules/actions/index.js";


await bootstrapActions({
  structuredSourceDirs: [
    "C:/Users/user/OneDrive/Desktop/tennis-explore-backend/uploads",
  ],
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