import type { NextRequest } from "next/server";
import { requireGym } from "@/lib/auth";
import { csvDocument } from "@/lib/csv";
import { attendanceLabel, businessDate } from "@/lib/domain";
import type { AttendanceDirection } from "@/lib/types";

type AttendanceExportRow = { member_code: string; member_name: string; direction: AttendanceDirection; plan_name: string | null; qr_version: number; occurred_at: string; business_date: string; total_count: number };

export async function GET(request: NextRequest) {
  const { supabase, gym } = await requireGym();
  const params = request.nextUrl.searchParams;
  const view = ["today", "inside", "missed", "history"].includes(params.get("view") ?? "") ? params.get("view")! : "today";
  const direction = params.get("direction") === "entry" || params.get("direction") === "exit" ? params.get("direction") as AttendanceDirection : null;
  const q = (params.get("q") ?? "").trim().slice(0, 100) || null;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.get("from") ?? "") ? params.get("from") : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(params.get("to") ?? "") ? params.get("to") : null;
  const today = businessDate(gym.timezone);
  const rows: AttendanceExportRow[] = [];

  for (let page = 1; page <= 500; page++) {
    const { data, error } = await supabase.rpc("list_attendance_events", { p_query: q, p_direction: direction, p_view: view, p_from: from, p_to: to, p_today: today, p_page: page, p_page_size: 100 });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as AttendanceExportRow[];
    rows.push(...batch);
    const total = Number(batch[0]?.total_count ?? 0);
    if (rows.length >= total || batch.length < 100) break;
    if (page === 500) return Response.json({ error: "Export is limited to 50,000 rows. Apply a date filter and try again." }, { status: 413 });
  }

  const csv = csvDocument(
    ["Business date", "Occurred at", "Member ID", "Member name", "Attendance", "Membership"],
    rows.map((row) => [row.business_date, new Intl.DateTimeFormat("en-IN", { timeZone: gym.timezone, dateStyle: "medium", timeStyle: "long" }).format(new Date(row.occurred_at)), row.member_code, row.member_name, attendanceLabel(row.direction), row.plan_name]),
  );
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="attendance-${view}-${today}.csv"`, "Cache-Control": "private, no-store" } });
}
