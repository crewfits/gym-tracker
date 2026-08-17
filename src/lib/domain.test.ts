import { describe, expect, it } from "vitest";
import { calculateCharge, calculateExpiry, calculateRenewalStart, membershipStatus, paymentStatus } from "./domain";

describe("membership dates", () => {
  it("uses inclusive expiry dates", () => expect(calculateExpiry("2026-01-15", 1, "months")).toBe("2026-02-14"));
  it("handles leap-day month arithmetic", () => expect(calculateExpiry("2024-01-30", 1, "months")).toBe("2024-02-28"));
  it("preserves paid time for early renewals", () => expect(calculateRenewalStart("2026-08-31", "2026-08-14")).toBe("2026-09-01"));
  it("starts late renewals on renewal date", () => expect(calculateRenewalStart("2026-07-31", "2026-08-14")).toBe("2026-08-14"));
});

describe("finance", () => {
  it("applies discount before GST with integer rounding", () => expect(calculateCharge(100_00, 10_00, 1800)).toEqual({ subtotalPaise: 10000, discountPaise: 1000, gstRateBasisPoints: 1800, taxPaise: 1620, totalPaise: 10620 }));
  it("derives balance states", () => { expect(paymentStatus(1000, 0)).toBe("unpaid"); expect(paymentStatus(1000, 400)).toBe("partial"); expect(paymentStatus(1000, 1000)).toBe("paid"); });
});

describe("status", () => {
  it("derives upcoming, active, expiring and expired", () => { expect(membershipStatus("2026-09-01", "2026-09-30", "2026-08-14")).toBe("upcoming"); expect(membershipStatus("2026-01-01", "2026-09-01", "2026-08-14")).toBe("active"); expect(membershipStatus("2026-01-01", "2026-08-20", "2026-08-14")).toBe("expiring"); expect(membershipStatus("2026-01-01", "2026-08-13", "2026-08-14")).toBe("expired"); });
});
