import { describe, expect, it } from "vitest";
import { attendanceLabel, businessDate, calculateCharge, calculateExpiry, calculatePaymentFollowUpDate, calculateRenewalStart, formatDisplayDate, formatDisplayDateTime, membershipStatus, nextAttendanceDirection, paymentStatus, planDurationDays, selectEffectiveMembership } from "./domain";

describe("membership dates", () => {
  it("uses inclusive expiry dates", () => expect(calculateExpiry("2026-01-15", 1, "months")).toBe("2026-02-14"));
  it("handles leap-day month arithmetic", () => expect(calculateExpiry("2024-01-30", 1, "months")).toBe("2024-02-28"));
  it("preserves paid time for early renewals", () => expect(calculateRenewalStart("2026-08-31", "2026-08-14")).toBe("2026-09-01"));
  it("starts late renewals on renewal date", () => expect(calculateRenewalStart("2026-07-31", "2026-08-14")).toBe("2026-08-14"));
  it("sets payment follow-up seven days after membership start", () => expect(calculatePaymentFollowUpDate("2026-08-23")).toBe("2026-08-30"));
  it("formats visible dates as day month year", () => expect(formatDisplayDate("2026-08-31")).toBe("31 08 2026"));
  it("formats visible timestamps as day month year with local time", () => expect(formatDisplayDateTime("2026-08-31T12:34:56.000Z", "UTC", true)).toBe("31 08 2026, 12:34:56"));
});

describe("plans", () => {
  it("normalizes plan durations for descending display", () => {
    expect(planDurationDays({ duration_value: 1, duration_unit: "months" })).toBeGreaterThan(planDurationDays({ duration_value: 7, duration_unit: "days" }));
  });
});

describe("finance", () => {
  it("applies discount before GST with integer rounding", () => expect(calculateCharge(100_00, 10_00, 1800)).toEqual({ subtotalPaise: 10000, discountPaise: 1000, gstRateBasisPoints: 1800, taxPaise: 1620, totalPaise: 10620 }));
  it("derives balance states", () => { expect(paymentStatus(1000, 0)).toBe("unpaid"); expect(paymentStatus(1000, 400)).toBe("partial"); expect(paymentStatus(1000, 1000)).toBe("paid"); });
});

describe("status", () => {
  it("derives upcoming, active, expiring and expired", () => { expect(membershipStatus("2026-09-01", "2026-09-30", "2026-08-14")).toBe("upcoming"); expect(membershipStatus("2026-01-01", "2026-09-01", "2026-08-14")).toBe("active"); expect(membershipStatus("2026-01-01", "2026-08-20", "2026-08-14")).toBe("expiring"); expect(membershipStatus("2026-01-01", "2026-08-13", "2026-08-14")).toBe("expired"); });
  it("uses the gym timezone for business dates", () => {
    const instant = new Date("2026-08-18T20:00:00.000Z");
    expect(businessDate("Asia/Kolkata", instant)).toBe("2026-08-19");
    expect(businessDate("America/New_York", instant)).toBe("2026-08-18");
  });
  it("keeps a current membership effective when a future renewal exists", () => {
    const current = { id: "current", starts_on: "2026-08-01", expires_on: "2026-08-31" };
    const renewal = { id: "renewal", starts_on: "2026-09-01", expires_on: "2026-09-30" };
    expect(selectEffectiveMembership([renewal, current], "2026-08-20")?.id).toBe("current");
    expect(selectEffectiveMembership([renewal, current], "2026-09-05")?.id).toBe("renewal");
  });
});

describe("attendance direction", () => {
  it("uses owner-friendly labels without changing stored values", () => {
    expect(attendanceLabel("entry")).toBe("Check-in");
    expect(attendanceLabel("exit")).toBe("Check-out");
  });

  it("starts each gym-local day with entry", () => {
    expect(nextAttendanceDirection(null, null, "2026-08-19")).toBe("entry");
    expect(nextAttendanceDirection("entry", "2026-08-18", "2026-08-19")).toBe("entry");
  });

  it("alternates entry and exit within the same day", () => {
    expect(nextAttendanceDirection("entry", "2026-08-19", "2026-08-19")).toBe("exit");
    expect(nextAttendanceDirection("exit", "2026-08-19", "2026-08-19")).toBe("entry");
  });
});
