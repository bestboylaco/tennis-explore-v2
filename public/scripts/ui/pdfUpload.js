import { uploadPrivatePdf } from "../api/ingestionApi.js";

const MAX_UPLOAD_BYTES =
    20 * 1024 * 1024;

function formatMegabytes(bytes) {
    return (
        bytes /
        (1024 * 1024)
    ).toFixed(
        1,
    );
}

function clientValidationError(file) {
    if (!file) {
        return null;
    }

    const isPdfName =
        file.name
            .toLowerCase()
            .endsWith(
                ".pdf",
            );

    if (
        !isPdfName ||
        (
            file.type &&
            file.type !==
                "application/pdf"
        )
    ) {
        return new Error(
            "Only PDF files are accepted.",
        );
    }

    if (
        file.size >
        MAX_UPLOAD_BYTES
    ) {
        return new Error(
            `PDF files must be 20 MB or smaller. This file is ${formatMegabytes(file.size)} MB.`,
        );
    }

    return null;
}

/**
 * Connects the existing + composer button to the authenticated private-PDF
 * ingestion endpoint.
 *
 * Validation in this module is convenience only. The backend repeats all
 * security-relevant validation before Source creation and ingestion.
 */
export function createPdfUpload({
    button,
    anchor,
    onBusyChange =
        () => {},
    onError =
        () => {},
}) {
    const input =
        document.createElement(
            "input",
        );

    input.type =
        "file";

    input.accept =
        "application/pdf,.pdf";

    input.hidden =
        true;

    input.setAttribute(
        "aria-hidden",
        "true",
    );

    document.body.append(
        input,
    );

    const status =
        document.createElement(
            "div",
        );

    status.className =
        "pdf-upload-status";

    status.hidden =
        true;

    status.setAttribute(
        "role",
        "status",
    );

    status.setAttribute(
        "aria-live",
        "polite",
    );

    anchor.insertAdjacentElement(
        "afterend",
        status,
    );

    function setStatus(
        state,
        message,
    ) {
        status.dataset.state =
            state;

        status.textContent =
            message;

        status.hidden =
            !message;
    }

    function setBusy(
        busy,
    ) {
        button.disabled =
            busy;

        button.setAttribute(
            "aria-busy",
            String(
                busy,
            ),
        );

        onBusyChange(
            busy,
        );
    }

    button.title =
        "Upload a private PDF match report";

    button.setAttribute(
        "aria-label",
        "Upload a private PDF match report",
    );

    button.addEventListener(
        "click",
        () => {
            input.click();
        },
    );

    input.addEventListener(
        "change",
        async () => {
            const file =
                input.files?.[0] ??
                null;

            if (!file) {
                return;
            }

            const validationError =
                clientValidationError(
                    file,
                );

            if (validationError) {
                input.value =
                    "";

                setStatus(
                    "",
                    "",
                );

                onError(
                    validationError,
                );

                return;
            }

            setBusy(
                true,
            );

            setStatus(
                "processing",
                `Uploading and indexing “${file.name}”…`,
            );

            try {
                const result =
                    await uploadPrivatePdf(
                        file,
                    );

                const chunks =
                    result
                        ?.ingestion
                        ?.volume
                        ?.chunks ??
                    null;

                const chunkSuffix =
                    Number.isFinite(
                        chunks,
                    ) &&
                    chunks > 0
                        ? ` ${chunks} searchable chunks were added.`
                        : "";

                setStatus(
                    "success",
                    `“${file.name}” is now available to your AI Coach.${chunkSuffix}`,
                );
            } catch (error) {
                setStatus(
                    "",
                    "",
                );

                onError(
                    error,
                );
            } finally {
                input.value =
                    "";

                setBusy(
                    false,
                );
            }
        },
    );

    return {
        open() {
            input.click();
        },

        clearStatus() {
            setStatus(
                "",
                "",
            );
        },
    };
}
