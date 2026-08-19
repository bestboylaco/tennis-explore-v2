import {
    fetchRecord,
    fetchRecords,
    fetchSummary,
} from "./api/telemetryApi.js";
import { createFilterBar } from "./ui/telemetry/filterBar.js";
import { createRecordDetail } from "./ui/telemetry/recordDetail.js";
import { createRecordsTable } from "./ui/telemetry/recordsTable.js";
import { createSummaryView } from "./ui/telemetry/summaryView.js";

/*
 * ADMIN GATE MOUNT POINT (E5-17).
 *
 * Telemetry is Internal-classified data served from unauthenticated routes
 * (threat model T-01). When accounts and roles land, the role check goes here,
 * before the first request is issued, alongside the matching gates on the page
 * itself and on the navigation link in index.html.
 */

/**
 * Returns a required page element or throws a clear startup error.
 */
function getRequiredElement(selector) {
    const element = document.querySelector(selector);

    if (!element) {
        throw new Error(
            `Required interface element was not found: ${selector}`,
        );
    }

    return element;
}

const filterForm = getRequiredElement("#telemetry-filters");
const resetButton = getRequiredElement("#filter-reset");
const refreshButton = getRequiredElement("#telemetry-refresh");

const statusIndicator = getRequiredElement("#telemetry-status");
const statusText = getRequiredElement("#telemetry-status-text");

const errorBanner = getRequiredElement("#telemetry-error");

const errorMessage = getRequiredElement(
    "#telemetry-error-message",
);

const errorDismissButton = getRequiredElement(
    "#telemetry-error-dismiss",
);

const summaryContainer = getRequiredElement("#telemetry-summary");

const recordsContainer = getRequiredElement(
    "#telemetry-records-table",
);

const detailContainer = getRequiredElement(
    "#telemetry-record-detail",
);

function setStatus(state, label) {
    statusIndicator.className =
        `status-indicator status-indicator--${state}`;

    statusText.textContent = label;
}

function showError(message) {
    errorMessage.textContent = message;
    errorBanner.hidden = false;
}

function clearError() {
    errorMessage.textContent = "";
    errorBanner.hidden = true;
}

/*
 * A request counter rather than a lock. Clicking Refresh twice must not leave
 * the slower of the two responses painting the page after the faster one.
 */
let latestRequestId = 0;

/*
 * Counted separately from latestRequestId. A superseded request still has to
 * release the button, and only the last request in flight may re-enable it.
 */
let requestsInFlight = 0;

let selectedRecordId = null;

/**
 * Reflects the open record in the address bar so a specific run can be shared.
 *
 * replaceState rather than pushState: the browser Back button should leave the
 * dashboard, not step through rows the reader clicked.
 */
function updateAddressBar(recordId) {
    const url = new URL(window.location.href);

    if (recordId) {
        url.searchParams.set("recordId", recordId);
    } else {
        url.searchParams.delete("recordId");
    }

    window.history.replaceState({}, "", url);
}

const summaryView = createSummaryView({
    container: summaryContainer,
});

const recordDetail = createRecordDetail({
    container: detailContainer,
});

/**
 * Renders a record that the list already holds.
 *
 * No request is made: the list endpoint returns whole records, so re-fetching
 * a row that is already in memory would only add latency.
 */
function selectRecord(record) {
    selectedRecordId = record?.recordId ?? null;

    recordDetail.render(record);
    updateAddressBar(selectedRecordId);

    recordsTable.render({
        records: lastRecords,
        meta: lastMeta,
        selectedRecordId,
    });
}

let lastRecords = [];
let lastMeta = { count: 0, total: 0 };

const recordsTable = createRecordsTable({
    container: recordsContainer,
    onSelect: selectRecord,
    onOptionsChange: () => {
        /*
         * Cold start and row limit only narrow the record list. The summary is
         * unaffected by them, so it is not re-requested.
         */
        loadRecords();
    },
});

const filterBar = createFilterBar({
    form: filterForm,
    resetButton,
    onApply: () => loadAll(),
});

function setBusy(isBusy) {
    refreshButton.disabled = isBusy;

    refreshButton.textContent = isBusy
        ? "Loading..."
        : "Refresh";
}

function beginRequest() {
    requestsInFlight += 1;
    setBusy(true);

    return (latestRequestId += 1);
}

function endRequest() {
    requestsInFlight -= 1;

    if (requestsInFlight === 0) {
        setBusy(false);
    }
}

function describeFailure(error) {
    return (
        error?.message ??
        "An unexpected error occurred while loading telemetry."
    );
}

function showRecords({ records, meta }) {
    lastRecords = records;
    lastMeta = meta;

    recordsTable.render({
        records: lastRecords,
        meta: lastMeta,
        selectedRecordId,
    });
}

async function loadRecords() {
    const requestId = beginRequest();

    const filters = {
        ...filterBar.getFilters(),
        ...recordsTable.getOptions(),
    };

    try {
        const result = await fetchRecords(filters);

        if (requestId === latestRequestId) {
            showRecords(result);
            setStatus("ready", "Loaded");
        }
    } catch (error) {
        if (requestId === latestRequestId) {
            setStatus("failed", "Failed");
            showError(describeFailure(error));
        }
    } finally {
        endRequest();
    }
}

/**
 * Loads the summary and the record list together.
 *
 * allSettled rather than all: a rejected summary must not blank the record
 * list, and the reverse. A malformed sourceId, for instance, fails both with
 * INVALID_SOURCE_ID, but a percentile or aggregation problem fails only one.
 */
async function loadAll() {
    const requestId = beginRequest();

    clearError();
    setStatus("loading", "Loading");

    const filters = filterBar.getFilters();

    try {
        const [summaryResult, recordsResult] =
            await Promise.allSettled([
                fetchSummary(filters),
                fetchRecords({
                    ...filters,
                    ...recordsTable.getOptions(),
                }),
            ]);

        if (requestId !== latestRequestId) {
            return;
        }

        if (summaryResult.status === "fulfilled") {
            summaryView.render(summaryResult.value, { filters });
        }

        if (recordsResult.status === "fulfilled") {
            showRecords(recordsResult.value);
        }

        const failure =
            summaryResult.reason ?? recordsResult.reason ?? null;

        if (failure) {
            setStatus("failed", "Failed");

            /*
             * The backend message is shown as returned. A rejected sourceId
             * comes back as "sourceId must be a valid ObjectId.", which is the
             * whole value of surfacing it over a generic failure line.
             */
            showError(describeFailure(failure));

            return;
        }

        setStatus("ready", "Loaded");
    } finally {
        endRequest();
    }
}

/**
 * Restores the record named in the address bar.
 *
 * This is the only path that reads a single record from the API. Row selection
 * uses the object the list already returned.
 */
async function openLinkedRecord() {
    const requestedId = new URLSearchParams(
        window.location.search,
    ).get("recordId");

    if (!requestedId) {
        recordDetail.render(null);
        return;
    }

    try {
        const record = await fetchRecord(requestedId);

        selectedRecordId = record?.recordId ?? null;
        recordDetail.render(record);

        /*
         * The list has already painted with no selection, so it is re-rendered
         * to mark the linked row.
         */
        recordsTable.render({
            records: lastRecords,
            meta: lastMeta,
            selectedRecordId,
        });
    } catch (error) {
        recordDetail.render(null);
        showError(describeFailure(error));
    }
}

errorDismissButton.addEventListener("click", () => {
    clearError();

    if (statusText.textContent === "Failed") {
        setStatus("ready", "Ready");
    }
});

refreshButton.addEventListener("click", () => {
    loadAll();
});

/*
 * The linked record is resolved after the dashboard has loaded, because
 * loadAll clears the error banner on entry and would otherwise wipe a "record
 * not found" message from the deep link. With no ?recordId= in the address bar
 * openLinkedRecord returns without issuing a request.
 *
 * Nothing polls after this. Refresh is manual: /api/telemetry is excluded from
 * the telemetry middleware so a poll would not pollute the data it displays,
 * but a debugging page issuing requests while being read only makes the server
 * log harder to follow.
 */
async function initialise() {
    await loadAll();
    await openLinkedRecord();
}

initialise();
