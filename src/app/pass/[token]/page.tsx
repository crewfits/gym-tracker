import { notFound } from "next/navigation";
import { DownloadQrButton } from "@/components/download-qr-button";
import { QrCode, qrPngDataUrl } from "@/components/qr-code";
import { createAdminClient } from "@/lib/supabase/admin";
import { isShortQrCode, qrUrls, verifyQrToken, type QrTokenPayload } from "@/lib/qr-token";

export const dynamic = "force-dynamic";

export default async function PublicPassPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = createAdminClient();

  let payload: QrTokenPayload | null = null;
  let credential: { gym_id: string; member_id: string; version: number; enabled: boolean } | null = null;

  if (isShortQrCode(token)) {
    const { data } = await db.from("member_qr_credentials").select("gym_id,member_id,version,enabled").eq("public_code", token).maybeSingle();
    credential = data;
    if (credential) payload = { gymId: credential.gym_id, memberId: credential.member_id, version: credential.version };
  } else {
    payload = verifyQrToken(token);
    if (payload) {
      const { data } = await db.from("member_qr_credentials").select("gym_id,member_id,version,enabled").eq("gym_id", payload.gymId).eq("member_id", payload.memberId).maybeSingle();
      credential = data;
    }
  }

  if (!payload || !credential) notFound();

  const [{ data: member }, { data: gym }] = await Promise.all([
    db.from("members").select("member_code,name,is_archived").eq("gym_id", payload.gymId).eq("id", payload.memberId).maybeSingle(),
    db.from("gyms").select("name").eq("id", payload.gymId).maybeSingle(),
  ]);
  if (!credential?.enabled || credential.version !== payload.version || !member || member.is_archived || !gym) notFound();

  const { scanUrl } = qrUrls(token);
  const qrPng = await qrPngDataUrl(scanUrl);
  const memberNameSlug = member.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const downloadName = `${memberNameSlug || "member"}-${member.member_code.toLowerCase()}-gym-pass.png`;
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: "var(--canvas)" }}>
    <section className="card stack" style={{ width: "min(440px, 100%)", textAlign: "center", padding: 30 }}>
      <div><p className="eyebrow">Member pass</p><h1>{gym.name}</h1><p className="muted">Show this QR to an authorized gym operator.</p></div>
      <div style={{ width: "min(360px, 100%)", margin: "auto" }}><QrCode value={scanUrl} label={`Gym pass for ${member.member_code}`}/></div>
      <div><strong>{member.name}</strong><br/><span className="muted">{member.member_code}</span></div>
      <DownloadQrButton dataUrl={qrPng} filename={downloadName}/>
    </section>
  </main>;
}
