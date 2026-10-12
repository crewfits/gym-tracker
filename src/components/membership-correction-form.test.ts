import { describe, expect, it } from "vitest";
import { correctionValuesForPlan, type MembershipCorrectionPlan } from "./membership-correction-form";

const monthly: MembershipCorrectionPlan = {
  id: "monthly",
  name: "Monthly Plan",
  duration_value: 1,
  duration_unit: "months",
  default_fee_paise: 200000,
  is_active: true,
};

const quarterly: MembershipCorrectionPlan = {
  id: "quarterly",
  name: "Quarterly Plan",
  duration_value: 3,
  duration_unit: "months",
  default_fee_paise: 500000,
  is_active: true,
};

describe("membership correction plan defaults", () => {
  it("updates the price and expiry when correcting a monthly plan to quarterly", () => {
    expect(correctionValuesForPlan(quarterly, "2026-09-09")).toEqual({
      subtotal: "5000.00",
      expiresOn: "2026-12-08",
    });
  });

  it("updates the price and expiry when correcting a higher plan to monthly", () => {
    expect(correctionValuesForPlan(monthly, "2026-09-09")).toEqual({
      subtotal: "2000.00",
      expiresOn: "2026-10-08",
    });
  });
});
