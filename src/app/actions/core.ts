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
      name: text, phone: z.string().trim().min(7), email: z.email().or(z.literal("")), notes: z.string(),
      plan_id: z.uuid(), starts_on: z.iso.date(), expires_on: z.iso.date().or(z.literal("")),
      subtotal: money, discount: money, gst_rate: z.coerce.number().min(0).max(100), amount_paid: money,
      method: z.enum(["cash", "upi", "card", "bank_transfer"]), reference: z.string(), paid_on: z.iso.date(),
    }).parse(Object.fromEntries(formData));
    const { supabase, gym } = await requireGym();
    const { data: duplicate } = await supabase.from("members").select("member_code,name").eq("gym_id", gym.id).eq("phone", input.phone).limit(1).maybeSingle();
    if (duplicate) throw new Error(`${duplicate.name} (${duplicate.member_code}) already uses this phone number.`);
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
    const result = data as { member_id?: string; payment_id?: string } | null;
    if (!result?.member_id) throw new Error("Member was created but the result could not be loaded");
    if (input.amount_paid > 0 && result.payment_id) done(`/receipts/${result.payment_id}`, "Payment recorded. Send or share the receipt below.");
    done(`/members/${result.member_id}`, "Member enrolled");
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

export async function updatePlan(formData: FormData) {
  const id = String(formData.get("id"));
  try {
    const input = z.object({ name: text, duration_value: z.coerce.number().int().positive(), duration_unit: z.enum(["days", "months"]), fee: money }).parse(Object.fromEntries(formData));
    const { supabase, gym } = await requireGym();
    const { error } = await supabase.from("plans").update({ name: input.name, duration_value: input.duration_value, duration_unit: input.duration_unit, default_fee_paise: input.fee, updated_at: new Date().toISOString() }).eq("id", id).eq("gym_id", gym.id);
    if (error) throw error;
    done("/plans", "Plan updated. Existing memberships were not changed.");
  } catch (e) { fail(`/plans/${id}/edit`, e); }
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
  const returnPath = formData.get("return_path") === `/members/${memberId}` ? `/members/${memberId}` : `/members/${memberId}/renew`;
  try {
    const { supabase, gym } = await requireGym();
    const input = z.object({ plan_id: z.uuid(), renewal_date: z.iso.date(), expires_on: z.iso.date().or(z.literal("")), subtotal: money, discount: money, gst_rate: z.coerce.number().min(0).max(100), amount_paid: money, method: z.enum(["cash", "upi", "card", "bank_transfer"]), reference: z.string() }).parse(Object.fromEntries(formData));
    const [{ data: latest }, { data: plan, error: planError }] = await Promise.all([
      supabase.from("memberships").select("expires_on").eq("member_id", memberId).eq("gym_id", gym.id).order("expires_on", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("plans").select("*").eq("id", input.plan_id).eq("gym_id", gym.id).eq("is_active", true).single(),
    ]);
    if (planError || !plan) throw new Error("Active plan not found");
    const startsOn = calculateRenewalStart(latest?.expires_on ?? null, input.renewal_date);
    const computedExpiry = calculateExpiry(startsOn, plan.duration_value, plan.duration_unit);
    const expiry = input.expires_on || computedExpiry;
    const charge = calculateCharge(input.subtotal, input.discount, Math.round(input.gst_rate * 100));
    if (input.amount_paid > charge.totalPaise) throw new Error("Payment cannot exceed the renewal total");
    const { data: membershipId, error: membershipError } = await supabase.rpc("create_membership_charge", { p_member_id: memberId, p_plan_id: input.plan_id, p_starts_on: startsOn, p_expires_on: expiry, p_date_overridden: expiry !== computedExpiry, p_subtotal_paise: charge.subtotalPaise, p_discount_paise: charge.discountPaise, p_gst_rate_basis_points: charge.gstRateBasisPoints, p_tax_paise: charge.taxPaise, p_total_paise: charge.totalPaise });
    if (membershipError) throw membershipError;
    if (input.amount_paid <= 0) done(`/members/${memberId}`, "Renewal created with payment pending");
    const { data: createdCharge, error: chargeError } = await supabase.from("charges").select("id").eq("membership_id", membershipId).eq("gym_id", gym.id).single();
    if (chargeError || !createdCharge) throw new Error("Renewal was created but its charge could not be loaded");
    const { data: payment, error: paymentError } = await supabase.rpc("record_payment", { p_charge_id: createdCharge.id, p_amount_paise: input.amount_paid, p_method: input.method, p_reference: input.reference, p_paid_on: input.renewal_date, p_notes: "Renewal payment" });
    if (paymentError) throw paymentError;
    const result = payment as { id?: string } | null;
    if (!result?.id) throw new Error("Payment was recorded but the receipt could not be loaded");
    done(`/receipts/${result.id}`, "Renewal and payment recorded. Send or share the receipt below.");
  } catch (e) { fail(returnPath, e); }
}

export async function removeMistakenRenewal(formData: FormData) {
  const membershipId = String(formData.get("membership_id"));
  const memberId = String(formData.get("member_id"));
  try {
    const { supabase, gym } = await requireGym();
    const { data: membership } = await supabase.from("memberships").select("id,created_at").eq("id", membershipId).eq("member_id", memberId).eq("gym_id", gym.id).single();
    if (!membership) throw new Error("Renewal not found");
    const { count: olderCount } = await supabase.from("memberships").select("id", { count: "exact", head: true }).eq("member_id", memberId).eq("gym_id", gym.id).lt("created_at", membership.created_at);
    if (!olderCount) throw new Error("The original enrollment cannot be removed here");
    const { data: charge } = await supabase.from("charges").select("id").eq("membership_id", membershipId).eq("gym_id", gym.id).single();
    if (!charge) throw new Error("Renewal charge not found");
    const { count: paymentCount } = await supabase.from("payments").select("id", { count: "exact", head: true }).eq("charge_id", charge.id).eq("gym_id", gym.id);
    if (paymentCount) throw new Error("This renewal has payment history and cannot be removed. Reverse the payment instead.");
    await supabase.from("reminder_deliveries").delete().eq("membership_id", membershipId).eq("gym_id", gym.id);
    const { error: chargeDeleteError } = await supabase.from("charges").delete().eq("id", charge.id).eq("gym_id", gym.id);
    if (chargeDeleteError) throw chargeDeleteError;
    const { error: membershipDeleteError } = await supabase.from("memberships").delete().eq("id", membershipId).eq("gym_id", gym.id);
    if (membershipDeleteError) throw membershipDeleteError;
    done(`/members/${memberId}`, "Mistaken renewal removed");
  } catch (e) { fail(`/members/${memberId}`, e); }
}

export async function recordPayment(formData: FormData) {
  const chargeId = String(formData.get("charge_id")); const memberId = String(formData.get("member_id"));
  try {
    const input = z.object({ amount: money, method: z.enum(["cash", "upi", "card", "bank_transfer"]), reference: z.string(), paid_on: z.iso.date(), notes: z.string() }).parse(Object.fromEntries(formData));
    const { supabase } = await requireGym();
    const { data, error } = await supabase.rpc("record_payment", { p_charge_id: chargeId, p_amount_paise: input.amount, p_method: input.method, p_reference: input.reference, p_paid_on: input.paid_on, p_notes: input.notes });
    if (error) throw error;
    const payment = data as { id?: string } | null;
    if (!payment?.id) throw new Error("Payment was recorded but the receipt could not be loaded");
    done(`/receipts/${payment.id}`, "Payment recorded. Send or share the receipt below.");
  } catch (e) { fail(`/members/${memberId}/pay?charge=${chargeId}`, e); }
}

export async function reversePayment(formData: FormData) {
  const paymentId = String(formData.get("payment_id")); const memberId = String(formData.get("member_id"));
  try { const input = z.object({ reason: text, amount: money }).parse(Object.fromEntries(formData)); const { supabase } = await requireGym(); const { error } = await supabase.rpc("reverse_payment", { p_payment_id: paymentId, p_amount_paise: input.amount, p_reason: input.reason }); if (error) throw error; done(`/members/${memberId}`, "Payment reversal recorded. The original receipt remains in the audit history."); } catch (e) { fail(`/members/${memberId}`, e); }
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
