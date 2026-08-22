import Link from "next/link";
import { AlertCircle, ArrowRight, Clock3, IndianRupee, LogIn, ScanLine, UserPlus, Users, WalletCards } from "lucide-react";
import { requireGym } from "@/lib/auth";
import { businessDate, formatInr, formatPaymentMethod } from "@/lib/domain";

type DashboardSummary = { active_members: number; expiring_members: number; expired_members: number; total_members: number; new_members_month: number; outstanding_paise: number; overdue_paise: number; pending_accounts: number; today_collected_paise: number; today_payment_count: number; month_collected_paise: number; month_payment_count: number; renewals_month: number; attendance_entries_today: number; attendance_exits_today: number; attendance_inside_now: number; method_cash_paise: number; method_upi_paise: number; method_card_paise: number; method_bank_transfer_paise: number };
type ExpiringMember = { id: string; member_code: string; name: string; plan_name: string | null; expires_on: string | null; membership_status: string };

export default async function Dashboard() {
  const { supabase, gym } = await requireGym();
  const today = businessDate(gym.timezone);
  const [{ data: summaryData, error: summaryError }, { data: expiringData, error: expiringError }] = await Promise.all([
    supabase.rpc("get_dashboard_summary", { p_today: today }),
    supabase.rpc("list_members", { p_query: null, p_status: "expiring", p_today: today, p_page: 1, p_page_size: 6 }),
  ]);
  if (summaryError) throw summaryError;
  if (expiringError) throw expiringError;
  const summary = summaryData as DashboardSummary;
  const expiring = (expiringData ?? []) as ExpiringMember[];
  const averagePayment = Number(summary.month_payment_count) ? Math.round(Number(summary.month_collected_paise) / Number(summary.month_payment_count)) : 0;
  const paymentMethods = [
    ["cash", Number(summary.method_cash_paise)],
    ["upi", Number(summary.method_upi_paise)],
    ["card", Number(summary.method_card_paise)],
    ["bank_transfer", Number(summary.method_bank_transfer_paise)],
  ] as const;
  const methodMax = Math.max(1, ...paymentMethods.map(([, amount]) => amount));

  return <>
    <div className="page-head dashboard-hero"><div><p className="eyebrow">Today · {today}</p><h1>Dashboard</h1><p className="muted">Membership health, collections, attendance, and follow-ups needing attention.</p></div><Link className="button" href="/members/new">Add member</Link></div>
    <div className="cards dashboard-kpis"><Metric href="/members?status=active" icon={<Users/>} label="Active members" value={String(summary.active_members)}/><Metric href="/members?status=expiring" icon={<Clock3/>} label="Expiring in 7 days" value={String(summary.expiring_members)}/><Metric href="/members?status=expired" icon={<AlertCircle/>} label="Expired" value={String(summary.expired_members)}/><Metric href="/members?status=outstanding" icon={<IndianRupee/>} label="Outstanding" value={formatInr(Number(summary.outstanding_paise))}/></div>
    <div className="cards dashboard-kpis secondary-kpis"><Metric href="/members" icon={<Users/>} label="Current roster" value={String(summary.total_members)}/><Metric href="/members" icon={<UserPlus/>} label="New this month" value={String(summary.new_members_month)}/><Metric href="/transactions" icon={<WalletCards/>} label="Renewals this month" value={String(summary.renewals_month)}/><Metric href="/members?status=outstanding" icon={<AlertCircle/>} label="Pending accounts" value={String(summary.pending_accounts)}/></div>
    <div className="cards dashboard-kpis secondary-kpis"><Metric href="/attendance" icon={<LogIn/>} label="Entries today" value={String(summary.attendance_entries_today)}/><Metric href="/attendance?direction=exit" icon={<ScanLine/>} label="Exits today" value={String(summary.attendance_exits_today)}/><Metric href="/attendance?view=inside" icon={<Users/>} label="Currently inside" value={String(summary.attendance_inside_now)}/><Metric href="/reminders?filter=overdue" icon={<IndianRupee/>} label="Overdue balance" value={formatInr(Number(summary.overdue_paise))}/></div>
    <div className="grid-2 dashboard-overview"><section className="card"><div className="section-head"><div className="section-head-copy"><span className="eyebrow">Member follow-up</span><h2>Expiring in 7 days</h2><span className="muted">Open an individual reminder before the membership ends.</span></div><Link className="text-link" href="/reminders?filter=expiring">Open reminders <ArrowRight size={15}/></Link></div><div className="table-wrap"><table className="table"><thead><tr><th>Member</th><th>Plan</th><th>Expiry</th><th>Status</th></tr></thead><tbody>{expiring.map((item) => <tr key={item.id}><td><Link href={`/members/${item.id}`}><strong>{item.name}</strong><br/><small className="muted">{item.member_code}</small></Link></td><td>{item.plan_name ?? "—"}</td><td>{item.expires_on ?? "—"}</td><td><span className={`badge ${item.membership_status}`}>{item.membership_status}</span></td></tr>)}</tbody></table>{!expiring.length && <div className="empty">No memberships expire in the next 7 days.</div>}</div></section>
      <section className="stack overview-stack"><div className="card"><span className="metric-label">Collected today</span><div className="metric">{formatInr(Number(summary.today_collected_paise))}</div><small className="muted">{summary.today_payment_count} payment{Number(summary.today_payment_count) === 1 ? "" : "s"}</small></div><div className="card"><span className="metric-label">Collected this month</span><div className="metric">{formatInr(Number(summary.month_collected_paise))}</div><small className="muted">Average {formatInr(averagePayment)} per payment</small></div><div className="card"><span className="metric-label">Overdue balance</span><div className="metric">{formatInr(Number(summary.overdue_paise))}</div><small className="muted">Past the configured charge due date</small></div></section>
    </div>
    <section className="card" style={{ marginTop: 18 }}><div className="section-head"><div className="section-head-copy"><span className="eyebrow">Collection split</span><h2>Payment method mix</h2><span className="muted">How this month&apos;s gym collections reached the desk.</span></div><Link className="text-link" href="/transactions">Open ledger <ArrowRight size={15}/></Link></div><div className="cards" style={{ marginBottom: 0 }}>{paymentMethods.map(([method, amount]) => <div className="card method-card" key={method}><span className="metric-label">{formatPaymentMethod(method)}</span><div className="method-value">{formatInr(amount)}</div><div className="mix-track" aria-label={`${formatPaymentMethod(method)} collection share`}><span style={{ width: `${(amount / methodMax) * 100}%` }}/></div></div>)}</div></section>
  </>;
}

function Metric({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: string }) { return <Link href={href} className="card"><span className="metric-icon">{icon}</span><div className="metric">{value}</div><span className="metric-label">{label}</span></Link>; }
