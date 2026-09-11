import { z } from "zod";

export const paymentMethods = ["cash", "upi", "card", "bank_transfer"] as const;
export type PaymentRow = { key: string; amount: string; method: typeof paymentMethods[number]; paid_on: string; reference: string };
export const paymentRowSchema = z.object({
  amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount with up to 2 decimal places.")
    .transform(value => Math.round(Number(value) * 100))
    .refine(value => Number.isSafeInteger(value) && value > 0, "Payment must be greater than zero."),
  method: z.enum(paymentMethods, { error: "Choose a payment method." }),
  paid_on: z.iso.date("Enter a valid payment date."),
  reference: z.string().trim().max(200, "Reference must be 200 characters or fewer."),
});
export const paymentRowsSchema = z.array(paymentRowSchema).max(10, "Use at most 10 payment entries.");
export type PaymentEntry = { amount_paise: number; method: typeof paymentMethods[number]; paid_on: string; reference: string };
export function parsePaymentRows(value: unknown): PaymentEntry[] {
  return paymentRowsSchema.parse(value).map(({ amount, ...row }) => ({ ...row, amount_paise: amount }));
}
export function paymentRowsTotal(rows: PaymentRow[]) {
  return rows.reduce((sum, row) => sum + (Number.isFinite(Number(row.amount)) ? Math.round(Number(row.amount) * 100) : 0), 0);
}
export function paymentRowsErrors(rows: PaymentRow[], balancePaise: number, required = false) {
  const parsed = paymentRowsSchema.safeParse(rows);
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const issue of parsed.error.issues) errors[issue.path.join(".")] ??= issue.message;
  if (required && !rows.length) errors.total = "Add at least one payment.";
  if (paymentRowsTotal(rows) > balancePaise) errors.total = "Total paid cannot exceed the remaining balance.";
  return errors;
}
export type SplitPaymentResult = { ok: true; location: string } | { ok: false; error?: string; fieldErrors: Record<string, string>; reactivateUrl?: string };
