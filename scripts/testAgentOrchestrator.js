import {
  bootstrapActions,
} from "../src/modules/actions/index.js";
import {
  env,
} from "../src/config/env.js";

import {
  runAgent,
} from "../src/modules/agent/agentOrchestrator.service.js";


await bootstrapActions({
  structuredSourceDirs:
    env.structuredSourceDirs,
});


const question =
  "What is the average singles ranking?";


try {
  const result =
    await runAgent({
      question,

      context: {
        roleId:
          "academy_coach",

        correlationId:
          "agent-orchestrator-test",
      },

      maxSteps: 5,
    });


  console.log(
    JSON.stringify(
      {
        question:
          result.question,

        initialActions:
          result.routing
            ?.decision
            ?.selectedActions,

        stepCount:
          result.agent
            ?.state
            ?.stepCount,

        steps:
          result.agent
            ?.state
            ?.steps
            ?.map((step) => ({
              stepNumber:
                step.stepNumber,

              actions:
                step.decision
                  ?.selectedActions,

              observations:
                step.observations
                  ?.map(
                    (observation) => ({
                      actionId:
                        observation.actionId,

                      status:
                        observation.status,

                      hasData:
                        observation.data !== null,

                      evidenceCount:
                        observation.evidence
                          ?.length ?? 0,
                    })
                  ),
            })),

        stopReason:
          result.agent
            ?.stopReason,

        finalDecision:
          result.agent
            ?.finalDecision,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}   