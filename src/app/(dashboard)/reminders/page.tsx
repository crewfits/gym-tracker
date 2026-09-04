import Link from "next/link";
import { Send } from "lucide-react";
import { runAutomaticMembershipReminders } from "@/app/actions/reminders";
import { Feedback } from "@/components/feedback";
import { OpenWhatsAppReminderButton } from "@/components/open-whatsapp-reminder-button";
import { RefreshButton } from "@/components/refresh-button";
import { SubmitButton } from "@/components/submit-button";
import { SortableTableHeader, type SortOrder } from "@/components/sortable-table-header";
import { requireGym } from "@/lib/auth";
import { businessDate, formatDisplayDate, memberOperationalView } from "@/lib/domain";

const pageSize = 50;
const filters = new Set(["expired", "expiring"]);
const reminderSorts = new Set(["candidate_date", "member_name"]);

type ReminderMembershipRow = { id: string; plan_name: string; starts_on: string; expires_on: string; created_at: string; reverted_at: string | null };
type ReminderMemberRow = { id: string; member_code: string; name: string; phone: string; is_archived: boolean; memberships: ReminderMembershipRow[] | null };
type Candidate = { candidate_kind: "expired" | "expiring"; member_id: string; member_code: string; member_name: string; phone: string; membership_id: string; plan_name: string; candidate_date: string };

export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string; error?: string; success?: string; sort?: string; order?: string }> }) {
  const params = await searchParams;
  const { supabase, gym } = await requireGym();
  const selectedFilter = typeof params.filter === "string" && filters.has(params.filter) ? params.filter : "";
  const requestedPage = Number(params.page ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const today = businessDate(gym.timezone);
  const sort = typeof params.sort === "string" && reminderSorts.has(params.sort) ? params.sort : "candidate_date";
  const order: SortOrder = params.order === "asc" || params.order === "desc" ? params.order : "asc";
  const { data, error: loadError } = await supabase.from("members").select("id,member_code,name,phone,is_archived,memberships(id,plan_name,starts_on,expires_on,created_at,reverted_at)").eq("gym_id", gym.id).eq("is_archived", false);
  if (loadError) throw loadError;
  const allCandidates = ((data ?? []) as ReminderMemberRow[]).flatMap((member) => {
    const operational = memberOperationalView((member.memberships ?? []).filter((membership) => !membership.reverted_at), today);
    if (!operational.membership || (operational.status !== "expiring" && operational.status !== "expired")) return [];
    return [{
      candidate_kind: operational.status,
      member_id: member.id,
      member_code: member.member_code,
      member_name: member.name,
      phone: member.phone,
      membership_id: operational.membership.id,
      plan_name: operational.membership.plan_name,
      candidate_date: operational.membership.expires_on,
    }];
  });
  const filtered = selectedFilter ? allCandidates.filter((candidate) => candidate.candidate_kind === selectedFilter) : allCandidates;
  const candidates = sortCandidates(filtered, sort, order).slice((page - 1) * pageSize, page * pageSize);
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const expiredCount = allCandidates.filter((candidate) => candidate.candidate_kind === "expired").length;
  const expiringCount = allCandidates.filter((candidate) => candidate.candidate_kind === "expiring").length;
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
    <div className="page-head reminder-page-head">
      <div><p className="eyebrow">Owner follow-up</p><h1>Reminders</h1><p className="muted">Send WhatsApp renewal nudges for members expiring soon or already expired.</p></div>
      <div className="reminder-actions"><form action={runAutomaticMembershipReminders}><SubmitButton className="button small" pendingLabel="Sending reminders..."><Send size={15}/> Send due WhatsApp reminders</SubmitButton></form><RefreshButton/></div>
    </div>
    <Feedback success={params.success} error={params.error}/>
    <nav className="filter-tabs" aria-label="Reminder queues"><ReminderTab href={filterHref("")} active={!selectedFilter} label="All" count={expiredCount + expiringCount}/><ReminderTab href={filterHref("expiring")} active={selectedFilter === "expiring"} label="Expiring" count={expiringCount}/><ReminderTab href={filterHref("expired")} active={selectedFilter === "expired"} label="Expired" count={expiredCount}/></nav>
    <section className="card table-wrap"><table className="table"><thead><tr><SortableTableHeader label="Member" href={hrefForSort("member_name", "asc")} active={sort === "member_name"} order={order}/><th>Reason</th><SortableTableHeader label="Plan date" href={hrefForSort("candidate_date", "asc")} active={sort === "candidate_date"} order={order}/><th>Action</th></tr></thead><tbody>{candidates.map((candidate) => <tr key={`${candidate.candidate_kind}-${candidate.membership_id}`}><td><Link href={`/members/${candidate.member_id}`}><strong>{candidate.member_name}</strong><br/><small className="muted">{candidate.member_code} · {candidate.phone}</small></Link></td><td><strong>{reminderLabel(candidate.candidate_kind)}</strong><br/><small className="muted">{candidate.plan_name}</small></td><td><strong>{formatDisplayDate(candidate.candidate_date)}</strong><br/><small className="muted">{dateLabel(candidate.candidate_kind)}</small></td><td><OpenWhatsAppReminderButton kind="renewal" memberId={candidate.member_id} membershipId={candidate.membership_id} chargeId={null}/></td></tr>)}</tbody></table>{!candidates.length && <div className="empty"><strong>{emptyTitle(selectedFilter)}</strong><br/><span>{emptyDetail(selectedFilter)}</span></div>}</section>
    <div className="pagination"><span className="muted">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 reminders"}</span><div>{page > 1 && <Link className="button secondary small" href={pageHref(page - 1)}>Previous</Link>}{page < pages && <Link className="button secondary small" href={pageHref(page + 1)}>Next</Link>}</div></div>
  </>;
}

function sortCandidates(candidates: Candidate[], sort: string, order: SortOrder) {
  const direction = order === "desc" ? -1 : 1;
  return [...candidates].sort((left, right) => {
    const value = sort === "member_name" ? left.member_name.localeCompare(right.member_name) : left.candidate_date.localeCompare(right.candidate_date);
    return value * direction || left.member_name.localeCompare(right.member_name);
  });
}
function reminderLabel(kind: string) { return kind === "expired" ? "Membership already expired" : "Membership ending soon"; }
function dateLabel(kind: string) { return kind === "expired" ? "Ended on" : "Plan end date"; }
function ReminderTab({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) { return <Link href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>{label}<span>{count}</span></Link>; }
function emptyTitle(filter: string) { return filter === "expired" ? "No expired memberships" : filter === "expiring" ? "No memberships end in the next 7 days" : "No renewal reminders need action"; }
function emptyDetail(filter: string) { return filter ? "Choose another queue to review other membership reminder types." : "Expiring and expired memberships will appear here automatically."; }
