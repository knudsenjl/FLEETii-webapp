// A single "required text field" table row: a label with a red asterisk plus
// a required/aria-required input, styled to match the app's tight admin
// tables by default. Used anywhere a form needs the standard required-field
// look (NewVehiclePage, UserDetailsPage, ReservationPage) instead of each
// page hand-writing the same label+input markup.

/** Default row/input styling — matches the tight two-column admin tables (NewVehiclePage, UserDetailsPage). Override via className/inputClassName for a different layout (e.g. ReservationPage's roomier form rows). */
const DEFAULT_ROW_CLASSNAME = "grid grid-cols-2 items-center gap-2 p-0.5";
const DEFAULT_LABEL_CLASSNAME = "flex items-center text-sm font-medium text-brand-700";
const DEFAULT_INPUT_CLASSNAME =
  "rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20";

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
  /** Omits the red "*" marker — for a spot where that specific mark already carries a DIFFERENT meaning nearby (e.g. AnvendelseSettings' "* Kan ikke ændres eller slettes" protected-row note) and would otherwise read as a contradictory signal. The field stays functionally required (still gates its own submit button, still HTML `required`) — only the red-asterisk affordance is dropped in favor of a plain placeholder hint. Defaults to false (show it, the normal case everywhere else). */
  hideAsterisk?: boolean;
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
  hideAsterisk = false,
}: RequiredFieldRowProps) {
  return (
    <div className={className}>
      <label className={labelClassName}>
        {label} {!hideAsterisk && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      <input
        type={type}
        required
        aria-required="true"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClassName}
      />
    </div>
  );
}
