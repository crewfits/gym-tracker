import { describe, expect, it } from "vitest";
import { parsePaymentRows, paymentRowsErrors, paymentRowsTotal, type PaymentRow } from "./split-payments";
const row: PaymentRow = { key: "one", amount: "100.10", method: "upi", paid_on: "2026-09-11", reference: " tx-1 " };
describe("split payment validation", () => {
  it("converts each row to paise and preserves method, date and reference", () => {
    expect(parsePaymentRows([row, { ...row, amount: "50", method: "cash" }])).toEqual([
      { amount_paise: 10010, method: "upi", paid_on: row.paid_on, reference: "tx-1" },
      { amount_paise: 5000, method: "cash", paid_on: row.paid_on, reference: "tx-1" },
    ]);
    expect(paymentRowsTotal([row, { ...row, amount: "0.20" }])).toBe(10030);
  });
  it.each(["", "0", "-1", "1.001", "1e3", "Infinity", "9007199254740992"])("rejects invalid amount %s", amount => {
    expect(paymentRowsErrors([{ ...row, amount }], Number.MAX_SAFE_INTEGER)["0.amount"]).toBeTruthy();
  });
  it("rejects malformed dates, methods, references and too many rows", () => {
    expect(() => parsePaymentRows([{ ...row, paid_on: "2026-02-30" }])).toThrow();
    expect(() => parsePaymentRows([{ ...row, method: "other" }])).toThrow();
    expect(() => parsePaymentRows([{ ...row, reference: "a".repeat(201) }])).toThrow();
    expect(() => parsePaymentRows(Array(11).fill(row))).toThrow();
  });
  it("allows unpaid memberships but requires collection and rejects aggregate overpayment", () => {
    expect(paymentRowsErrors([], 10000)).toEqual({});
    expect(paymentRowsErrors([], 10000, true).total).toBeTruthy();
    expect(paymentRowsErrors([row, row], 15000).total).toBeTruthy();
    expect(paymentRowsErrors([row], 10010)).toEqual({});
  });
});
