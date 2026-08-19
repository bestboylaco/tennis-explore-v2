import {
    TELEMETRY_QUERY_CLASS_OPTIONS,
    TELEMETRY_RUN_TYPE_OPTIONS,
    TELEMETRY_STATUS_OPTIONS,
} from "../../config.js";
import { createDateTimeField } from "./dateTimeField.js";

/**
 * The filter fields the telemetry API accepts, in the order they are written
 * into the query string.
 *
 * The list is closed on purpose. Callers pass one filter object around the page
 * and add view state to it (which record is open, for instance), and only the
 * keys named here may reach the backend. Stable ordering also keeps a shared
 * debugging URL comparable to another one.
 *
 * Mirrors readQueryOptions in
 * src/modules/telemetry/controllers/telemetry.controller.js.
 */
const QUERY_FIELDS = [
    "runType",
    "queryClass",
    "status",
    "correlationId",
    "sourceId",
    "from",
    "to",
    "coldStart",
    "limit",
];

/**
 * Builds the query string for a telemetry request.
 *
 * Returns "" rather than "?" when nothing is filtered, so a caller can append
 * the result to a URL unconditionally.
 */
export function buildTelemetryQuery(filters = {}) {
    const parameters = new URLSearchParams();

    for (const field of QUERY_FIELDS) {
        const value = filters?.[field];

        /*
         * The select elements use "" for their "any" option. Sending that
         * through would filter for the empty string instead of for anything.
         */
        if (
            value === undefined ||
            value === null ||
            value === ""
        ) {
            continue;
        }

        /*
         * coldStart=false is a real filter (warm runs only), so unlike a blank
         * select it cannot be dropped for being falsy.
         */
        parameters.set(field, String(value));
    }

    return parameters.toString();
}

function fillSelect(select, options) {
    const anyOption = document.createElement("option");

    anyOption.value = "";
    anyOption.textContent = "Any";

    select.append(anyOption);

    for (const option of options) {
        const optionElement = document.createElement("option");

        optionElement.value = option.value;
        optionElement.textContent = option.label;

        select.append(optionElement);
    }
}

/**
 * Wires the page filter form.
 *
 * The cold start and row limit controls are deliberately not here. They belong
 * to the records list only; see the note in recordsTable.js for why a page-wide
 * cold start filter would make the summary contradict itself.
 */
export function createFilterBar({ form, resetButton, onApply }) {
    const fields = {
        runType: form.elements.runType,
        queryClass: form.elements.queryClass,
        status: form.elements.status,
        correlationId: form.elements.correlationId,
        sourceId: form.elements.sourceId,
    };

    /*
     * The two date fields are typed in Australian order and read back as the
     * YYYY-MM-DDTHH:MM string the API expects. See dateTimeField.js for why
     * they are not native datetime-local inputs.
     */
    const dateFields = {
        from: createDateTimeField({
            wrapper: form.querySelector("[data-date-field='from']"),
        }),
        to: createDateTimeField({
            wrapper: form.querySelector("[data-date-field='to']"),
        }),
    };

    fillSelect(fields.runType, TELEMETRY_RUN_TYPE_OPTIONS);
    fillSelect(fields.queryClass, TELEMETRY_QUERY_CLASS_OPTIONS);
    fillSelect(fields.status, TELEMETRY_STATUS_OPTIONS);

    /**
     * Reads the form into the filter shape buildTelemetryQuery expects.
     *
     * Blank fields are left as "" and dropped there rather than being turned
     * into a filter for the empty string. A date that cannot be read is left
     * blank too, but reading it marks the field, so an unusable range cannot
     * pass as an unfiltered one.
     */
    function getFilters() {
        return {
            runType: fields.runType.value,
            queryClass: fields.queryClass.value,
            status: fields.status.value,
            from: dateFields.from.read().value,
            to: dateFields.to.read().value,
            correlationId: fields.correlationId.value.trim(),
            sourceId: fields.sourceId.value.trim(),
        };
    }

    form.addEventListener("submit", (event) => {
        event.preventDefault();

        /*
         * Both are read before either is judged: || would short circuit and
         * leave a second bad date unmarked.
         */
        const isFromValid = dateFields.from.read().isValid;
        const isToValid = dateFields.to.read().isValid;

        if (!isFromValid || !isToValid) {
            return;
        }

        onApply();
    });

    resetButton.addEventListener("click", () => {
        form.reset();

        /*
         * form.reset() restores the text but not the invalid marks, and it
         * cannot close an open calendar.
         */
        dateFields.from.reset();
        dateFields.to.reset();

        onApply();
    });

    return { getFilters };
}
