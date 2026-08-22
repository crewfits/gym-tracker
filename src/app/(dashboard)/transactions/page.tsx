import Link from "next/link";
import { ArrowDownToLine, Banknote, CircleDollarSign, RotateCcw } from "lucide-react";
import { requireGym } from "@/lib/auth";
import { formatInr, formatPaymentMethod } from "@/lib/domain";
import type { PaymentMethod } from "@/lib/types";

const pageSize = 50;
const methods = new Set<PaymentMethod>(["cash", "upi", "card", "bank_transfer"]);
const statuses = new Set(["completed", "reversed", "partial_reversal"]);

type Transaction = { id: string; receipt_number: string; paid_on: string; method: PaymentMethod; reference: string | null; amount_paise: number; reversed_paise: number; net_paise: number; voided_at: string | null; void_reason: string | null; member_id: string; member_code: string; member_name: string; plan_name: string; total_count: number; view_collected_paise: number; view_reversed_paise: number; view_completed_count: number };

export default async function Transactions({ searchParams }: PageProps<"/transactions">) {
  const params = await searchParams;
  const { supabase } = await requireGym();
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const methodValue = typeof params.method === "string" && methods.has(params.method as PaymentMethod) ? params.method as PaymentMethod : null;
  const status = typeof params.status === "string" && statuses.has(params.status) ? params.status : "";
  const from = typeof params.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : null;
  const to = typeof params.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : null;
  const requestedPage = Number(typeof params.page === "string" ? params.page : "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const { data, error } = await supabase.rpc("list_transactions", { p_query: q || null, p_method: methodValue, p_status: status || null, p_from: from, p_to: to, p_page: page, p_page_size: pageSize });
  if (error) throw error;
  const transactions = (data ?? []) as Transaction[];
  const totals = transactions[0];
  const total = Number(totals?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const queryFor = (targetPage?: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (status) query.set("status", status);
    if (methodValue) query.set("method", methodValue);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (targetPage && targetPage > 1) query.set("page", String(targetPage));
    return query;
  };

  return <>
    <div className="page-head"><div><p className="eyebrow">Financial ledger</p><h1>Transactions</h1><p className="muted">Track every receipt and correction without opening individual members.</p></div><a className="button secondary" href={`/api/exports/payments?${queryFor().toString()}`}><ArrowDownToLine size={16}/> Export this view</a></div>
    <div className="cards"><div className="card"><CircleDollarSign className="metric-icon"/><div className="metric">{formatInr(Number(totals?.view_collected_paise ?? 0))}</div><span className="metric-label">Collected in this view</span></div><div className="card"><Banknote className="metric-icon"/><div className="metric">{Number(totals?.view_completed_count ?? 0)}</div><span className="metric-label">Completed payments</span></div><div className="card"><RotateCcw className="metric-icon"/><div className="metric">{formatInr(Number(totals?.view_reversed_paise ?? 0))}</div><span className="metric-label">Reversed payments</span></div></div>
    <form className="card form" style={{ marginBottom: 16 }}><div className="form-grid"><div className="field"><label>Search</label><input name="q" defaultValue={q} maxLength={100} placeholder="Member, ID, receipt or reference"/></div><div className="field"><label>Status</label><select name="status" defaultValue={status}><option value="">All statuses</option><option value="completed">Completed</option><option value="partial_reversal">Partially reversed</option><option value="reversed">Fully reversed</option></select></div><div className="field"><label>Method</label><select name="method" defaultValue={methodValue ?? ""}><option value="">All methods</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option></select></div><div className="field"><label>From</label><input type="date" name="from" defaultValue={from ?? ""}/></div><div className="field"><label>To</label><input type="date" name="to" defaultValue={to ?? ""}/></div></div><div style={{ display: "flex", gap: 8 }}><button className="button">Apply filters</button><Link className="button secondary" href="/transactions">Clear</Link></div></form>
    <div className="card table-wrap"><table className="table"><thead><tr><th>Receipt</th><th>Date</th><th>Member</th><th>Plan</th><th>Method</th><th>Reference</th><th>Amount</th><th>Status</th></tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td><Link href={`/receipts/${item.id}`}><strong>{item.receipt_number}</strong></Link></td><td>{item.paid_on}</td><td><Link href={`/members/${item.member_id}`}><strong>{item.member_name}</strong><br/><small className="muted">{item.member_code}</small></Link></td><td>{item.plan_name}</td><td>{formatPaymentMethod(item.method)}</td><td>{item.reference || "—"}</td><td><strong>{formatInr(Number(item.net_paise))}</strong>{Number(item.reversed_paise) > 0 && <><br/><small className="muted">{formatInr(Number(item.reversed_paise))} reversed</small></>}</td><td>{item.voided_at ? <span className="badge expired" title={item.void_reason ?? "Payment reversed"}>Reversed</span> : Number(item.reversed_paise) > 0 ? <span className="badge partial">Partially reversed</span> : <span className="badge paid">Completed</span>}</td></tr>)}</tbody></table>{!transactions.length && <div className="empty">No transactions match these filters.</div>}</div>
    <div className="pagination"><span className="muted">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 transactions"}</span><div>{page > 1 && <Link className="button secondary small" href={`/transactions?${queryFor(page - 1).toString()}`}>Previous</Link>}{page < pages && <Link className="button secondary small" href={`/transactions?${queryFor(page + 1).toString()}`}>Next</Link>}</div></div>
  </>;
}
