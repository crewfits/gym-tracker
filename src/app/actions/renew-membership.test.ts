import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, redirect } = vi.hoisted(() => ({ db: { from: vi.fn(), rpc: vi.fn() }, redirect: vi.fn((url: string) => { throw Object.assign(new Error(url), { digest: "NEXT_REDIRECT" }); }) }));
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn(async () => ({ supabase: db, gym: { id: "gym-one" } })) }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/app-origin", () => ({ requestAppOrigin: vi.fn() }));
vi.mock("@/lib/receipt-token", () => ({ createReceiptToken: vi.fn() }));

import { renewMembership } from "./core";

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ member_id: "member-one", return_path: "/members/member-one?view=membership", plan_id: "cfc70c70-d76e-4788-af97-6a2d97479436", renewal_date: "2026-09-05", expires_on: "2026-10-04", subtotal: "1000", discount: "0", gst_rate: "0", amount_paid: "0", method: "cash", reference: "" })) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.from.mockImplementation((table: string) => {
    const result = { data: table === "plans" ? { duration_value: 1, duration_unit: "months" } : table === "charges" ? { id: "charge-new" } : { expires_on: "2026-08-31" }, error: null };
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue(result), maybeSingle: vi.fn().mockResolvedValue(result) };
  });
});

describe("renewal feedback navigation", () => {
  it("preserves the membership view and readable database error", async () => {
    db.rpc.mockResolvedValue({ error: { message: "Membership dates overlap" } });
    await expect(renewMembership(form())).rejects.toThrow();
    const url = new URL(redirect.mock.calls[0][0], "http://localhost");
    expect(url.pathname).toBe("/members/member-one");
    expect(url.searchParams.get("view")).toBe("membership");
    expect(url.searchParams.get("error")).toBe("Membership dates overlap");
  });

  it("returns unpaid renewal success to membership without turning the redirect into an error", async () => {
    db.rpc.mockResolvedValue({ data: "membership-new", error: null });
    await expect(renewMembership(form())).rejects.toThrow();
    expect(redirect).toHaveBeenCalledTimes(1);
    const url = new URL(redirect.mock.calls[0][0], "http://localhost");
    expect(url.searchParams.get("view")).toBe("membership");
    expect(url.searchParams.get("success")).toBe("Renewal created with payment pending");
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it("warns against another renewal when payment fails after membership creation", async () => {
    db.rpc.mockResolvedValueOnce({ data: "membership-new", error: null }).mockResolvedValueOnce({ error: { message: "Payment service unavailable" } });
    const data = form();
    data.set("amount_paid", "400");
    data.delete("return_path");
    await expect(renewMembership(data)).rejects.toThrow();
    expect(redirect).toHaveBeenCalledTimes(1);
    const url = new URL(redirect.mock.calls[0][0], "http://localhost");
    expect(url.pathname).toBe("/members/member-one");
    expect(url.searchParams.get("view")).toBe("membership");
    expect(url.searchParams.get("error")).toContain("Renewal already created");
    expect(url.searchParams.get("error")).toContain("do not renew again");
    expect(url.searchParams.get("error")).toContain("Payment service unavailable");
  });

  it("opens combined sharing after recording the partial renewal payment", async () => {
    db.rpc.mockResolvedValueOnce({ data: "membership-new", error: null }).mockResolvedValueOnce({ data: { id: "payment-new" }, error: null });
    const data = form();
    data.set("amount_paid", "400");
    await expect(renewMembership(data)).rejects.toThrow();
    expect(redirect).toHaveBeenCalledTimes(1);
    const url = new URL(redirect.mock.calls[0][0], "http://localhost");
    expect(url.pathname).toBe("/members/member-one/qr");
    expect(url.searchParams.has("error")).toBe(false);
    expect(db.rpc).toHaveBeenLastCalledWith("record_payment", expect.objectContaining({ p_charge_id: "charge-new", p_amount_paise: 40000 }));
  });

  it("keeps a missing receipt response out of the renewal retry flow", async () => {
    db.rpc.mockResolvedValueOnce({ data: "membership-new", error: null }).mockResolvedValueOnce({ data: null, error: null });
    const data = form();
    data.set("amount_paid", "400");
    await expect(renewMembership(data)).rejects.toThrow();
    const url = new URL(redirect.mock.calls[0][0], "http://localhost");
    expect(url.pathname).toBe("/members/member-one");
    expect(url.searchParams.get("error")).toContain("Review its balance and receipts");
  });
});
