import type { ReactNode } from "react";
import Link from "next/link";
import { Activity, ArrowRight, CalendarClock, CheckCircle2, Clock3, IndianRupee, LogIn, RefreshCw, ScanLine, Sparkles, TrendingUp, UserPlus, WalletCards } from "lucide-react";
import { DashboardViewSelector } from "@/components/dashboard-view-selector";
import { DashboardLiveRefresh } from "@/components/dashboard-live-refresh";
import { requireGym } from "@/lib/auth";
import { businessDate, formatDisplayDate, formatInr, formatPaymentMethod, memberOperationalView } from "@/lib/domain";

type DashboardSummary = { active_members: number; expiring_members: number; expired_members: number; total_members: number; new_members_month: number; outstanding_paise: number; overdue_paise: number; pending_accounts: number; today_collected_paise: number; today_payment_count: number; month_collected_paise: number; month_payment_count: number; renewals_month: number; attendance_entries_today: number; attendance_exits_today: number; attendance_inside_now: number; method_cash_paise: number; method_upi_paise: number; method_card_paise: number; method_bank_transfer_paise: number };
type ExpiringMember = { id: string; member_code: string; name: string; plan_name: string | null; expires_on: string | null; membership_status: string };
type DashboardMembershipRow = { id: string; plan_name: string; starts_on: string; expires_on: string; created_at: string; reverted_at: string | null };
type DashboardMemberRow = { id: string; member_code: string; name: string; is_archived: boolean; memberships: DashboardMembershipRow[] | null };
type MonthlyTrend = { month_start: string; new_members: number; collected_paise: number; payment_count: number; renewals: number };
type EngagementEvent = { member_id: string; occurred_at: string };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const selectedView = view === "trends" ? "trends" : "current";
  const { supabase, gym } = await requireGym();
  const today = businessDate(gym.timezone);
  const weekStart = startOfWeek(today);
  const previousWeekStart = addDays(weekStart, -7);
  const previousWeekEnd = addDays(weekStart, -1);
  const [{ data: summaryData, error: summaryError }, { data: statusMembersData, error: statusMembersError }, { data: trendsData, error: trendsError }, { data: engagementData, error: engagementError }] = await Promise.all([
    supabase.rpc("get_dashboard_summary", { p_today: today }),
    selectedView === "current" ? supabase.from("members").select("id,member_code,name,is_archived,memberships(id,plan_name,starts_on,expires_on,created_at,reverted_at)").eq("gym_id", gym.id).eq("is_archived", false) : Promise.resolve({ data: [], error: null }),
    supabase.rpc("get_dashboard_monthly_trends", { p_today: today, p_months: selectedView === "trends" ? 6 : 2 }),
    selectedView === "current" ? supabase.from("attendance_events").select("member_id,occurred_at").eq("gym_id", gym.id).eq("direction", "entry").is("voided_at", null).gte("occurred_at", `${previousWeekStart}T00:00:00.000Z`).lte("occurred_at", `${addDays(today, 1)}T00:00:00.000Z`) : Promise.resolve({ data: [], error: null }),
  ]);
  if (summaryError) throw summaryError;
  if (statusMembersError) throw statusMembersError;
  if (trendsError) throw trendsError;
  if (engagementError) throw engagementError;

  const statusViews = ((statusMembersData ?? []) as DashboardMemberRow[]).map((member) => {
    const operational = memberOperationalView((member.memberships ?? []).filter((membership) => !membership.reverted_at), today);
    return {
      id: member.id,
      member_code: member.member_code,
      name: member.name,
      plan_name: operational.membership?.plan_name ?? null,
      expires_on: operational.membership?.expires_on ?? null,
      membership_status: operational.status,
    };
  });
  const summary = selectedView === "current" ? {
    ...(summaryData as DashboardSummary),
    active_members: statusViews.filter((member) => member.membership_status === "active" || member.membership_status === "expiring").length,
    expiring_members: statusViews.filter((member) => member.membership_status === "expiring").length,
    expired_members: statusViews.filter((member) => member.membership_status === "expired").length,
    total_members: statusViews.length,
  } : (summaryData as DashboardSummary);
  const expiring = statusViews.filter((member) => member.membership_status === "expiring").sort(byExpiry).slice(0, 6);
  const expired = statusViews.filter((member) => member.membership_status === "expired").sort(byExpiry).slice(0, 6);
  const trends = (trendsData ?? []) as MonthlyTrend[];
  const engagementEvents = (engagementData ?? []) as EngagementEvent[];

  return <>
    <div className="page-head dashboard-hero">
      <div>
        <p className="eyebrow">Today · {formatDisplayDate(today)}</p>
        <h1>Dashboard</h1>
        <p className="muted">{selectedView === "current" ? "Today's membership, collection, attendance, and follow-up picture." : "Compare member growth, renewals, and collections over the last six months."}</p>
      </div>
      <div className="dashboard-hero-actions"><DashboardViewSelector value={selectedView}/><Link className="button" href="/members/new"><UserPlus size={16}/> Add member</Link></div>
    </div>
    {selectedView === "trends" ? <TrendDashboard trends={trends}/> : <CurrentDashboard summary={summary} expiring={expiring} expired={expired} trends={trends} engagementEvents={engagementEvents} weekStart={weekStart} previousWeekStart={previousWeekStart} previousWeekEnd={previousWeekEnd} gymName={gym.name} timezone={gym.timezone}/>}
  </>;
}

function CurrentDashboard({ summary, expiring, expired, trends, engagementEvents, weekStart, previousWeekStart, previousWeekEnd, gymName, timezone }: { summary: DashboardSummary; expiring: ExpiringMember[]; expired: ExpiringMember[]; trends: MonthlyTrend[]; engagementEvents: EngagementEvent[]; weekStart: string; previousWeekStart: string; previousWeekEnd: string; gymName: string; timezone: string }) {
  const averagePayment = Number(summary.month_payment_count) ? Math.round(Number(summary.month_collected_paise) / Number(summary.month_payment_count)) : 0;
  const paymentMethods = [["cash", Number(summary.method_cash_paise)], ["upi", Number(summary.method_upi_paise)], ["card", Number(summary.method_card_paise)], ["bank_transfer", Number(summary.method_bank_transfer_paise)]] as const;
  const methodMax = Math.max(1, ...paymentMethods.map(([, amount]) => amount));
  const healthTotal = Math.max(1, Number(summary.active_members) + Number(summary.expiring_members) + Number(summary.expired_members));
  const activeAngle = (Number(summary.active_members) / healthTotal) * 360;
  const expiringAngle = activeAngle + (Number(summary.expiring_members) / healthTotal) * 360;
  const activeRoster = Math.max(1, Number(summary.active_members));
  const currentTrend = trends.at(-1) ?? { month_start: "", new_members: 0, collected_paise: 0, payment_count: 0, renewals: 0 };
  const previousTrend = trends.at(-2) ?? currentTrend;
  const currentWeekVisitors = uniqueVisitors(engagementEvents, weekStart, undefined, timezone);
  const previousWeekVisitors = uniqueVisitors(engagementEvents, previousWeekStart, previousWeekEnd, timezone);
  const engagementRate = Math.min(100, Math.round((currentWeekVisitors / activeRoster) * 100));
  const previousEngagementRate = Math.min(100, Math.round((previousWeekVisitors / activeRoster) * 100));
  const slippingMembers = Math.max(0, Number(summary.active_members) - currentWeekVisitors);
  const priorityAreaCount = [Number(summary.expiring_members), Number(summary.overdue_paise), Number(summary.pending_accounts)].filter(Boolean).length;

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
        <div className="priority-head"><div><span className="dashboard-kicker">Priority queue</span><h2>{priorityAreaCount ? `${priorityAreaCount} items need you!` : "You're all caught up"}</h2></div><span className={`priority-count ${priorityAreaCount ? "has-items" : "is-clear"}`}>{priorityAreaCount || <CheckCircle2 size={20}/>}</span></div>
        <div className="priority-list">
          <Priority href="/reminders?filter=expiring" icon={<Clock3/>} tone="amber" label="Memberships expiring" value={String(summary.expiring_members)} detail="within the next 7 days"/>
          <Priority href="/reminders?filter=overdue" icon={<CalendarClock/>} tone="red" label="Overdue to recover" value={formatInr(Number(summary.overdue_paise))} detail="past the payment follow-up date"/>
          <Priority href="/members?status=outstanding" icon={<WalletCards/>} tone="violet" label="Pending accounts" value={String(summary.pending_accounts)} detail={`${formatInr(Number(summary.outstanding_paise))} open balance total`}/>
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
          <Momentum icon={<UserPlus/>} label="New members" value={signedNumber(Number(summary.new_members_month))} detail={percentChangeLabel(Number(currentTrend.new_members), Number(previousTrend.new_members))} href="/members"/>
          <Momentum icon={<RefreshCw/>} label="Renewals" value={String(summary.renewals_month)} detail={countChangeLabel(Number(currentTrend.renewals), Number(previousTrend.renewals))} href="/transactions"/>
          <Momentum icon={<TrendingUp/>} label="Collections" value={formatInr(Number(summary.month_collected_paise))} detail={percentChangeLabel(Number(currentTrend.collected_paise), Number(previousTrend.collected_paise))} href="/transactions"/>
        </div>
      </section>
    </div>

    <div className="dashboard-overview">
      <div className="dashboard-followup-grid">
      <section className="card"><div className="section-head"><div className="section-head-copy"><span className="eyebrow">Member follow-up</span><h2>Expiring in 7 days</h2><span className="muted">Open an individual reminder before the membership ends.</span></div><Link className="text-link" href="/reminders?filter=expiring">Open reminders <ArrowRight size={15}/></Link></div><div className="table-wrap"><table className="table"><thead><tr><th>Member</th><th>Plan</th><th>Plan end</th><th>Status</th></tr></thead><tbody>{expiring.map((item) => <tr key={item.id}><td><Link href={`/members/${item.id}`}><strong>{item.name}</strong><br/><small className="muted">{item.member_code}</small></Link></td><td>{item.plan_name ?? "—"}</td><td>{formatDisplayDate(item.expires_on)}</td><td><span className={`badge ${item.membership_status}`}>{statusLabel(item.membership_status)}</span></td></tr>)}</tbody></table>{!expiring.length && <div className="empty">No memberships expire in the next 7 days.</div>}</div></section>
      <section className="card"><div className="section-head"><div className="section-head-copy"><span className="eyebrow">Recovery watch</span><h2>Already expired</h2><span className="muted">Members whose access has already ended.</span></div><Link className="text-link" href="/members?status=expired">View expired <ArrowRight size={15}/></Link></div><div className="table-wrap"><table className="table"><thead><tr><th>Member</th><th>Plan</th><th>Ended on</th><th>Status</th></tr></thead><tbody>{expired.map((item) => <tr key={item.id}><td><Link href={`/members/${item.id}`}><strong>{item.name}</strong><br/><small className="muted">{item.member_code}</small></Link></td><td>{item.plan_name ?? "—"}</td><td>{formatDisplayDate(item.expires_on)}</td><td><span className="badge expired">Expired</span></td></tr>)}</tbody></table>{!expired.length && <div className="empty">No expired memberships right now.</div>}</div></section>
      </div>
      <section className="card engagement-health-card"><div className="section-head"><div className="section-head-copy"><span className="eyebrow">Member engagement</span><h2>Engagement health</h2><span className="muted">How much of the active roster showed up this week.</span></div><Link className="text-link" href="/attendance?view=history">View attendance <ArrowRight size={15}/></Link></div>
        <div className="engagement-board">
          <EngagementRow tone="green" label="Visited this week" value={`${currentWeekVisitors}/${summary.active_members}`} detail={`${engagementRate}% of active roster`}/>
          <EngagementRow tone="amber" label="Slipping" value={`${slippingMembers}`} detail="Active members with no visit"/>
          <EngagementRow tone="blue" label="Last week" value={`${previousWeekVisitors}/${summary.active_members}`} detail={`${previousEngagementRate}% visited`}/>
          <EngagementRow tone="violet" label="Trend" value={engagementDeltaValue(engagementRate, previousEngagementRate)} detail="Compared with last week"/>
        </div>
      </section>
    </div>
  </div>;
}

function TrendDashboard({ trends }: { trends: MonthlyTrend[] }) {
  const current = trends.at(-1) ?? { month_start: "", new_members: 0, collected_paise: 0, payment_count: 0, renewals: 0 };
  const previous = trends.at(-2) ?? current;
  const collectionMax = Math.max(1, ...trends.map((item) => Number(item.collected_paise)));
  const memberMax = Math.max(1, ...trends.map((item) => Number(item.new_members)));
  const renewalMax = Math.max(1, ...trends.map((item) => Number(item.renewals)));
  const totalCollected = trends.reduce((sum, item) => sum + Number(item.collected_paise), 0);
  const totalNewMembers = trends.reduce((sum, item) => sum + Number(item.new_members), 0);

  return <div className="dashboard-sections trend-dashboard trend-dashboard-modern">
    <section className="trend-command-card">
      <div className="trend-command-copy"><span className="dashboard-kicker">Six-month momentum</span><h2>{monthLabel(current.month_start)} Performance Pulse</h2><p>Track growth, collections, renewals and payment volume from one operating view.</p></div>
      <div className="trend-command-total"><span>Total collected</span><strong>{formatInr(totalCollected)}</strong><small>{totalNewMembers} new members across this period</small></div>
      <div className="trend-kpi-grid">
        <Comparison icon={<UserPlus/>} label="New members" value={String(current.new_members)} change={change(Number(current.new_members), Number(previous.new_members))}/>
        <Comparison icon={<IndianRupee/>} label="Amount collected" value={formatInr(Number(current.collected_paise))} change={change(Number(current.collected_paise), Number(previous.collected_paise))}/>
        <Comparison icon={<RefreshCw/>} label="Renewals" value={String(current.renewals)} change={change(Number(current.renewals), Number(previous.renewals))}/>
        <Comparison icon={<WalletCards/>} label="Payments" value={String(current.payment_count)} change={change(Number(current.payment_count), Number(previous.payment_count))}/>
      </div>
    </section>
    <div className="trend-visual-grid">
      <TrendChart title="Monthly collections" detail="Net collections after reversals." trends={trends} max={collectionMax} value={(item) => Number(item.collected_paise)} format={formatInr} tone="lime"/>
      <TrendChart title="New member growth" detail="Profiles added each month." trends={trends} max={memberMax} value={(item) => Number(item.new_members)} format={String} tone="blue"/>
      <TrendChart title="Renewal rhythm" detail="Renewals completed by month." trends={trends} max={renewalMax} value={(item) => Number(item.renewals)} format={String} tone="violet"/>
    </div>
    <section className="card table-wrap trend-table-card"><div className="section-head"><div><h2>Six-month comparison</h2><span className="muted">A clear month-by-month operating record.</span></div></div><table className="table"><thead><tr><th>Month</th><th>New members</th><th>Renewals</th><th>Payments</th><th>Collected</th></tr></thead><tbody>{trends.map((item) => <tr key={item.month_start}><td><strong>{monthLabel(item.month_start)}</strong></td><td>{item.new_members}</td><td>{item.renewals}</td><td>{item.payment_count}</td><td><strong>{formatInr(Number(item.collected_paise))}</strong></td></tr>)}</tbody></table></section>
  </div>;
}

function Priority({ href, icon, tone, label, value, detail }: { href: string; icon: ReactNode; tone: string; label: string; value: string; detail: string }) { return <Link href={href} className="priority-item"><span className={`priority-icon ${tone}`}>{icon}</span><span className="priority-copy"><strong>{label}</strong><small>{detail}</small></span><span className="priority-value">{value}</span><ArrowRight className="priority-arrow" size={15}/></Link>; }
function EngagementRow({ tone, label, value, detail }: { tone: string; label: string; value: string; detail: string }) { return <div className={`engagement-row ${tone}`}><span><strong>{label}</strong><small>{detail}</small></span><b>{value}</b></div>; }
function HealthItem({ href, tone, label, value }: { href: string; tone: string; label: string; value: number }) { return <Link href={href} className="health-item"><i className={tone}/><span>{label}</span><strong>{value}</strong></Link>; }
function Momentum({ href, icon, label, value, detail }: { href: string; icon: ReactNode; label: string; value: string; detail: string }) { return <Link href={href} className="momentum-item"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div><ArrowRight size={15}/></Link>; }
function Comparison({ icon, label, value, change: delta }: { icon: ReactNode; label: string; value: string; change: number | null }) { return <div className="comparison-card"><span className="comparison-icon">{icon}</span><span className="metric-label">{label}</span><div className="metric">{value}</div><span className={`trend-change ${delta !== null && delta < 0 ? "down" : "up"}`}>{delta === null ? "New baseline" : `${delta >= 0 ? "+" : ""}${delta}% vs last month`}</span></div>; }
function TrendChart({ title, detail, trends, max, value, format, tone }: { title: string; detail: string; trends: MonthlyTrend[]; max: number; value: (item: MonthlyTrend) => number; format: (value: number) => string; tone: string }) { return <section className={`card trend-chart trend-chart-modern ${tone}`}><div className="section-head"><div><h2>{title}</h2><span className="muted">{detail}</span></div></div><div className="trend-bars">{trends.map((item) => { const amount = value(item); return <div className="trend-bar-item" key={item.month_start}><div className="trend-bar-value">{format(amount)}</div><div className="trend-bar-track"><span style={{ height: `${Math.max(amount ? 8 : 2, (amount / max) * 100)}%` }}/></div><strong>{shortMonth(item.month_start)}</strong></div>; })}</div></section>; }
function change(current: number, previous: number) { return previous === 0 ? (current === 0 ? 0 : null) : Math.round(((current - previous) / previous) * 100); }
function monthLabel(date: string) { return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); }
function shortMonth(date: string) { return new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); }
function statusLabel(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function byExpiry(left: ExpiringMember, right: ExpiringMember) { return (left.expires_on ?? "").localeCompare(right.expires_on ?? ""); }
function signedNumber(value: number) { return value > 0 ? `+${value}` : String(value); }
function percentChangeLabel(current: number, previous: number) {
  if (!previous) return current ? "New baseline this month" : "No change vs last month";
  const delta = Math.round(((current - previous) / previous) * 100);
  return `${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta)}% vs last month`;
}
function countChangeLabel(current: number, previous: number) {
  const delta = current - previous;
  if (!delta) return "No change vs last month";
  return `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta)} vs last month`;
}
function engagementDeltaValue(current: number, previous: number) {
  const delta = current - previous;
  if (!delta) return "Steady";
  return `${delta > 0 ? "+" : "-"}${Math.abs(delta)}%`;
}
function uniqueVisitors(events: EngagementEvent[], from: string, to: string | undefined, timezone: string) {
  return new Set(events.filter((event) => {
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(event.occurred_at));
    return localDate >= from && (!to || localDate <= to);
  }).map((event) => event.member_id)).size;
}
function startOfWeek(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() - day + 1);
  return parsed.toISOString().slice(0, 10);
}
function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
