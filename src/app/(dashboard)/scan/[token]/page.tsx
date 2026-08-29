import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { recordAttendance } from "@/app/actions/attendance";
import { Feedback } from "@/components/feedback";
import { requireGym } from "@/lib/auth";
import { attendanceLabel, businessDate, nextAttendanceDirection } from "@/lib/domain";
import { signedMemberPhotoUrl } from "@/lib/member-photo";
import { isShortQrCode, verifyQrToken, type QrTokenPayload } from "@/lib/qr-token";

type Query = { success?: string; error?: string };

export default async function ScanPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Query> }) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const { supabase, gym } = await requireGym();

  let payload: QrTokenPayload | null = null;
  let credential: { version: number; enabled: boolean } | null = null;

  if (isShortQrCode(token)) {
    const { data } = await supabase.from("member_qr_credentials").select("member_id,version,enabled").eq("public_code", token).eq("gym_id", gym.id).maybeSingle();
    if (data) {
      payload = { gymId: gym.id, memberId: data.member_id, version: data.version };
      credential = { version: data.version, enabled: data.enabled };
    }
  } else {
    const verifiedPayload = verifyQrToken(token);
    payload = verifiedPayload;
    if (verifiedPayload && verifiedPayload.gymId === gym.id) {
      const { data } = await supabase.from("member_qr_credentials").select("version,enabled").eq("member_id", verifiedPayload.memberId).eq("gym_id", gym.id).maybeSingle();
      credential = data;
    }
  }

  if (!payload) notFound();
  if (payload.gymId !== gym.id) notFound();
  const today = businessDate(gym.timezone);
  const [{ data: member }, { data: membership }, { data: lastEvent }] = await Promise.all([
    supabase.from("members").select("id,member_code,name,phone,email,profile_photo_path,is_archived").eq("id", payload.memberId).eq("gym_id", gym.id).maybeSingle(),
    supabase.from("memberships").select("id,plan_name,starts_on,expires_on").eq("member_id", payload.memberId).eq("gym_id", gym.id).lte("starts_on", today).gte("expires_on", today).order("expires_on", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("attendance_events").select("direction,occurred_at").eq("member_id", payload.memberId).eq("gym_id", gym.id).order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!member) notFound();
  const photoUrl = await signedMemberPhotoUrl(supabase, member.profile_photo_path);

  const qrValid = credential?.enabled && credential.version === payload.version && !member.is_archived;
  const allowed = qrValid && Boolean(membership);
  const lastEventDate = lastEvent ? businessDate(gym.timezone, new Date(lastEvent.occurred_at)) : null;
  const suggestedDirection = nextAttendanceDirection(lastEvent?.direction ?? null, lastEventDate, today);
  const directions = ["entry", "exit"] as const;
  const accessMessage = !qrValid
    ? "QR disabled or replaced"
    : membership
      ? `${membership.plan_name} · valid through ${membership.expires_on}`
      : `No active membership for ${today}`;
  const lastMovement = lastEvent
    ? `${attendanceLabel(lastEvent.direction)} · ${new Intl.DateTimeFormat("en-IN", { timeZone: gym.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(lastEvent.occurred_at))}${lastEventDate !== today ? " · today starts with Check-in" : ""}`
    : "No attendance recorded yet";

  return <>
    <div className="page-head">
      <div><p className="eyebrow">QR attendance</p><h1>Scan result</h1><p className="muted">Review access and record the movement when allowed.</p></div>
      <Link className="button secondary" href={`/members/${member.id}`}>Open member</Link>
    </div>
    <Feedback success={query.success} error={query.error}/>
    <div className="scan-layout">
      <section className={`card scan-card ${allowed ? "allowed" : "denied"}`}>
        <div className="scan-status">
          <span className="member-avatar scan">{photoUrl ? <img src={photoUrl} alt=""/> : member.name.slice(0, 1).toUpperCase()}</span>
          <span className={`scan-pill ${allowed ? "allowed" : "denied"}`}>{allowed ? "Access allowed" : "Access denied"}</span>
          <h2>{member.name}</h2>
          <p>{member.member_code} · {member.phone}</p>
        </div>
        <div className={`scan-access-note ${allowed ? "allowed" : "denied"}`}>
          <strong>{allowed ? "Membership active" : "Do not admit with this QR"}</strong>
          <span>{accessMessage}</span>
        </div>
        {allowed && <div className="scan-actions">
          {directions.map((direction) => <form action={recordAttendance} key={direction}>
            <input type="hidden" name="token" value={token}/><input type="hidden" name="direction" value={direction}/><input type="hidden" name="request_id" value={randomUUID()}/>
            <button className={`button scan-action ${direction} ${direction === suggestedDirection ? "suggested" : "secondary"}`}>{attendanceLabel(direction)}</button>
          </form>)}
        </div>}
        <p className="scan-context"><span>Last movement</span><strong>{lastMovement}</strong></p>
      </section>
    </div>
  </>;
}
