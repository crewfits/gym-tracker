"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { FilterCategories, type FilterCategory, type FilterSelection } from "@/components/filter-categories";
import { parseMemberFilters, serializeMemberFilters, type MemberFilters } from "@/lib/member-filters";

const fields = [{ value: "all", label: "All fields" }, { value: "name", label: "Name" }, { value: "phone", label: "Phone" }, { value: "member_code", label: "FitKiro ID" }, { value: "old_member_id", label: "Member ID" }];
export function MemberSearchFilters({ filters, plans, total }: { filters: MemberFilters; plans: string[]; total: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);
  const [field, setField] = useState(filters.field);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(filters);
  const [scheduled, setScheduled] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(filters);
  const target = useRef<string | null>(null);
  const appliedKey = serializeMemberFilters(filters).toString();
  // A later selection must not be overwritten by an earlier server response.
  useEffect(() => {
    if (target.current && target.current !== appliedKey) return;
    if (timer.current) return;
    target.current = null;
    latest.current = filters;
    setDraft(filters);
  }, [appliedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Restore search controls on browser navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(filters.q); setField(filters.field);
  }, [filters.q, filters.field]);
  const incomplete = draft.expiry === "custom" && (!draft.from || !draft.to || draft.from > draft.to);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("member-filter-updating", { detail: scheduled || pending || incomplete }));
    return () => { window.dispatchEvent(new CustomEvent("member-filter-updating", { detail: false })); };
  }, [scheduled, pending, incomplete]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function navigate(next: MemberFilters) {
    try {
      const validated = parseMemberFilters(serializeMemberFilters({ ...next, page: 1 }));
      setError("");
      target.current = serializeMemberFilters(validated).toString();
      startTransition(() => router.push(`/members?${serializeMemberFilters(validated)}`, { scroll: false }));
    } catch (error) { setError(error instanceof Error ? error.message : "Check your filters."); }
  }
  function update(next: MemberFilters, immediate = false) {
    latest.current = next;
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (next.expiry === "custom" && (!next.from || !next.to || next.from > next.to)) {
      setScheduled(false);
      target.current = "incomplete-date";
      if (immediate) {
        const withoutIncompleteRange = { ...next, expiry: filters.expiry, from: filters.from, to: filters.to };
        navigate(withoutIncompleteRange);
        target.current = "incomplete-date";
      }
      return;
    }
    target.current = serializeMemberFilters(parseMemberFilters(serializeMemberFilters({ ...next, page: 1 }))).toString();
    if (serializeMemberFilters({ ...next, page: 1 }).toString() === serializeMemberFilters({ ...filters, page: 1 }).toString() && !pending) { target.current = null; setScheduled(false); return; }
    if (immediate) { setScheduled(false); navigate(next); return; }
    setScheduled(true);
    timer.current = setTimeout(() => { timer.current = null; setScheduled(false); navigate(latest.current); }, 400);
  }
  const categories: FilterCategory[] = [
    { key: "membership", label: "Membership", multiple: true, help: "Active and Expiring soon are separate. Expiring soon ends within 7 days without a scheduled renewal.", options: [{ value: "active", label: "Active" }, { value: "expiring", label: "Expiring soon" }, { value: "expired", label: "Expired" }, { value: "upcoming", label: "Upcoming" }, { value: "not_enrolled", label: "Not enrolled" }], selection: { values: draft.membership } },
    { key: "payment", label: "Payment", help: "Balance includes all membership periods.", options: [{ value: "due", label: "Balance due" }, { value: "clear", label: "No balance due" }], selection: { values: draft.payment ? [draft.payment] : [] } },
    { key: "attendance", label: "Attendance", help: "Weeks start on Monday in the gym timezone. Only valid check-ins count. Combine with Membership to narrow the roster.", options: [{ value: "this_week", label: "Checked in this week" }, { value: "no_this_week", label: "No check-in this week" }, { value: "last_week", label: "Checked in last week" }], selection: { values: draft.attendance ? [draft.attendance] : [] } },
    { key: "plans", label: "Plan", multiple: true, help: "Matches the plan shown in the list, including a scheduled renewal. Historical plan names are included.", options: [...[...new Set([...plans, ...draft.plans])].sort().map((name) => ({ value: `plan:${name}`, label: name })), { value: "none", label: "No membership" }], selection: { values: [...draft.plans.map((name) => `plan:${name}`), ...(draft.noMembership ? ["none"] : [])] } },
    { key: "expiry", label: "Expiry date", dateRangeValue: "custom", help: "Matches the plan end shown in the list. Next 7/30 days includes today through 7/30 days from today, in the gym timezone.", options: [{ value: "today", label: "Today" }, { value: "next7", label: "Next 7 days" }, { value: "next30", label: "Next 30 days" }, { value: "custom", label: "Custom date range" }], selection: { values: draft.expiry ? [draft.expiry] : [], from: draft.from, to: draft.to } },
    { key: "qr", label: "QR pass", multiple: true, options: [{ value: "not_generated", label: "Not generated" }, { value: "not_shared", label: "Not shared" }, { value: "shared", label: "Shared" }, { value: "disabled", label: "Disabled" }], selection: { values: draft.qr } },
  ];
  function apply(key: string, selection: FilterSelection) {
    const next = { ...latest.current };
    if (key === "membership" || key === "qr") next[key] = selection.values;
    if (key === "plans") { next.plans = selection.values.filter((value) => value.startsWith("plan:")).map((value) => value.slice(5)); next.noMembership = selection.values.includes("none"); }
    if (key === "payment") next.payment = (selection.values[0] ?? "") as MemberFilters["payment"];
    if (key === "attendance") next.attendance = (selection.values[0] ?? "") as MemberFilters["attendance"];
    if (key === "expiry") { next.expiry = (selection.values[0] ?? "") as MemberFilters["expiry"]; next.from = selection.from ?? ""; next.to = selection.to ?? ""; }
    update(next);
  }
  return <section className="member-search-filters" aria-label="Search and filter members" aria-busy={pending || scheduled}>
    <form className="member-search-row" onSubmit={(event) => { event.preventDefault(); update({ ...latest.current, q: query, field }, true); }}>
      <label className="search-field-label"><span className="sr-only">Search field</span><select aria-label="Search field" value={field} onChange={(event) => setField(event.target.value as MemberFilters["field"])}>{fields.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
      <label className="member-search-input"><span className="sr-only">Search members</span><Search size={18}/><input name="q" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} placeholder={field === "all" ? "Search name, phone, FitKiro ID or member ID" : `Search by ${fields.find((item) => item.value === field)?.label.toLowerCase()}`}/></label>
      <button className="button" disabled={pending}>Search</button>
      <label className="record-scope">Records<select value={draft.records} onChange={(event) => update({ ...latest.current, records: event.target.value as MemberFilters["records"] }, true)}><option value="current">Not archived</option><option value="archived">Archived</option><option value="all">All records</option></select></label>
    </form>
    <FilterCategories categories={categories} onChange={apply} onClear={() => update({ ...parseMemberFilters({}), q: latest.current.q, field: latest.current.field, records: latest.current.records, sort: latest.current.sort, order: latest.current.order })}/>
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="filter-result-summary" role="status">{incomplete ? "Choose a valid expiry date range to update results." : pending || scheduled ? "Updating members…" : `${total.toLocaleString()} member${total === 1 ? "" : "s"}`}{filters.q && <span> matching {fields.find((item) => item.value === filters.field)?.label.toLowerCase()}: “{filters.q}” <button type="button" className="filter-clear" onClick={() => { setQuery(""); update({ ...latest.current, q: "" }, true); }}>Clear search</button></span>}</div>
  </section>;
}
