"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

export type FilterSelection = { values: string[]; from?: string; to?: string };
export type FilterCategory = {
  key: string; label: string; help?: string; multiple?: boolean;
  options: { value: string; label: string }[];
  selection: FilterSelection;
  dateRangeValue?: string;
};

/** Reusable compact category picker. The parent owns the selected values. */
export function FilterCategories({ categories, onChange, onClear }: {
  categories: FilterCategory[];
  onChange: (key: string, selection: FilterSelection) => void; onClear: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState<string | null>(null);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(null); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  const active = categories.filter((item) => item.selection.values.length);
  function close() { if (open) triggers.current[open]?.focus(); setOpen(null); }
  return <div ref={root} className="filter-categories" onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
    <div className="filter-category-bar" aria-label="Filter categories">
      {categories.map((item) => <div className="filter-category-item" key={item.key}>
        <button ref={(element) => { triggers.current[item.key] = element; }} type="button" className={`filter-category-trigger ${open === item.key ? "is-open" : ""} ${item.selection.values.length ? "has-selection" : ""}`} aria-expanded={open === item.key} aria-controls={`${id}-${item.key}`} onClick={() => setOpen(open === item.key ? null : item.key)}>
          {item.label}{item.selection.values.length > 0 && <span className="filter-count">{item.selection.values.length}</span>}<ChevronDown size={15}/>
        </button>
        {open === item.key && <div id={`${id}-${item.key}`} className="filter-category-panel" role="group" aria-label={`${item.label} options`}>
          {item.help && <p className="muted filter-help">{item.help}</p>}
          <div className="filter-option-grid">
            {!item.multiple && <label className="filter-option"><input type="radio" name={`${id}-${item.key}`} checked={!item.selection.values.length} onChange={() => onChange(item.key, { values: [] })}/>Any</label>}
            {item.options.map((option) => <label className="filter-option" key={option.value}>
              <input type={item.multiple ? "checkbox" : "radio"} name={`${id}-${item.key}`} checked={item.selection.values.includes(option.value)} onChange={(event) => onChange(item.key, { ...item.selection, values: item.multiple ? event.target.checked ? [...item.selection.values, option.value] : item.selection.values.filter((value) => value !== option.value) : [option.value] })}/>{option.label}
            </label>)}
          </div>
          {item.dateRangeValue && item.selection.values.includes(item.dateRangeValue) && <div className="filter-date-range">
            <label>From<input type="date" value={item.selection.from ?? ""} max={item.selection.to || undefined} onChange={(event) => onChange(item.key, { ...item.selection, from: event.target.value })}/></label>
            <label>Through<input type="date" value={item.selection.to ?? ""} min={item.selection.from || undefined} onChange={(event) => onChange(item.key, { ...item.selection, to: event.target.value })}/></label>
          </div>}
        </div>}
      </div>)}
    </div>
    {active.length > 0 && <div className="filter-chips" aria-label="Selected filters">
      {active.map((item) => <span className="filter-chip" key={item.key}><button type="button" onClick={() => setOpen(open === item.key ? null : item.key)} aria-label={`Edit ${item.label} filter`}>
        <strong>{item.label}:</strong> {item.selection.values.map((value) => value === item.dateRangeValue ? item.selection.from && item.selection.to ? `${item.selection.from} – ${item.selection.to}` : "Choose dates" : item.options.find((option) => option.value === value)?.label ?? value).join(", ")}
      </button><button type="button" aria-label={`Remove ${item.label} filter`} onClick={() => onChange(item.key, { values: [] })}><X size={14}/></button></span>)}
      <button type="button" className="filter-clear" onClick={onClear}>Clear filters</button>
    </div>}
  </div>;
}
