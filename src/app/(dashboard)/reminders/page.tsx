import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { openWhatsAppReminder } from "@/app/actions/reminders";
import { Feedback } from "@/components/feedback";
import { requireGym } from "@/lib/auth";
import { businessDate, formatInr } from "@/lib/domain";

const pageSize = 50;
const filters = new Set(["overdue", "partial_payment", "expiring"]);

type Candidate = { candidate_kind: string; member_id: string; member_code: string; member_name: string; phone: string; membership_id: string; charge_id: string | null; plan_name: string; candidate_date: string; balance_paise: number; total_count: number };

export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string; error?: string }> }) {
  const params = await searchParams;
  const { supabase, gym } = await requireGym();
  const selectedFilter = typeof params.filter === "string" && filters.has(params.filter) ? params.filter : "";
  const requestedPage = Number(params.page ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const today = businessDate(gym.timezone);
  const loadCandidates = (filter: string | null, selectedPage: number, selectedPageSize: number) => supabase.rpc("list_reminder_candidates", { p_filter: filter, p_today: today, p_page: selectedPage, p_page_size: selectedPageSize });
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
  const { data: history, error: historyError } = await supabase.from("manual_reminder_events").select("id,kind,status,phone_snapshot,created_at,members(name,member_code)").eq("gym_id", gym.id).order("created_at", { ascending: false }).limit(20);
  if (historyError) throw historyError;
  const pageHref = (target: number) => `/reminders?${new URLSearchParams({ ...(selectedFilter ? { filter: selectedFilter } : {}), ...(target > 1 ? { page: String(target) } : {}) }).toString()}`.replace(/\?$/, "");

  return <>
    <div className="page-head"><div><p className="eyebrow">Owner follow-up</p><h1>Reminders</h1><p className="muted">Review each message in WhatsApp and send it manually from the owner&apos;s number.</p></div></div>
    <Feedback error={params.error}/>
    <nav className="filter-tabs" aria-label="Reminder queues"><ReminderTab href="/reminders" active={!selectedFilter} label="All" count={countOf(overdue.data) + countOf(outstanding.data) + countOf(expiring.data)}/><ReminderTab href="/reminders?filter=overdue" active={selectedFilter === "overdue"} label="Overdue" count={countOf(overdue.data)}/><ReminderTab href="/reminders?filter=partial_payment" active={selectedFilter === "partial_payment"} label="Payment follow-up" count={countOf(outstanding.data)}/><ReminderTab href="/reminders?filter=expiring" active={selectedFilter === "expiring"} label="Expiring" count={countOf(expiring.data)}/></nav>
    <section className="card table-wrap"><table className="table"><thead><tr><th>Member</th><th>Reason</th><th>Action date</th><th>Outstanding</th><th>Action</th></tr></thead><tbody>{candidates.map((candidate) => <tr key={`${candidate.candidate_kind}-${candidate.membership_id}-${candidate.charge_id ?? "renewal"}`}><td><Link href={`/members/${candidate.member_id}`}><strong>{candidate.member_name}</strong><br/><small className="muted">{candidate.member_code} · {candidate.phone}</small></Link></td><td><strong>{reminderLabel(candidate.candidate_kind)}</strong><br/><small className="muted">{candidate.plan_name}</small></td><td><strong>{candidate.candidate_date}</strong><br/><small className="muted">{dateLabel(candidate.candidate_kind)}</small></td><td>{candidate.charge_id ? formatInr(Number(candidate.balance_paise)) : "—"}</td><td><form action={openWhatsAppReminder} target="_blank"><input type="hidden" name="kind" value={candidate.charge_id ? "payment" : "renewal"}/><input type="hidden" name="member_id" value={candidate.member_id}/><input type="hidden" name="membership_id" value={candidate.membership_id}/><input type="hidden" name="charge_id" value={candidate.charge_id ?? ""}/><button className="button small">Open WhatsApp <ExternalLink size={14}/></button></form></td></tr>)}</tbody></table>{!candidates.length && <div className="empty"><strong>{emptyTitle(selectedFilter)}</strong><br/><span>{emptyDetail(selectedFilter)}</span></div>}</section>
    <div className="pagination"><span className="muted">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 reminders"}</span><div>{page > 1 && <Link className="button secondary small" href={pageHref(page - 1)}>Previous</Link>}{page < pages && <Link className="button secondary small" href={pageHref(page + 1)}>Next</Link>}</div></div>
    <section className="card table-wrap" style={{ marginTop: 24 }}><div className="section-head"><div><h2>Recently opened</h2><span className="muted">This confirms only that WhatsApp was opened, not that a message was sent or delivered.</span></div></div><table className="table"><thead><tr><th>Member</th><th>Type</th><th>Status</th><th>Opened</th></tr></thead><tbody>{(history ?? []).map((event) => { const member = Array.isArray(event.members) ? event.members[0] : event.members; return <tr key={event.id}><td>{member ? `${member.name} · ${member.member_code}` : "—"}</td><td>{event.kind}</td><td><span className="badge upcoming">{event.status}</span></td><td>{new Intl.DateTimeFormat("en-IN", { timeZone: gym.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(event.created_at))}</td></tr>; })}</tbody></table>{!history?.length && <div className="empty">No reminders have been opened yet.</div>}</section>
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
