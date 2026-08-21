import Link from "next/link";
import { Banknote, CircleDollarSign, RotateCcw } from "lucide-react";
import { requireGym } from "@/lib/auth";
import { formatInr, formatPaymentMethod } from "@/lib/domain";

type Transaction = {
  id: string; receipt_number: string; paid_on: string; method: string; reference: string | null;
  amount_paise: number; voided_at: string | null; void_reason: string | null;
  payment_reversals: { amount_paise: number; reason: string }[];
  charges: { memberships: { member_id: string; plan_name: string; members: { id: string; name: string; member_code: string } } };
};

export default async function Transactions({ searchParams }: PageProps<"/transactions">) {
  const params = await searchParams;
  const { supabase, gym } = await requireGym();
  let request = supabase.from("payments").select("*, payment_reversals(amount_paise,reason), charges!inner(memberships!inner(member_id,plan_name,members!inner(id,name,member_code)))").eq("gym_id", gym.id).order("paid_on", { ascending: false }).order("created_at", { ascending: false });
  const method = typeof params.method === "string" ? params.method : "";
  const status = typeof params.status === "string" ? params.status : "";
  const from = typeof params.from === "string" ? params.from : "";
  const to = typeof params.to === "string" ? params.to : "";
  const q = typeof params.q === "string" ? params.q.toLowerCase().trim() : "";
  if (method) request = request.eq("method", method);
  if (status === "completed") request = request.is("voided_at", null);
  if (status === "reversed") request = request.not("voided_at", "is", null);
  if (from) request = request.gte("paid_on", from);
  if (to) request = request.lte("paid_on", to);
  const { data } = await request;
  const all = (data ?? []) as Transaction[];
  const transactions = q ? all.filter((item) => { const member = item.charges.memberships.members; return member.name.toLowerCase().includes(q) || member.member_code.toLowerCase().includes(q) || item.receipt_number.toLowerCase().includes(q) || item.reference?.toLowerCase().includes(q); }) : all;
  const reversedFor = (item: Transaction) => item.payment_reversals.reduce((sum, reversal) => sum + Number(reversal.amount_paise), 0);
  const netFor = (item: Transaction) => item.voided_at ? 0 : Number(item.amount_paise) - reversedFor(item);
  const completed = transactions.filter((item) => netFor(item) > 0);
  const collected = transactions.reduce((sum, item) => sum + netFor(item), 0);
  const reversed = transactions.reduce((sum, item) => sum + (reversedFor(item) || (item.voided_at ? Number(item.amount_paise) : 0)), 0);

  return <><div className="page-head"><div><p className="eyebrow">Financial ledger</p><h1>Transactions</h1><p className="muted">Track every receipt and correction without opening individual members.</p></div></div><div className="cards"><div className="card"><CircleDollarSign className="metric-icon"/><div className="metric">{formatInr(collected)}</div><span className="metric-label">Collected in this view</span></div><div className="card"><Banknote className="metric-icon"/><div className="metric">{completed.length}</div><span className="metric-label">Completed payments</span></div><div className="card"><RotateCcw className="metric-icon"/><div className="metric">{formatInr(reversed)}</div><span className="metric-label">Reversed payments</span></div></div>
    <form className="card form" style={{ marginBottom: 16 }}><div className="form-grid"><div className="field"><label>Search</label><input name="q" defaultValue={q} placeholder="Member, ID, receipt or reference"/></div><div className="field"><label>Status</label><select name="status" defaultValue={status}><option value="">All statuses</option><option value="completed">Completed</option><option value="reversed">Reversed</option></select></div><div className="field"><label>Method</label><select name="method" defaultValue={method}><option value="">All methods</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option></select></div><div className="field"><label>From</label><input type="date" name="from" defaultValue={from}/></div><div className="field"><label>To</label><input type="date" name="to" defaultValue={to}/></div></div><div style={{ display: "flex", gap: 8 }}><button className="button">Apply filters</button><Link className="button secondary" href="/transactions">Clear</Link></div></form>
    <div className="card table-wrap"><table className="table"><thead><tr><th>Receipt</th><th>Date</th><th>Member</th><th>Plan</th><th>Method</th><th>Reference</th><th>Amount</th><th>Status</th></tr></thead><tbody>{transactions.map((item) => { const member = item.charges.memberships.members; return <tr key={item.id}><td><Link href={`/receipts/${item.id}`}><strong>{item.receipt_number}</strong></Link></td><td>{item.paid_on}</td><td><Link href={`/members/${member.id}`}><strong>{member.name}</strong><br/><small className="muted">{member.member_code}</small></Link></td><td>{item.charges.memberships.plan_name}</td><td>{formatPaymentMethod(item.method)}</td><td>{item.reference || "—"}</td><td><strong>{formatInr(netFor(item))}</strong>{reversedFor(item) > 0 && <><br/><small className="muted">{formatInr(reversedFor(item))} reversed</small></>}</td><td>{item.voided_at ? <span className="badge expired" title={item.void_reason ?? "Payment reversed"}>Reversed</span> : reversedFor(item) > 0 ? <span className="badge partial">Partially reversed</span> : <span className="badge paid">Completed</span>}</td></tr>; })}</tbody></table>{!transactions.length && <div className="empty">No transactions match these filters.</div>}</div>
  </>;
}
