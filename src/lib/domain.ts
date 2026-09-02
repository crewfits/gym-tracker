import { addDays, addMonths, differenceInCalendarDays, format, parseISO, subDays } from "date-fns";
import type { AttendanceDirection, DurationUnit, MembershipStatus, PaymentStatus } from "./types";

export function formatDate(date: Date): string { return format(date, "yyyy-MM-dd"); }

export function formatDisplayDate(value: string | null | undefined): string {
  return value ? format(parseISO(value), "d MMM yyyy") : "—";
}

export function formatDisplayDateTime(value: string | null | undefined, timeZone: string, includeSeconds = false): string {
  if (!value) return "—";
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hour12: true,
  }).formatToParts(new Date(value)).reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
  const time = `${parts.hour}:${parts.minute}${includeSeconds ? `:${parts.second}` : ""} ${parts.dayPeriod.toLowerCase()}`;
  return `${parts.day} ${parts.month} ${parts.year}, ${time}`;
}

export function planDurationDays(plan: { duration_value: number; duration_unit: DurationUnit }): number {
  return plan.duration_unit === "months" ? plan.duration_value * 31 : plan.duration_value;
}

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

export function calculatePaymentFollowUpDate(startDate: string): string {
  return formatDate(addDays(parseISO(startDate), 7));
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

export function businessDate(timeZone: string, date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function selectEffectiveMembership<T extends { starts_on: string; expires_on: string; created_at?: string }>(memberships: T[], today: string): T | undefined {
  const rank = (membership: T) => membership.starts_on <= today && membership.expires_on >= today ? 0 : membership.starts_on > today ? 1 : 2;
  return [...memberships].sort((left, right) => {
    const rankDifference = rank(left) - rank(right);
    if (rankDifference) return rankDifference;
    if (rank(left) === 1) {
      const startDifference = left.starts_on.localeCompare(right.starts_on);
      if (startDifference) return startDifference;
    }
    const expiryDifference = right.expires_on.localeCompare(left.expires_on);
    if (expiryDifference) return expiryDifference;
    return (right.created_at ?? "").localeCompare(left.created_at ?? "");
  })[0];
}

export type MemberOperationalStatus = MembershipStatus | "not_enrolled";

export function memberOperationalView<T extends { starts_on: string; expires_on: string; created_at?: string }>(memberships: T[], today: string, expiringWindow = 7): { membership?: T; status: MemberOperationalStatus } {
  const activeMemberships = memberships.filter((membership) => membership.starts_on <= today && membership.expires_on >= today);
  const futureMemberships = memberships.filter((membership) => membership.starts_on > today);
  const expiredMemberships = memberships.filter((membership) => membership.expires_on < today);
  const newest = (left: T, right: T) => right.expires_on.localeCompare(left.expires_on) || (right.created_at ?? "").localeCompare(left.created_at ?? "");
  const earliest = (left: T, right: T) => left.starts_on.localeCompare(right.starts_on) || (left.created_at ?? "").localeCompare(right.created_at ?? "");
  const current = [...activeMemberships].sort(newest)[0];
  const future = [...futureMemberships].sort(earliest)[0];
  const expired = [...expiredMemberships].sort(newest)[0];

  if (current) {
    return {
      membership: future ?? current,
      status: future ? "active" : membershipStatus(current.starts_on, current.expires_on, today, expiringWindow),
    };
  }
  if (future) return { membership: future, status: "upcoming" };
  if (expired) return { membership: expired, status: "expired" };
  return { status: "not_enrolled" };
}

export function formatInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
}

export function formatPaymentMethod(method: string): string {
  return ({ cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank Transfer" } as Record<string, string>)[method] ?? method;
}

export function attendanceLabel(direction: AttendanceDirection): "Check-in" | "Check-out" {
  return direction === "entry" ? "Check-in" : "Check-out";
}

export function nextAttendanceDirection(
  lastDirection: AttendanceDirection | null,
  lastBusinessDate: string | null,
  today: string,
): AttendanceDirection {
  if (!lastDirection || lastBusinessDate !== today) return "entry";
  return lastDirection === "entry" ? "exit" : "entry";
}
