// A custom dropdown for picking a time-of-day string from a fixed list of
// options (e.g. 15-minute increments). Built as a plain button + absolutely
// positioned list rather than a native <select> so it can be styled to match
// the rest of the app's inputs consistently across browsers.
import { useEffect, useRef, useState } from "react";

interface TimeSelectProps {
  /** Currently selected option (shown on the toggle button even if it's not present in `options`). */
  value: string;
  /** The selectable time strings, in display order (e.g. ReservationPage filters these to exclude times that would be invalid). */
  options: string[];
  onChange: (value: string) => void;
  /** When true, the toggle button can't be opened/clicked — matches a native input's `disabled` (e.g. ReservationPage's "Nu" checkbox locking the start time). */
  disabled?: boolean;
}

/** Dropdown time picker: click the button to open/close the list, click an option to select it and close. Closes automatically on an outside click, and scrolls the currently-selected option into view when opened. */
export function TimeSelect({ value, options, onChange, disabled = false }: TimeSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const selected = listRef.current.querySelector('[data-selected="true"]');
    selected?.scrollIntoView({ block: "center" });
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        className="w-full rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-left text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {value}
      </button>
      {open && !disabled && (
        <div
          ref={listRef}
          className="absolute left-0 top-full z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-brand-200 bg-white shadow-lg"
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              data-selected={option === value}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left text-sm transition ${
                option === value
                  ? "bg-accent-50 font-semibold text-accent-700"
                  : "text-brand-800 hover:bg-brand-50"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
