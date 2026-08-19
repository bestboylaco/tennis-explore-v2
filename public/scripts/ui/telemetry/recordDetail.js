import { renderValue } from "./structuredValue.js";
import {
    clear,
    createElement,
    createFieldList,
    createPill,
    createSection,
    createTable,
} from "./elements.js";
import {
    dash,
    formatBoolean,
    formatBytes,
    formatCount,
    formatDateTime,
    formatMs,
    formatNumber,
} from "./formatters.js";

/*
 * Telemetry records are content-free by design (threat model T-04): no document
 * text and no question text is ever written to them, and attribute values are
 * length-capped so none can leak in through the free-form map. Nothing in this
 * panel should ever be extended to display question or document content.
 */

function createSubsection(title, content) {
    const block = createElement(
        "div",
        "record-detail__subsection",
    );

    block.append(
        createElement("div", "record-detail__subtitle", title),
        content,
    );

    return block;
}

function createEmptyNote(message) {
    return createElement(
        "p",
        "telemetry-section__note",
        message,
    );
}

/**
 * Converts a serialised Map field into rows carrying their own key.
 *
 * stages, compute.byResource, ingestion.byApi and attributes are all stored as
 * Mongoose Maps and arrive as plain objects.
 */
function toRows(value, keyName) {
    if (!value || typeof value !== "object") {
        return [];
    }

    return Object.entries(value).map(([key, entry]) => ({
        [keyName]: key,
        ...entry,
    }));
}

function renderRunSummary(record) {
    const status = createPill(record.status);

    return createFieldList([
        ["Started", formatDateTime(record.startedAt)],
        ["Completed", formatDateTime(record.completedAt)],
        ["Duration", formatMs(record.totalDurationMs)],
        ["Status", status],
        ["Run type", dash(record.runType)],
        ["Query class", dash(record.queryClass)],
        ["Correlation ID", dash(record.correlationId)],
        ["Environment", dash(record.environment)],
        ["Service version", dash(record.serviceVersion)],
        ["Schema version", dash(record.schemaVersion)],
        ["Tokens in", formatCount(record.tokens?.input)],
        ["Tokens out", formatCount(record.tokens?.output)],
        [
            "OCU-seconds",
            formatNumber(record.compute?.ocuSeconds, 3),
        ],
        ["OCU basis", dash(record.compute?.basis)],
        ["Record ID", createElement(
            "span",
            "record-detail__id",
            dash(record.recordId),
        )],
    ]);
}

function renderStages(record) {
    const rows = toRows(record.stages, "stage");

    if (rows.length === 0) {
        return createSubsection(
            "Stages",
            createEmptyNote("This record carries no stage map."),
        );
    }

    return createSubsection(
        "Stages",
        createTable({
            rows,
            columns: [
                {
                    label: "Stage",
                    emphasis: true,
                    value: (row) => dash(row.stage),
                },
                {
                    label: "Status",
                    render: (row) => createPill(row.status),
                },
                {
                    label: "Duration",
                    numeric: true,
                    value: (row) => formatMs(row.durationMs),
                },
                { label: "API", value: (row) => dash(row.apiType) },
                {
                    label: "Calls",
                    numeric: true,
                    value: (row) => formatCount(row.apiCalls),
                },
                {
                    label: "Tokens in",
                    numeric: true,
                    value: (row) => formatCount(row.tokensIn),
                },
                {
                    label: "Tokens out",
                    numeric: true,
                    value: (row) => formatCount(row.tokensOut),
                },
                {
                    label: "Cold",
                    numeric: true,
                    value: (row) => formatBoolean(row.coldStart ?? null),
                },
                { label: "Reason", value: (row) => dash(row.reason) },
                {
                    label: "Error",
                    value: (row) => dash(row.errorCode),
                },
            ],
        }).scroller,
    );
}

function renderCompute(record) {
    const rows = toRows(record.compute?.byResource, "resource");

    if (rows.length === 0) {
        return null;
    }

    return createSubsection(
        "Compute by resource (estimated)",
        createTable({
            rows,
            columns: [
                {
                    label: "Resource",
                    emphasis: true,
                    value: (row) => dash(row.resource),
                },
                {
                    label: "Seconds",
                    numeric: true,
                    value: (row) => formatNumber(row.seconds, 2),
                },
                {
                    label: "OCU",
                    numeric: true,
                    value: (row) => formatNumber(row.ocu, 2),
                },
                {
                    label: "OCU-seconds",
                    numeric: true,
                    value: (row) => formatNumber(row.ocuSeconds, 3),
                },
                {
                    label: "Calls",
                    numeric: true,
                    value: (row) => formatCount(row.calls),
                },
            ],
        }).scroller,
    );
}

function renderColdStart(record) {
    const coldStart = record.coldStart ?? {};
    const events = Array.isArray(coldStart.events)
        ? coldStart.events
        : [];

    if (!coldStart.detected && events.length === 0) {
        return null;
    }

    const block = createSubsection(
        "Cold start",
        createFieldList([
            ["Detected", formatBoolean(coldStart.detected ?? null)],
            ["Events", formatCount(coldStart.count)],
            [
                "Total recovery",
                formatMs(coldStart.totalRecoveryMs),
            ],
        ]),
    );

    if (events.length > 0) {
        block.append(
            createTable({
                rows: events,
                columns: [
                    {
                        label: "Resource",
                        emphasis: true,
                        value: (row) => dash(row.resource),
                    },
                    { label: "Stage", value: (row) => dash(row.stage) },
                    {
                        label: "Detected",
                        value: (row) => formatDateTime(row.detectedAt),
                    },
                    {
                        label: "Recovery",
                        numeric: true,
                        value: (row) => formatMs(row.recoveryMs),
                    },
                    {
                        label: "Threshold",
                        numeric: true,
                        value: (row) => formatMs(row.thresholdMs),
                    },
                ],
            }).scroller,
        );
    }

    return block;
}

function renderIngestion(record) {
    const ingestion = record.ingestion ?? {};
    const rows = toRows(ingestion.byApi, "apiType");

    if (rows.length === 0 && !ingestion.sourceId) {
        return null;
    }

    const block = createSubsection(
        "Ingestion",
        createFieldList([
            ["Source ID", dash(ingestion.sourceId)],
            ["Source type", dash(ingestion.sourceType)],
            ["Documents", formatCount(ingestion.documentCount)],
            ["Pages", formatCount(ingestion.pageCount)],
            ["Assets", formatCount(ingestion.assetCount)],
            ["Bytes", formatBytes(ingestion.byteCount)],
            ["Chunks", formatCount(ingestion.chunkCount)],
        ]),
    );

    if (rows.length > 0) {
        block.append(
            createTable({
                rows,
                columns: [
                    {
                        label: "API",
                        emphasis: true,
                        value: (row) => dash(row.apiType),
                    },
                    {
                        label: "Calls",
                        numeric: true,
                        value: (row) => formatCount(row.apiCalls),
                    },
                    {
                        label: "Pages",
                        numeric: true,
                        value: (row) => formatCount(row.pages),
                    },
                    {
                        label: "Bytes",
                        numeric: true,
                        value: (row) => formatBytes(row.bytes),
                    },
                    {
                        label: "Chunks",
                        numeric: true,
                        value: (row) => formatCount(row.chunks),
                    },
                    {
                        label: "Failures",
                        numeric: true,
                        value: (row) => formatCount(row.failures),
                    },
                    {
                        label: "Duration",
                        numeric: true,
                        value: (row) => formatMs(row.durationMs),
                    },
                ],
            }).scroller,
        );
    }

    return block;
}

function renderContext(record) {
    const http = record.http ?? {};
    const error = record.error ?? {};
    const attributes = record.attributes ?? {};

    const entries = [
        ["HTTP method", dash(http.method)],
        ["HTTP route", dash(http.route)],
        ["HTTP status", dash(http.statusCode)],
        ["Error code", dash(error.code)],
        ["Error message", dash(error.message)],
    ];

    for (const [key, value] of Object.entries(attributes)) {
        entries.push([`Attribute: ${key}`, dash(value)]);
    }

    return createSubsection(
        "Context",
        createFieldList(entries),
    );
}

function renderRaw(record) {
    const details = createElement("details", "record-raw");

    details.append(
        createElement("summary", null, "Complete record"),
        renderValue(record),
    );

    return details;
}

/**
 * The detail panel for one telemetry record.
 *
 * Selecting a row in the list renders the record that row already holds; only
 * the ?recordId= deep link fetches one. Either way the same object shape
 * arrives here.
 */
export function createRecordDetail({ container }) {
    function showPlaceholder(message) {
        clear(container);

        const { section, body } = createSection({
            title: "Record detail",
        });

        body.append(
            createElement(
                "p",
                "record-detail__placeholder",
                message,
            ),
        );

        container.append(section);
    }

    function render(record) {
        if (!record) {
            showPlaceholder(
                "Select a record from the list to inspect its stages, compute and cold start events.",
            );

            return;
        }

        clear(container);

        const { section, body } = createSection({
            title: "Record detail",
        });

        body.append(renderRunSummary(record));
        body.append(renderStages(record));

        for (const block of [
            renderCompute(record),
            renderColdStart(record),
            renderIngestion(record),
        ]) {
            if (block) {
                body.append(block);
            }
        }

        body.append(renderContext(record));
        body.append(renderRaw(record));

        container.append(section);
    }

    return { render };
}
