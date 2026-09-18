// A single "required text field" table row: a label with a red asterisk plus
// a required/aria-required input, styled to match the app's tight admin
// tables by default. Used anywhere a form needs the standard required-field
// look (NewVehiclePage, UserDetailsPage, ReservationPage) instead of each
// page hand-writing the same label+input markup.

import { TEXT_INPUT_CLASSNAME } from "../lib/inputStyles";
import { RequiredMark } from "./RequiredMark";

/** Default row/input styling — matches the tight two-column admin tables (NewVehiclePage, UserDetailsPage). Override via className/inputClassName for a different layout (e.g. ReservationPage's roomier form rows). */
const DEFAULT_ROW_CLASSNAME = "grid grid-cols-2 items-center gap-2 p-0.5";
const DEFAULT_LABEL_CLASSNAME = "flex items-center text-sm font-medium text-brand-700";
const DEFAULT_INPUT_CLASSNAME = TEXT_INPUT_CLASSNAME;

interface RequiredFieldRowProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** HTML input type, e.g. "email" for the browser's built-in email keyboard/format hinting. Defaults to "text". */
  type?: string;
  /** Overrides the row wrapper's classes (default: tight two-column grid). */
  className?: string;
  /** Overrides the <label>'s classes (default: left-aligned, matches the tight admin-table style). */
  labelClassName?: string;
  /** Overrides the <input>'s classes (default: matches the tight admin-table style). */
  inputClassName?: string;
  /** Renders a locked, non-interactive input instead (readOnly + disabled + the same muted "locked" styling UserDetailsPage.tsx uses for its own Hjemmeafdeling display) and suppresses the required asterisk (nothing to actually require when the field can't be edited here) — for UserDetailsPage's self-view, where profile fields are shown but not editable from this page. Defaults to false. */
  readOnly?: boolean;
}

/** One required-field table row (label + red asterisk + required input). Pair with a "* Feltet skal udfyldes" legend below the table and gate the submit button on every required field being non-empty. */
export function RequiredFieldRow({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  className = DEFAULT_ROW_CLASSNAME,
  labelClassName = DEFAULT_LABEL_CLASSNAME,
  inputClassName = DEFAULT_INPUT_CLASSNAME,
  readOnly = false,
}: RequiredFieldRowProps) {
  return (
    <div className={className}>
      <label className={labelClassName}>
        {label} {!readOnly && <RequiredMark />}
      </label>
      <input
        type={type}
        required={!readOnly}
        aria-required={!readOnly}
        readOnly={readOnly}
        disabled={readOnly}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={readOnly ? "cursor-not-allowed rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800" : inputClassName}
      />
    </div>
  );
}
