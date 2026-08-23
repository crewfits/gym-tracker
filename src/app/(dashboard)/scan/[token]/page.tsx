import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { recordAttendance } from "@/app/actions/attendance";
import { Feedback } from "@/components/feedback";
import { requireGym } from "@/lib/auth";
import { attendanceLabel, businessDate, nextAttendanceDirection } from "@/lib/domain";
import { verifyQrToken } from "@/lib/qr-token";

type Query = { success?: string; error?: string };

export default async function ScanPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Query> }) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const payload = verifyQrToken(token);
  if (!payload) notFound();

  const { supabase, gym } = await requireGym();
  if (payload.gymId !== gym.id) notFound();
  const today = businessDate(gym.timezone);
  const [{ data: member }, { data: credential }, { data: membership }, { data: lastEvent }] = await Promise.all([
    supabase.from("members").select("id,member_code,name,phone,email,is_archived").eq("id", payload.memberId).eq("gym_id", gym.id).maybeSingle(),
    supabase.from("member_qr_credentials").select("version,enabled").eq("member_id", payload.memberId).eq("gym_id", gym.id).maybeSingle(),
    supabase.from("memberships").select("id,plan_name,starts_on,expires_on").eq("member_id", payload.memberId).eq("gym_id", gym.id).lte("starts_on", today).gte("expires_on", today).order("expires_on", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("attendance_events").select("direction,occurred_at").eq("member_id", payload.memberId).eq("gym_id", gym.id).order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!member) notFound();

  const qrValid = credential?.enabled && credential.version === payload.version && !member.is_archived;
  const allowed = qrValid && Boolean(membership);
  const lastEventDate = lastEvent ? businessDate(gym.timezone, new Date(lastEvent.occurred_at)) : null;
  const suggestedDirection = nextAttendanceDirection(lastEvent?.direction ?? null, lastEventDate, today);
  const directions = [suggestedDirection, suggestedDirection === "entry" ? "exit" : "entry"] as const;

  return <>
    <div className="page-head">
      <div><p className="eyebrow">QR attendance</p><h1>{member.name}</h1><p className="muted">{member.member_code} · {member.phone}</p></div>
      <Link className="button secondary" href={`/members/${member.id}`}>Open member</Link>
    </div>
    <Feedback success={query.success} error={query.error}/>
    {!qrValid && <div className="alert error">This QR has been disabled or replaced. Do not admit the member using this copy.</div>}
    {qrValid && !membership && <div className="alert error">This member does not have an active membership for {today}.</div>}
    <div className="scan-layout">
      <section className={`card scan-card ${allowed ? "allowed" : "denied"}`}>
        <div className="scan-status"><span className="metric-label">Attendance</span><h2>{allowed ? "Access allowed" : "Access denied"}</h2>{membership && <p className="muted">{membership.plan_name} · valid through {membership.expires_on}</p>}</div>
        {allowed && <div className="scan-actions">
          {directions.map((direction) => <form action={recordAttendance} key={direction}>
            <input type="hidden" name="token" value={token}/><input type="hidden" name="direction" value={direction}/><input type="hidden" name="request_id" value={randomUUID()}/>
            <button className={`button ${direction === suggestedDirection ? "" : "secondary"}`}>{attendanceLabel(direction)}</button>
          </form>)}
        </div>}
        <p className="scan-context muted">{lastEvent ? <>Last attendance: <strong>{attendanceLabel(lastEvent.direction)}</strong> · {new Intl.DateTimeFormat("en-IN", { timeZone: gym.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(lastEvent.occurred_at))}{lastEventDate !== today ? ". Today starts with Check-in." : ""}</> : "No attendance recorded yet."}</p>
      </section>
    </div>
  </>;
}
