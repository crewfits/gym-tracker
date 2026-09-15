"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requestAppOrigin } from "@/lib/app-origin";
import { requireGym, requirePermission } from "@/lib/auth";
import { calculateCharge, calculateExpiry, calculatePaymentFollowUpDate, calculateRenewalStart, formatInr, normalizeCurrencyCode } from "@/lib/domain";
import { memberPhotoBucket } from "@/lib/member-photo";
import { createReceiptToken } from "@/lib/receipt-token";
import { newMemberSchema, memberValidationErrors, type CreateMemberResult } from "@/lib/new-member-validation";
import { decodePhotoDataUrl, saveMemberPhoto } from "@/lib/member-photo-upload";
import { Resend } from "resend";

const text = z.string().trim().min(1);
const money = z.coerce.number().min(0).transform(v => Math.round(v * 100));
const optionalDate = z.union([z.iso.date(), z.literal("")]).optional();
function feedbackPath(path: string, key: "success" | "error", message: string) {
  const url = new URL(path, "http://localhost");
  url.searchParams.set(key, message);
  return `${url.pathname}${url.search}${url.hash}`;
}
function done(path: string, message: string): never { revalidatePath("/", "layout"); redirect(feedbackPath(path, "success", message)); }
function actionErrorMessage(error: unknown): string {
  if (typeof error === "object" && error && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw error;
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "Please check the form and try again.";
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String((error as { message: unknown }).message);
  if (typeof error === "string") return error;
  return "Something went wrong. Please try again.";
}
function fail(path: string, error: unknown): never {
  redirect(feedbackPath(path, "error", actionErrorMessage(error)));
}

function photoInput(formData: FormData) {
  const dataUrl = String(formData.get("profile_photo_data_url") ?? "");
  const removed = String(formData.get("profile_photo_removed") ?? "") === "true";
  return { dataUrl, removed };
}

async function removeMemberPhoto(supabase: Awaited<ReturnType<typeof requireGym>>["supabase"], existingPath?: string | null) {
  if (!existingPath) return;
  await supabase.storage.from(memberPhotoBucket).remove([existingPath]);
}

export async function createMember(formData: FormData): Promise<CreateMemberResult> {
  let createdMemberId: string | undefined;
  function complete(path: string, message: string): CreateMemberResult {
    revalidatePath("/", "layout");
    return { ok: true, location: `${path}?success=${encodeURIComponent(message)}` };
  }
  try {
    const values = Object.fromEntries(formData);
    const parsed = newMemberSchema.safeParse(values);
    if (!parsed.success) return { ok: false, fieldErrors: memberValidationErrors(values) };
    const input = parsed.data;
    const { supabase, gym } = await requirePermission("members.create");
    const selectedPhoto = photoInput(formData);
    try { decodePhotoDataUrl(selectedPhoto.dataUrl); }
    catch (error) { return { ok: false, fieldErrors: { profile_photo_data_url: error instanceof Error ? error.message : "Choose a valid photo." } }; }
    const { data: duplicates, error: duplicateError } = await supabase.from("members").select("id,member_code,name,is_archived").eq("gym_id", gym.id).eq("phone", input.phone).order("is_archived", { ascending: true }).order("created_at", { ascending: false });
    if (duplicateError) throw duplicateError;
    const duplicate = duplicates?.[0];
    if (duplicate?.is_archived) return { ok: false, fieldErrors: { phone: `${duplicate.name} (${duplicate.member_code}) is archived. Reactivate that profile instead.` }, reactivateUrl: `/members/${duplicate.id}?reactivate=1` };
    if ((duplicates?.length ?? 0) >= 3) return { ok: false, fieldErrors: { phone: "This phone number is already shared by 3 members. Enter a different number." } };
    if (duplicate && input.shared_phone !== "on") return { ok: false, fieldErrors: { shared_phone: `${duplicate.name} (${duplicate.member_code}) already uses this phone. Select the shared-phone confirmation to continue.` } };
    const { data: plan, error: planError } = await supabase.from("plans").select("*").eq("id", input.plan_id).eq("gym_id", gym.id).eq("is_active", true).single();
    if (planError || !plan) return { ok: false, fieldErrors: { plan_id: "This plan is no longer available. Select an active plan." } };
    const computedExpiry = calculateExpiry(input.starts_on, plan.duration_value, plan.duration_unit);
    const expiry = input.expires_on || computedExpiry;
    const dueOn = input.due_on || calculatePaymentFollowUpDate(input.starts_on);
    const charge = calculateCharge(input.subtotal, input.discount, Math.round(input.gst_rate * 100));
    if (input.amount_paid > charge.totalPaise) throw new Error("Initial payment cannot exceed the total charge");
    const { data, error } = await supabase.rpc("create_member_with_enrollment", {
      p_name: input.name, p_phone: input.phone, p_email: input.email, p_notes: input.notes,
      p_plan_id: input.plan_id, p_starts_on: input.starts_on, p_expires_on: expiry, p_date_overridden: expiry !== computedExpiry,
      p_subtotal_paise: charge.subtotalPaise, p_discount_paise: charge.discountPaise,
      p_gst_rate_basis_points: charge.gstRateBasisPoints, p_tax_paise: charge.taxPaise, p_total_paise: charge.totalPaise,
      p_due_on: dueOn,
      p_payment_paise: input.amount_paid, p_payment_method: input.method,
      p_payment_reference: input.reference, p_paid_on: input.paid_on,
    });
    if (error) throw error;
    const result = data as { member_id?: string; payment_id?: string } | null;
    if (!result?.member_id) throw new Error("Member was created but the result could not be loaded");
    createdMemberId = result.member_id;
    if (input.old_member_id) {
      const { error: oldMemberIdError } = await supabase.from("members").update({ old_member_id: input.old_member_id, updated_at: new Date().toISOString() }).eq("id", result.member_id).eq("gym_id", gym.id);
      if (oldMemberIdError) throw oldMemberIdError;
    }
    let photoWarning = "";
    if (selectedPhoto.dataUrl) {
      try {
        const path = await saveMemberPhoto(supabase, gym.id, result.member_id, selectedPhoto.dataUrl);
        const { error: photoUpdateError } = await supabase.from("members").update({ profile_photo_path: path, updated_at: new Date().toISOString() }).eq("id", result.member_id).eq("gym_id", gym.id);
        if (photoUpdateError) throw photoUpdateError;
      } catch (photoError) {
        photoWarning = ` Photo upload failed: ${photoError instanceof Error ? photoError.message : String(photoError)}`;
      }
    }
    if (input.generate_qr === "on") {
      const { error: qrError } = await supabase.rpc("issue_member_qr", { p_member_id: result.member_id });
      if (qrError) return { ok: true, location: `/members/${result.member_id}?error=${encodeURIComponent(`Member created, but QR generation failed: ${qrError.message}`)}` };
      return complete(`/members/${result.member_id}/qr`, `${input.amount_paid > 0 ? "Member enrolled, payment recorded and QR generated" : "Member enrolled and QR generated"}${photoWarning}`);
    }
    if (input.amount_paid > 0 && result.payment_id) return complete(`/receipts/${result.payment_id}`, "Payment recorded. Send or share the receipt below.");
    return complete(`/members/${result.member_id}`, `Member enrolled${photoWarning}`);
  } catch (e) {
    const message = actionErrorMessage(e);
    // Enrollment has committed: navigate to the created member rather than invite a duplicate retry.
    if (createdMemberId) return { ok: true, location: `/members/${createdMemberId}?error=${encodeURIComponent(`Member created, but setup needs attention: ${message}`)}` };
    return { ok: false, fieldErrors: {}, error: message };
  }
}

export async function updateMember(formData: FormData) {
  const id = String(formData.get("id"));
  try {
    const input = z.object({ name: text, phone: z.string().trim().min(7), email: z.email().or(z.literal("")), old_member_id: z.string().trim().max(100), notes: z.string(), is_archived: z.string().optional() }).parse(Object.fromEntries(formData));
    const { supabase, gym } = await requirePermission("members.manage");
    const selectedPhoto = photoInput(formData);
    const { data: existing, error: existingError } = await supabase.from("members").select("profile_photo_path").eq("id", id).eq("gym_id", gym.id).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) throw new Error("Member not found");
    let profilePhotoPath = existing.profile_photo_path ?? null;
    if (selectedPhoto.dataUrl) profilePhotoPath = await saveMemberPhoto(supabase, gym.id, id, selectedPhoto.dataUrl, existing.profile_photo_path);
    else if (selectedPhoto.removed) {
      await removeMemberPhoto(supabase, existing.profile_photo_path);
      profilePhotoPath = null;
    }
    const { error } = await supabase.from("members").update({ name: input.name, phone: input.phone, email: input.email || null, old_member_id: input.old_member_id || null, notes: input.notes || null, profile_photo_path: profilePhotoPath, is_archived: input.is_archived === "on", updated_at: new Date().toISOString() }).eq("id", id).eq("gym_id", gym.id);
    if (error) throw error; done(`/members/${id}`, "Member updated");
  } catch (e) { fail(`/members/${id}`, e); }
}

export async function reactivateMember(formData: FormData) {
  const memberId = z.uuid().parse(formData.get("member_id"));
  try {
    const { supabase, gym } = await requirePermission("members.manage");
    const { data: member, error: memberError } = await supabase.from("members").select("id,is_archived").eq("id", memberId).eq("gym_id", gym.id).maybeSingle();
    if (memberError) throw memberError;
    if (!member) throw new Error("Member not found");
    if (!member.is_archived) done(`/members/${memberId}`, "Member is already active");
    const { error } = await supabase.rpc("reactivate_archived_member", { p_member_id: memberId });
    if (error) throw error;
    done(`/members/${memberId}`, "Member reactivated. Issue a new QR when access should resume.");
  } catch (error) {
    fail(`/members/${memberId}?reactivate=1`, error);
  }
}

export async function createPlan(formData: FormData) {
  try {
    const input = z.object({ name: text, duration_value: z.coerce.number().int().positive(), duration_unit: z.enum(["days", "months"]), fee: money }).parse(Object.fromEntries(formData));
    const { supabase, gym } = await requirePermission("plans.manage");
    const { error } = await supabase.from("plans").insert({ gym_id: gym.id, name: input.name, duration_value: input.duration_value, duration_unit: input.duration_unit, default_fee_paise: input.fee });
    if (error) throw error; done("/plans", "Plan created");
  } catch (e) { fail("/plans", e); }
}

export async function togglePlan(formData: FormData) {
  const { supabase, gym } = await requirePermission("plans.manage"); const id = String(formData.get("id")); const active = formData.get("active") === "true";
  await supabase.from("plans").update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", id).eq("gym_id", gym.id);
  done("/plans", active ? "Plan activated" : "Plan archived");
}

export async function updatePlan(formData: FormData) {
  const id = String(formData.get("id"));
  try {
    const input = z.object({ name: text, duration_value: z.coerce.number().int().positive(), duration_unit: z.enum(["days", "months"]), fee: money }).parse(Object.fromEntries(formData));
    const { supabase, gym } = await requirePermission("plans.manage");
    const { error } = await supabase.from("plans").update({ name: input.name, duration_value: input.duration_value, duration_unit: input.duration_unit, default_fee_paise: input.fee, updated_at: new Date().toISOString() }).eq("id", id).eq("gym_id", gym.id);
    if (error) throw error;
    done("/plans", "Plan updated. Existing memberships were not changed.");
  } catch (e) { fail(`/plans/${id}/edit`, e); }
}

export async function createMembership(formData: FormData) {
  const memberId = String(formData.get("member_id"));
  try {
    const input = z.object({ member_id: z.uuid(), plan_id: z.uuid(), starts_on: z.iso.date(), expires_on: z.iso.date().or(z.literal("")), due_on: optionalDate, subtotal: money, discount: money, gst_rate: z.coerce.number().min(0).max(100) }).parse(Object.fromEntries(formData));
    const { supabase, gym } = await requirePermission("payments.manage");
    const { data: plan, error: planError } = await supabase.from("plans").select("*").eq("id", input.plan_id).eq("gym_id", gym.id).eq("is_active", true).single();
    if (planError || !plan) throw new Error("Active plan not found");
    const computedExpiry = calculateExpiry(input.starts_on, plan.duration_value, plan.duration_unit);
    const expiry = input.expires_on || computedExpiry;
    const dueOn = input.due_on || calculatePaymentFollowUpDate(input.starts_on);
    const charge = calculateCharge(input.subtotal, input.discount, Math.round(input.gst_rate * 100));
    const { error } = await supabase.rpc("create_membership_charge", { p_member_id: input.member_id, p_plan_id: input.plan_id, p_starts_on: input.starts_on, p_expires_on: expiry, p_date_overridden: expiry !== computedExpiry, p_subtotal_paise: charge.subtotalPaise, p_discount_paise: charge.discountPaise, p_gst_rate_basis_points: charge.gstRateBasisPoints, p_tax_paise: charge.taxPaise, p_total_paise: charge.totalPaise, p_due_on: dueOn });
    if (error) throw error; done(`/members/${memberId}`, "Membership created");
  } catch (e) { fail(`/members/${memberId}/enroll`, e); }
}

export async function renewMembership(formData: FormData) {
  const memberId = String(formData.get("member_id"));
  const returnPath = formData.get("return_path") === `/members/${memberId}?view=membership` ? `/members/${memberId}?view=membership` : formData.get("return_path") === `/members/${memberId}` ? `/members/${memberId}` : `/members/${memberId}/renew`;
  let renewalCreated = false;
  try {
    const { supabase, gym } = await requirePermission("payments.manage");
    const input = z.object({ plan_id: z.uuid(), renewal_date: z.iso.date(), expires_on: z.iso.date().or(z.literal("")), due_on: optionalDate, subtotal: money, discount: money, gst_rate: z.coerce.number().min(0).max(100), amount_paid: money, method: z.enum(["cash", "upi", "card", "bank_transfer"]), reference: z.string() }).parse(Object.fromEntries(formData));
    const [{ data: latest, error: latestError }, { data: plan, error: planError }] = await Promise.all([
      supabase.from("memberships").select("expires_on").eq("member_id", memberId).eq("gym_id", gym.id).is("reverted_at", null).order("expires_on", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("plans").select("*").eq("id", input.plan_id).eq("gym_id", gym.id).eq("is_active", true).single(),
    ]);
    if (latestError) throw latestError;
    if (planError || !plan) throw new Error("Active plan not found");
    const startsOn = calculateRenewalStart(latest?.expires_on ?? null, input.renewal_date);
    const computedExpiry = calculateExpiry(startsOn, plan.duration_value, plan.duration_unit);
    const expiry = input.expires_on || computedExpiry;
    const dueOn = input.due_on || calculatePaymentFollowUpDate(startsOn);
    const charge = calculateCharge(input.subtotal, input.discount, Math.round(input.gst_rate * 100));
    if (input.amount_paid > charge.totalPaise) throw new Error("Payment cannot exceed the renewal total");
    const { data: membershipId, error: membershipError } = await supabase.rpc("create_membership_charge", { p_member_id: memberId, p_plan_id: input.plan_id, p_starts_on: startsOn, p_expires_on: expiry, p_date_overridden: expiry !== computedExpiry, p_subtotal_paise: charge.subtotalPaise, p_discount_paise: charge.discountPaise, p_gst_rate_basis_points: charge.gstRateBasisPoints, p_tax_paise: charge.taxPaise, p_total_paise: charge.totalPaise, p_due_on: dueOn });
    if (membershipError) throw membershipError;
    renewalCreated = true;
    if (input.amount_paid <= 0) done(`/members/${memberId}?view=membership`, "Renewal created with payment pending");
    const { data: createdCharge, error: chargeError } = await supabase.from("charges").select("id").eq("membership_id", membershipId).eq("gym_id", gym.id).single();
    if (chargeError || !createdCharge) throw new Error("Renewal was created but its charge could not be loaded");
    const { data: payment, error: paymentError } = await supabase.rpc("record_payment", { p_charge_id: createdCharge.id, p_amount_paise: input.amount_paid, p_method: input.method, p_reference: input.reference, p_paid_on: input.renewal_date, p_notes: "Renewal payment" });
    if (paymentError) throw paymentError;
    const result = payment as { id?: string } | null;
    if (!result?.id) throw new Error("Payment was recorded but the receipt could not be loaded");
    done(`/members/${memberId}/qr`, "Renewal and payment recorded. Share the QR pass and receipt below.");
  } catch (e) {
    const message = actionErrorMessage(e);
    if (renewalCreated) fail(`/members/${memberId}?view=membership`, `Renewal already created. Review its balance and receipts before collecting any remaining payment; do not renew again. ${message}`);
    fail(returnPath, message);
  }
}

export async function removeMistakenRenewal(formData: FormData) {
  const membershipId = String(formData.get("membership_id"));
  const memberId = String(formData.get("member_id"));
  try {
    const { supabase, gym, user } = await requirePermission("payments.manage");
    const { data: membership, error: membershipLoadError } = await supabase.from("memberships").select("id,created_at,reverted_at").eq("id", membershipId).eq("member_id", memberId).eq("gym_id", gym.id).maybeSingle();
    if (membershipLoadError) throw membershipLoadError;
    if (!membership) throw new Error("Renewal not found");
    if (membership.reverted_at) done(`/members/${memberId}`, "Renewal was already reverted");
    const { count: olderCount } = await supabase.from("memberships").select("id", { count: "exact", head: true }).eq("member_id", memberId).eq("gym_id", gym.id).is("reverted_at", null).lt("created_at", membership.created_at);
    if (!olderCount) throw new Error("The original enrollment cannot be removed here");
    const { data: charge, error: chargeLoadError } = await supabase.from("charges").select("id").eq("membership_id", membershipId).eq("gym_id", gym.id).maybeSingle();
    if (chargeLoadError) throw chargeLoadError;
    if (!charge) throw new Error("Renewal charge not found");
    const { count: attendanceCount } = await supabase.from("attendance_events").select("id", { count: "exact", head: true }).eq("membership_id", membershipId).eq("gym_id", gym.id);
    if (attendanceCount) throw new Error("This membership has attendance history and cannot be reverted as a mistaken renewal");
    const { data: payments } = await supabase.from("payments").select("id,amount_paise,voided_at,payment_reversals(amount_paise)").eq("charge_id", charge.id).eq("gym_id", gym.id);
    for (const payment of payments ?? []) {
      const reversed = (payment.payment_reversals ?? []).reduce((sum, item) => sum + Number(item.amount_paise), 0);
      const remaining = payment.voided_at ? 0 : Number(payment.amount_paise) - reversed;
      if (remaining > 0) {
        const { error: reversalError } = await supabase.rpc("reverse_payment", { p_payment_id: payment.id, p_amount_paise: remaining, p_reason: "Mistaken renewal reverted" });
        if (reversalError) throw reversalError;
      }
    }
    const { error: membershipError } = await supabase.from("memberships").update({ reverted_at: new Date().toISOString(), reverted_reason: "Mistaken renewal reverted", reverted_by: user.id }).eq("id", membershipId).eq("member_id", memberId).eq("gym_id", gym.id).is("reverted_at", null);
    if (membershipError) throw membershipError;
    done(`/members/${memberId}`, "Mistaken renewal reverted. Any recorded payment was fully reversed.");
  } catch (e) { fail(`/members/${memberId}`, e); }
}

export async function recordPayment(formData: FormData) {
  const chargeId = String(formData.get("charge_id")); const memberId = String(formData.get("member_id"));
  try {
    const input = z.object({ amount: money, method: z.enum(["cash", "upi", "card", "bank_transfer"]), reference: z.string(), paid_on: z.iso.date(), notes: z.string() }).parse(Object.fromEntries(formData));
    const { supabase } = await requirePermission("payments.manage");
    const { data, error } = await supabase.rpc("record_payment", { p_charge_id: chargeId, p_amount_paise: input.amount, p_method: input.method, p_reference: input.reference, p_paid_on: input.paid_on, p_notes: input.notes });
    if (error) throw error;
    const payment = data as { id?: string } | null;
    if (!payment?.id) throw new Error("Payment was recorded but the receipt could not be loaded");
    done(`/members/${memberId}/qr`, "Payment recorded. Share the QR pass and receipt below.");
  } catch (e) { fail(`/members/${memberId}/pay?charge=${chargeId}`, e); }
}

export async function updateChargeDueDate(formData: FormData) {
  const memberId = String(formData.get("member_id"));
  const returnPath = formData.get("return_path") === "/reminders?filter=payments" ? "/reminders?filter=payments" : `/members/${memberId}`;
  try {
    const input = z.object({ charge_id: z.uuid(), due_on: z.iso.date() }).parse(Object.fromEntries(formData));
    const { supabase, gym } = await requirePermission("reminders.manage");
    const { data: charge, error: chargeError } = await supabase.from("charges")
      .select("id,memberships!inner(member_id,reverted_at)").eq("id", input.charge_id).eq("gym_id", gym.id)
      .eq("memberships.member_id", memberId).is("memberships.reverted_at", null).maybeSingle();
    if (chargeError) throw chargeError;
    if (!charge) throw new Error("Membership charge not found");
    const { error } = await supabase.from("charges").update({ due_on: input.due_on }).eq("id", input.charge_id).eq("gym_id", gym.id);
    if (error) throw error;
    done(returnPath, "Payment follow-up date updated");
  } catch (error) {
    fail(returnPath, error);
  }
}

export async function reversePayment(formData: FormData) {
  const paymentId = String(formData.get("payment_id")); const memberId = String(formData.get("member_id"));
  try { const input = z.object({ reason: text, amount: money }).parse(Object.fromEntries(formData)); const { supabase } = await requirePermission("payments.manage"); const { error } = await supabase.rpc("reverse_payment", { p_payment_id: paymentId, p_amount_paise: input.amount, p_reason: input.reason }); if (error) throw error; done(`/members/${memberId}`, "Payment reversal recorded. The original receipt remains in the audit history."); } catch (e) { fail(`/members/${memberId}`, e); }
}

export async function updateSettings(formData: FormData) {
  try {
    const input = z.object({
      name: text,
      phone: z.string(),
      email: z.email().or(z.literal("")),
      address: z.string(),
      gstin: z.string(),
      timezone: text,
      receipt_prefix: z.string().trim().min(1).max(8),
      currency_code: z.enum(["INR", "USD", "EUR", "GBP", "AED", "SGD"]),
    }).parse(Object.fromEntries(formData));
    const { supabase, gym } = await requirePermission("settings.manage");
    const { error } = await supabase.from("gyms").update({ ...input, email: input.email || null }).eq("id", gym.id); if (error) throw error;
    done("/settings", "Settings saved");
  } catch (e) { fail("/settings", e); }
}

export async function emailReceipt(formData: FormData) {
  const paymentId = String(formData.get("payment_id"));
  try {
    const { supabase, gym } = await requirePermission("payments.manage");
    const { data: p } = await supabase.from("payments").select("*, charges!inner(*, memberships!inner(*, members!inner(*)))").eq("id", paymentId).eq("gym_id", gym.id).single();
    if (!p) throw new Error("Receipt not found");
    const member = p.charges.memberships.members;
    if (!member.email) throw new Error("This member has no email address");
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
    const url = `${await requestAppOrigin()}/r/${createReceiptToken(p.id)}`;
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: process.env.RESEND_FROM_EMAIL ?? "FitKiro <onboarding@resend.dev>", to: member.email, subject: `Receipt ${p.receipt_number} from ${gym.name}`, html: `<p>Hi ${escapeHtml(member.name)},</p><p>We received your payment of ${formatInr(Number(p.amount_paise), normalizeCurrencyCode(gym.currency_code))}.</p><p><a href="${url}">View receipt ${p.receipt_number}</a></p><p>${escapeHtml(gym.name)}</p>` });
    if (error) throw new Error(error.message); done(`/receipts/${p.id}`, "Receipt emailed");
  } catch (e) { fail(`/receipts/${paymentId}`, e); }
}

function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]!); }
