import type { NextRequest } from "next/server";
import { requireGym } from "@/lib/auth";
import { csvDocument } from "@/lib/csv";
import { businessDate } from "@/lib/domain";
import type { PaymentMethod } from "@/lib/types";

type PaymentExportRow = { receipt_number: string; paid_on: string; method: PaymentMethod; reference: string | null; amount_paise: number; reversed_paise: number; net_paise: number; voided_at: string | null; void_reason: string | null; member_code: string; member_name: string; plan_name: string; total_count: number };

export async function GET(request: NextRequest) {
  const { supabase, gym } = await requireGym();
  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 100) || null;
  const method = ["cash", "upi", "card", "bank_transfer"].includes(params.get("method") ?? "") ? params.get("method") as PaymentMethod : null;
  const status = ["completed", "reversed", "partial_reversal"].includes(params.get("status") ?? "") ? params.get("status") : null;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.get("from") ?? "") ? params.get("from") : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(params.get("to") ?? "") ? params.get("to") : null;
  const rows: PaymentExportRow[] = [];
  for (let page = 1; page <= 500; page++) {
    const { data, error } = await supabase.rpc("list_transactions", { p_query: q, p_method: method, p_status: status, p_from: from, p_to: to, p_page: page, p_page_size: 100 });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as PaymentExportRow[];
    rows.push(...batch);
    const total = Number(batch[0]?.total_count ?? 0);
    if (rows.length >= total || batch.length < 100) break;
    if (page === 500) return Response.json({ error: "Export is limited to 50,000 payments. Apply a date filter and try again." }, { status: 413 });
  }
  const csv = csvDocument(
    ["Receipt", "Payment date", "Member ID", "Member name", "Plan", "Method", "Reference", "Original amount (INR)", "Reversed (INR)", "Net amount (INR)", "Status", "Reversal reason"],
    rows.map((row) => [row.receipt_number, row.paid_on, row.member_code, row.member_name, row.plan_name, row.method, row.reference, (Number(row.amount_paise) / 100).toFixed(2), (Number(row.reversed_paise) / 100).toFixed(2), (Number(row.net_paise) / 100).toFixed(2), row.voided_at ? "reversed" : Number(row.reversed_paise) > 0 ? "partially reversed" : "completed", row.void_reason]),
  );
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="payments-${businessDate(gym.timezone)}.csv"`, "Cache-Control": "private, no-store" } });
}
