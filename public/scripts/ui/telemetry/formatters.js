/**
 * Display formatting for telemetry numbers.
 *
 * The aggregation endpoints return null in many normal situations, not only
 * when something is broken:
 *
 * - p50/p95/p99 are null on MongoDB below 7.0, which has no $percentile
 * - per-run averages are null when the group holds zero runs
 * - every ingestion counter is null for a non-ingestion run type
 *
 * So "no value" is rendered as an em dash rather than as zero. A blank cell
 * would read as a missing feature and a zero would read as a fast one.
 */

const ABSENT = "—";

/**
 * True when a value carries no measurement.
 *
 * Zero is a measurement and is deliberately not included: a stage that ran in
 * under a millisecond is not the same as a stage that never reported.
 */
function isAbsent(value) {
    return (
        value === null ||
        value === undefined ||
        value === ""
    );
}

function isMeasurement(value) {
    const numericValue = Number(value);

    return (
        !isAbsent(value) &&
        typeof value !== "boolean" &&
        Number.isFinite(numericValue)
    );
}

/**
 * Renders any value, marking an absent one instead of printing "null".
 */
export function dash(value) {
    if (isAbsent(value)) {
        return ABSENT;
    }

    return String(value);
}

/**
 * Renders a duration in milliseconds.
 *
 * The unit stays milliseconds at every magnitude so a column can be scanned
 * and compared without reading each suffix. Values under 10 ms keep one
 * decimal, because routing currently completes in well under a millisecond and
 * would otherwise round to "0 ms" and read as uninstrumented.
 */
export function formatMs(value) {
    if (!isMeasurement(value)) {
        return ABSENT;
    }

    const milliseconds = Number(value);

    const rounded =
        Math.abs(milliseconds) < 10
            ? Number(milliseconds.toFixed(1))
            : Math.round(milliseconds);

    return `${rounded.toLocaleString("en-US")} ms`;
}

/**
 * Renders a 0-1 rate, such as coldStartRate, as a percentage.
 */
export function formatPercent(value) {
    if (!isMeasurement(value)) {
        return ABSENT;
    }

    return `${(Number(value) * 100).toFixed(1)}%`;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

/**
 * Renders a byte count in binary units.
 */
export function formatBytes(value) {
    if (!isMeasurement(value)) {
        return ABSENT;
    }

    const bytes = Number(value);
    const sign = bytes < 0 ? "-" : "";

    let size = Math.abs(bytes);
    let unitIndex = 0;

    while (
        size >= 1024 &&
        unitIndex < BYTE_UNITS.length - 1
    ) {
        size /= 1024;
        unitIndex += 1;
    }

    if (unitIndex === 0) {
        return `${sign}${Math.round(size)} B`;
    }

    return `${sign}${size.toFixed(1)} ${BYTE_UNITS[unitIndex]}`;
}

/**
 * Renders a whole number of runs, samples, calls or tokens.
 */
export function formatCount(value) {
    if (!isMeasurement(value)) {
        return ABSENT;
    }

    return Math.round(Number(value)).toLocaleString("en-US");
}

/**
 * Renders a fractional figure such as OCU-seconds or average tokens per run.
 */
export function formatNumber(value, decimals = 2) {
    if (!isMeasurement(value)) {
        return ABSENT;
    }

    return Number(value).toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

function padTwo(value) {
    return String(value).padStart(2, "0");
}

/**
 * Renders a timestamp in local time as YYYY-MM-DD HH:MM:SS.
 *
 * The fixed layout sorts as text and stays the same width in every row, which
 * a locale-dependent format does not.
 */
export function formatDateTime(value) {
    if (isAbsent(value)) {
        return ABSENT;
    }

    const date =
        value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return ABSENT;
    }

    const day = [
        date.getFullYear(),
        padTwo(date.getMonth() + 1),
        padTwo(date.getDate()),
    ].join("-");

    const time = [
        padTwo(date.getHours()),
        padTwo(date.getMinutes()),
        padTwo(date.getSeconds()),
    ].join(":");

    return `${day} ${time}`;
}

/**
 * Renders a flag, keeping "false" distinguishable from "not reported".
 *
 * A warm run stores coldStart.detected as false, while a record written before
 * a field existed has nothing at all. The table has to show which one it is.
 */
export function formatBoolean(value) {
    if (typeof value !== "boolean") {
        return ABSENT;
    }

    return value ? "✓" : "✗";
}
