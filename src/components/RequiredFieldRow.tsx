const DEFAULT_ROW_CLASSNAME = "grid grid-cols-2 items-center gap-2 p-0.5";
const DEFAULT_INPUT_CLASSNAME =
  "rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20";

interface RequiredFieldRowProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

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
