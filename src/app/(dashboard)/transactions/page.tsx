import Link from "next/link";
import { ArrowDownToLine, Banknote, CircleDollarSign, CreditCard, Landmark, RefreshCw, RotateCcw, Smartphone, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { businessDate, formatDisplayDate, formatInr, formatPaymentMethod } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import type { PaymentMethod } from "@/lib/types";
import { Pagination } from "@/components/pagination";
import { SortableTableHeader, type SortOrder } from "@/components/sortable-table-header";

const pageSize = 10;
const methods = new Set<PaymentMethod>(["cash", "upi", "card", "bank_transfer"]);
const statuses = new Set(["completed", "reversed", "partial_reversal"]);
const transactionSorts = new Set(["paid_on", "member_name", "amount"]);

type Transaction = { id: string; receipt_number: string; paid_on: string; method: PaymentMethod; reference: string | null; amount_paise: number; reversed_paise: number; net_paise: number; voided_at: string | null; void_reason: string | null; member_id: string; member_code: string; member_name: string; plan_name: string; total_count: number; view_collected_paise: number; view_reversed_paise: number; view_completed_count: number };
type TransactionSummary = { outstanding_paise: number; pending_accounts: number };

export default async function Transactions({ searchParams }: PageProps<"/transactions">) {
  const params = await searchParams;
  const { supabase, gym, viewer } = await requirePermission("payments.view");
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const methodValue = typeof params.method === "string" && methods.has(params.method as PaymentMethod) ? params.method as PaymentMethod : null;
  const status = typeof params.status === "string" && statuses.has(params.status) ? params.status : "";
  const today = businessDate(gym.timezone);
  const range = params.range === "today" || params.range === "month" ? params.range : null;
  const explicitFrom = typeof params.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : null;
  const explicitTo = typeof params.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : null;
  const from = explicitFrom ?? (range === "today" ? today : range === "month" ? monthStart(today) : null);
  const to = explicitTo ?? (range ? today : null);
  const requestedPage = Number(typeof params.page === "string" ? params.page : "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const sort = typeof params.sort === "string" && transactionSorts.has(params.sort) ? params.sort : "paid_on";
  const order: SortOrder = params.order === "asc" || params.order === "desc" ? params.order : "desc";
  const methodBreakdownRequest = (method: PaymentMethod) => supabase.rpc("list_transactions", { p_query: q || null, p_method: method, p_status: status || null, p_from: from, p_to: to, p_page: 1, p_page_size: 1, p_sort: sort, p_order: order });
  const [{ data, error }, { data: summaryData, error: summaryError }, cash, upi, card, bankTransfer] = await Promise.all([
    supabase.rpc("list_transactions", { p_query: q || null, p_method: methodValue, p_status: status || null, p_from: from, p_to: to, p_page: page, p_page_size: pageSize, p_sort: sort, p_order: order }),
    supabase.rpc("get_dashboard_summary", { p_today: today }),
    methodBreakdownRequest("cash"),
    methodBreakdownRequest("upi"),
    methodBreakdownRequest("card"),
    methodBreakdownRequest("bank_transfer"),
  ]);
  if (error) throw error;
  if (summaryError) throw summaryError;
  for (const result of [cash, upi, card, bankTransfer]) if (result.error) throw result.error;
  const transactions = (data ?? []) as Transaction[];
  const methodBreakdown = [
    ["cash", cash.data],
    ["upi", upi.data],
    ["card", card.data],
    ["bank_transfer", bankTransfer.data],
  ] as const;
  const methodAmounts = methodBreakdown.map(([method, rows]) => [method, Number(((rows?.[0] as Transaction | undefined)?.view_collected_paise) ?? 0)] as const);
  const methodMax = Math.max(1, ...methodAmounts.map(([, amount]) => amount));
  const methodTotal = methodAmounts.reduce((sum, [, amount]) => sum + amount, 0);
  const topMethod = [...methodAmounts].sort((left, right) => right[1] - left[1])[0];
  const totals = transactions[0];
  const summary = summaryData as TransactionSummary;
  const total = Number(totals?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const queryFor = ({ targetPage, nextSort, nextOrder, nextMethod }: { targetPage?: number; nextSort?: string; nextOrder?: SortOrder; nextMethod?: PaymentMethod | null } = {}) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (status) query.set("status", status);
    const selectedMethod = nextMethod === undefined ? methodValue : nextMethod;
    if (selectedMethod) query.set("method", selectedMethod);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    const selectedSort = nextSort ?? sort;
    const selectedOrder = nextOrder ?? order;
    if (selectedSort !== "paid_on") query.set("sort", selectedSort);
    if (selectedSort !== "paid_on" || selectedOrder !== "desc") query.set("order", selectedOrder);
    if (targetPage && targetPage > 1) query.set("page", String(targetPage));
    return query;
  };
  const hrefForSort = (field: string, firstOrder: SortOrder) => {
    if (sort === field && order !== firstOrder) return `/transactions?${queryFor({ nextSort: "paid_on", nextOrder: "desc" }).toString()}`.replace(/\?$/, "");
    const nextOrder = sort === field ? (order === "asc" ? "desc" : "asc") : firstOrder;
    return `/transactions?${queryFor({ nextSort: field, nextOrder }).toString()}`;
  };
  const currentQuery = queryFor();
  const refreshHref = `/transactions?${currentQuery.toString()}`.replace(/\?$/, "");

  return <>
    <div className="page-head"><div><p className="eyebrow">Financial ledger</p><h1>Transactions</h1><p className="muted">Track every receipt and correction without opening individual members.</p></div><div className="page-actions"><a className="button secondary" href={refreshHref}><RefreshCw size={16}/> Refresh</a>{canAccess(viewer, "exports.payments", "csv_exports") && <a className="button secondary" href={`/api/exports/payments?${queryFor().toString()}`}><ArrowDownToLine size={16}/> Export this view</a>}</div></div>
    <section className="transaction-ledger-row">
      <div className="card ledger-command-card">
        <div className="ledger-command-head"><span className="metric-icon"><CircleDollarSign size={21}/></span><div><span className="dashboard-kicker">Collection focus</span><h2>Collected in this view</h2><div className="metric">{formatInr(Number(totals?.view_collected_paise ?? 0))}</div><p>Net receipts from the filters currently applied.</p></div></div>
        <div className="ledger-mini-grid">
          <div><Banknote size={18}/><span>Completed</span><strong>{Number(totals?.view_completed_count ?? 0)}</strong></div>
          <div><RotateCcw size={18}/><span>Reversed</span><strong>{formatInr(Number(totals?.view_reversed_paise ?? 0))}</strong></div>
          <div><CircleDollarSign size={18}/><span>Outstanding</span><strong>{formatInr(Number(summary?.outstanding_paise ?? 0))}</strong></div>
          <div><Banknote size={18}/><span>Pending accounts</span><strong>{Number(summary?.pending_accounts ?? 0)}</strong></div>
        </div>
      </div>
      <div className="card ledger-mix-card">
        <div className="mix-spotlight">
          <div><span className="dashboard-kicker">Payment mix</span><h2>{methodTotal ? formatPaymentMethod(topMethod[0]) : "No collections yet"}</h2><p>{methodTotal ? `${Math.round((topMethod[1] / methodTotal) * 100)}% of this view came through ${formatPaymentMethod(topMethod[0])}.` : "Once collections come in, each payment channel will light up here."}</p></div>
          <div className="mix-total"><span>Total split</span><strong>{formatInr(methodTotal)}</strong></div>
        </div>
        <div className="mix-share-rail" aria-label="Payment method share">{methodAmounts.map(([method, amount]) => amount > 0 && <span className={`mix-segment ${method}`} key={method} style={{ flexGrow: amount }} title={`${formatPaymentMethod(method)} ${formatInr(amount)}`}/>)}</div>
        <div className="ledger-method-grid">{methodAmounts.map(([method, amount]) => {
          const meta = methodMeta(method);
          const Icon = meta.icon;
          const href = `/transactions?${queryFor({ nextMethod: method }).toString()}`.replace(/\?$/, "");
          return <Link href={href} className={`ledger-method-tile ${method} ${methodValue === method ? "active" : ""}`} aria-current={methodValue === method ? "page" : undefined} key={method}><div className="method-tile-head"><span className="method-icon"><Icon size={17}/></span><span>{formatPaymentMethod(method)}</span><strong>{methodTotal ? `${Math.round((amount / methodTotal) * 100)}%` : "0%"}</strong></div><div><strong>{formatInr(amount)}</strong><small>{methodValue === method ? "Filtered view" : amount === methodMax && amount > 0 ? "Top channel" : "Collection channel"}</small></div></Link>;
        })}</div>
      </div>
    </section>
    <form className="card transaction-filters transaction-filter-bar">{sort !== "paid_on" && <input type="hidden" name="sort" value={sort}/>} {(sort !== "paid_on" || order !== "desc") && <input type="hidden" name="order" value={order}/>}<div className="field transaction-search-field"><label>Search</label><input name="q" defaultValue={q} maxLength={100} placeholder="Member, ID, receipt or reference"/></div><div className="field"><label>Status</label><select name="status" defaultValue={status}><option value="">All statuses</option><option value="completed">Completed</option><option value="partial_reversal">Partially reversed</option><option value="reversed">Fully reversed</option></select></div><div className="field"><label>Method</label><select name="method" defaultValue={methodValue ?? ""}><option value="">All methods</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option></select></div><div className="field"><label>From</label><input type="date" name="from" defaultValue={from ?? ""}/></div><div className="field"><label>To</label><input type="date" name="to" defaultValue={to ?? ""}/></div><div className="transaction-filter-actions"><button className="button">Apply</button><Link className="button secondary" href="/transactions">Clear</Link></div></form>
    <div className="card table-wrap transaction-table-card"><table className="table"><thead><tr><th>Receipt</th><SortableTableHeader label="Date" href={hrefForSort("paid_on", "desc")} active={sort === "paid_on"} order={order}/><SortableTableHeader label="Member" href={hrefForSort("member_name", "asc")} active={sort === "member_name"} order={order}/><th>Plan</th><th>Method</th><th>Reference</th><SortableTableHeader label="Amount" href={hrefForSort("amount", "desc")} active={sort === "amount"} order={order}/><th>Status</th></tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td><Link href={`/receipts/${item.id}`}><strong>{item.receipt_number}</strong></Link></td><td>{formatDisplayDate(item.paid_on)}</td><td><Link href={`/members/${item.member_id}`}><strong>{item.member_name}</strong><br/><small className="muted">{item.member_code}</small></Link></td><td>{item.plan_name}</td><td>{formatPaymentMethod(item.method)}</td><td>{item.reference || "-"}</td><td><strong>{formatInr(Number(item.net_paise))}</strong>{Number(item.reversed_paise) > 0 && <><br/><small className="muted">{formatInr(Number(item.reversed_paise))} reversed</small></>}</td><td>{item.voided_at ? <span className="badge expired" title={item.void_reason ?? "Payment reversed"}>Reversed</span> : Number(item.reversed_paise) > 0 ? <span className="badge partial">Partially reversed</span> : <span className="badge paid">Completed</span>}</td></tr>)}</tbody></table>{!transactions.length && <div className="empty">No transactions match these filters.</div>}</div>
    <Pagination page={page} pages={pages} total={total} label="transactions" pageSize={pageSize} hrefForPage={(targetPage) => `/transactions?${queryFor({ targetPage }).toString()}`.replace(/\?$/, "")}/>
  </>;
}

function monthStart(date: string) {
  return `${date.slice(0, 8)}01`;
}

function methodMeta(method: PaymentMethod) {
  if (method === "upi") return { icon: Smartphone };
  if (method === "card") return { icon: CreditCard };
  if (method === "bank_transfer") return { icon: Landmark };
  return { icon: Wallet };
}
