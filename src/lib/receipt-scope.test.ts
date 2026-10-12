import { describe, expect, it } from "vitest";
import { customerReceiptSummary } from "./receipt-scope";

const payments = [
  {
    id: "original",
    amount_paise: 550000,
    method: "cash",
    reference: "old-reference",
    voided_at: null,
    payment_reversals: [{ amount_paise: 350000 }],
  },
  {
    id: "correction-one",
    amount_paise: 350000,
    method: "cash",
    reference: null,
    voided_at: null,
    payment_reversals: [],
  },
  {
    id: "correction-two",
    amount_paise: 450000,
    method: "cash",
    reference: null,
    voided_at: null,
    payment_reversals: [],
  },
];

describe("customer receipt summary", () => {
  it("collapses a corrected membership into one final customer payment line", () => {
    expect(customerReceiptSummary(payments, true)).toEqual({
      totalReceivedPaise: 1000000,
      lines: [{
        id: "corrected-final-payment",
        amountPaise: 1000000,
        method: "cash",
        reference: null,
      }],
    });
  });

  it("preserves ordinary split-payment receipt lines", () => {
    expect(customerReceiptSummary(payments.slice(1), false)).toEqual({
      totalReceivedPaise: 800000,
      lines: [
        { id: "correction-one", amountPaise: 350000, method: "cash", reference: null },
        { id: "correction-two", amountPaise: 450000, method: "cash", reference: null },
      ],
    });
  });
});
