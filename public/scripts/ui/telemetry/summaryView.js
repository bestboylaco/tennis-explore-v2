import { TELEMETRY_INGESTION_RUN_TYPE } from "../../config.js";
import {
    clear,
    createBar,
    createElement,
    createEmpty,
    createNotice,
    createSection,
    createStatGrid,
    createTable,
    maxOf,
} from "./elements.js";
import {
    dash,
    formatBoolean,
    formatBytes,
    formatCount,
    formatMs,
    formatNumber,
    formatPercent,
} from "./formatters.js";

const NO_RECORDS_MESSAGE =
    "No telemetry recorded for this filter yet. Ask a question on the home page, or run an ingestion with";

const NO_RECORDS_COMMAND = "POST /api/sources/:id/ingest";

function numericColumn(label, value) {
    return { label, numeric: true, value };
}

/*
 * Stage latency
 *
 * The exclusion note matters: aggregateStageLatency defaults to
 * excludeColdStart, so these figures are warm-path only and read faster than
 * the pipeline actually feels on a first request.
 */

function stageLatencyColumns(byQueryClass) {
    const columns = [
        { label: "Run type", value: (row) => dash(row.runType) },
        {
            label: "Stage",
            emphasis: true,
            value: (row) => dash(row.stage),
        },
    ];

    if (byQueryClass) {
        columns.push({
            label: "Query class",
            value: (row) => dash(row.queryClass),
        });
    }

    columns.push(
        numericColumn("Samples", (row) => formatCount(row.samples)),
        numericColumn("Avg", (row) => formatMs(row.avgMs)),
        numericColumn("p50", (row) => formatMs(row.p50Ms)),
        numericColumn("p95", (row) => formatMs(row.p95Ms)),
        numericColumn("p99", (row) => formatMs(row.p99Ms)),
        numericColumn("Max", (row) => formatMs(row.maxMs)),
        numericColumn("Failures", (row) => formatCount(row.failures)),
    );

    return columns;
}

function renderStageLatencyBody(body, report) {
    clear(body);

    if (!report) {
        body.append(createEmpty("Stage latency was not returned."));
        return;
    }

    /*
     * Percentiles are null on MongoDB below 7.0, which has no $percentile. Left
     * unexplained the three empty columns read as an instrumentation gap rather
     * than as a cluster capability.
     */
    if (report.percentilesSupported === false) {
        body.append(
            createNotice(
                "This cluster does not support $percentile (MongoDB 7.0 or later is required), so p50, p95 and p99 are unavailable. Averages, counts and maxima are unaffected.",
            ),
        );
    }

    const rows = report.stages ?? [];

    if (rows.length === 0) {
        body.append(
            createEmpty(NO_RECORDS_MESSAGE, NO_RECORDS_COMMAND),
        );

        return;
    }

    const columns = stageLatencyColumns(report.byQueryClass);

    /*
     * The bar is scaled to the largest p95 in this table, so it ranks stages
     * against each other and not against an absolute budget. Where percentiles
     * are unavailable it falls back to the average, which keeps the column
     * meaningful instead of blank.
     */
    const useAverage = report.percentilesSupported === false;

    const barValue = (row) =>
        useAverage ? row.avgMs : row.p95Ms;

    const largest = maxOf(rows, barValue);

    columns.push({
        label: useAverage ? "Avg" : "p95",
        bar: true,
        render: (row) =>
            createBar({
                value: Number(barValue(row)),
                max: largest,
                label: formatMs(barValue(row)),
            }),
    });

    body.append(createTable({ columns, rows }).scroller);
}

function renderStageLatency(summary) {
    const toggle = createElement("div", "toggle-group");

    const byRunTypeButton = createElement(
        "button",
        "toggle-group__button toggle-group__button--active",
        "By run type",
    );

    const byQueryClassButton = createElement(
        "button",
        "toggle-group__button",
        "By query class",
    );

    byRunTypeButton.type = "button";
    byQueryClassButton.type = "button";

    toggle.append(byRunTypeButton, byQueryClassButton);

    const { section, body } = createSection({
        title: "Stage latency",
        note: "Cold start affected samples are excluded. The exclusion is per stage rather than per record, so a run that paid a cold start in one stage still contributes its warm stages here.",
        controls: toggle,
    });

    function show(byQueryClass) {
        byRunTypeButton.classList.toggle(
            "toggle-group__button--active",
            !byQueryClass,
        );

        byQueryClassButton.classList.toggle(
            "toggle-group__button--active",
            byQueryClass,
        );

        renderStageLatencyBody(
            body,
            byQueryClass
                ? summary.stageLatencyByQueryClass
                : summary.stageLatency,
        );
    }

    byRunTypeButton.addEventListener("click", () => show(false));
    byQueryClassButton.addEventListener("click", () => show(true));

    show(false);

    return section;
}

/* End-to-end latency */

function renderRunLatency(summary) {
    const { section, body } = createSection({
        title: "End-to-end latency by query class",
        note: "Whole-run duration with its token and OCU cost from the same grouping, so latency per query and cost per query cannot disagree. Cold start runs are excluded.",
    });

    const rows = summary.runLatency ?? [];

    if (rows.length === 0) {
        body.append(
            createEmpty(NO_RECORDS_MESSAGE, NO_RECORDS_COMMAND),
        );

        return section;
    }

    body.append(
        createTable({
            rows,
            columns: [
                {
                    label: "Query class",
                    emphasis: true,
                    value: (row) => dash(row.queryClass),
                },
                { label: "Run type", value: (row) => dash(row.runType) },
                numericColumn("Runs", (row) => formatCount(row.runs)),
                numericColumn("Avg", (row) => formatMs(row.avgMs)),
                numericColumn("Min", (row) => formatMs(row.minMs)),
                numericColumn("Max", (row) => formatMs(row.maxMs)),
                numericColumn("Avg tokens in", (row) =>
                    formatNumber(row.avgTokensIn, 1),
                ),
                numericColumn("Avg tokens out", (row) =>
                    formatNumber(row.avgTokensOut, 1),
                ),
                numericColumn("Avg OCU-s", (row) =>
                    formatNumber(row.avgOcuSeconds, 3),
                ),
                numericColumn("Failures", (row) => formatCount(row.failures)),
            ],
        }).scroller,
    );

    return section;
}

/* Cold start */

function renderColdStarts(summary) {
    const { section, body } = createSection({
        title: "Cold start",
        note: "The rate is reported per run type and never blended. Every HTTP request writes a record and almost none are cold, while a startup connection almost always is, so a single rate across both would answer no question.",
    });

    const coldStarts = summary.coldStarts ?? {};
    const byRunType = coldStarts.byRunType ?? [];
    const byResource = coldStarts.byResource ?? [];
    const totals = coldStarts.totals;

    if (byRunType.length === 0) {
        body.append(
            createEmpty(NO_RECORDS_MESSAGE, NO_RECORDS_COMMAND),
        );

        return section;
    }

    if (totals) {
        /*
         * Counts only. coldStarts.totals deliberately carries no rate, and one
         * must not be computed here either: the aggregation omits it because a
         * blended figure would be misleading, not because it was overlooked.
         */
        body.append(
            createStatGrid([
                { label: "Runs", value: formatCount(totals.runs) },
                { label: "Cold runs", value: formatCount(totals.coldRuns) },
                { label: "Warm runs", value: formatCount(totals.warmRuns) },
                {
                    label: "Total recovery",
                    value: formatMs(totals.totalRecoveryMs),
                },
            ]),
        );
    }

    const byRunTypeBlock = createElement(
        "div",
        "record-detail__subsection",
    );

    byRunTypeBlock.append(
        createElement(
            "div",
            "record-detail__subtitle",
            "Rate by run type",
        ),

        createTable({
            rows: byRunType,
            columns: [
                {
                    label: "Run type",
                    emphasis: true,
                    value: (row) => dash(row.runType),
                },
                numericColumn("Runs", (row) => formatCount(row.runs)),
                numericColumn("Cold", (row) => formatCount(row.coldRuns)),
                numericColumn("Warm", (row) => formatCount(row.warmRuns)),
                numericColumn("Recovery", (row) =>
                    formatMs(row.totalRecoveryMs),
                ),
                {
                    label: "Cold start rate",
                    bar: true,
                    render: (row) =>
                        createBar({
                            // A rate bar is drawn against the full 0-1 scale,
                            // not against the largest row, so 4% looks like 4%.
                            value: Number(row.coldStartRate),
                            max: 1,
                            label: formatPercent(row.coldStartRate),
                            variant: "warning",
                        }),
                },
            ],
        }).scroller,
    );

    body.append(byRunTypeBlock);

    const byResourceBlock = createElement(
        "div",
        "record-detail__subsection",
    );

    byResourceBlock.append(
        createElement(
            "div",
            "record-detail__subtitle",
            "Recovery by resource",
        ),
    );

    if (byResource.length === 0) {
        byResourceBlock.append(
            createEmpty(
                "No cold start events in this window.",
            ),
        );
    } else {
        byResourceBlock.append(
            createTable({
                rows: byResource,
                columns: [
                    {
                        label: "Resource",
                        emphasis: true,
                        value: (row) => dash(row.resource),
                    },
                    numericColumn("Events", (row) => formatCount(row.events)),
                    numericColumn("Avg recovery", (row) =>
                        formatMs(row.avgRecoveryMs),
                    ),
                    numericColumn("Max recovery", (row) =>
                        formatMs(row.maxRecoveryMs),
                    ),
                ],
            }).scroller,
        );
    }

    body.append(byResourceBlock);

    return section;
}

/* Compute */

function renderCompute(summary) {
    const { section, body } = createSection({
        title: "Compute (estimated)",
        note: "OCU-seconds are measured seconds multiplied by a configured OCU rate, which is what this project can produce without a provider invoice. These are not billing figures.",
    });

    const rows = summary.compute ?? [];

    if (rows.length === 0) {
        body.append(
            createEmpty(
                "No compute recorded for this filter. Only stages that report measured seconds against a billed resource appear here.",
            ),
        );

        return section;
    }

    body.append(
        createTable({
            rows,
            columns: [
                {
                    label: "Resource",
                    emphasis: true,
                    value: (row) => dash(row.resource),
                },
                {
                    label: "Query class",
                    value: (row) => dash(row.queryClass),
                },
                numericColumn("Runs", (row) => formatCount(row.runs)),
                numericColumn("Seconds", (row) =>
                    formatNumber(row.seconds, 2),
                ),
                numericColumn("OCU-seconds", (row) =>
                    formatNumber(row.ocuSeconds, 2),
                ),
                numericColumn("Calls", (row) => formatCount(row.calls)),
                numericColumn("OCU-s per run", (row) =>
                    formatNumber(row.ocuSecondsPerRun, 3),
                ),
            ],
        }).scroller,
    );

    return section;
}

/* Ingestion volume */

function renderIngestion(summary, filters) {
    const { section, body } = createSection({
        title: "Ingestion volume",
        note: "Split by API type because each is billed on a different unit: Textract per page, embeddings per token, S3 per object.",
    });

    /*
     * aggregateIngestionVolume pins the run type to ingestion in both
     * directions, so any other run type filter returns an empty structure by
     * design. That is "does not apply", not "nothing recorded", and the
     * difference decides whether the reader goes looking for a bug.
     */
    const runTypeFilter = filters?.runType;

    if (
        runTypeFilter &&
        runTypeFilter !== TELEMETRY_INGESTION_RUN_TYPE
    ) {
        body.append(
            createNotice(
                `Not applicable while the run type filter is "${runTypeFilter}". Only ingestion runs carry volume counters, so this aggregation is pinned to the ingestion run type and returns nothing for any other.`,
                "muted",
            ),
        );

        return section;
    }

    const ingestion = summary.ingestion ?? {};
    const totals = ingestion.totals ?? {};
    const byApi = ingestion.byApi ?? [];

    if (!totals.runs) {
        body.append(
            createEmpty(
                "No ingestion runs for this filter. Run one with",
                "POST /api/sources/:id/ingest",
            ),
        );

        return section;
    }

    body.append(
        createStatGrid([
            { label: "Runs", value: formatCount(totals.runs) },
            { label: "Documents", value: formatCount(totals.documents) },
            { label: "Pages", value: formatCount(totals.pages) },
            { label: "Assets", value: formatCount(totals.assets) },
            { label: "Bytes", value: formatBytes(totals.bytes) },
            { label: "Chunks", value: formatCount(totals.chunks) },
            { label: "Per page", value: formatMs(totals.msPerPage) },
            { label: "Per document", value: formatMs(totals.msPerDocument) },
        ]),
    );

    const byApiBlock = createElement(
        "div",
        "record-detail__subsection",
    );

    byApiBlock.append(
        createElement("div", "record-detail__subtitle", "By API"),
    );

    if (byApi.length === 0) {
        byApiBlock.append(
            createEmpty(
                "Ingestion runs were recorded but none reported a per-API breakdown.",
            ),
        );
    } else {
        byApiBlock.append(
            createTable({
                rows: byApi,
                columns: [
                    {
                        label: "API",
                        emphasis: true,
                        value: (row) => dash(row.apiType),
                    },
                    numericColumn("Calls", (row) => formatCount(row.apiCalls)),
                    numericColumn("Documents", (row) =>
                        formatCount(row.documents),
                    ),
                    numericColumn("Pages", (row) => formatCount(row.pages)),
                    numericColumn("Assets", (row) => formatCount(row.assets)),
                    numericColumn("Bytes", (row) => formatBytes(row.bytes)),
                    numericColumn("Chunks", (row) => formatCount(row.chunks)),
                    numericColumn("Tokens in", (row) =>
                        formatCount(row.tokensIn),
                    ),
                    numericColumn("Tokens out", (row) =>
                        formatCount(row.tokensOut),
                    ),
                    numericColumn("Failures", (row) =>
                        formatCount(row.failures),
                    ),
                    numericColumn("Duration", (row) =>
                        formatMs(row.durationMs),
                    ),
                    numericColumn("Per page", (row) =>
                        formatMs(row.msPerPage),
                    ),
                ],
            }).scroller,
        );
    }

    body.append(byApiBlock);

    return section;
}

/* Instrumentation coverage */

function describeStatuses(byStatus) {
    if (!Array.isArray(byStatus) || byStatus.length === 0) {
        return dash(null);
    }

    return byStatus
        .map((entry) => `${dash(entry.status)} ${formatCount(entry.count)}`)
        .join(" · ");
}

function renderCoverage(summary) {
    const { section, body } = createSection({
        title: "Instrumentation coverage",
        note: "A stage counts as instrumented only once it has actually run. not_implemented and skipped both mean the reporting is not there yet, which is the gap this section exists to show.",
    });

    const rows = summary.coverage ?? [];

    if (rows.length === 0) {
        body.append(
            createEmpty(NO_RECORDS_MESSAGE, NO_RECORDS_COMMAND),
        );

        return section;
    }

    body.append(
        createTable({
            rows,
            columns: [
                { label: "Run type", value: (row) => dash(row.runType) },
                {
                    label: "Stage",
                    emphasis: true,
                    value: (row) => dash(row.stage),
                },
                numericColumn("Records", (row) => formatCount(row.total)),
                numericColumn("Instrumented", (row) =>
                    formatBoolean(row.instrumented),
                ),
                {
                    label: "By status",
                    value: (row) => describeStatuses(row.byStatus),
                },
            ],
        }).scroller,
    );

    return section;
}

/**
 * Renders the seven aggregations returned by GET /api/telemetry/summary.
 *
 * One request fills the whole view, so the sections cannot show data from
 * different moments.
 */
export function createSummaryView({ container }) {
    function render(summary, { filters } = {}) {
        clear(container);

        if (!summary) {
            container.append(
                createEmpty(
                    NO_RECORDS_MESSAGE,
                    NO_RECORDS_COMMAND,
                ),
            );

            return;
        }

        container.append(
            renderStageLatency(summary),
            renderRunLatency(summary),
            renderColdStarts(summary),
            renderCompute(summary),
            renderIngestion(summary, filters),
            renderCoverage(summary),
        );
    }

    return { render };
}
