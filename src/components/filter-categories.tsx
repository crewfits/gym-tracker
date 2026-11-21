"use client";

import { useId, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

export type FilterSelection = { values: string[]; from?: string; to?: string };
export type FilterCategory = {
  key: string; label: string; help?: string; multiple?: boolean;
  options: { value: string; label: string }[];
  selection: FilterSelection;
  dateRangeValue?: string;
};

/** Screen-independent expandable categories; only Apply commits the draft. */
export function FilterCategories({ categories, disabled, onApply, onClear }: {
  categories: FilterCategory[]; disabled?: boolean;
  onApply: (key: string, selection: FilterSelection) => void; onClear: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<FilterSelection>({ values: [] });
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const category = categories.find((item) => item.key === open);
  const active = categories.filter((item) => item.selection.values.length);
  function close() { if (open) triggers.current[open]?.focus(); setOpen(null); }
  function toggle(item: FilterCategory) {
    if (open === item.key) { close(); return; }
    // Switching categories discards the uncommitted draft, never applies it.
    setDraft({ ...item.selection, values: [...item.selection.values] }); setOpen(item.key);
  }
  return <div className="filter-categories" onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
    <div className="filter-category-bar" aria-label="Filter categories">
      {categories.map((item) => <button key={item.key} ref={(element) => { triggers.current[item.key] = element; }} type="button" className={`filter-category-trigger ${open === item.key ? "is-open" : ""} ${item.selection.values.length ? "has-selection" : ""}`} aria-expanded={open === item.key} aria-controls={`${id}-${item.key}`} disabled={disabled} onClick={() => toggle(item)}>
        {item.label}{item.selection.values.length > 0 && <span className="filter-count">{item.selection.values.length}</span>}<ChevronDown size={15}/>
      </button>)}
    </div>
    {category && <form id={`${id}-${category.key}`} className="filter-category-panel" aria-label={`${category.label} options`} onSubmit={(event) => { event.preventDefault(); onApply(category.key, draft); close(); }}>
      <fieldset disabled={disabled}>
        <legend>{category.label}</legend>
        {category.help && <p className="muted filter-help">{category.help}</p>}
        <div className="filter-option-grid">
          {!category.multiple && <label className="filter-option"><input type="radio" name={`${id}-option`} checked={!draft.values.length} onChange={() => setDraft({ values: [] })}/>Any</label>}
          {category.options.map((option) => <label className="filter-option" key={option.value}>
            <input type={category.multiple ? "checkbox" : "radio"} name={`${id}-option`} checked={draft.values.includes(option.value)} onChange={(event) => setDraft({ ...draft, values: category.multiple ? event.target.checked ? [...draft.values, option.value] : draft.values.filter((value) => value !== option.value) : [option.value] })}/>{option.label}
          </label>)}
        </div>
        {category.dateRangeValue && draft.values.includes(category.dateRangeValue) && <div className="filter-date-range">
          <label>From<input type="date" required value={draft.from ?? ""} max={draft.to || undefined} onChange={(event) => setDraft({ ...draft, from: event.target.value })}/></label>
          <label>Through<input type="date" required value={draft.to ?? ""} min={draft.from || undefined} onChange={(event) => setDraft({ ...draft, to: event.target.value })}/></label>
        </div>}
        <div className="filter-panel-actions"><button type="button" className="button secondary small" onClick={close}>Cancel</button><button className="button small" type="submit">Apply</button></div>
      </fieldset>
    </form>}
    {active.length > 0 && <div className="filter-chips" aria-label="Applied filters">
      {active.map((item) => <span className="filter-chip" key={item.key}><button type="button" disabled={disabled} onClick={() => toggle(item)} aria-label={`Edit ${item.label} filter`}>
        <strong>{item.label}:</strong> {item.selection.values.map((value) => value === item.dateRangeValue ? `${item.selection.from} – ${item.selection.to}` : item.options.find((option) => option.value === value)?.label ?? value).join(", ")}
      </button><button type="button" disabled={disabled} aria-label={`Remove ${item.label} filter`} onClick={() => { if (open === item.key) close(); onApply(item.key, { values: [] }); }}><X size={14}/></button></span>)}
      <button type="button" className="filter-clear" disabled={disabled} onClick={() => { close(); onClear(); }}>Clear filters</button>
    </div>}
  </div>;
}
