import Link from "next/link";
import { Activity, ArrowRight, CalendarClock, CheckCircle2, Clock3, IndianRupee, LogIn, RefreshCw, ScanLine, Sparkles, TrendingUp, UserPlus, WalletCards } from "lucide-react";
import { DashboardViewSelector } from "@/components/dashboard-view-selector";
import { DashboardLiveRefresh } from "@/components/dashboard-live-refresh";
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
    <div className="page-head dashboard-hero"><div><p className="eyebrow">Today · {today}</p><h1>Dashboard</h1><p className="muted">{selectedView === "current" ? "Today’s membership, collection, attendance, and follow-up picture." : "Compare member growth, renewals, and collections over the last six months."}</p></div><div className="dashboard-hero-actions"><DashboardViewSelector value={selectedView}/><Link className="button" href="/members/new"><UserPlus size={16}/> Add member</Link></div></div>
    {selectedView === "trends" ? <TrendDashboard trends={trends}/> : <CurrentDashboard summary={summary} expiring={expiring} gymName={gym.name}/>}
  </>;
}

function CurrentDashboard({ summary, expiring, gymName }: { summary: DashboardSummary; expiring: ExpiringMember[]; gymName: string }) {
  const averagePayment = Number(summary.month_payment_count) ? Math.round(Number(summary.month_collected_paise) / Number(summary.month_payment_count)) : 0;
  const paymentMethods = [["cash", Number(summary.method_cash_paise)], ["upi", Number(summary.method_upi_paise)], ["card", Number(summary.method_card_paise)], ["bank_transfer", Number(summary.method_bank_transfer_paise)]] as const;
  const methodMax = Math.max(1, ...paymentMethods.map(([, amount]) => amount));
  const healthTotal = Math.max(1, Number(summary.active_members) + Number(summary.expiring_members) + Number(summary.expired_members));
  const activeAngle = (Number(summary.active_members) / healthTotal) * 360;
  const expiringAngle = activeAngle + (Number(summary.expiring_members) / healthTotal) * 360;
  const attentionCount = Number(summary.expiring_members) + Number(summary.pending_accounts);
  return <div className="dashboard-sections">
    <div className="dashboard-command-grid">
      <section className="gym-pulse-card">
        <div className="gym-pulse-top"><span className="live-label"><i/> Live floor</span><div className="live-floor-actions"><DashboardLiveRefresh/><Link href="/attendance">View attendance <ArrowRight size={15}/></Link></div></div>
        <div className="gym-pulse-main">
          <div className="gym-pulse-copy"><span className="dashboard-kicker">{gymName} · today</span><h2><strong>{summary.attendance_inside_now}</strong> members are inside now</h2><p>The live floor is ready. Every QR movement appears here as it happens.</p></div>
          <div className="pulse-visual" aria-hidden="true"><span className="pulse-ring pulse-ring-one"/><span className="pulse-ring pulse-ring-two"/><span className="pulse-core"><Activity size={28}/></span></div>
        </div>
        <div className="gym-pulse-stats">
          <Link href="/attendance"><span className="pulse-stat-icon entry"><LogIn size={18}/></span><span><strong>{summary.attendance_entries_today}</strong><small>Check-ins</small></span></Link>
          <Link href="/attendance?direction=exit"><span className="pulse-stat-icon exit"><ScanLine size={18}/></span><span><strong>{summary.attendance_exits_today}</strong><small>Check-outs</small></span></Link>
          <Link href="/transactions"><span className="pulse-stat-icon cash"><IndianRupee size={18}/></span><span><strong>{formatInr(Number(summary.today_collected_paise))}</strong><small>Collected today</small></span></Link>
        </div>
      </section>

      <aside className="priority-card">
        <div className="priority-head"><div><span className="dashboard-kicker">Priority queue</span><h2>{attentionCount ? `${attentionCount} items need you` : "You're all caught up"}</h2></div><span className={`priority-count ${attentionCount ? "has-items" : "is-clear"}`}>{attentionCount || <CheckCircle2 size={20}/>}</span></div>
        <div className="priority-list">
          <Priority href="/reminders?filter=expiring" icon={<Clock3/>} tone="amber" label="Memberships expiring" value={String(summary.expiring_members)} detail="within 7 days"/>
          <Priority href="/reminders?filter=overdue" icon={<CalendarClock/>} tone="red" label="Overdue to recover" value={formatInr(Number(summary.overdue_paise))} detail="send a reminder"/>
          <Priority href="/members?status=outstanding" icon={<WalletCards/>} tone="violet" label="Pending accounts" value={String(summary.pending_accounts)} detail="with open balance"/>
        </div>
        <Link className="priority-footer" href="/reminders">Open follow-up centre <ArrowRight size={16}/></Link>
      </aside>
    </div>

    <div className="dashboard-insight-grid">
      <section className="insight-card membership-health-card">
        <div className="insight-head"><div><span className="dashboard-kicker">Membership health</span><h2>Access status</h2></div><Link href="/members">View roster <ArrowRight size={14}/></Link></div>
        <div className="health-content">
          <div className="health-ring" style={{ background: `conic-gradient(#18a66a 0deg ${activeAngle}deg, #f5a524 ${activeAngle}deg ${expiringAngle}deg, #e45858 ${expiringAngle}deg 360deg)` }}><div><strong>{summary.total_members}</strong><span>Total</span></div></div>
          <div className="health-legend">
            <HealthItem href="/members?status=active" tone="green" label="Active" value={summary.active_members}/>
            <HealthItem href="/members?status=expiring" tone="amber" label="Expiring" value={summary.expiring_members}/>
            <HealthItem href="/members?status=expired" tone="red" label="Expired" value={summary.expired_members}/>
          </div>
        </div>
      </section>

      <section className="insight-card revenue-card">
        <div className="insight-head"><div><span className="dashboard-kicker">Collections</span><h2>This month</h2></div><Link href="/transactions">Open ledger <ArrowRight size={14}/></Link></div>
        <div className="revenue-total"><strong>{formatInr(Number(summary.month_collected_paise))}</strong><span>{summary.month_payment_count} payments · {formatInr(averagePayment)} average</span></div>
        <div className="revenue-methods">{paymentMethods.map(([method, amount]) => <div className="revenue-method" key={method}><div><span>{formatPaymentMethod(method)}</span><strong>{formatInr(amount)}</strong></div><div className="mix-track"><span style={{ width: `${(amount / methodMax) * 100}%` }}/></div></div>)}</div>
      </section>

      <section className="insight-card momentum-card">
        <div className="insight-head"><div><span className="dashboard-kicker">Momentum</span><h2>This month</h2></div><span className="spark-icon"><Sparkles size={18}/></span></div>
        <div className="momentum-list">
          <Momentum icon={<UserPlus/>} label="New members" value={String(summary.new_members_month)} href="/members"/>
          <Momentum icon={<RefreshCw/>} label="Renewals" value={String(summary.renewals_month)} href="/transactions"/>
          <Momentum icon={<TrendingUp/>} label="Total outstanding" value={formatInr(Number(summary.outstanding_paise))} href="/members?status=outstanding"/>
        </div>
      </section>
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

function Priority({ href, icon, tone, label, value, detail }: { href: string; icon: React.ReactNode; tone: string; label: string; value: string; detail: string }) { return <Link href={href} className="priority-item"><span className={`priority-icon ${tone}`}>{icon}</span><span className="priority-copy"><strong>{label}</strong><small>{detail}</small></span><span className="priority-value">{value}</span><ArrowRight className="priority-arrow" size={15}/></Link>; }
function HealthItem({ href, tone, label, value }: { href: string; tone: string; label: string; value: number }) { return <Link href={href} className="health-item"><i className={tone}/><span>{label}</span><strong>{value}</strong></Link>; }
function Momentum({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: string }) { return <Link href={href} className="momentum-item"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div><ArrowRight size={15}/></Link>; }
function Comparison({ label, value, change: delta }: { label: string; value: string; change: number | null }) { return <div className="card comparison-card"><span className="metric-label">{label}</span><div className="metric">{value}</div><span className={`trend-change ${delta !== null && delta < 0 ? "down" : "up"}`}>{delta === null ? "No prior-month baseline" : `${delta >= 0 ? "+" : ""}${delta}% from last month`}</span></div>; }
function TrendChart({ title, detail, trends, max, value, format }: { title: string; detail: string; trends: MonthlyTrend[]; max: number; value: (item: MonthlyTrend) => number; format: (value: number) => string }) { return <section className="card trend-chart"><div className="section-head"><div><h2>{title}</h2><span className="muted">{detail}</span></div></div><div className="trend-bars">{trends.map((item) => { const amount = value(item); return <div className="trend-bar-item" key={item.month_start}><div className="trend-bar-value">{format(amount)}</div><div className="trend-bar-track"><span style={{ height: `${Math.max(amount ? 8 : 2, (amount / max) * 100)}%` }}/></div><strong>{shortMonth(item.month_start)}</strong></div>; })}</div></section>; }
function change(current: number, previous: number) { return previous === 0 ? (current === 0 ? 0 : null) : Math.round(((current - previous) / previous) * 100); }
function monthLabel(date: string) { return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); }
function shortMonth(date: string) { return new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); }
function statusLabel(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
