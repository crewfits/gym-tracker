import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

type EmailMessage = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  attachments?: EmailAttachment[];
};

type EmailBinding = {
  send(message: EmailMessage): Promise<{ messageId?: string; message_id?: string; id?: string } | void>;
};

export type EmailKind =
  | "activation_qr_receipt"
  | "qr_pass"
  | "receipt"
  | "membership_expiring"
  | "membership_expired";

export type EmailAuditInput = {
  gymId: string;
  memberId?: string | null;
  membershipId?: string | null;
  paymentId?: string | null;
  kind: EmailKind;
  toEmail: string;
  subject: string;
  createdBy?: string | null;
  metadata?: Record<string, unknown>;
};

export type EmailAttachment = {
  filename: string;
  content: string | ArrayBuffer | ArrayBufferView;
  type: string;
  disposition?: "attachment" | "inline";
  content_id?: string;
};

export type TransactionalEmailInput = EmailAuditInput & {
  html: string;
  text: string;
  replyTo?: string | null;
  fromName?: string | null;
  attachments?: EmailAttachment[];
};

export function escapeHtml(value: string | null | undefined) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]!);
}

export function paragraphText(value: string) {
  return `<p style="margin:0 0 14px;color:#334155;line-height:1.6">${escapeHtml(value)}</p>`;
}

export function linkButton(label: string, href: string) {
  const safeHref = escapeHtml(href);
  return `<a href="${safeHref}" style="display:inline-block;margin:10px 10px 18px 0;padding:12px 18px;border-radius:14px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700">${escapeHtml(label)}</a>`;
}

export function emailShell(title: string, body: string, footer: string, brandLabel = "FitKiro") {
  return `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:620px;margin:0 auto;padding:32px 18px">
    <div style="background:#ffffff;border:1px solid #dbe7f7;border-radius:22px;padding:28px;box-shadow:0 20px 45px rgba(15,23,42,.08)">
      <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;font-weight:800;margin-bottom:10px">${escapeHtml(brandLabel)}</div>
      <h1 style="font-size:26px;line-height:1.2;margin:0 0 18px;color:#0f172a">${escapeHtml(title)}</h1>
      ${body}
      <div style="border-top:1px solid #e2e8f0;margin-top:24px;padding-top:16px;color:#64748b;font-size:13px;line-height:1.5">${escapeHtml(footer)}</div>
    </div>
  </div>
</body></html>`;
}

function emailAddressFrom(value: string) {
  const match = value.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  return match?.[1] ?? value.trim();
}

function cleanSenderName(value: string | null | undefined) {
  return String(value ?? "FitKiro").replace(/[\r\n<>"]/g, " ").replace(/\s+/g, " ").trim() || "FitKiro";
}

async function emailBinding(): Promise<EmailBinding | null> {
  try {
    const context = await getCloudflareContext({ async: true });
    const binding = (context.env as CloudflareEnv & { EMAIL?: EmailBinding }).EMAIL;
    return binding ?? null;
  } catch {
    return null;
  }
}

export async function sendTransactionalEmail(supabase: SupabaseClient, input: TransactionalEmailInput) {
  const configuredFrom = process.env.EMAIL_FROM ?? "FitKiro <notifications@fitkiro.com>";
  const from = `${cleanSenderName(input.fromName)} <${emailAddressFrom(configuredFrom)}>`;
  const replyTo = input.replyTo || process.env.EMAIL_REPLY_TO || undefined;
  const binding = await emailBinding();
  let providerMessageId: string | null = null;

  try {
    if (!binding) {
      throw new Error("Cloudflare EMAIL binding is not available. Run through the Cloudflare dev/deployed worker to send email.");
    }
    const response = await binding.send({
      to: input.toEmail,
      from,
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    });
    providerMessageId = response?.messageId ?? response?.message_id ?? response?.id ?? null;
    await recordEmailDelivery(supabase, input, "sent", providerMessageId, null);
    return { ok: true as const, providerMessageId };
  } catch (error) {
    await recordEmailDelivery(supabase, input, "failed", providerMessageId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function alreadySentEmail(supabase: SupabaseClient, input: Pick<EmailAuditInput, "gymId" | "kind"> & { membershipId?: string | null; paymentId?: string | null }) {
  let query = supabase.from("email_delivery_events").select("id", { count: "exact", head: true }).eq("gym_id", input.gymId).eq("kind", input.kind).eq("status", "sent");
  if (input.membershipId) query = query.eq("membership_id", input.membershipId);
  if (input.paymentId) query = query.eq("payment_id", input.paymentId);
  const { count, error } = await query;
  if (error) throw error;
  return Boolean(count);
}

export async function latestSentEmail(supabase: SupabaseClient, input: Pick<EmailAuditInput, "gymId" | "kind"> & { membershipId?: string | null; paymentId?: string | null }) {
  let query = supabase
    .from("email_delivery_events")
    .select("id,created_at,to_email,provider_message_id,metadata")
    .eq("gym_id", input.gymId)
    .eq("kind", input.kind)
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(1);
  if (input.membershipId) query = query.eq("membership_id", input.membershipId);
  if (input.paymentId) query = query.eq("payment_id", input.paymentId);
  const { data, error } = await query.maybeSingle<{ id: string; created_at: string; to_email: string; provider_message_id: string | null; metadata: Record<string, unknown> | null }>();
  if (error) throw error;
  return data;
}

async function recordEmailDelivery(supabase: SupabaseClient, input: EmailAuditInput, status: "sent" | "failed", providerMessageId: string | null, errorMessage: string | null) {
  const { error } = await supabase.from("email_delivery_events").insert({
    gym_id: input.gymId,
    member_id: input.memberId ?? null,
    membership_id: input.membershipId ?? null,
    payment_id: input.paymentId ?? null,
    kind: input.kind,
    to_email: input.toEmail,
    subject: input.subject,
    status,
    provider: "cloudflare",
    provider_message_id: providerMessageId,
    error_message: errorMessage,
    created_by: input.createdBy ?? null,
    metadata: input.metadata ?? {},
  });
  if (error && status === "failed") return;
  if (error && error.code !== "23505") throw error;
}
