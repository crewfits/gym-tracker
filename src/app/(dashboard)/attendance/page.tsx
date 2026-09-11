import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ArrowDownToLine, LogIn, LogOut, RefreshCw, UserRoundCheck } from "lucide-react";
import { correctAttendanceLog } from "@/app/actions/attendance";
import { AttendanceCorrectionForm } from "@/components/attendance-correction-form";
import { Feedback } from "@/components/feedback";
import { Pagination } from "@/components/pagination";
import { requirePermission } from "@/lib/auth";
import { attendanceLabel, businessDate, formatDisplayDate, formatDisplayDateTime } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import type { AttendanceDirection } from "@/lib/types";
import { SortableTableHeader, type SortOrder } from "@/components/sortable-table-header";

const pageSize = 10;
const allowedViews = new Set(["today", "inside", "missed", "history", "denied"]);
const attendanceSorts = new Set(["occurred_at", "member_name"]);

type AttendanceRow = { reason?: string; expires_on?: string; id: string; member_id: string; member_code: string; member_name: string; membership_id: string | null; plan_name: string | null; direction: AttendanceDirection; qr_version: number | null; source: "qr" | "manual"; occurred_at: string; business_date: string; can_undo: boolean; replacement_direction: AttendanceDirection; total_count: number };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string; direction?: string; view?: string; from?: string; to?: string; sort?: string; order?: string; success?: string; error?: string }> }) {
  const params = await searchParams;
  const { supabase, gym, viewer } = await requirePermission("attendance.view");
  const today = businessDate(gym.timezone);
  const requestedPage = Number(params.page ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const view = typeof params.view === "string" && allowedViews.has(params.view) ? params.view : "today";
  const direction = params.direction === "entry" || params.direction === "exit" ? params.direction : null;
  const from = typeof params.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : null;
  const to = typeof params.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : null;
  const sort = typeof params.sort === "string" && attendanceSorts.has(params.sort) ? params.sort : "occurred_at";
  const order: SortOrder = params.order === "asc" || params.order === "desc" ? params.order : "desc";
  const rpc = (selectedView: string, selectedDirection: AttendanceDirection | null, selectedPage = 1, selectedPageSize = pageSize) => supabase.rpc("list_attendance_events", {
    p_query: selectedView === view ? q || null : null,
    p_direction: selectedDirection,
    p_view: selectedView,
    p_from: selectedView === "history" ? from : null,
    p_to: selectedView === "history" ? to : null,
    p_today: today,
    p_page: selectedPage,
    p_page_size: selectedPageSize,
    p_sort: sort,
    p_order: order,
  });
  const [main, entries, exits, inside, missed] = await Promise.all([
    view === "denied" ? supabase.rpc("list_denied_access_attempts", { p_query: q || null, p_from: from, p_to: to, p_page: page, p_page_size: pageSize, p_sort: sort, p_order: order }) : rpc(view, direction, page),
    rpc("today", "entry", 1, 1),
    rpc("today", "exit", 1, 1),
    rpc("inside", null, 1, 1),
    rpc("missed", null, 1, 1),
  ]);
  for (const result of [main, entries, exits, inside, missed]) if (result.error) throw result.error;
  const events = (main.data ?? []) as AttendanceRow[];
  const countOf = (rows: unknown[] | null) => Number((rows?.[0] as AttendanceRow | undefined)?.total_count ?? 0);
  const total = countOf(main.data);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const queryFor = ({ targetPage, nextSort, nextOrder }: { targetPage?: number; nextSort?: string; nextOrder?: SortOrder } = {}) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (view !== "today") query.set("view", view);
    if (direction && view !== "denied") query.set("direction", direction);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    const selectedSort = nextSort ?? sort;
    const selectedOrder = nextOrder ?? order;
    if (selectedSort !== "occurred_at") query.set("sort", selectedSort);
    if (selectedSort !== "occurred_at" || selectedOrder !== "desc") query.set("order", selectedOrder);
    if (targetPage && targetPage > 1) query.set("page", String(targetPage));
    return query;
  };
  const hrefForSort = (field: string, firstOrder: SortOrder) => {
    if (sort === field && order !== firstOrder) return `/attendance?${queryFor({ nextSort: "occurred_at", nextOrder: "desc" }).toString()}`.replace(/\?$/, "");
    const nextOrder = sort === field ? (order === "asc" ? "desc" : "asc") : firstOrder;
    return `/attendance?${queryFor({ nextSort: field, nextOrder }).toString()}`;
  };
  const currentQuery = queryFor();
  const refreshHref = `/attendance?${currentQuery.toString()}`.replace(/\?$/, "");

  return <>
    <div className="page-head"><div><p className="eyebrow">Access ledger · {formatDisplayDate(today)}</p><h1>Attendance</h1><p className="muted">Today&apos;s check-ins, check-outs and searchable history.</p></div><div className="page-actions"><a className="button secondary" href={refreshHref}><RefreshCw size={16}/> Refresh</a>{canAccess(viewer, "exports.attendance", "csv_exports") && <a className="button secondary" href={`/api/exports/attendance?${queryFor().toString()}`}><ArrowDownToLine size={16}/> Export this view</a>}</div></div>
    <Feedback success={params.success} error={params.error}/>
    <div className="cards dashboard-kpis"><Metric href="/attendance" icon={<LogIn/>} label="Check-ins today" value={countOf(entries.data)}/><Metric href="/attendance?direction=exit" icon={<LogOut/>} label="Check-outs today" value={countOf(exits.data)}/><Metric href="/attendance?view=inside" icon={<UserRoundCheck/>} label="Currently inside" value={countOf(inside.data)}/><Metric href="/attendance?view=missed" icon={<LogOut/>} label="Missing yesterday's check-out" value={countOf(missed.data)}/></div>
    <form className="attendance-filters card">{sort !== "occurred_at" && <input type="hidden" name="sort" value={sort}/>} {(sort !== "occurred_at" || order !== "desc") && <input type="hidden" name="order" value={order}/>}<div className="toolbar"><input className="search" name="q" defaultValue={q} maxLength={100} placeholder="Search member, ID or phone"/><select className="search" name="view" defaultValue={view}><option value="today">Today</option><option value="inside">Currently inside</option><option value="history">History</option><option value="denied">Denied attempts</option>{view === "missed" && <option value="missed">Missing yesterday&apos;s check-out</option>}</select><button className="button">Apply</button><Link className="button secondary" href="/attendance">Clear</Link></div><details open={view === "history" || view === "denied" || Boolean(direction || from || to)}><summary>More filters</summary><div className="form-grid attendance-more"><div className="field"><label>Attendance type</label><select name="direction" disabled={view === "denied"} defaultValue={direction ?? ""}><option value="">Check-in and Check-out</option><option value="entry">Check-in</option><option value="exit">Check-out</option></select></div><div className="field"><label>From</label><input type="date" name="from" defaultValue={from ?? ""}/></div><div className="field"><label>To</label><input type="date" name="to" defaultValue={to ?? ""}/></div></div></details></form>
    {view === "denied" && <p className="muted">Expired-membership attempts only. These are not check-ins and do not affect occupancy.</p>}
    <div className="card table-wrap"><table className="table"><thead><tr><SortableTableHeader label="Time" href={hrefForSort("occurred_at", "desc")} active={sort === "occurred_at"} order={order}/><SortableTableHeader label="Member" href={hrefForSort("member_name", "asc")} active={sort === "member_name"} order={order}/><th>Attendance</th><th>Membership</th><th>Actions</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{formatDisplayDateTime(event.occurred_at, gym.timezone)}</td><td><Link href={`/members/${event.member_id}`}><strong>{event.member_name}</strong><br/><small className="muted">{event.member_code}</small></Link></td><td><span className={`badge ${view === "denied" ? "expired" : event.direction === "entry" ? "active" : "upcoming"}`}>{view === "denied" ? "Access denied" : attendanceLabel(event.direction)}</span>{view === "denied" && <><br/><small className="error-text">Membership expired{event.expires_on ? ` · ${formatDisplayDate(event.expires_on)}` : ""}</small></>}{event.source === "manual" && <><br/><small className="muted">Manual correction</small></>}</td><td>{event.plan_name ?? "—"}</td><td>{view === "denied" ? <Link href={`/members/${event.member_id}?view=membership`}>Open member</Link> : event.can_undo ? <AttendanceCorrectionForm action={correctAttendanceLog} eventId={event.id} requestId={randomUUID()} returnPath={refreshHref} direction={event.direction} replacementDirection={event.replacement_direction}/> : <span className="muted">—</span>}</td></tr>)}</tbody></table>{!events.length && <div className="empty">{view === "denied" ? "No denied attempts match this view." : "No attendance records match this view."}</div>}</div>
    <Pagination page={page} pages={pages} total={total} label="events" pageSize={pageSize} hrefForPage={(targetPage) => `/attendance?${queryFor({ targetPage }).toString()}`.replace(/\?$/, "")}/>
  </>;
}

function Metric({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: number }) {
  return <Link href={href} className="card"><span className="metric-icon">{icon}</span><div className="metric">{value}</div><span className="metric-label">{label}</span></Link>;
}
