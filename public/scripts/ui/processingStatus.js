/**
 * Controls the visible request state in one place.
 *
 * Keeping this logic separate prevents status class names and labels
 * from being repeated throughout app.js.
 */
export function createProcessingStatus({
    statusIndicator,
    statusText,
    processingMessage,
    conversation,
}) {
    function setState(state, label) {
        statusIndicator.className =
            `status-indicator status-indicator--${state}`;

        statusText.textContent = label;
    }

    function ready() {
        processingMessage.hidden = true;
        setState("ready", "Ready");
    }

    function start() {
        /*
         * Move the processing message to the end of the conversation.
         * It therefore appears after the user's newest question.
         */
        conversation.append(processingMessage);

        processingMessage.hidden = false;

        setState("processing", "Processing");
    }

    function complete() {
        processingMessage.hidden = true;
        setState("completed", "Completed");
    }

    function fail() {
        processingMessage.hidden = true;
        setState("failed", "Failed");
    }

    return {
        ready,
        start,
        complete,
        fail,
    };
}