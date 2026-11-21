import type { NextRequest } from "next/server";
import { requireGym } from "@/lib/auth";
import { csvDocument } from "@/lib/csv";
import { businessDate, formatDisplayDate, formatDisplayDateTime } from "@/lib/domain";
import { MemberFilterError, memberFilterRpcArgs, parseMemberFilters } from "@/lib/member-filters";
import { canAccess } from "@/lib/permissions";

type MemberExportRow = { id: string; member_code: string; old_member_id: string | null; name: string; phone: string; email: string | null; is_archived: boolean; plan_name: string | null; starts_on: string | null; expires_on: string | null; membership_status: string; balance_paise: number; qr_version: number | null; qr_enabled: boolean; qr_shared_at: string | null; total_count: number };
export async function GET(request: NextRequest) {
  const { supabase, gym, viewer } = await requireGym();
  if (!canAccess(viewer, "exports.members", "csv_exports")) return Response.json({ error: "CSV export is restricted for this account." }, { status: 403 });
  const today = businessDate(gym.timezone);
  const params = request.nextUrl.searchParams;
  let filters;
  try { filters = parseMemberFilters(params); }
  catch (error) {
    if (!(error instanceof MemberFilterError)) throw error;
    return Response.json({ error: error.message }, { status: 400 });
  }
  const rows: MemberExportRow[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.rpc("search_members", memberFilterRpcArgs({ ...filters, page }, today, 100));
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const result = data as { rows: MemberExportRow[]; total: number };
    const batch = result.rows;
    rows.push(...batch);
    const total = Number(result.total);
    if (rows.length >= total || batch.length < 100) break;
    if (page === 50) return Response.json({ error: "Export is limited to 5,000 members" }, { status: 413 });
  }
  const remarks = new Map<string, string | null>();
  for (let offset = 0; offset < rows.length; offset += 100) {
    const memberIds = rows.slice(offset, offset + 100).map((row) => row.id);
    const { data, error } = await supabase.from("members").select("id,notes").eq("gym_id", gym.id).in("id", memberIds);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    for (const member of data ?? []) remarks.set(member.id, member.notes);
  }
  const csv = csvDocument(
    ["FitKiro ID", "Member ID", "Name", "Phone", "Email", "Remarks", "Archived", "Plan", "Plan start date", "Plan end date", "Membership status", `Outstanding (${gym.currency_code ?? "INR"})`, "QR status", "QR shared at"],
    rows.map((row) => {
      const qrStatus = row.is_archived ? "archived" : !row.qr_version ? "not generated" : !row.qr_enabled ? "disabled" : row.qr_shared_at ? "shared" : "not shared";
      return [row.member_code, row.old_member_id, row.name, row.phone, row.email, remarks.get(row.id) ?? "", row.is_archived, row.plan_name, formatDisplayDate(row.starts_on), formatDisplayDate(row.expires_on), row.is_archived ? "archived" : row.membership_status, (Number(row.balance_paise) / 100).toFixed(2), qrStatus, formatDisplayDateTime(row.qr_shared_at, gym.timezone)];
    }),
  );
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="members-${filters.records}-${today}.csv"`, "Cache-Control": "private, no-store" } });
}
