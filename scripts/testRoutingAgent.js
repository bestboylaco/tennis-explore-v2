import {
  env,
} from "../src/config/env.js";

import {
  bootstrapActions,
  getAvailableActions,
} from "../src/modules/actions/index.js";

import {
  routeQuestion,
} from "../src/modules/routing/index.js";


await bootstrapActions({
  structuredSourceDirs:
    env.structuredSourceDirs,
});


const availableActions =
  getAvailableActions();


console.log(
  "\n=== AVAILABLE ACTIONS ==="
);

console.log(
  availableActions.map(
    (action) => action.id
  )
);


const question =
  "What is the average singles ranking?";


console.log(
  "\n=== QUESTION ==="
);

console.log(question);


try {
  const result =
    await routeQuestion({
      question,
    });


  console.log(
    "\n=== ROUTING RESULT ==="
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
} catch (error) {
  console.error(
    "\n=== ROUTING ERROR ==="
  );

  console.error(error);

  process.exitCode = 1;
}