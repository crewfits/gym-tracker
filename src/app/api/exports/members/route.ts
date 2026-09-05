import type { NextRequest } from "next/server";
import { requireGym } from "@/lib/auth";
import { csvDocument } from "@/lib/csv";
import { businessDate, formatDisplayDate, formatDisplayDateTime } from "@/lib/domain";

type MemberExportRow = { member_code: string; name: string; phone: string; email: string | null; is_archived: boolean; plan_name: string | null; starts_on: string | null; expires_on: string | null; membership_status: string; balance_paise: number; qr_version: number | null; qr_enabled: boolean; qr_shared_at: string | null; total_count: number };
const statuses = new Set(["active", "expiring", "expired", "upcoming", "not_enrolled", "outstanding", "qr_not_generated", "qr_not_shared", "qr_shared", "qr_disabled", "archived", "all"]);
const sorts = new Set(["created_at", "member_code", "name", "expires_on", "balance", "status"]);

export async function GET(request: NextRequest) {
  const { supabase, gym } = await requireGym();
  const today = businessDate(gym.timezone);
  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 100) || null;
  const statusValue = params.get("status") ?? "";
  const status = statuses.has(statusValue) ? statusValue : null;
  const sortValue = params.get("sort") ?? "created_at";
  const sort = sorts.has(sortValue) ? sortValue : "created_at";
  const order = params.get("order") === "asc" ? "asc" : "desc";
  const rows: MemberExportRow[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.rpc("list_members", { p_query: q, p_status: status, p_today: today, p_page: page, p_page_size: 100, p_sort: sort, p_order: order });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as MemberExportRow[];
    rows.push(...batch);
    const total = Number(batch[0]?.total_count ?? 0);
    if (rows.length >= total || batch.length < 100) break;
    if (page === 50) return Response.json({ error: "Export is limited to 5,000 members" }, { status: 413 });
  }
  const csv = csvDocument(
    ["Member ID", "Name", "Phone", "Email", "Archived", "Plan", "Plan start date", "Plan end date", "Membership status", "Outstanding (INR)", "QR status", "QR shared at"],
    rows.map((row) => {
      const qrStatus = row.is_archived ? "archived" : !row.qr_version ? "not generated" : !row.qr_enabled ? "disabled" : row.qr_shared_at ? "shared" : "not shared";
      return [row.member_code, row.name, row.phone, row.email, row.is_archived, row.plan_name, formatDisplayDate(row.starts_on), formatDisplayDate(row.expires_on), row.is_archived ? "archived" : row.membership_status, (Number(row.balance_paise) / 100).toFixed(2), qrStatus, formatDisplayDateTime(row.qr_shared_at, gym.timezone)];
    }),
  );
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="members-${status ?? "current"}-${today}.csv"`, "Cache-Control": "private, no-store" } });
}
