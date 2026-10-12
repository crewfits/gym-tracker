import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, requirePermission, redirect, revalidatePath } = vi.hoisted(() => ({
  db: { rpc: vi.fn() },
  requirePermission: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requirePermission }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/app-origin", () => ({ requestAppOrigin: vi.fn() }));
vi.mock("@/lib/receipt-token", () => ({ createReceiptToken: vi.fn() }));

import { correctMembershipHistory } from "./core";

const requestId = "40000000-0000-4000-8000-000000000001";
const memberId = "41000000-0000-4000-8000-000000000001";
const membershipId = "42000000-0000-4000-8000-000000000001";
const planId = "43000000-0000-4000-8000-000000000001";
const paymentId = "44000000-0000-4000-8000-000000000001";

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    request_id: requestId,
    member_id: memberId,
    membership_id: membershipId,
    plan_id: planId,
    starts_on: "2026-09-10",
    expires_on: "2026-12-09",
    subtotal: "5000",
    discount: "0",
    gst_rate: "0",
    amount_paid: "5000",
    method: "cash",
    paid_on: "2026-10-10",
    reference: "",
    reason: "Wrong plan selected during activation",
    ...overrides,
  })) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ supabase: db, gym: { id: "gym-one" }, role: "owner" });
  db.rpc.mockResolvedValue({ data: { payment_ids: [paymentId], reversed_paise: 0, balance_paise: 0 }, error: null });
});

describe("owner membership financial correction", () => {
  it("submits one final amount paid through the atomic correction function", async () => {
    const result = await correctMembershipHistory(form());
    expect(db.rpc).toHaveBeenCalledWith("correct_membership_with_final_payment", {
      p_request_id: requestId,
      p_member_id: memberId,
      p_membership_id: membershipId,
      p_plan_id: planId,
      p_starts_on: "2026-09-10",
      p_expires_on: "2026-12-09",
      p_subtotal_paise: 500000,
      p_discount_paise: 0,
      p_gst_rate_basis_points: 0,
      p_tax_paise: 0,
      p_total_paise: 500000,
      p_target_paid_paise: 500000,
      p_method: "cash",
      p_paid_on: "2026-10-10",
      p_reference: "",
      p_reason: "Wrong plan selected during activation",
    });
    expect(result).toEqual(expect.objectContaining({ ok: true, location: expect.stringContaining(`/receipts/${paymentId}`) }));
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("returns to history when a lower corrected amount only needs an audited reversal", async () => {
    db.rpc.mockResolvedValue({ data: { payment_ids: [], reversed_paise: 50000, balance_paise: 0 }, error: null });
    const result = await correctMembershipHistory(form({ subtotal: "1500", amount_paid: "1500" }));
    expect(result).toEqual(expect.objectContaining({ ok: true, location: expect.stringContaining("view=history") }));
    if (result.ok) expect(result.location).toContain("Excess%20payment%20was%20reversed");
  });

  it("allows a partial correction payment and keeps the remainder outstanding", async () => {
    db.rpc.mockResolvedValue({ data: { payment_ids: [paymentId], reversed_paise: 0, balance_paise: 200000 }, error: null });
    const result = await correctMembershipHistory(form({ amount_paid: "3000" }));
    expect(db.rpc).toHaveBeenCalledWith("correct_membership_with_final_payment", expect.objectContaining({
      p_target_paid_paise: 300000,
    }));
    expect(result).toEqual(expect.objectContaining({ ok: true, location: expect.stringContaining(`/receipts/${paymentId}`) }));
  });

  it("allows the correction without collecting payment and leaves the balance due", async () => {
    db.rpc.mockResolvedValue({ data: { payment_ids: [], reversed_paise: 0, balance_paise: 300000 }, error: null });
    const result = await correctMembershipHistory(form({ amount_paid: "2000" }));
    expect(result).toEqual(expect.objectContaining({ ok: true, location: expect.stringContaining("view=history") }));
    if (result.ok) expect(result.location).toContain("A%20balance%20remains%20due");
  });

  it("blocks staff before any database correction is attempted", async () => {
    requirePermission.mockResolvedValue({ supabase: db, gym: { id: "gym-one" }, role: "receptionist" });
    const result = await correctMembershipHistory(form());
    expect(db.rpc).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, fieldErrors: {}, error: "Only the gym owner can correct saved membership history" });
  });

  it("rejects an end date before the start date before database writes", async () => {
    const result = await correctMembershipHistory(form({ expires_on: "2026-09-09" }));
    expect(db.rpc).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, fieldErrors: { expires_on: "Membership end date cannot be before the start date" } });
  });

  it("rejects an amount paid above the corrected plan total", async () => {
    const result = await correctMembershipHistory(form({ amount_paid: "5000.01" }));
    expect(db.rpc).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, fieldErrors: { amount_paid: "Amount paid cannot exceed the plan total." } });
  });
});
