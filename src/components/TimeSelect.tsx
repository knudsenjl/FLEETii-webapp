import { useEffect, useRef, useState } from "react";

interface TimeSelectProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}

export function TimeSelect({ value, options, onChange }: TimeSelectProps) {
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
        onClick={() => setOpen((prev) => !prev)}
        className="w-full rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-left text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
      >
        {value}
      </button>
      {open && (
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
