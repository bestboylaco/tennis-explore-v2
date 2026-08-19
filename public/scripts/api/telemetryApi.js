import {
    TELEMETRY_ENDPOINT,
    TELEMETRY_REQUEST_TIMEOUT_MS,
} from "../config.js";
import { buildTelemetryQuery } from "../ui/telemetry/filterBar.js";
import { requestJson } from "./httpClient.js";

function withQuery(path, filters) {
    const query = buildTelemetryQuery(filters);

    return query ? `${path}?${query}` : path;
}

function request(path, options) {
    return requestJson(path, {
        timeoutMs: TELEMETRY_REQUEST_TIMEOUT_MS,
        ...options,
    });
}

/**
 * Loads all seven aggregations in one request.
 *
 * coldStart and limit are dropped rather than forwarded.
 *
 * getTelemetrySummary never exposes excludeColdStart as an API parameter, and
 * aggregateRunLatencyByQueryClass forces coldStart to false regardless of what
 * was asked for. Passing coldStart=true would therefore return a cold-start
 * stage table beside an end-to-end table that had excluded those same runs, and
 * the two sections would contradict each other. Cold start has its own section,
 * and the coldStart filter belongs only on the records list.
 */
export async function fetchSummary(filters = {}, options = {}) {
    const {
        coldStart,
        limit,
        ...summaryFilters
    } = filters;

    const responseBody = await request(
        withQuery(
            `${TELEMETRY_ENDPOINT}/summary`,
            summaryFilters,
        ),
        options,
    );

    return responseBody?.data ?? null;
}

/**
 * Loads the raw record list.
 *
 * Returns the meta block alongside the records: meta.total is the number of
 * records matching the filter, which the limited list length does not show.
 */
export async function fetchRecords(filters = {}, options = {}) {
    const responseBody = await request(
        withQuery(TELEMETRY_ENDPOINT, filters),
        options,
    );

    return {
        records: Array.isArray(responseBody?.data)
            ? responseBody.data
            : [],

        meta: responseBody?.meta ?? {
            count: 0,
            total: 0,
        },
    };
}

/**
 * Loads one record by id, for the ?recordId= deep link.
 *
 * Selecting a row in the list does not come through here: that row already
 * holds the whole record, so re-fetching it would only add latency.
 */
export async function fetchRecord(recordId, options = {}) {
    const responseBody = await request(
        `${TELEMETRY_ENDPOINT}/${encodeURIComponent(recordId)}`,
        options,
    );

    return responseBody?.data ?? null;
}
