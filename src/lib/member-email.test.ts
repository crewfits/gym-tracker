import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createReceiptPdf } from "./member-email";

const gym = { id: "gym-one", name: "Muscle Fitness", currency_code: "INR" };
const membership = {
  id: "membership-one",
  plan_name: "Quarterly Plan",
  starts_on: "2026-10-01",
  expires_on: "2026-12-31",
  members: { id: "member-one", member_code: "MEM-00001", name: "Member One", email: "member@example.com", phone: "9000000000" },
};
const payment = {
  id: "payment-current",
  receipt_number: "RCT-000002",
  amount_paise: 300000,
  method: "cash",
  reference: "CURRENT-PAYMENT",
  paid_on: "2026-10-11",
  operation_id: "operation-one",
  charge_id: "charge-one",
  voided_at: null,
  payment_reversals: [],
  charges: {
    id: "charge-one",
    subtotal_paise: 500000,
    discount_paise: 0,
    tax_paise: 0,
    gst_rate_basis_points: 0,
    total_paise: 500000,
    memberships: membership,
  },
};

describe("customer receipt PDF privacy", () => {
  it("shows only net customer payments and never exposes reversal audit language", () => {
    const pdf = createReceiptPdf({
      gym,
      payment,
      currencyCode: "INR",
      consolidated: true,
      payments: [
        {
          id: "payment-voided",
          amount_paise: 200000,
          method: "upi",
          reference: "INTERNAL-VOIDED-REFERENCE",
          paid_on: "2026-10-01",
          receipt_number: "RCT-000001",
          operation_id: null,
          charge_id: "charge-one",
          voided_at: "2026-10-11T00:00:00Z",
          payment_reversals: [{ amount_paise: 200000 }],
        },
        payment,
      ],
    }).toString("utf8");

    expect(pdf).toContain("PAYMENT RECEIPT");
    expect(pdf).not.toContain("CURRENT-PAYMENT");
    expect(pdf).not.toContain("REVERSAL RECORDED");
    expect(pdf).not.toContain("Reversed:");
    expect(pdf).not.toContain("INTERNAL-VOIDED-REFERENCE");
    expect(pdf.match(/Payment received via Cash/g)).toHaveLength(1);
    expect(pdf).toContain("INR 3,000.00");
    expect(pdf).not.toContain("Total collected");
  });
});
