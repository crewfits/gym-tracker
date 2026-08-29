import Link from "next/link";
import { AlertCircle, ArrowRight, CalendarClock, Clock3, IndianRupee, LogIn, RefreshCw, ScanLine, TrendingUp, UserPlus, Users, WalletCards } from "lucide-react";
import { DashboardViewSelector } from "@/components/dashboard-view-selector";
import { requireGym } from "@/lib/auth";
import { businessDate, formatInr, formatPaymentMethod } from "@/lib/domain";

type DashboardSummary = { active_members: number; expiring_members: number; expired_members: number; total_members: number; new_members_month: number; outstanding_paise: number; overdue_paise: number; pending_accounts: number; today_collected_paise: number; today_payment_count: number; month_collected_paise: number; month_payment_count: number; renewals_month: number; attendance_entries_today: number; attendance_exits_today: number; attendance_inside_now: number; method_cash_paise: number; method_upi_paise: number; method_card_paise: number; method_bank_transfer_paise: number };
type ExpiringMember = { id: string; member_code: string; name: string; plan_name: string | null; expires_on: string | null; membership_status: string };
type MonthlyTrend = { month_start: string; new_members: number; collected_paise: number; payment_count: number; renewals: number };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const selectedView = view === "trends" ? "trends" : "current";
  const { supabase, gym } = await requireGym();
  const today = businessDate(gym.timezone);
  const [{ data: summaryData, error: summaryError }, { data: expiringData, error: expiringError }, { data: trendsData, error: trendsError }] = await Promise.all([
    supabase.rpc("get_dashboard_summary", { p_today: today }),
    selectedView === "current" ? supabase.rpc("list_members", { p_query: null, p_status: "expiring", p_today: today, p_page: 1, p_page_size: 6 }) : Promise.resolve({ data: [], error: null }),
    selectedView === "trends" ? supabase.rpc("get_dashboard_monthly_trends", { p_today: today, p_months: 6 }) : Promise.resolve({ data: [], error: null }),
  ]);
  if (summaryError) throw summaryError;
  if (expiringError) throw expiringError;
  if (trendsError) throw trendsError;
  const summary = summaryData as DashboardSummary;
  const expiring = (expiringData ?? []) as ExpiringMember[];
  const trends = (trendsData ?? []) as MonthlyTrend[];

  return <>
    <div className="page-head dashboard-hero"><div><p className="eyebrow">Today · {today}</p><h1>Dashboard</h1><p className="muted">{selectedView === "current" ? "Today’s membership, collection, attendance, and follow-up picture." : "Compare member growth, renewals, and collections over the last six months."}</p></div><div className="dashboard-hero-actions"><DashboardViewSelector value={selectedView}/><Link className="button" href="/members/new">Add member</Link></div></div>
    {selectedView === "trends" ? <TrendDashboard trends={trends}/> : <CurrentDashboard summary={summary} expiring={expiring}/>}
  </>;
}

function CurrentDashboard({ summary, expiring }: { summary: DashboardSummary; expiring: ExpiringMember[] }) {
  const averagePayment = Number(summary.month_payment_count) ? Math.round(Number(summary.month_collected_paise) / Number(summary.month_payment_count)) : 0;
  const paymentMethods = [["cash", Number(summary.method_cash_paise)], ["upi", Number(summary.method_upi_paise)], ["card", Number(summary.method_card_paise)], ["bank_transfer", Number(summary.method_bank_transfer_paise)]] as const;
  const methodMax = Math.max(1, ...paymentMethods.map(([, amount]) => amount));
  return <div className="dashboard-sections">
    <div className="dashboard-group-grid">
    <DashboardGroup title="Today at the gym" detail="Live floor activity for today.">
      <Metric href="/attendance" icon={<LogIn/>} label="Check-ins today" value={String(summary.attendance_entries_today)} tone="blue"/>
      <Metric href="/attendance?direction=exit" icon={<ScanLine/>} label="Check-outs today" value={String(summary.attendance_exits_today)} tone="violet"/>
      <Metric href="/attendance?view=inside" icon={<Users/>} label="Currently inside" value={String(summary.attendance_inside_now)} tone="green"/>
      <Metric href="/transactions" icon={<IndianRupee/>} label="Collected today" value={formatInr(Number(summary.today_collected_paise))} tone="amber"/>
    </DashboardGroup>
    <DashboardGroup title="Membership health" detail="Current access and expiry status.">
      <Metric href="/members?status=active" icon={<Users/>} label="Active members" value={String(summary.active_members)} tone="green"/>
      <Metric href="/members?status=expiring" icon={<Clock3/>} label="Expiring in 7 days" value={String(summary.expiring_members)} tone="amber"/>
      <Metric href="/members?status=expired" icon={<AlertCircle/>} label="Expired memberships" value={String(summary.expired_members)} tone="red"/>
      <Metric href="/members" icon={<Users/>} label="Current roster" value={String(summary.total_members)} tone="blue"/>
    </DashboardGroup>
    <DashboardGroup title="Collections and follow-up" detail="Balances needing attention.">
      <Metric href="/members?status=outstanding" icon={<WalletCards/>} label="Total outstanding" value={formatInr(Number(summary.outstanding_paise))} tone="violet"/>
      <Metric href="/reminders?filter=overdue" icon={<CalendarClock/>} label="Overdue balance" value={formatInr(Number(summary.overdue_paise))} tone="red"/>
      <Metric href="/members?status=outstanding" icon={<AlertCircle/>} label="Pending accounts" value={String(summary.pending_accounts)} tone="amber"/>
      <Metric href="/transactions" icon={<IndianRupee/>} label="Collected this month" value={formatInr(Number(summary.month_collected_paise))} tone="green"/>
    </DashboardGroup>
    <DashboardGroup title="Growth this month" detail="Member and collection momentum.">
      <Metric href="/members" icon={<UserPlus/>} label="New members" value={String(summary.new_members_month)} tone="blue"/>
      <Metric href="/transactions" icon={<RefreshCw/>} label="Membership renewals" value={String(summary.renewals_month)} tone="violet"/>
      <Metric href="/transactions" icon={<WalletCards/>} label="Payments received" value={String(summary.month_payment_count)} tone="green"/>
      <Metric href="/transactions" icon={<TrendingUp/>} label="Average payment" value={formatInr(averagePayment)} tone="amber"/>
    </DashboardGroup>
    </div>
    <div className="grid-2 dashboard-overview"><section className="card"><div className="section-head"><div className="section-head-copy"><span className="eyebrow">Member follow-up</span><h2>Expiring in 7 days</h2><span className="muted">Open an individual reminder before the membership ends.</span></div><Link className="text-link" href="/reminders?filter=expiring">Open reminders <ArrowRight size={15}/></Link></div><div className="table-wrap"><table className="table"><thead><tr><th>Member</th><th>Plan</th><th>Plan end</th><th>Status</th></tr></thead><tbody>{expiring.map((item) => <tr key={item.id}><td><Link href={`/members/${item.id}`}><strong>{item.name}</strong><br/><small className="muted">{item.member_code}</small></Link></td><td>{item.plan_name ?? "—"}</td><td>{item.expires_on ?? "—"}</td><td><span className={`badge ${item.membership_status}`}>{statusLabel(item.membership_status)}</span></td></tr>)}</tbody></table>{!expiring.length && <div className="empty">No memberships expire in the next 7 days.</div>}</div></section>
      <section className="card"><div className="section-head"><div className="section-head-copy"><span className="eyebrow">Collection split</span><h2>Payment method mix</h2><span className="muted">This month’s collected amount by payment method.</span></div><Link className="text-link" href="/transactions">Open ledger <ArrowRight size={15}/></Link></div><div className="method-list">{paymentMethods.map(([method, amount]) => <div className="method-row" key={method}><div><strong>{formatPaymentMethod(method)}</strong><span>{formatInr(amount)}</span></div><div className="mix-track"><span style={{ width: `${(amount / methodMax) * 100}%` }}/></div></div>)}</div></section>
    </div>
  </div>;
}

function TrendDashboard({ trends }: { trends: MonthlyTrend[] }) {
  const current = trends.at(-1) ?? { month_start: "", new_members: 0, collected_paise: 0, payment_count: 0, renewals: 0 };
  const previous = trends.at(-2) ?? current;
  const collectionMax = Math.max(1, ...trends.map((item) => Number(item.collected_paise)));
  const memberMax = Math.max(1, ...trends.map((item) => Number(item.new_members)));
  return <div className="dashboard-sections trend-dashboard">
    <section className="dashboard-group"><div className="dashboard-group-head"><div><h2>Current month compared with last month</h2><p>Quick momentum indicators for memberships and collections.</p></div></div><div className="cards dashboard-kpis">
      <Comparison label="New members" value={String(current.new_members)} change={change(Number(current.new_members), Number(previous.new_members))}/>
      <Comparison label="Amount collected" value={formatInr(Number(current.collected_paise))} change={change(Number(current.collected_paise), Number(previous.collected_paise))}/>
      <Comparison label="Renewals" value={String(current.renewals)} change={change(Number(current.renewals), Number(previous.renewals))}/>
      <Comparison label="Payments" value={String(current.payment_count)} change={change(Number(current.payment_count), Number(previous.payment_count))}/>
    </div></section>
    <div className="grid-2 trend-grid">
      <TrendChart title="Monthly collections" detail="Net collections after payment reversals." trends={trends} max={collectionMax} value={(item) => Number(item.collected_paise)} format={formatInr}/>
      <TrendChart title="New member growth" detail="Profiles added in each gym-local calendar month." trends={trends} max={memberMax} value={(item) => Number(item.new_members)} format={String}/>
    </div>
    <section className="card table-wrap"><div className="section-head"><div><h2>Six-month comparison</h2><span className="muted">A clear month-by-month operating record.</span></div></div><table className="table"><thead><tr><th>Month</th><th>New members</th><th>Renewals</th><th>Payments</th><th>Collected</th></tr></thead><tbody>{trends.map((item) => <tr key={item.month_start}><td><strong>{monthLabel(item.month_start)}</strong></td><td>{item.new_members}</td><td>{item.renewals}</td><td>{item.payment_count}</td><td><strong>{formatInr(Number(item.collected_paise))}</strong></td></tr>)}</tbody></table></section>
  </div>;
}

function DashboardGroup({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) { return <section className="dashboard-group"><div className="dashboard-group-head"><div><h2>{title}</h2><p>{detail}</p></div></div><div className="cards dashboard-kpis">{children}</div></section>; }
function Metric({ href, icon, label, value, tone }: { href: string; icon: React.ReactNode; label: string; value: string; tone: string }) { return <Link href={href} className={`card dashboard-metric tone-${tone}`}><span className="metric-icon">{icon}</span><div className="metric">{value}</div><span className="metric-label">{label}</span></Link>; }
function Comparison({ label, value, change: delta }: { label: string; value: string; change: number | null }) { return <div className="card comparison-card"><span className="metric-label">{label}</span><div className="metric">{value}</div><span className={`trend-change ${delta !== null && delta < 0 ? "down" : "up"}`}>{delta === null ? "No prior-month baseline" : `${delta >= 0 ? "+" : ""}${delta}% from last month`}</span></div>; }
function TrendChart({ title, detail, trends, max, value, format }: { title: string; detail: string; trends: MonthlyTrend[]; max: number; value: (item: MonthlyTrend) => number; format: (value: number) => string }) { return <section className="card trend-chart"><div className="section-head"><div><h2>{title}</h2><span className="muted">{detail}</span></div></div><div className="trend-bars">{trends.map((item) => { const amount = value(item); return <div className="trend-bar-item" key={item.month_start}><div className="trend-bar-value">{format(amount)}</div><div className="trend-bar-track"><span style={{ height: `${Math.max(amount ? 8 : 2, (amount / max) * 100)}%` }}/></div><strong>{shortMonth(item.month_start)}</strong></div>; })}</div></section>; }
function change(current: number, previous: number) { return previous === 0 ? (current === 0 ? 0 : null) : Math.round(((current - previous) / previous) * 100); }
function monthLabel(date: string) { return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); }
function shortMonth(date: string) { return new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); }
function statusLabel(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
