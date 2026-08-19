import { createElement } from "./elements.js";

/**
 * Australian-format date entry for the telemetry filters.
 */

export const DATE_TIME_PLACEHOLDER = "DD/MM/YYYY HH:MM";

export const DATE_TIME_HINT =
    "Use DD/MM/YYYY HH:MM, for example 18/08/2026 09:30.";

const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/* Monday first, as a week is written here. */
const WEEKDAY_NAMES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/*
 * Day and month are accepted with or without a leading zero, separated by / or
 * -, and the time is optional. A typed date with no time means midnight, which
 * is what the native control also sent for a date picked without one.
 */
const ENTRY_PATTERN =
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?$/;

const VALUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

function padTwo(value) {
    return String(value).padStart(2, "0");
}

/**
 * Renders a Date as the local datetime-local string the API expects.
 *
 * Deliberately not toISOString: that converts to UTC, which would shift every
 * filter by the local offset and make a range typed in Brisbane time select the
 * wrong runs.
 */
function toFilterValue(date) {
    const day = [
        date.getFullYear(),
        padTwo(date.getMonth() + 1),
        padTwo(date.getDate()),
    ].join("-");

    const time = [
        padTwo(date.getHours()),
        padTwo(date.getMinutes()),
    ].join(":");

    return `${day}T${time}`;
}

/**
 * Reads typed Australian-format text into the filter value.
 *
 * Returns "" for an empty field, which is "no filter" rather than a mistake,
 * and null for text that cannot be read as a date, so a typo narrows nothing
 * silently.
 */
export function parseAuDateTime(text) {
    const entry = String(text ?? "").trim();

    if (entry === "") {
        return "";
    }

    const match = ENTRY_PATTERN.exec(entry);

    if (!match) {
        return null;
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const hour = Number(match[4] ?? 0);
    const minute = Number(match[5] ?? 0);

    if (hour > 23 || minute > 59) {
        return null;
    }

    const date = new Date(year, month - 1, day, hour, minute);

    /*
     * Date rolls an impossible day forward (31/02 becomes 3 March) instead of
     * refusing it, so the result is compared back against what was typed.
     */
    if (
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }

    return toFilterValue(date);
}

/**
 * Renders a filter value as the Australian-format text shown in the field.
 */
export function formatAuDateTime(value) {
    const match = VALUE_PATTERN.exec(String(value ?? "").trim());

    if (!match) {
        return "";
    }

    const [, year, month, day, hour, minute] = match;

    return `${day}/${month}/${year} ${hour}:${minute}`;
}

function toDate(value) {
    const match = VALUE_PATTERN.exec(String(value ?? "").trim());

    if (!match) {
        return null;
    }

    return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
    );
}

function isSameDay(first, second) {
    return (
        first.getFullYear() === second.getFullYear() &&
        first.getMonth() === second.getMonth() &&
        first.getDate() === second.getDate()
    );
}

/**
 * Wires one filter field: a text input, its calendar button and its hint.
 *
 * The calendar sets the day only and leaves the time alone, so narrowing an
 * already typed range to a different date does not quietly reset it to
 * midnight. A time is typed, never picked: a native time control would be drawn
 * in the browser's locale, which is the problem this module exists to avoid.
 */
export function createDateTimeField({ wrapper }) {
    const input = wrapper.querySelector("input");
    const anchor = wrapper.querySelector(".date-field");
    const toggleButton = wrapper.querySelector(".date-field__toggle");
    const hint = wrapper.querySelector(".date-field__hint");

    input.placeholder = DATE_TIME_PLACEHOLDER;
    hint.textContent = DATE_TIME_HINT;

    let picker = null;
    let viewDate = new Date();

    function setInvalid(isInvalid) {
        hint.hidden = !isInvalid;
        wrapper.classList.toggle("filter-bar__field--invalid", isInvalid);

        if (isInvalid) {
            input.setAttribute("aria-invalid", "true");
        } else {
            input.removeAttribute("aria-invalid");
        }
    }

    /**
     * Returns the value for the query string and whether the field is usable.
     *
     * Marking the field is a side effect on purpose: every caller that reads
     * the filters is also a moment where a typo should become visible.
     */
    function read() {
        const value = parseAuDateTime(input.value);
        const isValid = value !== null;

        setInvalid(!isValid);

        return { value: isValid ? value : "", isValid };
    }

    function closePicker() {
        if (!picker) {
            return;
        }

        picker.remove();
        picker = null;

        toggleButton.setAttribute("aria-expanded", "false");

        document.removeEventListener("pointerdown", handleOutside, true);
        document.removeEventListener("keydown", handleKeydown, true);
    }

    function handleOutside(event) {
        if (!wrapper.contains(event.target)) {
            closePicker();
        }
    }

    function handleKeydown(event) {
        if (event.key === "Escape") {
            closePicker();
            toggleButton.focus();
        }
    }

    function chooseDay(day) {
        const current = parseAuDateTime(input.value);

        /*
         * A field holding unreadable text keeps no time to preserve, so the
         * picked day starts at midnight.
         */
        const time =
            current !== null && current !== ""
                ? current.slice(11)
                : "00:00";

        const picked = [
            viewDate.getFullYear(),
            padTwo(viewDate.getMonth() + 1),
            padTwo(day),
        ].join("-");

        input.value = formatAuDateTime(`${picked}T${time}`);

        setInvalid(false);
        closePicker();
        input.focus();
    }

    function buildMonth() {
        const grid = createElement("div", "date-picker__grid");

        for (const name of WEEKDAY_NAMES) {
            grid.append(
                createElement("span", "date-picker__weekday", name),
            );
        }

        const year = viewDate.getFullYear();
        const month = viewDate.getMonth();

        const daysInMonth = new Date(year, month + 1, 0).getDate();

        /* getDay() counts from Sunday; the grid starts on Monday. */
        const leading = (new Date(year, month, 1).getDay() + 6) % 7;

        const today = new Date();
        const selected = toDate(parseAuDateTime(input.value));

        for (let day = 1; day <= daysInMonth; day += 1) {
            const date = new Date(year, month, day);

            const isSelected =
                selected !== null && isSameDay(date, selected);

            const classNames = [
                "date-picker__day",
                isSelected ? "date-picker__day--selected" : null,
                isSameDay(date, today) ? "date-picker__day--today" : null,
            ].filter(Boolean);

            const button = createElement(
                "button",
                classNames.join(" "),
                day,
            );

            button.type = "button";

            if (day === 1) {
                button.style.gridColumnStart = String(leading + 1);
            }

            if (isSelected) {
                button.setAttribute("aria-current", "date");
            }

            button.addEventListener("click", () => chooseDay(day));

            grid.append(button);
        }

        return grid;
    }

    function renderPicker() {
        const body = picker.querySelector(".date-picker__body");
        const label = picker.querySelector(".date-picker__month");

        label.textContent =
            `${MONTH_NAMES[viewDate.getMonth()]} ${viewDate.getFullYear()}`;

        body.replaceChildren(buildMonth());
    }

    function stepMonth(offset) {
        viewDate = new Date(
            viewDate.getFullYear(),
            viewDate.getMonth() + offset,
            1,
        );

        renderPicker();
    }

    function createStepButton(text, label, offset) {
        const button = createElement("button", "date-picker__step", text);

        button.type = "button";
        button.setAttribute("aria-label", label);
        button.addEventListener("click", () => stepMonth(offset));

        return button;
    }

    function createActionButton(text, run) {
        const button = createElement("button", "date-picker__action", text);

        button.type = "button";
        button.addEventListener("click", run);

        return button;
    }

    function buildPicker() {
        const panel = createElement("div", "date-picker");

        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "Choose a date");

        const header = createElement("div", "date-picker__header");

        header.append(
            createStepButton("‹", "Previous month", -1),
            createElement("span", "date-picker__month"),
            createStepButton("›", "Next month", 1),
        );

        const footer = createElement("div", "date-picker__footer");

        footer.append(
            createActionButton("Now", () => {
                input.value = formatAuDateTime(toFilterValue(new Date()));
                setInvalid(false);
                closePicker();
                input.focus();
            }),
            createActionButton("Clear", () => {
                input.value = "";
                setInvalid(false);
                closePicker();
                input.focus();
            }),
        );

        panel.append(
            header,
            createElement("div", "date-picker__body"),
            footer,
        );

        return panel;
    }

    function openPicker() {
        if (picker) {
            closePicker();
            return;
        }

        viewDate = toDate(parseAuDateTime(input.value)) ?? new Date();

        picker = buildPicker();
        anchor.append(picker);

        toggleButton.setAttribute("aria-expanded", "true");

        renderPicker();

        document.addEventListener("pointerdown", handleOutside, true);
        document.addEventListener("keydown", handleKeydown, true);
    }

    toggleButton.setAttribute("aria-expanded", "false");
    toggleButton.addEventListener("click", openPicker);

    /*
     * The mark is dropped as soon as the field is edited and taken again on
     * blur, so a half-typed date is not scolded one character in.
     */
    input.addEventListener("input", () => setInvalid(false));
    input.addEventListener("blur", () => read());

    return {
        read,
        reset() {
            closePicker();
            input.value = "";
            setInvalid(false);
        },
    };
}
