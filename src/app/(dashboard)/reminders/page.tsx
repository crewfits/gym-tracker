import Link from "next/link";
import { Send } from "lucide-react";
import { runAutomaticPaymentReminders } from "@/app/actions/reminders";
import { Feedback } from "@/components/feedback";
import { OpenWhatsAppReminderButton } from "@/components/open-whatsapp-reminder-button";
import { RefreshButton } from "@/components/refresh-button";
import { SubmitButton } from "@/components/submit-button";
import { SortableTableHeader, type SortOrder } from "@/components/sortable-table-header";
import { requireGym } from "@/lib/auth";
import { businessDate, formatDisplayDate, formatDisplayDateTime, formatInr } from "@/lib/domain";

const pageSize = 50;
const filters = new Set(["overdue", "partial_payment", "expiring"]);
const reminderSorts = new Set(["candidate_date", "member_name", "balance"]);

type Candidate = { candidate_kind: string; member_id: string; member_code: string; member_name: string; phone: string; membership_id: string; charge_id: string | null; plan_name: string; candidate_date: string; balance_paise: number; total_count: number };

export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string; error?: string; success?: string; sort?: string; order?: string }> }) {
  const params = await searchParams;
  const { supabase, gym } = await requireGym();
  const selectedFilter = typeof params.filter === "string" && filters.has(params.filter) ? params.filter : "";
  const requestedPage = Number(params.page ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const today = businessDate(gym.timezone);
  const sort = typeof params.sort === "string" && reminderSorts.has(params.sort) ? params.sort : "candidate_date";
  const order: SortOrder = params.order === "asc" || params.order === "desc" ? params.order : "asc";
  const loadCandidates = (filter: string | null, selectedPage: number, selectedPageSize: number) => supabase.rpc("list_reminder_candidates", { p_filter: filter, p_today: today, p_page: selectedPage, p_page_size: selectedPageSize, p_sort: sort, p_order: order });
  const [main, overdue, outstanding, expiring] = await Promise.all([
    loadCandidates(selectedFilter || null, page, pageSize),
    loadCandidates("overdue", 1, 1),
    loadCandidates("partial_payment", 1, 1),
    loadCandidates("expiring", 1, 1),
  ]);
  for (const result of [main, overdue, outstanding, expiring]) if (result.error) throw result.error;
  const data = main.data;
  const candidates = (data ?? []) as Candidate[];
  const total = Number(candidates[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const { data: whatsappHistory, error: whatsappHistoryError } = await supabase.from("reminder_deliveries").select("id,status,recipient_snapshot,error,created_at,memberships(plan_name,members(name,member_code))").eq("gym_id", gym.id).eq("channel", "whatsapp").order("created_at", { ascending: false }).limit(20);
  if (whatsappHistoryError) throw whatsappHistoryError;
  const queryFor = ({ targetPage, nextFilter = selectedFilter, nextSort, nextOrder }: { targetPage?: number; nextFilter?: string; nextSort?: string; nextOrder?: SortOrder } = {}) => {
    const query = new URLSearchParams();
    if (nextFilter) query.set("filter", nextFilter);
    const selectedSort = nextSort ?? sort;
    const selectedOrder = nextOrder ?? order;
    if (selectedSort !== "candidate_date") query.set("sort", selectedSort);
    if (selectedSort !== "candidate_date" || selectedOrder !== "asc") query.set("order", selectedOrder);
    if (targetPage && targetPage > 1) query.set("page", String(targetPage));
    return query;
  };
  const pageHref = (targetPage: number) => `/reminders?${queryFor({ targetPage }).toString()}`.replace(/\?$/, "");
  const filterHref = (nextFilter: string) => `/reminders?${queryFor({ nextFilter }).toString()}`.replace(/\?$/, "");
  const hrefForSort = (field: string, firstOrder: SortOrder) => {
    if (sort === field && order !== firstOrder) return `/reminders?${queryFor({ nextSort: "candidate_date", nextOrder: "asc" }).toString()}`.replace(/\?$/, "");
    const nextOrder = sort === field ? (order === "asc" ? "desc" : "asc") : firstOrder;
    return `/reminders?${queryFor({ nextSort: field, nextOrder }).toString()}`;
  };

  return <>
    <div className="page-head reminder-page-head"><div><p className="eyebrow">Owner follow-up</p><h1>Reminders</h1><p className="muted">Review payment follow-ups, membership renewals, and WhatsApp reminder activity.</p></div><div className="reminder-actions"><form action={runAutomaticPaymentReminders}><SubmitButton className="button small" pendingLabel="Sending reminders…"><Send size={15}/> Send due WhatsApp reminders</SubmitButton></form><RefreshButton/></div></div>
    <Feedback success={params.success} error={params.error}/>
    <nav className="filter-tabs" aria-label="Reminder queues"><ReminderTab href={filterHref("")} active={!selectedFilter} label="All" count={countOf(overdue.data) + countOf(outstanding.data) + countOf(expiring.data)}/><ReminderTab href={filterHref("overdue")} active={selectedFilter === "overdue"} label="Overdue" count={countOf(overdue.data)}/><ReminderTab href={filterHref("partial_payment")} active={selectedFilter === "partial_payment"} label="Payment follow-up" count={countOf(outstanding.data)}/><ReminderTab href={filterHref("expiring")} active={selectedFilter === "expiring"} label="Expiring" count={countOf(expiring.data)}/></nav>
    <section className="card table-wrap"><table className="table"><thead><tr><SortableTableHeader label="Member" href={hrefForSort("member_name", "asc")} active={sort === "member_name"} order={order}/><th>Reason</th><SortableTableHeader label="Action date" href={hrefForSort("candidate_date", "asc")} active={sort === "candidate_date"} order={order}/><SortableTableHeader label="Outstanding" href={hrefForSort("balance", "desc")} active={sort === "balance"} order={order}/><th>Action</th></tr></thead><tbody>{candidates.map((candidate) => <tr key={`${candidate.candidate_kind}-${candidate.membership_id}-${candidate.charge_id ?? "renewal"}`}><td><Link href={`/members/${candidate.member_id}`}><strong>{candidate.member_name}</strong><br/><small className="muted">{candidate.member_code} · {candidate.phone}</small></Link></td><td><strong>{reminderLabel(candidate.candidate_kind)}</strong><br/><small className="muted">{candidate.plan_name}</small></td><td><strong>{formatDisplayDate(candidate.candidate_date)}</strong><br/><small className="muted">{dateLabel(candidate.candidate_kind)}</small></td><td>{candidate.charge_id ? formatInr(Number(candidate.balance_paise)) : "—"}</td><td><OpenWhatsAppReminderButton kind={candidate.charge_id ? "payment" : "renewal"} memberId={candidate.member_id} membershipId={candidate.membership_id} chargeId={candidate.charge_id}/></td></tr>)}</tbody></table>{!candidates.length && <div className="empty"><strong>{emptyTitle(selectedFilter)}</strong><br/><span>{emptyDetail(selectedFilter)}</span></div>}</section>
    <div className="pagination"><span className="muted">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 reminders"}</span><div>{page > 1 && <Link className="button secondary small" href={pageHref(page - 1)}>Previous</Link>}{page < pages && <Link className="button secondary small" href={pageHref(page + 1)}>Next</Link>}</div></div>
    <section className="card table-wrap reminder-delivery-card"><div className="section-head"><div><h2>Automatic WhatsApp reminders</h2><span className="muted">Latest submissions and processing results.</span></div><Link className="text-link" href="/settings">WhatsApp settings <ArrowRightIcon/></Link></div><table className="table"><thead><tr><th>Member</th><th>Plan</th><th>WhatsApp number</th><th>Status</th><th>Processed</th></tr></thead><tbody>{(whatsappHistory ?? []).map((delivery) => { const membership = Array.isArray(delivery.memberships) ? delivery.memberships[0] : delivery.memberships; const memberValue = membership ? (Array.isArray(membership.members) ? membership.members[0] : membership.members) : null; return <tr key={delivery.id}><td>{memberValue ? `${memberValue.name} · ${memberValue.member_code}` : "—"}</td><td>{membership?.plan_name ?? "—"}</td><td>{delivery.recipient_snapshot ?? delivery.error ?? "No number"}</td><td><span className={`badge ${delivery.status === "sent" ? "paid" : delivery.status === "failed" ? "unpaid" : "upcoming"}`}>{delivery.status === "sent" ? "submitted" : delivery.status}</span></td><td>{formatDisplayDateTime(delivery.created_at, gym.timezone)}</td></tr>; })}</tbody></table>{!whatsappHistory?.length && <div className="empty">No automatic WhatsApp reminders have been processed yet.</div>}</section>
  </>;
}

function reminderLabel(kind: string) {
  return ({ overdue: "Overdue payment", partial_payment: "Outstanding payment follow-up", expiring: "Membership ending soon" } as Record<string, string>)[kind] ?? kind.replaceAll("_", " ");
}

function dateLabel(kind: string) { return kind === "expiring" ? "Plan end date" : "Payment follow-up date"; }
function countOf(rows: unknown[] | null) { return Number((rows?.[0] as Candidate | undefined)?.total_count ?? 0); }
function ReminderTab({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) { return <Link href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>{label}<span>{count}</span></Link>; }
function emptyTitle(filter: string) { return ({ overdue: "No overdue payments", partial_payment: "No payments need follow-up", expiring: "No memberships end in the next 7 days" } as Record<string, string>)[filter] ?? "No reminders need action"; }
function emptyDetail(filter: string) { return filter ? "Choose another queue to review other reminder types." : "Outstanding payments and upcoming membership endings will appear here automatically."; }
function ArrowRightIcon() { return <span aria-hidden="true">→</span>; }
