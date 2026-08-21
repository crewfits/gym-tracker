import { addDays, addMonths, differenceInCalendarDays, format, parseISO, subDays } from "date-fns";
import type { DurationUnit, MembershipStatus, PaymentStatus } from "./types";

export function formatDate(date: Date): string { return format(date, "yyyy-MM-dd"); }

export function calculateExpiry(startDate: string, value: number, unit: DurationUnit): string {
  if (!Number.isInteger(value) || value <= 0) throw new Error("Duration must be a positive whole number");
  const start = parseISO(startDate);
  const endExclusive = unit === "months" ? addMonths(start, value) : addDays(start, value);
  return formatDate(subDays(endExclusive, 1));
}

export function calculateRenewalStart(currentExpiry: string | null, renewalDate: string): string {
  if (!currentExpiry) return renewalDate;
  return currentExpiry >= renewalDate ? formatDate(addDays(parseISO(currentExpiry), 1)) : renewalDate;
}

export function calculateCharge(subtotalPaise: number, discountPaise: number, gstRateBasisPoints: number) {
  for (const value of [subtotalPaise, discountPaise, gstRateBasisPoints]) if (!Number.isInteger(value) || value < 0) throw new Error("Money and tax values must be non-negative integers");
  if (discountPaise > subtotalPaise) throw new Error("Discount cannot exceed subtotal");
  const taxablePaise = subtotalPaise - discountPaise;
  const taxPaise = Math.round((taxablePaise * gstRateBasisPoints) / 10_000);
  return { subtotalPaise, discountPaise, gstRateBasisPoints, taxPaise, totalPaise: taxablePaise + taxPaise };
}

export function paymentStatus(totalPaise: number, paidPaise: number): PaymentStatus {
  if (paidPaise <= 0) return "unpaid";
  if (paidPaise < totalPaise) return "partial";
  return "paid";
}

export function membershipStatus(start: string, expiry: string, today: string, expiringWindow = 7): MembershipStatus {
  if (start > today) return "upcoming";
  if (expiry < today) return "expired";
  return differenceInCalendarDays(parseISO(expiry), parseISO(today)) <= expiringWindow ? "expiring" : "active";
}

export function formatInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
}

export function formatPaymentMethod(method: string): string {
  return ({ cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank Transfer" } as Record<string, string>)[method] ?? method;
}
