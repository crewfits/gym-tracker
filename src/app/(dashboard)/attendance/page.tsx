import Link from "next/link";
import { ArrowDownToLine, LogIn, LogOut, UserRoundCheck } from "lucide-react";
import { requireGym } from "@/lib/auth";
import { attendanceLabel, businessDate } from "@/lib/domain";
import type { AttendanceDirection } from "@/lib/types";

const pageSize = 50;
const allowedViews = new Set(["today", "inside", "missed", "history"]);

type AttendanceRow = { id: string; member_id: string; member_code: string; member_name: string; membership_id: string | null; plan_name: string | null; direction: AttendanceDirection; qr_version: number; occurred_at: string; business_date: string; total_count: number };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string; direction?: string; view?: string; from?: string; to?: string }> }) {
  const params = await searchParams;
  const { supabase, gym } = await requireGym();
  const today = businessDate(gym.timezone);
  const requestedPage = Number(params.page ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const view = typeof params.view === "string" && allowedViews.has(params.view) ? params.view : "today";
  const direction = params.direction === "entry" || params.direction === "exit" ? params.direction : null;
  const from = typeof params.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : null;
  const to = typeof params.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : null;
  const rpc = (selectedView: string, selectedDirection: AttendanceDirection | null, selectedPage = 1, selectedPageSize = pageSize) => supabase.rpc("list_attendance_events", {
    p_query: selectedView === view ? q || null : null,
    p_direction: selectedDirection,
    p_view: selectedView,
    p_from: selectedView === "history" ? from : null,
    p_to: selectedView === "history" ? to : null,
    p_today: today,
    p_page: selectedPage,
    p_page_size: selectedPageSize,
  });
  const [main, entries, exits, inside, missed] = await Promise.all([
    rpc(view, direction, page),
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
  const queryFor = (targetPage?: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (view !== "today") query.set("view", view);
    if (direction) query.set("direction", direction);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (targetPage && targetPage > 1) query.set("page", String(targetPage));
    return query;
  };

  return <>
    <div className="page-head"><div><p className="eyebrow">Access ledger · {today}</p><h1>Attendance</h1><p className="muted">Today&apos;s check-ins, check-outs and searchable history.</p></div><a className="button secondary" href={`/api/exports/attendance?${queryFor().toString()}`}><ArrowDownToLine size={16}/> Export this view</a></div>
    <div className="cards dashboard-kpis"><Metric href="/attendance" icon={<LogIn/>} label="Check-ins today" value={countOf(entries.data)}/><Metric href="/attendance?direction=exit" icon={<LogOut/>} label="Check-outs today" value={countOf(exits.data)}/><Metric href="/attendance?view=inside" icon={<UserRoundCheck/>} label="Currently inside" value={countOf(inside.data)}/><Metric href="/attendance?view=missed" icon={<LogOut/>} label="Missing yesterday's check-out" value={countOf(missed.data)}/></div>
    <form className="attendance-filters card"><div className="toolbar"><input className="search" name="q" defaultValue={q} maxLength={100} placeholder="Search member, ID or phone"/><select className="search" name="view" defaultValue={view}><option value="today">Today</option><option value="inside">Currently inside</option><option value="history">History</option>{view === "missed" && <option value="missed">Missing yesterday&apos;s check-out</option>}</select><button className="button">Apply</button><Link className="button secondary" href="/attendance">Clear</Link></div><details open={view === "history" || Boolean(direction || from || to)}><summary>More filters</summary><div className="form-grid attendance-more"><div className="field"><label>Attendance type</label><select name="direction" defaultValue={direction ?? ""}><option value="">Check-in and Check-out</option><option value="entry">Check-in</option><option value="exit">Check-out</option></select></div><div className="field"><label>From</label><input type="date" name="from" defaultValue={from ?? ""}/></div><div className="field"><label>To</label><input type="date" name="to" defaultValue={to ?? ""}/></div></div></details></form>
    <div className="card table-wrap"><table className="table"><thead><tr><th>Time</th><th>Member</th><th>Attendance</th><th>Membership</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{new Intl.DateTimeFormat("en-IN", { timeZone: gym.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurred_at))}</td><td><Link href={`/members/${event.member_id}`}><strong>{event.member_name}</strong><br/><small className="muted">{event.member_code}</small></Link></td><td><span className={`badge ${event.direction === "entry" ? "active" : "upcoming"}`}>{attendanceLabel(event.direction)}</span></td><td>{event.plan_name ?? "—"}</td></tr>)}</tbody></table>{!events.length && <div className="empty">No attendance records match this view.</div>}</div>
    <div className="pagination"><span className="muted">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 events"}</span><div>{page > 1 && <Link className="button secondary small" href={`/attendance?${queryFor(page - 1).toString()}`}>Previous</Link>}{page < pages && <Link className="button secondary small" href={`/attendance?${queryFor(page + 1).toString()}`}>Next</Link>}</div></div>
  </>;
}

function Metric({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: number }) {
  return <Link href={href} className="card"><span className="metric-icon">{icon}</span><div className="metric">{value}</div><span className="metric-label">{label}</span></Link>;
}
