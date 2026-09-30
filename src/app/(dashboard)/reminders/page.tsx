import Link from "next/link";
import { Mail, Send } from "lucide-react";
import { sendDueEmailReminders, sendSingleMembershipReminderEmail } from "@/app/actions/reminders";
import { Feedback } from "@/components/feedback";
import { NotificationBell } from "@/components/notification-bell";
import { PaymentFollowUps } from "@/components/payment-follow-ups";
import { RefreshButton } from "@/components/refresh-button";
import { SubmitButton } from "@/components/submit-button";
import { SortableTableHeader, type SortOrder } from "@/components/sortable-table-header";
import { requirePermission } from "@/lib/auth";
import { businessDate, formatDisplayDate, formatDisplayDateTime, memberOperationalView } from "@/lib/domain";

const pageSize = 50;
const filters = new Set(["expired", "expiring", "payments"]);
const reminderSorts = new Set(["candidate_date", "member_name"]);

type ReminderMembershipRow = { id: string; plan_name: string; starts_on: string; expires_on: string; created_at: string; reverted_at: string | null };
type ReminderMemberRow = { id: string; member_code: string; name: string; phone: string; email: string | null; is_archived: boolean; memberships: ReminderMembershipRow[] | null };
type Candidate = { candidate_kind: "expired" | "expiring"; member_id: string; member_code: string; member_name: string; phone: string; email: string | null; membership_id: string; plan_name: string; candidate_date: string };
type EmailEventRow = { id: string; kind: string; status: string; to_email: string; subject: string; error_message: string | null; created_at: string; members: { name: string; member_code: string } | { name: string; member_code: string }[] | null };

export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ filter?: string; timing?: string; page?: string; error?: string; success?: string; sort?: string; order?: string; confirm_email_member?: string; confirm_email_membership?: string; confirm_email_kind?: string; confirm_email_sent_at?: string; confirm_email_to?: string }> }) {
  const params = await searchParams;
  const { supabase, gym } = await requirePermission("reminders.manage");
  const selectedFilter = typeof params.filter === "string" && filters.has(params.filter) ? params.filter : "";
  const requestedPage = Number(params.page ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const today = businessDate(gym.timezone);
  const sort = typeof params.sort === "string" && reminderSorts.has(params.sort) ? params.sort : "candidate_date";
  const order: SortOrder = params.order === "asc" || params.order === "desc" ? params.order : "asc";
  const { data, error: loadError } = await supabase.from("members").select("id,member_code,name,phone,email,is_archived,memberships(id,plan_name,starts_on,expires_on,created_at,reverted_at)").eq("gym_id", gym.id).eq("is_archived", false);
  if (loadError) throw loadError;
  const { data: emailEvents } = await supabase
    .from("email_delivery_events")
    .select("id,kind,status,to_email,subject,error_message,created_at,members(name,member_code)")
    .eq("gym_id", gym.id)
    .in("kind", ["membership_expiring", "membership_expired"])
    .order("created_at", { ascending: false })
    .limit(8)
    .returns<EmailEventRow[]>();
  const allCandidates = ((data ?? []) as ReminderMemberRow[]).flatMap((member) => {
    const operational = memberOperationalView((member.memberships ?? []).filter((membership) => !membership.reverted_at), today);
    if (!operational.membership || (operational.status !== "expiring" && operational.status !== "expired")) return [];
    return [{
      candidate_kind: operational.status,
      member_id: member.id,
      member_code: member.member_code,
      member_name: member.name,
      phone: member.phone,
      email: member.email,
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
  const confirmReminder = params.confirm_email_member && params.confirm_email_membership && (params.confirm_email_kind === "expired" || params.confirm_email_kind === "expiring")
    ? {
      memberId: params.confirm_email_member,
      membershipId: params.confirm_email_membership,
      kind: params.confirm_email_kind,
      sentAt: params.confirm_email_sent_at,
      toEmail: params.confirm_email_to,
    }
    : null;

  return <>
    <div className="page-head reminder-page-head">
      <div><p className="eyebrow">Member follow-up</p><h1>Reminders</h1><p className="muted">Email reminders for memberships ending soon or already expired.</p></div>
      <div className="reminder-actions"><NotificationBell events={(emailEvents ?? []).map((event) => ({ ...event, display_time: formatDisplayDateTime(event.created_at, gym.timezone) }))}/><form action={sendDueEmailReminders}><SubmitButton className="button small" pendingLabel="Sending reminders…"><Send size={15}/> Send due email reminders</SubmitButton></form><RefreshButton/></div>
    </div>
    <Feedback success={params.success} error={params.error}/>
    {confirmReminder && <section className="alert warning reminder-resend-confirm">
      <div><strong>Email already sent{confirmReminder.sentAt ? ` on ${formatDisplayDateTime(confirmReminder.sentAt, gym.timezone)}` : ""}.</strong><br/><span>Recipient: {confirmReminder.toEmail ?? "member email"}. Do you want to send this reminder again?</span></div>
      <div className="reminder-resend-actions">
        <Link className="button secondary small" href={`/reminders?${queryFor({ targetPage: page }).toString()}`.replace(/\?$/, "")}>No, cancel</Link>
        <form action={sendSingleMembershipReminderEmail}>
          <input type="hidden" name="member_id" value={confirmReminder.memberId}/>
          <input type="hidden" name="membership_id" value={confirmReminder.membershipId}/>
          <input type="hidden" name="candidate_kind" value={confirmReminder.kind}/>
          <input type="hidden" name="force_resend" value="1"/>
          <input type="hidden" name="return_path" value={`/reminders?${queryFor({ targetPage: page }).toString()}`.replace(/\?$/, "")}/>
          <SubmitButton className="button warning small" pendingLabel="Sending…">Yes, send again</SubmitButton>
        </form>
      </div>
    </section>}
    <nav className="filter-tabs" aria-label="Reminder queues"><ReminderTab href={filterHref("")} active={!selectedFilter} label="All renewals" count={expiredCount + expiringCount}/><ReminderTab href={filterHref("expiring")} active={selectedFilter === "expiring"} label="Expiring" count={expiringCount}/><ReminderTab href={filterHref("expired")} active={selectedFilter === "expired"} label="Expired" count={expiredCount}/><ReminderTab href="/reminders?filter=payments" active={selectedFilter === "payments"} label="Payment follow-ups"/></nav>
    {selectedFilter === "payments" ? <PaymentFollowUps page={page} upcoming={params.timing === "upcoming"} descending={order === "desc"}/> : <>
    <section className="card table-wrap"><table className="table"><thead><tr><SortableTableHeader label="Member" href={hrefForSort("member_name", "asc")} active={sort === "member_name"} order={order}/><th>Reason</th><SortableTableHeader label="Plan date" href={hrefForSort("candidate_date", "asc")} active={sort === "candidate_date"} order={order}/><th>Action</th></tr></thead><tbody>{candidates.map((candidate) => <tr key={`${candidate.candidate_kind}-${candidate.membership_id}`}><td><Link href={`/members/${candidate.member_id}`}><strong>{candidate.member_name}</strong><br/><small className="muted">{candidate.member_code} · {candidate.phone}{candidate.email ? ` · ${candidate.email}` : ""}</small></Link></td><td><strong>{reminderLabel(candidate.candidate_kind)}</strong><br/><small className="muted">{candidate.plan_name}</small></td><td><strong>{formatDisplayDate(candidate.candidate_date)}</strong><br/><small className="muted">{dateLabel(candidate.candidate_kind)}</small></td><td><form action={sendSingleMembershipReminderEmail} className="inline-form"><input type="hidden" name="member_id" value={candidate.member_id}/><input type="hidden" name="membership_id" value={candidate.membership_id}/><input type="hidden" name="candidate_kind" value={candidate.candidate_kind}/><input type="hidden" name="return_path" value={`/reminders?${queryFor({ targetPage: page }).toString()}`.replace(/\?$/, "")}/><SubmitButton className="button secondary small" disabled={!candidate.email} title={candidate.email ? undefined : "Add member email before sending"} pendingLabel="Sending…"><Mail size={14}/> Email reminder</SubmitButton></form></td></tr>)}</tbody></table>{!candidates.length && <div className="empty"><strong>{emptyTitle(selectedFilter)}</strong><br/><span>{emptyDetail(selectedFilter)}</span></div>}</section>
    <div className="pagination"><span className="muted">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 reminders"}</span><div>{page > 1 && <Link className="button secondary small" href={pageHref(page - 1)}>Previous</Link>}{page < pages && <Link className="button secondary small" href={pageHref(page + 1)}>Next</Link>}</div></div>
    </>}
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
function ReminderTab({ href, active, label, count }: { href: string; active: boolean; label: string; count?: number }) { return <Link href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>{label}{count !== undefined && <span>{count}</span>}</Link>; }
function emptyTitle(filter: string) { return filter === "expired" ? "No expired memberships" : filter === "expiring" ? "No memberships end in the next 7 days" : "No renewal reminders need action"; }
function emptyDetail(filter: string) { return filter ? "Choose another queue to review other membership reminder types." : "Expiring and expired memberships will appear here automatically."; }
