import fs from "node:fs/promises";
import path from "node:path";
import {
    fileURLToPath,
} from "node:url";

import {
    recordTurn,
    resolveFollowUp,
} from "../src/modules/chat/services/conversationContext.service.js";


const currentFile =
    fileURLToPath(
        import.meta.url,
    );

const projectRoot =
    path.resolve(
        path.dirname(
            currentFile,
        ),
        "..",
    );

const testSetPath =
    path.join(
        projectRoot,
        "queries",
        "e1-02-followup-set.json",
    );

const evidencePath =
    path.join(
        projectRoot,
        "evidence",
        "e1-02-followup.json",
    );


const testCases =
    JSON.parse(
        await fs.readFile(
            testSetPath,
            "utf8",
        ),
    );


const results = [];


for (const testCase of testCases) {
    /*
     * Each case starts with its own isolated authenticated-session stand-in.
     *
     * The purpose of this evaluator is the rewrite contract, not answer
     * generation quality, so the preceding exchange is seeded directly.
     */
    const session = {};

    const conversationId =
        `e1-02-${testCase.id}`;


    recordTurn({
        session,

        conversationId,

        resolvedQuestion:
            testCase.firstQuestion,

        answer:
            "Previous assistant response in the same session.",
    });


    const resolution =
        await resolveFollowUp({
            session,

            conversationId,

            question:
                testCase.followUp,
        });


    const resolvedLower =
        resolution
            .resolvedQuestion
            .toLowerCase();


    const missingTerms =
        testCase.requiredTerms.filter(
            (term) =>
                !resolvedLower.includes(
                    term.toLowerCase(),
                ),
        );


    const passed =
        missingTerms.length === 0;


    results.push({
        id:
            testCase.id,

        type:
            testCase.type,

        firstQuestion:
            testCase.firstQuestion,

        followUp:
            testCase.followUp,

        resolvedQuestion:
            resolution.resolvedQuestion,

        requiredTerms:
            testCase.requiredTerms,

        missingTerms,

        contextTurnsUsed:
            resolution.contextTurnsUsed,

        rewriteApplied:
            resolution.rewriteApplied,

        rewriteReason:
            resolution.rewriteReason,

        passed,
    });


    console.log(
        `${passed ? "PASS" : "FAIL"} ${testCase.id}: ${resolution.resolvedQuestion}`,
    );
}


const passCount =
    results.filter(
        (result) =>
            result.passed,
    ).length;

const target =
    4;


const evidence = {
    story:
        "TENISE-8 / E1-02",

    generatedAt:
        new Date()
            .toISOString(),

    target:
        `${target}/${results.length}`,

    passCount,

    total:
        results.length,

    accepted:
        passCount >= target,

    results,
};


await fs.mkdir(
    path.dirname(
        evidencePath,
    ),
    {
        recursive:
            true,
    },
);


await fs.writeFile(
    evidencePath,

    `${JSON.stringify(
        evidence,
        null,
        2,
    )}\n`,

    "utf8",
);


console.log(
    `\nE1-02 result: ${passCount}/${results.length} passed.`,
);

console.log(
    `Evidence written to: ${evidencePath}`,
);


if (
    passCount <
    target
) {
    process.exitCode =
        1;
}