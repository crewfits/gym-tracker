import { describe, expect, it } from "vitest";
import { memberValidationErrors, newMemberSchema } from "./new-member-validation";

const valid = { name: "Mira", phone: "9876543210", email: "", notes: "", plan_id: "cfc70c70-d76e-4788-af97-6a2d97479436", starts_on: "2026-09-05", expires_on: "2026-10-04", subtotal: "1000.00", discount: "0", gst_rate: "0", amount_paid: "500", method: "cash", reference: "", paid_on: "2026-09-05" };
describe("new member inline validation", () => {
  it("accepts partial payment and intentional shared phones", () => expect(newMemberSchema.parse({ ...valid, shared_phone: "on" }).amount_paid).toBe(50000));
  it.each(["1234567", "98765abc210", "", "+1234"])("rejects invalid phone %s before enrollment", phone => expect(memberValidationErrors({ ...valid, phone }).phone).toBeTruthy());
  it.each(["98765 43210", "+91 98765 43210", "+1 (212) 555-0123"])("accepts formatted phone %s", phone => expect(memberValidationErrors({ ...valid, phone })).toEqual({}));
  it("reports errors against individual required fields", () => {
    const errors = memberValidationErrors({ ...valid, name: " ", subtotal: "", paid_on: "", email: "invalid" });
    expect(Object.keys(errors).sort()).toEqual(["email", "name", "paid_on", "subtotal"]);
  });
  it("rejects impossible dates and an end before the start", () => {
    expect(memberValidationErrors({ ...valid, expires_on: "2026-02-30" }).expires_on).toBeTruthy();
    expect(memberValidationErrors({ ...valid, expires_on: "2026-09-04" }).expires_on).toBeTruthy();
  });
  it("rejects invalid money instead of coercing it to zero", () => {
    expect(memberValidationErrors({ ...valid, amount_paid: "-10" }).amount_paid).toBeTruthy();
    expect(memberValidationErrors({ ...valid, discount: "1001" }).discount).toBeTruthy();
    expect(memberValidationErrors({ ...valid, amount_paid: "1001" }).amount_paid).toBeTruthy();
    expect(memberValidationErrors({ ...valid, gst_rate: "101" }).gst_rate).toBeTruthy();
  });
});
