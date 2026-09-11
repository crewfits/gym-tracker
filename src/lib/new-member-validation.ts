import { z } from "zod";

const required = (label: string) => z.string().trim().min(1, `${label} is required.`);
const amount = (label: string) => required(label).refine(v => /^\d+(\.\d{1,2})?$/.test(v), `${label} must be a positive amount or zero, with at most 2 decimal places.`).transform(v => Math.round(Number(v) * 100));
export const newMemberSchema = z.object({
  name: required("Full name"),
  phone: required("Phone number").refine(v => /^\+?[\d\s()-]+$/.test(v) && (v.startsWith("+") ? v.replace(/\D/g, "").length >= 10 && v.replace(/\D/g, "").length <= 15 : /^\d{10}$/.test(v.replace(/\D/g, ""))), "Enter a 10-digit phone number, or include + and the country code for an international number."),
  email: z.email("Enter a valid email address.").or(z.literal("")), notes: z.string(),
  generate_qr: z.string().optional(), whatsapp_reminders_enabled: z.string().optional(), shared_phone: z.string().optional(),
  assigned_trainer_user_id: z.uuid("Select an active trainer.").or(z.literal("")).optional(),
  plan_id: z.uuid("Select a membership plan."),
  starts_on: z.iso.date("Enter a valid start date."), expires_on: z.iso.date("Enter a valid end date."),
  due_on: z.iso.date().optional(),
  subtotal: amount("Base plan price"), discount: z.preprocess(v => v === "" ? "0" : v, amount("Discount")), amount_paid: amount("Amount paid"),
  gst_rate: z.preprocess(v => v === "" ? "0" : v, required("GST rate").refine(v => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 100, "GST rate must be between 0 and 100.").transform(Number)),
  method: z.enum(["cash", "upi", "card", "bank_transfer"], { error: "Select a payment method." }),
  reference: z.string(), paid_on: z.iso.date("Enter a valid payment date."),
}).superRefine((value, ctx) => {
  if (value.expires_on < value.starts_on) ctx.addIssue({ code: "custom", path: ["expires_on"], message: "End date must be on or after the start date." });
  if (typeof value.subtotal !== "number" || typeof value.discount !== "number" || typeof value.amount_paid !== "number" || typeof value.gst_rate !== "number") return;
  if (value.discount > value.subtotal) ctx.addIssue({ code: "custom", path: ["discount"], message: "Discount cannot exceed the base plan price." });
  const taxable = value.subtotal - value.discount;
  const total = taxable + Math.round(taxable * value.gst_rate / 100);
  if (value.amount_paid > total) ctx.addIssue({ code: "custom", path: ["amount_paid"], message: "Amount paid cannot exceed the membership total." });
});
export type MemberFieldErrors = Record<string, string>;
export type CreateMemberResult = { ok: true; location: string } | { ok: false; fieldErrors: MemberFieldErrors; error?: string; reactivateUrl?: string };
export function memberValidationErrors(values: Record<string, unknown>): MemberFieldErrors {
  const parsed = newMemberSchema.safeParse(values);
  if (parsed.success) return {};
  const errors: MemberFieldErrors = {};
  for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
  return errors;
}
