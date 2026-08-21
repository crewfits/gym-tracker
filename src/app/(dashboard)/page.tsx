import Link from "next/link";
import { AlertCircle, ArrowRight, Clock3, IndianRupee, UserPlus, Users, WalletCards } from "lucide-react";
import { requireGym } from "@/lib/auth";
import { formatInr, formatPaymentMethod, membershipStatus } from "@/lib/domain";

export default async function Dashboard() {
  const { supabase, gym } = await requireGym();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: gym.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const month = today.slice(0, 7);
  const [{ data: memberships }, { data: balances }, { data: payments }, { data: members }] = await Promise.all([
    supabase.from("memberships").select("*, members(name,member_code)").eq("gym_id", gym.id).order("expires_on", { ascending: true }),
    supabase.from("charge_balances").select("*").eq("gym_id", gym.id),
    supabase.from("payments").select("amount_paise,paid_on,method,voided_at,payment_reversals(amount_paise)").eq("gym_id", gym.id),
    supabase.from("members").select("id,created_at,is_archived").eq("gym_id", gym.id),
  ]);
  const current = new Map<string, any>();
  for (const membership of memberships ?? []) if (!current.has(membership.member_id) || current.get(membership.member_id).expires_on < membership.expires_on) current.set(membership.member_id, membership);
  const currentMemberships = [...current.values()];
  const active = currentMemberships.filter((item) => ["active", "expiring"].includes(membershipStatus(item.starts_on, item.expires_on, today))).length;
  const expiring = currentMemberships.filter((item) => membershipStatus(item.starts_on, item.expires_on, today) === "expiring").length;
  const expired = currentMemberships.filter((item) => membershipStatus(item.starts_on, item.expires_on, today) === "expired").length;
  const outstanding = (balances ?? []).reduce((sum, charge) => sum + Number(charge.balance_paise), 0);
  const pendingAccounts = (balances ?? []).filter((charge) => Number(charge.balance_paise) > 0).length;
  const overdueBalance = outstanding;
  const validPayments = (payments ?? []).filter((payment) => !payment.voided_at).map((payment) => ({ ...payment, net_amount_paise: Number(payment.amount_paise) - payment.payment_reversals.reduce((sum, reversal) => sum + Number(reversal.amount_paise), 0) })).filter((payment) => payment.net_amount_paise > 0);
  const todayPayments = validPayments.filter((payment) => payment.paid_on === today);
  const monthPayments = validPayments.filter((payment) => payment.paid_on.startsWith(month));
  const todayPaid = todayPayments.reduce((sum, payment) => sum + payment.net_amount_paise, 0);
  const monthPaid = monthPayments.reduce((sum, payment) => sum + payment.net_amount_paise, 0);
  const averagePayment = monthPayments.length ? Math.round(monthPaid / monthPayments.length) : 0;
  const newMembers = (members ?? []).filter((member) => member.created_at.startsWith(month)).length;
  const membershipCounts = new Map<string, number>();
  let renewalsThisMonth = 0;
  for (const membership of [...(memberships ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))) { const previous = membershipCounts.get(membership.member_id) ?? 0; if (previous > 0 && membership.created_at.startsWith(month)) renewalsThisMonth++; membershipCounts.set(membership.member_id, previous + 1); }
  const methodTotals = new Map<string, number>();
  for (const payment of monthPayments) methodTotals.set(payment.method, (methodTotals.get(payment.method) ?? 0) + payment.net_amount_paise);
  const paymentMethods = ["cash", "upi", "card", "bank_transfer"];
  const methodMax = Math.max(1, ...paymentMethods.map((method) => methodTotals.get(method) ?? 0));

  return <><div className="page-head dashboard-hero"><div><p className="eyebrow">Today · {today}</p><h1>Dashboard</h1><p className="muted">Membership health, collections, and the follow-ups needing attention.</p></div><Link className="button" href="/members/new">Add member</Link></div>
    <div className="cards dashboard-kpis"><Metric href="/members?status=active" icon={<Users/>} label="Active members" value={String(active)}/><Metric href="/members?status=expiring" icon={<Clock3/>} label="Expiring in 7 days" value={String(expiring)}/><Metric href="/members?status=expired" icon={<AlertCircle/>} label="Expired" value={String(expired)}/><Metric href="/members?status=outstanding" icon={<IndianRupee/>} label="Outstanding" value={formatInr(outstanding)}/></div>
    <div className="cards dashboard-kpis secondary-kpis"><Metric href="/members" icon={<Users/>} label="Total members" value={String((members ?? []).filter((member) => !member.is_archived).length)}/><Metric href="/members" icon={<UserPlus/>} label="New this month" value={String(newMembers)}/><Metric href="/transactions" icon={<WalletCards/>} label="Renewals this month" value={String(renewalsThisMonth)}/><Metric href="/members?status=outstanding" icon={<AlertCircle/>} label="Pending accounts" value={String(pendingAccounts)}/></div>
    <div className="grid-2 dashboard-overview"><section className="card"><div className="section-head"><div className="section-head-copy"><span className="eyebrow">Member follow-up</span><h2>Upcoming expiries</h2><span className="muted">Follow up before a member&apos;s training period ends.</span></div><Link className="text-link" href="/members?status=expiring">View members <ArrowRight size={15}/></Link></div><div className="table-wrap"><table className="table"><thead><tr><th>Member</th><th>Plan</th><th>Expiry</th><th>Status</th></tr></thead><tbody>{currentMemberships.filter((item) => item.expires_on >= today).slice(0, 6).map((item) => { const status = membershipStatus(item.starts_on, item.expires_on, today); return <tr key={item.id}><td><Link href={`/members/${item.member_id}`}><strong>{item.members?.name}</strong><br/><small className="muted">{item.members?.member_code}</small></Link></td><td>{item.plan_name}</td><td>{item.expires_on}</td><td><span className={`badge ${status}`}>{status}</span></td></tr>; })}</tbody></table>{!currentMemberships.length && <div className="empty">Add your first member to see activity here.</div>}</div></section>
      <section className="stack overview-stack"><div className="card"><span className="metric-label">Collected today</span><div className="metric">{formatInr(todayPaid)}</div><small className="muted">{todayPayments.length} payment{todayPayments.length === 1 ? "" : "s"}</small></div><div className="card"><span className="metric-label">Collected this month</span><div className="metric">{formatInr(monthPaid)}</div><small className="muted">Average {formatInr(averagePayment)} per payment</small></div><div className="card"><span className="metric-label">Overdue balance</span><div className="metric">{formatInr(overdueBalance)}</div><small className="muted">All currently unpaid membership charges</small></div></section>
    </div>
    <section className="card" style={{ marginTop: 18 }}><div className="section-head"><div className="section-head-copy"><span className="eyebrow">Collection split</span><h2>Payment method mix</h2><span className="muted">How this month&apos;s gym collections reached the desk.</span></div><Link className="text-link" href="/transactions">Open ledger <ArrowRight size={15}/></Link></div><div className="cards" style={{ marginBottom: 0 }}>{paymentMethods.map((method) => { const amount = methodTotals.get(method) ?? 0; return <div className="card method-card" key={method}><span className="metric-label">{formatPaymentMethod(method)}</span><div className="method-value">{formatInr(amount)}</div><div className="mix-track" aria-label={`${formatPaymentMethod(method)} collection share`}><span style={{ width: `${(amount / methodMax) * 100}%` }}/></div></div>; })}</div></section>
  </>;
}

function Metric({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: string }) { return <Link href={href} className="card"><span className="metric-icon">{icon}</span><div className="metric">{value}</div><span className="metric-label">{label}</span></Link>; }
