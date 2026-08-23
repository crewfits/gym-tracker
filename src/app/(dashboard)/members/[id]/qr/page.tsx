import Link from "next/link";
import { notFound } from "next/navigation";
import { Feedback } from "@/components/feedback";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { QrCode, qrPngDataUrl } from "@/components/qr-code";
import { QrShareActions } from "@/components/qr-share-actions";
import { disableMemberQr, issueMemberQr } from "@/app/actions/attendance";
import { requireGym } from "@/lib/auth";
import { attendanceLabel } from "@/lib/domain";
import { createQrToken, qrUrls } from "@/lib/qr-token";

type Query = { success?: string; error?: string };
type Credential = { version: number; enabled: boolean; issued_at: string; rotated_at: string | null };

export default async function MemberQrPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase, gym } = await requireGym();
  const [{ data: member }, { data: credentialData }, { data: attendance }] = await Promise.all([
    supabase.from("members").select("id,member_code,name,phone,is_archived").eq("id", id).eq("gym_id", gym.id).maybeSingle(),
    supabase.from("member_qr_credentials").select("version,enabled,issued_at,rotated_at").eq("member_id", id).eq("gym_id", gym.id).maybeSingle(),
    supabase.from("attendance_events").select("id,direction,occurred_at").eq("member_id", id).eq("gym_id", gym.id).order("occurred_at", { ascending: false }).limit(10),
  ]);
  if (!member) notFound();

  const credential = credentialData as Credential | null;
  const token = credential?.enabled ? createQrToken({ gymId: gym.id, memberId: member.id, version: credential.version }) : null;
  const urls = token ? qrUrls(token) : null;
  const pngDataUrl = urls ? await qrPngDataUrl(urls.scanUrl) : null;
  const defaultCountryCode = process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE ?? "91";

  return <>
    <div className="page-head">
      <div><p className="eyebrow">{member.member_code}</p><h1>Member QR pass</h1><p className="muted">Generate, share, rotate or disable this member&apos;s access QR.</p></div>
      <Link className="button secondary" href={`/members/${id}`}>Back to member</Link>
    </div>
    <Feedback success={query.success} error={query.error}/>
    {member.is_archived && <div className="alert error">Archived members cannot receive or use a QR pass.</div>}
    <div className="grid-2">
      <section className="card stack">
        {credential?.enabled && urls && pngDataUrl ? <>
          <div style={{ width: "min(360px, 100%)", margin: "auto" }}><QrCode value={urls.scanUrl} label={`Attendance QR for ${member.member_code}`}/></div>
          <div style={{ textAlign: "center" }}><strong>{member.name}</strong><br/><span className="muted">{member.member_code}</span></div>
          <QrShareActions memberCode={member.member_code} memberName={member.name} passUrl={urls.passUrl} phone={member.phone} qrPngDataUrl={pngDataUrl} defaultCountryCode={defaultCountryCode}/>
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }}/>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <ConfirmActionForm action={issueMemberQr} memberId={id} message="Regenerate this QR? Every previously shared or printed copy will stop working immediately."><button className="button danger" disabled={member.is_archived}>Regenerate and invalidate old QR</button></ConfirmActionForm>
            <form action={disableMemberQr}><input type="hidden" name="member_id" value={id}/><button className="button secondary">Disable QR</button></form>
          </div>
        </> : <div className="empty">
          <h2>No active QR</h2>
          <p className="muted">Generating a QR creates versioned credential metadata. The QR image itself is not saved.</p>
          <form action={issueMemberQr}><input type="hidden" name="member_id" value={id}/><button className="button" disabled={member.is_archived}>{credential ? "Issue a new QR" : "Generate QR"}</button></form>
        </div>}
      </section>
      <aside className="card">
        <h2>Recent attendance</h2>
        <div className="timeline" style={{ marginTop: 22 }}>
          {(attendance ?? []).map((event) => <div className="timeline-item" key={event.id}><strong>{attendanceLabel(event.direction)}</strong><br/><small className="muted">{new Intl.DateTimeFormat("en-IN", { timeZone: gym.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurred_at))}</small></div>)}
          {!attendance?.length && <div className="empty">No attendance recorded yet.</div>}
        </div>
      </aside>
    </div>
  </>;
}
