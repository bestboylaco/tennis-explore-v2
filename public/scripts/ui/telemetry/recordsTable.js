import { TELEMETRY_DEFAULT_LIMIT } from "../../config.js";
import {
    clear,
    createElement,
    createEmpty,
    createPill,
    createSection,
    createTable,
} from "./elements.js";
import {
    dash,
    formatBoolean,
    formatCount,
    formatDateTime,
    formatMs,
} from "./formatters.js";

/*
 * The backend accepts up to 500 and defaults to 100. The list returns whole
 * records, each carrying its full stage map, so the default here is lower: 25
 * rows fill the panel and cost a fraction of the payload.
 */
const LIMIT_OPTIONS = [25, 50, 100, 250, 500];

const COLD_START_OPTIONS = [
    { value: "", label: "Any" },
    { value: "true", label: "Cold only" },
    { value: "false", label: "Warm only" },
];

function createLabelledSelect({ id, label, options, value }) {
    const field = createElement("div", "filter-bar__field");

    const labelElement = createElement("label", null, label);

    labelElement.htmlFor = id;

    const select = createElement("select");

    select.id = id;

    for (const option of options) {
        const optionElement = createElement(
            "option",
            null,
            option.label,
        );

        optionElement.value = option.value;
        select.append(optionElement);
    }

    select.value = value;

    field.append(labelElement, select);

    return { field, select };
}

/**
 * The raw record list.
 *
 * The cold start control lives here and not in the page filter bar. The summary
 * endpoint does not expose excludeColdStart as a parameter and
 * aggregateRunLatencyByQueryClass pins coldStart to false regardless, so a
 * page-wide cold start filter would leave two summary sections contradicting
 * each other. Cold start has its own summary section; here it is a genuine
 * filter over individual records.
 */
export function createRecordsTable({
    container,
    onSelect,
    onOptionsChange,
}) {
    const controls = createElement("div", "filter-bar__actions");

    const coldStart = createLabelledSelect({
        id: "records-cold-start",
        label: "Cold start",
        options: COLD_START_OPTIONS,
        value: "",
    });

    const limit = createLabelledSelect({
        id: "records-limit",
        label: "Rows",
        options: LIMIT_OPTIONS.map((size) => ({
            value: String(size),
            label: String(size),
        })),
        value: String(TELEMETRY_DEFAULT_LIMIT),
    });

    controls.append(coldStart.field, limit.field);

    const { section, body } = createSection({
        title: "Raw records",
        note: "Newest first. Select a row to inspect the whole record.",
        controls,
    });

    const meta = createElement("p", "telemetry-section__note");
    const tableHost = createElement("div");

    body.append(meta, tableHost);
    container.append(section);

    for (const select of [coldStart.select, limit.select]) {
        select.addEventListener("change", () => {
            onOptionsChange();
        });
    }

    /**
     * The record filters owned by this section, in the shape
     * buildTelemetryQuery expects.
     */
    function getOptions() {
        return {
            /*
             * "" means no filter. false is a real one (warm runs only), so the
             * two cannot collapse into a single falsy check.
             */
            coldStart:
                coldStart.select.value === ""
                    ? undefined
                    : coldStart.select.value === "true",

            limit: Number(limit.select.value),
        };
    }

    function render({
        records = [],
        meta: responseMeta = {},
        selectedRecordId = null,
    } = {}) {
        clear(tableHost);

        const total = responseMeta.total ?? 0;
        const count = responseMeta.count ?? records.length;

        /*
         * count is capped by the row limit while total is not, so showing both
         * is what tells the reader the list is truncated.
         */
        meta.textContent =
            `Showing ${formatCount(count)} of ${formatCount(total)} matching records.`;

        if (records.length === 0) {
            meta.textContent = "No records match this filter.";

            tableHost.append(
                createEmpty(
                    "Nothing recorded yet. Ask a question on the home page, or run an ingestion with",
                    "POST /api/sources/:id/ingest",
                ),
            );

            return;
        }

        const table = createTable({
            rows: records,
            columns: [
                {
                    label: "Started",
                    emphasis: true,
                    value: (row) => formatDateTime(row.startedAt),
                },
                {
                    label: "Run type",
                    value: (row) => dash(row.runType),
                },
                {
                    label: "Query class",
                    value: (row) => dash(row.queryClass),
                },
                {
                    label: "Status",
                    render: (row) => createPill(row.status),
                },
                {
                    label: "Duration",
                    numeric: true,
                    value: (row) => formatMs(row.totalDurationMs),
                },
                {
                    label: "Cold",
                    numeric: true,
                    value: (row) =>
                        formatBoolean(row.coldStart?.detected ?? null),
                },
                {
                    label: "Record",
                    value: (row) =>
                        /*
                         * The id is a UUID. The leading segment is enough to
                         * match a row against the detail panel, and the full
                         * value stays available as a tooltip and in the panel.
                         */
                        typeof row.recordId === "string"
                            ? row.recordId.slice(0, 8)
                            : dash(row.recordId),
                },
            ],
        });

        tableHost.append(table.scroller);

        /*
         * Rows are made interactive after the table is built, so createTable
         * stays a plain presentational helper.
         */
        Array.from(table.body.children).forEach((row, index) => {
            const record = records[index];

            row.classList.add("record-row");
            row.tabIndex = 0;
            row.setAttribute("role", "button");

            if (typeof record?.recordId === "string") {
                row.title = record.recordId;
            }

            if (
                selectedRecordId &&
                record?.recordId === selectedRecordId
            ) {
                row.classList.add("record-row--selected");
            }

            row.addEventListener("click", () => {
                onSelect(record);
            });

            row.addEventListener("keydown", (event) => {
                if (
                    event.key === "Enter" ||
                    event.key === " "
                ) {
                    event.preventDefault();
                    onSelect(record);
                }
            });
        });
    }

    return { render, getOptions };
}
