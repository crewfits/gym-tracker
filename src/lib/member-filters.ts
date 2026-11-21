/** Shared, allowlisted member-directory contract for UI, URLs and CSV. */
export const searchFields = ["all", "name", "phone", "member_code", "old_member_id"] as const;
export const membershipOptions = ["active", "expiring", "expired", "upcoming", "not_enrolled"] as const;
export const qrOptions = ["not_generated", "not_shared", "shared", "disabled"] as const;
export const memberSorts = ["created_at", "member_code", "old_member_id", "name", "expires_on", "balance", "status"] as const;
export type MemberFilters = {
  q: string;
  field: typeof searchFields[number];
  records: "current" | "archived" | "all";
  membership: string[];
  payment: "" | "due" | "clear";
  attendance: "" | "this_week" | "no_this_week" | "last_week";
  qr: string[];
  plans: string[];
  noMembership: boolean;
  expiry: "" | "today" | "next7" | "next30" | "custom";
  from: string;
  to: string;
  sort: typeof memberSorts[number];
  order: "asc" | "desc";
  page: number;
};
export class MemberFilterError extends Error {}
type Params = URLSearchParams | Record<string, string | string[] | undefined>;
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function parseMemberFilters(params: Params): MemberFilters {
  const values = (key: string): string[] => params instanceof URLSearchParams ? params.getAll(key) : typeof params[key] === "string" ? [params[key]] : params[key] ?? [];
  const one = (key: string, allowed?: readonly string[], fallback = "") => {
    const found = values(key);
    if (found.length > 1 || (allowed && found[0] && !allowed.includes(found[0]))) throw new MemberFilterError(`Invalid ${key} filter. Clear it and try again.`);
    return found[0] || fallback;
  };
  const many = (key: string, allowed?: readonly string[]) => {
    const found = [...new Set(values(key))];
    if (found.length > 100 || found.some((value) => !value || value.length > 200 || (allowed && !allowed.includes(value)))) throw new MemberFilterError(`Invalid ${key} filter. Clear it and try again.`);
    return found.sort();
  };
  const result: MemberFilters = {
    q: one("q").trim().slice(0, 100), field: one("field", searchFields, "all") as MemberFilters["field"],
    records: one("records", ["current", "archived", "all"], "current") as MemberFilters["records"],
    membership: many("membership", membershipOptions), payment: one("payment", ["due", "clear"]) as MemberFilters["payment"],
    attendance: one("attendance", ["this_week", "no_this_week", "last_week"]) as MemberFilters["attendance"],
    qr: many("qr", qrOptions), plans: many("plan"), noMembership: one("noMembership", ["1"]) === "1",
    expiry: one("expiry", ["today", "next7", "next30", "custom"]) as MemberFilters["expiry"],
    from: one("from"), to: one("to"), sort: one("sort", memberSorts, "created_at") as MemberFilters["sort"],
    order: one("order", ["asc", "desc"], "desc") as MemberFilters["order"], page: Number(one("page", undefined, "1")),
  };
  if (!Number.isSafeInteger(result.page) || result.page < 1 || result.page > 100000) result.page = 1;
  if (result.expiry === "custom") {
    if (!validDate(result.from) || !validDate(result.to) || result.from > result.to) throw new MemberFilterError("Choose a valid expiry date range with the end on or after the start.");
  } else { result.from = ""; result.to = ""; }
  // Old dashboard/bookmark links remain usable. Explicit new groups win.
  const legacy = one("status", [...membershipOptions, "outstanding", "archived", "all", ...qrOptions.map((value) => `qr_${value}`), "visited_this_week", "visited_last_week", "slipping"]);
  if (membershipOptions.includes(legacy as typeof membershipOptions[number]) && !values("membership").length) result.membership = [legacy];
  if ((legacy === "all" || legacy === "archived") && !values("records").length) result.records = legacy;
  if (legacy === "outstanding" && !values("payment").length) result.payment = "due";
  if (legacy.startsWith("qr_") && !values("qr").length) result.qr = [legacy.slice(3)];
  if (["visited_this_week", "visited_last_week", "slipping"].includes(legacy)) {
    if (!values("attendance").length) result.attendance = legacy === "slipping" ? "no_this_week" : legacy === "visited_this_week" ? "this_week" : "last_week";
    if (!values("membership").length) result.membership = ["active", "expiring"];
  }
  return result;
}
export function serializeMemberFilters(filters: MemberFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.field !== "all") params.set("field", filters.field);
  if (filters.records !== "current") params.set("records", filters.records);
  for (const value of filters.membership) params.append("membership", value);
  if (filters.payment) params.set("payment", filters.payment);
  if (filters.attendance) params.set("attendance", filters.attendance);
  for (const value of filters.qr) params.append("qr", value);
  for (const value of filters.plans) params.append("plan", value);
  if (filters.noMembership) params.set("noMembership", "1");
  if (filters.expiry) params.set("expiry", filters.expiry);
  if (filters.expiry === "custom") { params.set("from", filters.from); params.set("to", filters.to); }
  if (filters.sort !== "created_at") params.set("sort", filters.sort);
  if (filters.order !== "desc") params.set("order", filters.order);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}
export function memberFilterRpcArgs(filters: MemberFilters, today: string, pageSize: number) {
  return {
    p_query: filters.q || null, p_field: filters.field, p_records: filters.records,
    p_membership: filters.membership, p_payment: filters.payment || null, p_attendance: filters.attendance || null,
    p_qr: filters.qr, p_plans: filters.plans, p_no_membership: filters.noMembership,
    p_expiry: filters.expiry || null, p_from: filters.from || null, p_to: filters.to || null,
    p_today: today, p_page: filters.page, p_page_size: pageSize, p_sort: filters.sort, p_order: filters.order,
  };
}
