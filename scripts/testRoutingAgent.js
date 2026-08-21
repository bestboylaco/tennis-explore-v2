import {
  bootstrapActions,
  getActionDescriptions,
} from "../src/modules/actions/index.js";

import {
  routeQuestion,
} from "../src/modules/routing/index.js";


bootstrapActions();


console.log(
  "\n=== AVAILABLE ACTIONS ==="
);

console.log(
  getActionDescriptions()
);


const question =
  "What does research say about training load?";


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

  console.dir(
    result,
    {
      depth: null,
    }
  );
} catch (error) {
  console.error(
    "\n=== ROUTING ERROR ==="
  );

  console.error(
    error
  );
}