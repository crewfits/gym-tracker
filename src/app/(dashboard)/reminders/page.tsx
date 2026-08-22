import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { openWhatsAppReminder } from "@/app/actions/reminders";
import { Feedback } from "@/components/feedback";
import { requireGym } from "@/lib/auth";
import { businessDate, formatInr } from "@/lib/domain";

const pageSize = 50;
const filters = new Set(["overdue", "due_today", "expiring"]);

type Candidate = { candidate_kind: string; member_id: string; member_code: string; member_name: string; phone: string; membership_id: string; charge_id: string | null; plan_name: string; candidate_date: string; balance_paise: number; total_count: number };

export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string; error?: string }> }) {
  const params = await searchParams;
  const { supabase, gym } = await requireGym();
  const selectedFilter = typeof params.filter === "string" && filters.has(params.filter) ? params.filter : "";
  const requestedPage = Number(params.page ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const { data, error } = await supabase.rpc("list_reminder_candidates", { p_filter: selectedFilter || null, p_today: businessDate(gym.timezone), p_page: page, p_page_size: pageSize });
  if (error) throw error;
  const candidates = (data ?? []) as Candidate[];
  const total = Number(candidates[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const { data: history, error: historyError } = await supabase.from("manual_reminder_events").select("id,kind,status,phone_snapshot,created_at,members(name,member_code)").eq("gym_id", gym.id).order("created_at", { ascending: false }).limit(20);
  if (historyError) throw historyError;
  const pageHref = (target: number) => `/reminders?${new URLSearchParams({ ...(selectedFilter ? { filter: selectedFilter } : {}), ...(target > 1 ? { page: String(target) } : {}) }).toString()}`.replace(/\?$/, "");

  return <>
    <div className="page-head"><div><p className="eyebrow">Owner follow-up</p><h1>Reminders</h1><p className="muted">Review each message in WhatsApp and send it manually from the owner&apos;s number.</p></div></div>
    <Feedback error={params.error}/>
    <form className="toolbar"><select className="search" name="filter" defaultValue={selectedFilter}><option value="">All action queues</option><option value="overdue">Overdue payments</option><option value="due_today">Payments due today</option><option value="expiring">Expiring in 7 days</option></select><button className="button secondary">Filter</button></form>
    <section className="card table-wrap"><table className="table"><thead><tr><th>Member</th><th>Reason</th><th>Date</th><th>Balance</th><th>Action</th></tr></thead><tbody>{candidates.map((candidate) => <tr key={`${candidate.candidate_kind}-${candidate.membership_id}-${candidate.charge_id ?? "renewal"}`}><td><Link href={`/members/${candidate.member_id}`}><strong>{candidate.member_name}</strong><br/><small className="muted">{candidate.member_code} · {candidate.phone}</small></Link></td><td><strong>{candidate.candidate_kind.replaceAll("_", " ")}</strong><br/><small className="muted">{candidate.plan_name}</small></td><td>{candidate.candidate_date}</td><td>{candidate.charge_id ? formatInr(Number(candidate.balance_paise)) : "—"}</td><td><form action={openWhatsAppReminder} target="_blank"><input type="hidden" name="kind" value={candidate.charge_id ? "payment" : "renewal"}/><input type="hidden" name="member_id" value={candidate.member_id}/><input type="hidden" name="membership_id" value={candidate.membership_id}/><input type="hidden" name="charge_id" value={candidate.charge_id ?? ""}/><button className="button small">Open WhatsApp <ExternalLink size={14}/></button></form></td></tr>)}</tbody></table>{!candidates.length && <div className="empty">Nothing needs a reminder in this queue.</div>}</section>
    <div className="pagination"><span className="muted">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 reminders"}</span><div>{page > 1 && <Link className="button secondary small" href={pageHref(page - 1)}>Previous</Link>}{page < pages && <Link className="button secondary small" href={pageHref(page + 1)}>Next</Link>}</div></div>
    <section className="card table-wrap" style={{ marginTop: 24 }}><div className="section-head"><div><h2>Recently opened</h2><span className="muted">This confirms only that WhatsApp was opened, not that a message was sent or delivered.</span></div></div><table className="table"><thead><tr><th>Member</th><th>Type</th><th>Status</th><th>Opened</th></tr></thead><tbody>{(history ?? []).map((event) => { const member = Array.isArray(event.members) ? event.members[0] : event.members; return <tr key={event.id}><td>{member ? `${member.name} · ${member.member_code}` : "—"}</td><td>{event.kind}</td><td><span className="badge upcoming">{event.status}</span></td><td>{new Intl.DateTimeFormat("en-IN", { timeZone: gym.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(event.created_at))}</td></tr>; })}</tbody></table>{!history?.length && <div className="empty">No reminders have been opened yet.</div>}</section>
  </>;
}
