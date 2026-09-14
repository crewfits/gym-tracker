import { describe, expect, it } from "vitest";
import { hasPermission, type GymRole } from "@/lib/permissions";

describe("role permissions", () => {
  it("lets a receptionist open an individual receipt without granting transaction or payment access", () => {
    const receptionist = { role: "receptionist" as GymRole };

    expect(hasPermission(receptionist, "receipts.view")).toBe(true);
    expect(hasPermission(receptionist, "reminders.manage")).toBe(true);
    expect(hasPermission(receptionist, "payments.view")).toBe(false);
    expect(hasPermission(receptionist, "payments.manage")).toBe(false);
  });

  it("keeps receipt review available to payment-capable roles", () => {
    for (const role of ["owner", "trainer", "admin"] as GymRole[]) {
      expect(hasPermission({ role }, "receipts.view")).toBe(true);
    }
  });
});
