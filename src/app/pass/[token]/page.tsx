import { notFound } from "next/navigation";
import { QrCode } from "@/components/qr-code";
import { createAdminClient } from "@/lib/supabase/admin";
import { qrUrls, verifyQrToken } from "@/lib/qr-token";

export default async function PublicPassPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = verifyQrToken(token);
  if (!payload) notFound();

  const db = createAdminClient();
  const [{ data: credential }, { data: member }, { data: gym }] = await Promise.all([
    db.from("member_qr_credentials").select("version,enabled").eq("gym_id", payload.gymId).eq("member_id", payload.memberId).maybeSingle(),
    db.from("members").select("member_code,is_archived").eq("gym_id", payload.gymId).eq("id", payload.memberId).maybeSingle(),
    db.from("gyms").select("name").eq("id", payload.gymId).maybeSingle(),
  ]);
  if (!credential?.enabled || credential.version !== payload.version || !member || member.is_archived || !gym) notFound();

  const { scanUrl } = qrUrls(token);
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: "var(--canvas)" }}>
    <section className="card stack" style={{ width: "min(440px, 100%)", textAlign: "center", padding: 30 }}>
      <div><p className="eyebrow">Member pass</p><h1>{gym.name}</h1><p className="muted">Show this QR to an authorized gym operator.</p></div>
      <div style={{ width: "min(360px, 100%)", margin: "auto" }}><QrCode value={scanUrl} label={`Gym pass for ${member.member_code}`}/></div>
      <div><strong>{member.member_code}</strong><br/><small className="muted">QR version {credential.version}</small></div>
      <small className="muted">This page does not record attendance. The operator must scan and confirm entry or exit.</small>
    </section>
  </main>;
}
