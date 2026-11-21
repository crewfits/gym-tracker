"use client";

import { useState, useTransition } from "react";
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
  function navigate(next: MemberFilters) {
    try {
      const validated = parseMemberFilters(serializeMemberFilters({ ...next, page: 1 }));
      setError("");
      startTransition(() => router.push(`/members?${serializeMemberFilters(validated)}`, { scroll: false }));
    } catch (error) { setError(error instanceof Error ? error.message : "Check your filters."); }
  }
  const categories: FilterCategory[] = [
    { key: "membership", label: "Membership", multiple: true, help: "Active and Expiring soon are separate. Expiring soon ends within 7 days without a scheduled renewal.", options: [{ value: "active", label: "Active" }, { value: "expiring", label: "Expiring soon" }, { value: "expired", label: "Expired" }, { value: "upcoming", label: "Upcoming" }, { value: "not_enrolled", label: "Not enrolled" }], selection: { values: filters.membership } },
    { key: "payment", label: "Payment", help: "Balance includes all membership periods.", options: [{ value: "due", label: "Balance due" }, { value: "clear", label: "No balance due" }], selection: { values: filters.payment ? [filters.payment] : [] } },
    { key: "attendance", label: "Attendance", help: "Weeks start on Monday in the gym timezone. Only valid check-ins count. Combine with Membership to narrow the roster.", options: [{ value: "this_week", label: "Checked in this week" }, { value: "no_this_week", label: "No check-in this week" }, { value: "last_week", label: "Checked in last week" }], selection: { values: filters.attendance ? [filters.attendance] : [] } },
    { key: "plans", label: "Plan", multiple: true, help: "Matches the plan shown in the list, including a scheduled renewal. Historical plan names are included.", options: [...[...new Set([...plans, ...filters.plans])].sort().map((name) => ({ value: `plan:${name}`, label: name })), { value: "none", label: "No membership" }], selection: { values: [...filters.plans.map((name) => `plan:${name}`), ...(filters.noMembership ? ["none"] : [])] } },
    { key: "expiry", label: "Expiry date", dateRangeValue: "custom", help: "Matches the plan end shown in the list. Next 7/30 days includes today through 7/30 days from today, in the gym timezone.", options: [{ value: "today", label: "Today" }, { value: "next7", label: "Next 7 days" }, { value: "next30", label: "Next 30 days" }, { value: "custom", label: "Custom date range" }], selection: { values: filters.expiry ? [filters.expiry] : [], from: filters.from, to: filters.to } },
    { key: "qr", label: "QR pass", multiple: true, options: [{ value: "not_generated", label: "Not generated" }, { value: "not_shared", label: "Not shared" }, { value: "shared", label: "Shared" }, { value: "disabled", label: "Disabled" }], selection: { values: filters.qr } },
  ];
  function apply(key: string, selection: FilterSelection) {
    const next = { ...filters };
    if (key === "membership" || key === "qr") next[key] = selection.values;
    if (key === "plans") { next.plans = selection.values.filter((value) => value.startsWith("plan:")).map((value) => value.slice(5)); next.noMembership = selection.values.includes("none"); }
    if (key === "payment") next.payment = (selection.values[0] ?? "") as MemberFilters["payment"];
    if (key === "attendance") next.attendance = (selection.values[0] ?? "") as MemberFilters["attendance"];
    if (key === "expiry") { next.expiry = (selection.values[0] ?? "") as MemberFilters["expiry"]; next.from = selection.from ?? ""; next.to = selection.to ?? ""; }
    navigate(next);
  }
  return <section className="member-search-filters" aria-label="Search and filter members" aria-busy={pending}>
    <form className="member-search-row" onSubmit={(event) => { event.preventDefault(); navigate({ ...filters, q: query, field }); }}>
      <label className="search-field-label"><span className="sr-only">Search field</span><select aria-label="Search field" value={field} disabled={pending} onChange={(event) => setField(event.target.value as MemberFilters["field"])}>{fields.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
      <label className="member-search-input"><span className="sr-only">Search members</span><Search size={18}/><input name="q" value={query} maxLength={100} disabled={pending} onChange={(event) => setQuery(event.target.value)} placeholder={field === "all" ? "Search name, phone, FitKiro ID or member ID" : `Search by ${fields.find((item) => item.value === field)?.label.toLowerCase()}`}/></label>
      <button className="button" disabled={pending}>Search</button>
      <label className="record-scope">Records<select value={filters.records} disabled={pending} onChange={(event) => navigate({ ...filters, records: event.target.value as MemberFilters["records"] })}><option value="current">Not archived</option><option value="archived">Archived</option><option value="all">All records</option></select></label>
    </form>
    <FilterCategories categories={categories} disabled={pending} onApply={apply} onClear={() => navigate({ ...parseMemberFilters({}), q: filters.q, field: filters.field, records: filters.records, sort: filters.sort, order: filters.order })}/>
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="filter-result-summary" role="status">{pending ? "Updating members…" : `${total.toLocaleString()} member${total === 1 ? "" : "s"}`}{filters.q && <span> matching {fields.find((item) => item.value === filters.field)?.label.toLowerCase()}: “{filters.q}” <button type="button" className="filter-clear" disabled={pending} onClick={() => { setQuery(""); navigate({ ...filters, q: "" }); }}>Clear search</button></span>}</div>
  </section>;
}
