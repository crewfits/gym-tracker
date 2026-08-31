import Link from "next/link";
import { notFound } from "next/navigation";
import { Feedback } from "@/components/feedback";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { QrCode, qrPngDataUrl } from "@/components/qr-code";
import { QrShareActions } from "@/components/qr-share-actions";
import { disableMemberQr, issueMemberQr, markMemberQrShared } from "@/app/actions/attendance";
import { requireGym } from "@/lib/auth";
import { requestAppOrigin } from "@/lib/app-origin";
import { attendanceLabel, formatDisplayDateTime } from "@/lib/domain";
import { qrUrls } from "@/lib/qr-token";

type Query = { success?: string; error?: string };
type Credential = { public_code: string; version: number; enabled: boolean; issued_at: string; rotated_at: string | null; shared_at: string | null };

export default async function MemberQrPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [{ supabase, gym }, origin] = await Promise.all([requireGym(), requestAppOrigin()]);
  const [{ data: member }, { data: credentialData }, { data: attendance }] = await Promise.all([
    supabase.from("members").select("id,member_code,name,phone,is_archived").eq("id", id).eq("gym_id", gym.id).maybeSingle(),
    supabase.from("member_qr_credentials").select("public_code,version,enabled,issued_at,rotated_at,shared_at").eq("member_id", id).eq("gym_id", gym.id).maybeSingle(),
    supabase.from("attendance_events").select("id,direction,occurred_at").eq("member_id", id).eq("gym_id", gym.id).order("occurred_at", { ascending: false }).limit(10),
  ]);
  if (!member) notFound();

  const credential = credentialData as Credential | null;
  const token = credential?.enabled ? credential.public_code : null;
  const urls = token ? qrUrls(token, origin) : null;
  const defaultCountryCode = process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE ?? "91";
  const sharedAt = credential?.shared_at ? formatDisplayDateTime(credential.shared_at, gym.timezone) : null;
  const qrPng = urls ? await qrPngDataUrl(urls.scanUrl) : null;
  const memberNameSlug = member.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const qrFilename = `${memberNameSlug || "member"}-${member.member_code.toLowerCase()}-gym-pass.png`;

  return <>
    <div className="qr-page-head">
      <div className="qr-page-title"><h1>Member QR pass</h1><p className="muted">Generate, share, rotate or disable this member&apos;s access QR.</p></div>
      <div className="qr-back-actions"><Link className="button secondary small" href="/members">Back to members list</Link><Link className="button secondary small" href={`/members/${id}`}>Back to profile</Link></div>
    </div>
    <Feedback success={query.success} error={query.error}/>
    {member.is_archived && <div className="alert error">Archived members cannot receive or use a QR pass.</div>}
    <div className="grid-2">
      <section className="card stack qr-manage-card">
        {credential?.enabled && urls ? <>
          <div className="qr-manage-layout">
            <div className="qr-preview-panel">
              <div className="qr-manage-image"><QrCode value={urls.scanUrl} label={`Attendance QR for ${member.member_code}`}/></div>
              <div className="qr-member-label"><strong>{member.name}</strong><br/><span className="muted">{member.member_code}</span></div>
            </div>
            <div className="qr-control-panel">
              {qrPng && <QrShareActions defaultCountryCode={defaultCountryCode} filename={qrFilename} gymName={gym.name} memberCode={member.member_code} memberName={member.name} phone={member.phone} qrPngDataUrl={qrPng}/>}
              <div className={`qr-share-confirm ${sharedAt ? "is-shared" : ""}`}>
                <span>{sharedAt ? `Marked shared · ${sharedAt}` : "Not marked as shared"}</span>
                {!sharedAt && <form action={markMemberQrShared}><input type="hidden" name="member_id" value={id}/><button className="button secondary small">Mark as shared</button></form>}
              </div>
              <hr className="qr-actions-divider"/>
              <details className="qr-settings"><summary>QR settings</summary><div className="qr-danger-actions">
                <ConfirmActionForm action={issueMemberQr} memberId={id} message="Regenerate this QR? Every previously shared or printed copy will stop working immediately."><button className="button danger" disabled={member.is_archived}>Regenerate QR</button></ConfirmActionForm>
                <form action={disableMemberQr}><input type="hidden" name="member_id" value={id}/><button className="button secondary">Disable QR</button></form>
              </div></details>
            </div>
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
          {(attendance ?? []).map((event) => <div className="timeline-item" key={event.id}><strong>{attendanceLabel(event.direction)}</strong><br/><small className="muted">{formatDisplayDateTime(event.occurred_at, gym.timezone)}</small></div>)}
          {!attendance?.length && <div className="empty">No attendance recorded yet.</div>}
        </div>
      </aside>
    </div>
  </>;
}
