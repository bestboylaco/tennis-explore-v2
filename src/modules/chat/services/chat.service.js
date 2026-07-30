const DEMO_PROCESSING_DELAY_MS = 600;

/**
 * Creates a small delay so the frontend processing state is visible
 * during the Sprint 2 demonstration.
 */
function wait(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

/**
 * Handles one natural-language coaching question.
 *
 * This is currently a deterministic demo implementation. A future story
 * can replace this section with the real routing, retrieval, and AI pipeline
 * without changing the controller or the chat interface.
 */
export async function submitChatQuestion(question) {
    await wait(DEMO_PROCESSING_DELAY_MS);

    return {
        status: "completed",

        /*
         * This response is deliberately not forced into the TENISE-22
         * four-section template. The frontend must render the structure
         * returned by the backend.
         */
        response: {
            message: "Your coaching question was accepted.",
            receivedQuestion: question,
            coachingSuggestions: [
                "Review the player's current performance evidence.",
                "Identify one measurable priority for the next training session.",
                "Monitor the result and adjust the plan when new evidence is available.",
            ],
            demoInformation: {
                responseType: "general_coaching_demo",
                generatedAt: new Date().toISOString(),
            },
        },

        citations: [
            {
                id: "demo-coaching-reference",
                title: "Demo coaching reference",
                excerpt:
                    "This reference demonstrates that supporting evidence can be opened from the unified chat interface.",
                url: "/citations/demo-reference.html",
            },
        ],
    };
}