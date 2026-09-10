"use client";

interface FilterChipsProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** Small pill-style single-select filter — for a short, fixed set of choices
 * (e.g. All / Active / Completed) where a dropdown would be overkill. */
export default function FilterChips<T extends string>({ options, value, onChange }: FilterChipsProps<T>) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-full text-[10px] font-cinzel font-bold uppercase tracking-wider transition-colors cursor-pointer border ${
              active
                ? "bg-gold text-bg border-gold"
                : "bg-transparent text-muted border-cleo-border hover:border-gold/40 hover:text-ink"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
