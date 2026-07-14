// A single "required text field" table row: a label with a red asterisk plus
// a required/aria-required input, styled to match the app's tight admin
// tables by default. Used anywhere a form needs the standard required-field
// look (NewVehiclePage, UserDetailsPage, ReservationPage) instead of each
// page hand-writing the same label+input markup.

/** Default row/input styling — matches the tight two-column admin tables (NewVehiclePage, UserDetailsPage). Override via className/inputClassName for a different layout (e.g. ReservationPage's roomier form rows). */
const DEFAULT_ROW_CLASSNAME = "grid grid-cols-2 items-center gap-2 p-0.5";
const DEFAULT_INPUT_CLASSNAME =
  "rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20";

interface RequiredFieldRowProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Overrides the row wrapper's classes (default: tight two-column grid). */
  className?: string;
  /** Overrides the <input>'s classes (default: matches the tight admin-table style). */
  inputClassName?: string;
}

/** One required-field table row (label + red asterisk + required input). Pair with a "* Feltet skal udfyldes" legend below the table and gate the submit button on every required field being non-empty. */
export function RequiredFieldRow({
  label,
  value,
  onChange,
  placeholder,
  className = DEFAULT_ROW_CLASSNAME,
  inputClassName = DEFAULT_INPUT_CLASSNAME,
}: RequiredFieldRowProps) {
  return (
    <div className={className}>
      <label className="flex items-center text-sm font-medium text-brand-700">
        {label} <span className="ml-0.5 text-red-600">*</span>
      </label>
      <input
        type="text"
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
