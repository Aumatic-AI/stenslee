"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { countries } from "countries-list";
import { sanitizePhoneNumberInput } from "@/lib/phone";

interface CountryOption {
  iso: string;
  name: string;
  dial: string;
  search: string;
}

// One option per (country, dialing code), built once from countries-list.
const COUNTRY_OPTIONS: CountryOption[] = Object.entries(countries)
  .flatMap(([iso, c]) =>
    c.phone.map((code) => ({
      iso,
      name: c.name,
      dial: `+${code}`,
      search: [c.name, c.native, ...(c.alias ?? []), iso, `+${code}`].join(" ").toLowerCase(),
    }))
  )
  .sort((a, b) => a.name.localeCompare(b.name));

// Which country a shared dialing code shows as (e.g. +1 → United States, not Canada).
const PREFERRED_ISO: Record<string, string> = {
  "+1": "US", "+7": "RU", "+44": "GB", "+47": "NO", "+61": "AU", "+64": "NZ", "+212": "MA", "+262": "RE",
  "+290": "SH", "+358": "FI", "+377": "MC", "+381": "RS", "+386": "SI", "+500": "FK", "+590": "GP", "+672": "NF",
};

function optionFor(dial: string, pickedIso: string | null): CountryOption | null {
  return (
    COUNTRY_OPTIONS.find((o) => o.dial === dial && o.iso === pickedIso) ??
    COUNTRY_OPTIONS.find((o) => o.dial === dial && o.iso === PREFERRED_ISO[dial]) ??
    COUNTRY_OPTIONS.find((o) => o.dial === dial) ??
    null
  );
}

const DEFAULT_FIELD_CLASS =
  "bg-surface border border-cleo-border rounded-xl py-3.5 text-ink text-base placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors";
// For forms sitting on a surface card (customer screens), where fields use the darker page background.
export const PANEL_FIELD_CLASS =
  "bg-bg border border-cleo-border rounded-xl py-3 text-ink font-mono text-base placeholder:text-muted/40 focus:outline-none focus:border-gold transition-colors";
const PANEL_MAX_HEIGHT = 320;

interface PhoneInputProps {
  countryCode: string;
  phoneNumber: string;
  onCountryCodeChange: (code: string) => void;
  onPhoneNumberChange: (number: string) => void;
  // Look of both boxes (border, background, padding-y, text); leave out width and horizontal padding.
  fieldClassName?: string;
  id?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

// Country-code picker + number box; stores the code as "+91" and the number as digits only.
export default function PhoneInput({
  countryCode,
  phoneNumber,
  onCountryCodeChange,
  onPhoneNumberChange,
  fieldClassName = DEFAULT_FIELD_CLASS,
  id,
  placeholder = "98765 43210",
  autoFocus,
  disabled,
}: PhoneInputProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [pickedIso, setPickedIso] = useState<string | null>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = optionFor(countryCode, pickedIso);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? COUNTRY_OPTIONS.filter((o) => o.search.includes(q)) : COUNTRY_OPTIONS;
  }, [query]);

  // The list lives in a portal so modals can't clip it; keep it pinned under (or above) the field.
  useLayoutEffect(() => {
    if (!open) return;
    const place = (e?: Event) => {
      // Scrolling the list itself doesn't move the field.
      if (e && panelRef.current?.contains(e.target as Node)) return;
      const rect = rootRef.current!.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 288), window.innerWidth - 16);
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < PANEL_MAX_HEIGHT && rect.top > spaceBelow;
      setPanelStyle(
        openUp
          ? { left, width, bottom: window.innerHeight - rect.top + 6, maxHeight: Math.min(PANEL_MAX_HEIGHT, rect.top - 16) }
          : { left, width, top: rect.bottom + 6, maxHeight: Math.min(PANEL_MAX_HEIGHT, spaceBelow - 16) }
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Re-runs once the panel gets its height, so the selected country is in view on open.
  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, panelStyle.maxHeight]);

  function openList() {
    setQuery("");
    setActiveIndex(selected ? Math.max(COUNTRY_OPTIONS.indexOf(selected), 0) : 0);
    setOpen(true);
  }

  function choose(option: CountryOption) {
    setPickedIso(option.iso);
    onCountryCodeChange(option.dial);
    setOpen(false);
    numberRef.current?.focus();
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // Also stops Enter from submitting the surrounding form.
      e.preventDefault();
      if (filtered[activeIndex]) choose(filtered[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="flex gap-2">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selected ? `Country code ${selected.name} ${selected.dial}` : "Choose country code"}
        className={`${fieldClassName} shrink-0 flex items-center gap-1.5 px-3 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {selected && <span className="text-muted text-[11px] font-mono">{selected.iso}</span>}
        <span>{countryCode || "+"}</span>
        <svg className={`w-3.5 h-3.5 text-muted transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      <input
        ref={numberRef}
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        aria-label="Phone number"
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        value={phoneNumber}
        onChange={(e) => onPhoneNumberChange(sanitizePhoneNumberInput(e.target.value))}
        className={`${fieldClassName} flex-1 min-w-0 px-4`}
      />

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={panelStyle}
            className="fixed z-70 flex flex-col bg-surface border border-cleo-border rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="p-2 border-b border-cleo-border">
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
                onKeyDown={onSearchKeyDown}
                placeholder="Search country or code"
                aria-label="Search country or code"
                aria-controls={listId}
                aria-activedescendant={filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
                className="w-full bg-bg border border-cleo-border rounded-lg px-3 py-2 text-ink text-sm placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
              />
            </div>
            <ul ref={listRef} id={listId} role="listbox" className="flex-1 min-h-0 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-3 text-muted text-sm">No matches</li>
              ) : (
                filtered.map((option, i) => {
                  const isSelected = option.iso === selected?.iso && option.dial === selected?.dial;
                  return (
                    <li
                      key={`${option.iso}${option.dial}`}
                      id={`${listId}-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIndex(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(option)}
                      className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer ${i === activeIndex ? "bg-gold/10" : ""} ${isSelected ? "text-gold" : "text-ink"}`}
                    >
                      <span className="w-6 text-muted text-[11px] font-mono">{option.iso}</span>
                      <span className="flex-1 truncate">{option.name}</span>
                      <span className="text-muted text-xs font-mono">{option.dial}</span>
                    </li>
                  );
                })
              )}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}
