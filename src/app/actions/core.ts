"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireGym } from "@/lib/auth";
import { calculateCharge, calculateExpiry, calculateRenewalStart } from "@/lib/domain";
import { Resend } from "resend";

const text = z.string().trim().min(1);
const money = z.coerce.number().min(0).transform(v => Math.round(v * 100));
function done(path: string, message: string): never { revalidatePath("/", "layout"); redirect(`${path}?success=${encodeURIComponent(message)}`); }
function fail(path: string, error: unknown): never {
  if (typeof error === "object" && error && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw error;
  const message = error instanceof Error ? error.message : String(error); redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function createMember(formData: FormData) {
  try {
    const input = z.object({
      name: text, phone: z.string().trim().min(7), email: z.email().or(z.literal("")), notes: z.string(), confirm_shared: z.string().optional(),
      plan_id: z.uuid(), starts_on: z.iso.date(), expires_on: z.iso.date().or(z.literal("")),
      subtotal: money, discount: money, gst_rate: z.coerce.number().min(0).max(100), amount_paid: money,
      method: z.enum(["cash", "upi", "card", "bank_transfer"]), reference: z.string(), paid_on: z.iso.date(),
    }).parse(Object.fromEntries(formData));
    const { supabase, gym } = await requireGym();
    const { data: duplicate } = await supabase.from("members").select("member_code,name").eq("gym_id", gym.id).eq("phone", input.phone).limit(1).maybeSingle();
    if (duplicate && input.confirm_shared !== "on") throw new Error(`${duplicate.name} (${duplicate.member_code}) already uses this phone. Select the shared-phone confirmation to continue.`);
    const { data: plan, error: planError } = await supabase.from("plans").select("*").eq("id", input.plan_id).eq("gym_id", gym.id).eq("is_active", true).single();
    if (planError || !plan) throw new Error("Active plan not found");
    const computedExpiry = calculateExpiry(input.starts_on, plan.duration_value, plan.duration_unit);
    const expiry = input.expires_on || computedExpiry;
    const charge = calculateCharge(input.subtotal, input.discount, Math.round(input.gst_rate * 100));
    if (input.amount_paid > charge.totalPaise) throw new Error("Initial payment cannot exceed the total charge");
    const { data, error } = await supabase.rpc("create_member_with_enrollment", {
      p_name: input.name, p_phone: input.phone, p_email: input.email, p_notes: input.notes,
      p_plan_id: input.plan_id, p_starts_on: input.starts_on, p_expires_on: expiry, p_date_overridden: expiry !== computedExpiry,
      p_subtotal_paise: charge.subtotalPaise, p_discount_paise: charge.discountPaise,
      p_gst_rate_basis_points: charge.gstRateBasisPoints, p_tax_paise: charge.taxPaise, p_total_paise: charge.totalPaise,
      p_payment_paise: input.amount_paid, p_payment_method: input.method,
      p_payment_reference: input.reference, p_paid_on: input.paid_on,
    });
    if (error) throw error;
    const result = data as { member_id?: string } | null;
    if (!result?.member_id) throw new Error("Member was created but the result could not be loaded");
    done(`/members/${result.member_id}`, input.amount_paid > 0 ? "Member enrolled and payment recorded" : "Member enrolled");
  } catch (e) { fail("/members/new", e); }
}

export async function updateMember(formData: FormData) {
  const id = String(formData.get("id"));
  try {
    const input = z.object({ name: text, phone: z.string().trim().min(7), email: z.email().or(z.literal("")), notes: z.string(), is_archived: z.string().optional() }).parse(Object.fromEntries(formData));
    const { supabase, gym } = await requireGym();
    const { error } = await supabase.from("members").update({ name: input.name, phone: input.phone, email: input.email || null, notes: input.notes || null, is_archived: input.is_archived === "on", updated_at: new Date().toISOString() }).eq("id", id).eq("gym_id", gym.id);
    if (error) throw error; done(`/members/${id}`, "Member updated");
  } catch (e) { fail(`/members/${id}`, e); }
}

export async function createPlan(formData: FormData) {
  try {
    const input = z.object({ name: text, duration_value: z.coerce.number().int().positive(), duration_unit: z.enum(["days", "months"]), fee: money }).parse(Object.fromEntries(formData));
    const { supabase, gym } = await requireGym();
    const { error } = await supabase.from("plans").insert({ gym_id: gym.id, name: input.name, duration_value: input.duration_value, duration_unit: input.duration_unit, default_fee_paise: input.fee });
    if (error) throw error; done("/plans", "Plan created");
  } catch (e) { fail("/plans", e); }
}

export async function togglePlan(formData: FormData) {
  const { supabase, gym } = await requireGym(); const id = String(formData.get("id")); const active = formData.get("active") === "true";
  await supabase.from("plans").update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", id).eq("gym_id", gym.id);
  done("/plans", active ? "Plan activated" : "Plan archived");
}

export async function createMembership(formData: FormData) {
  const memberId = String(formData.get("member_id"));
  try {
    const input = z.object({ member_id: z.uuid(), plan_id: z.uuid(), starts_on: z.iso.date(), expires_on: z.iso.date().or(z.literal("")), subtotal: money, discount: money, gst_rate: z.coerce.number().min(0).max(100) }).parse(Object.fromEntries(formData));
    const { supabase, gym } = await requireGym();
    const { data: plan, error: planError } = await supabase.from("plans").select("*").eq("id", input.plan_id).eq("gym_id", gym.id).eq("is_active", true).single();
    if (planError || !plan) throw new Error("Active plan not found");
    const computedExpiry = calculateExpiry(input.starts_on, plan.duration_value, plan.duration_unit);
    const expiry = input.expires_on || computedExpiry;
    const charge = calculateCharge(input.subtotal, input.discount, Math.round(input.gst_rate * 100));
    const { error } = await supabase.rpc("create_membership_charge", { p_member_id: input.member_id, p_plan_id: input.plan_id, p_starts_on: input.starts_on, p_expires_on: expiry, p_date_overridden: expiry !== computedExpiry, p_subtotal_paise: charge.subtotalPaise, p_discount_paise: charge.discountPaise, p_gst_rate_basis_points: charge.gstRateBasisPoints, p_tax_paise: charge.taxPaise, p_total_paise: charge.totalPaise });
    if (error) throw error; done(`/members/${memberId}`, "Membership created");
  } catch (e) { fail(`/members/${memberId}/enroll`, e); }
}

export async function renewMembership(formData: FormData) {
  const memberId = String(formData.get("member_id"));
  try {
    const { supabase, gym } = await requireGym();
    const renewalDate = String(formData.get("renewal_date"));
    const { data: latest } = await supabase.from("memberships").select("expires_on").eq("member_id", memberId).eq("gym_id", gym.id).order("expires_on", { ascending: false }).limit(1).maybeSingle();
    formData.set("starts_on", calculateRenewalStart(latest?.expires_on ?? null, renewalDate));
    await createMembership(formData);
  } catch (e) { fail(`/members/${memberId}/renew`, e); }
}

export async function recordPayment(formData: FormData) {
  const chargeId = String(formData.get("charge_id")); const memberId = String(formData.get("member_id"));
  try {
    const input = z.object({ amount: money, method: z.enum(["cash", "upi", "card", "bank_transfer"]), reference: z.string(), paid_on: z.iso.date(), notes: z.string() }).parse(Object.fromEntries(formData));
    const { supabase } = await requireGym();
    const { error } = await supabase.rpc("record_payment", { p_charge_id: chargeId, p_amount_paise: input.amount, p_method: input.method, p_reference: input.reference, p_paid_on: input.paid_on, p_notes: input.notes });
    if (error) throw error; done(`/members/${memberId}`, "Payment recorded");
  } catch (e) { fail(`/members/${memberId}/pay?charge=${chargeId}`, e); }
}

export async function voidPayment(formData: FormData) {
  const paymentId = String(formData.get("payment_id")); const memberId = String(formData.get("member_id"));
  try { const reason = text.parse(formData.get("reason")); const { supabase, gym } = await requireGym(); const { error } = await supabase.from("payments").update({ voided_at: new Date().toISOString(), void_reason: reason }).eq("id", paymentId).eq("gym_id", gym.id).is("voided_at", null); if (error) throw error; done(`/members/${memberId}`, "Payment voided"); } catch (e) { fail(`/members/${memberId}`, e); }
}

export async function updateSettings(formData: FormData) {
  try {
    const input = z.object({ name: text, phone: z.string(), email: z.email().or(z.literal("")), address: z.string(), gstin: z.string(), timezone: text, receipt_prefix: z.string().trim().min(1).max(8), reminder_subject: text, reminder_body: text, offsets: text }).parse(Object.fromEntries(formData));
    const offsets = [...new Set(input.offsets.split(",").map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n <= 365);
    if (!offsets.length) throw new Error("Enter at least one valid reminder offset");
    const { supabase, gym } = await requireGym();
    const { error } = await supabase.from("gyms").update({ ...input, email: input.email || null, offsets: undefined }).eq("id", gym.id); if (error) throw error;
    await supabase.from("reminder_rules").delete().eq("gym_id", gym.id); await supabase.from("reminder_rules").insert(offsets.map(days_before => ({ gym_id: gym.id, days_before, enabled: true })));
    done("/settings", "Settings saved");
  } catch (e) { fail("/settings", e); }
}

export async function emailReceipt(formData: FormData) {
  const paymentId = String(formData.get("payment_id"));
  try {
    const { supabase, gym } = await requireGym();
    const { data: p } = await supabase.from("payments").select("*, charges!inner(*, memberships!inner(*, members!inner(*)))").eq("id", paymentId).eq("gym_id", gym.id).single();
    if (!p) throw new Error("Receipt not found");
    const member = p.charges.memberships.members;
    if (!member.email) throw new Error("This member has no email address");
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
    const url = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/receipts/${p.id}`;
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: process.env.RESEND_FROM_EMAIL ?? "GymDesk <onboarding@resend.dev>", to: member.email, subject: `Receipt ${p.receipt_number} from ${gym.name}`, html: `<p>Hi ${escapeHtml(member.name)},</p><p>We received your payment of ₹${(Number(p.amount_paise) / 100).toFixed(2)}.</p><p><a href="${url}">View receipt ${p.receipt_number}</a></p><p>${escapeHtml(gym.name)}</p>` });
    if (error) throw new Error(error.message); done(`/receipts/${p.id}`, "Receipt emailed");
  } catch (e) { fail(`/receipts/${paymentId}`, e); }
}

function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]!); }
