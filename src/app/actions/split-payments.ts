"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { newMemberSchema } from "@/lib/new-member-validation";
import { parsePaymentRows, type SplitPaymentResult } from "@/lib/split-payments";
import { decodePhotoDataUrl, saveMemberPhoto } from "@/lib/member-photo-upload";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount with up to 2 decimal places.").transform(v => Math.round(Number(v) * 100)).refine(Number.isSafeInteger);
const handlerSchema = z.uuid().or(z.literal("")).optional();
const membershipSchema = z.object({
  member_id: z.uuid(), plan_id: z.uuid(), starts_on: z.iso.date(), expires_on: z.iso.date(),
  subtotal: money, discount: money, gst_rate: z.coerce.number().min(0).max(100),
  assigned_trainer_user_id: z.uuid().or(z.literal("")).optional(), handled_by_gym_user_id: handlerSchema,
}).refine(v => v.discount <= v.subtotal, { path: ["discount"], message: "Discount cannot exceed the plan price." });

async function submit(kind: "activate" | "enroll" | "renew" | "collect", form: FormData): Promise<SplitPaymentResult> {
  let completedMember: string | undefined;
  try {
    const requestId = z.uuid().parse(form.get("request_id"));
    let payments;
    try { payments = parsePaymentRows(JSON.parse(String(form.get("payments") ?? "[]"))); }
    catch { return { ok: false, fieldErrors: { payments: "Check the amount, method and date in each payment entry." } }; }
    if (kind === "collect" && !payments.length) return { ok: false, fieldErrors: { payments: "Add at least one payment." } };
    const values = Object.fromEntries(form);
    let details: Record<string, unknown>;
    const handledBy = typeof values.handled_by_gym_user_id === "string" && values.handled_by_gym_user_id ? values.handled_by_gym_user_id : null;
    if (kind === "activate") {
      const input = newMemberSchema.parse({ ...values, amount_paid: (payments.reduce((sum, p) => sum + p.amount_paise, 0) / 100).toFixed(2), method: "cash", paid_on: values.starts_on, reference: "" });
      details = { name: input.name, phone: input.phone, email: input.email, notes: input.notes, plan_id: input.plan_id, starts_on: input.starts_on, expires_on: input.expires_on, subtotal_paise: input.subtotal, discount_paise: input.discount, gst_rate_basis_points: Math.round(input.gst_rate * 100), shared_phone: input.shared_phone === "on", whatsapp_reminders_enabled: input.whatsapp_reminders_enabled === "on", generate_qr: input.generate_qr === "on", ...(form.has("handled_by_gym_user_id") ? { handled_by_gym_user_id: handledBy } : {}), ...(form.has("assigned_trainer_user_id") ? { assigned_trainer_user_id: typeof values.assigned_trainer_user_id === "string" && values.assigned_trainer_user_id ? values.assigned_trainer_user_id : null } : {}) };
      try { decodePhotoDataUrl(String(form.get("profile_photo_data_url") ?? "")); }
      catch (error) { return { ok: false, fieldErrors: { profile_photo_data_url: error instanceof Error ? error.message : "Choose a valid photo." } }; }
    } else if (kind === "collect") {
      details = { ...z.object({ member_id: z.uuid(), charge_id: z.uuid(), notes: z.string().max(2000), handled_by_gym_user_id: handlerSchema }).parse(values), handled_by_gym_user_id: handledBy };
    } else {
      const input = membershipSchema.parse({ ...values, starts_on: kind === "renew" ? values.renewal_date : values.starts_on, discount: values.discount || "0", gst_rate: values.gst_rate || "0" });
      details = { member_id: input.member_id, plan_id: input.plan_id, starts_on: input.starts_on, expires_on: input.expires_on, subtotal_paise: input.subtotal, discount_paise: input.discount, gst_rate_basis_points: Math.round(input.gst_rate * 100), ...(form.has("handled_by_gym_user_id") ? { handled_by_gym_user_id: handledBy } : {}), ...(form.has("assigned_trainer_user_id") ? { assigned_trainer_user_id: input.assigned_trainer_user_id || null } : {}) };
    }
    const permission = kind === "activate" ? "members.create" : kind === "collect" ? "payments.manage" : "payments.manage";
    const { supabase, gym } = await requirePermission(permission);
    const { data, error } = await supabase.rpc("submit_payment_operation", { p_request_id: requestId, p_kind: kind, p_details: details, p_payments: payments });
    if (error) {
      const field = ["plan_id", "phone", "shared_phone", "expires_on", "payments", "handled_by_gym_user_id"].includes(error.hint) ? error.hint : undefined;
      return { ok: false, fieldErrors: field ? { [field]: error.message } : {}, error: field ? undefined : error.message, ...(field === "phone" && z.uuid().safeParse(error.details).success ? { reactivateUrl: `/members/${error.details}?reactivate=1` } : {}) };
    }
    const result = z.object({ member_id: z.uuid(), operation_id: z.uuid(), payment_ids: z.array(z.uuid()) }).parse(data);
    completedMember = result.member_id;
    let warning = "";
    const assignedTrainer = typeof details.assigned_trainer_user_id === "string" && details.assigned_trainer_user_id ? details.assigned_trainer_user_id : null;
    if (kind !== "collect" && Object.prototype.hasOwnProperty.call(details, "assigned_trainer_user_id")) {
      const { error: trainerError } = await supabase.rpc("assign_member_trainer", { p_member_id: result.member_id, p_trainer_user_id: assignedTrainer });
      if (trainerError) warning += " Membership saved, but trainer assignment failed. Choose the trainer again from the member profile.";
    }
    if (kind === "activate" && form.get("profile_photo_data_url")) {
      try {
        const path = await saveMemberPhoto(supabase, gym.id, result.member_id, String(form.get("profile_photo_data_url")));
        const { error: photoError } = await supabase.from("members").update({ profile_photo_path: path }).eq("id", result.member_id).eq("gym_id", gym.id);
        if (photoError) throw photoError;
      } catch { warning = " Membership saved, but photo upload failed. Add the photo from the member profile."; }
    }
    revalidatePath("/", "layout");
    const path = result.payment_ids.length ? `/payments/${result.operation_id}` : kind === "activate" && details.generate_qr ? `/members/${result.member_id}/qr` : `/members/${result.member_id}`;
    return { ok: true, location: `${path}?success=${encodeURIComponent(`Saved successfully.${warning}`)}` };
  } catch (error) {
    if (completedMember) return { ok: true, location: `/members/${completedMember}?error=${encodeURIComponent("Saved successfully. Open membership history to review payments.")}` };
    if (error instanceof z.ZodError) return { ok: false, fieldErrors: Object.fromEntries(error.issues.map(issue => [String(issue.path[0]), issue.message])) };
    return { ok: false, fieldErrors: {}, error: "Could not confirm saving. Your entries are preserved. Retry with the same details to avoid duplicates." };
  }
}
export async function activateWithPayments(form: FormData) { return submit("activate", form); }
export async function enrollWithPayments(form: FormData) { return submit("enroll", form); }
export async function renewWithPayments(form: FormData) { return submit("renew", form); }
export async function collectPayments(form: FormData) { return submit("collect", form); }
