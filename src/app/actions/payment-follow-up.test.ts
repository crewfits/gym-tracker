import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, lookup, mutation, redirect } = vi.hoisted(() => ({
  db: { from: vi.fn() },
  lookup: { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), maybeSingle: vi.fn() },
  mutation: { update: vi.fn().mockReturnThis(), eq: vi.fn() },
  redirect: vi.fn((url: string) => { throw Object.assign(new Error(url), { digest: "NEXT_REDIRECT" }); }),
}));
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn(async () => ({ supabase: db, gym: { id: "gym-one" } })) }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/app-origin", () => ({ requestAppOrigin: vi.fn() }));
vi.mock("@/lib/receipt-token", () => ({ createReceiptToken: vi.fn() }));
import { updateChargeDueDate } from "./core";

const chargeId = "cfc70c70-d76e-4788-af97-6a2d97479436";
function form(returnPath = "/reminders?filter=payments") {
  const data = new FormData();
  for (const [key, value] of Object.entries({ member_id: "member-one", charge_id: chargeId, due_on: "2026-09-12", return_path: returnPath })) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  db.from.mockReset().mockReturnValueOnce(lookup).mockReturnValue(mutation);
  lookup.maybeSingle.mockResolvedValue({ data: { id: chargeId }, error: null });
  mutation.eq.mockReset().mockReturnValueOnce(mutation).mockResolvedValue({ error: null });
});

describe("rescheduling a payment follow-up", () => {
  it("checks gym, member and active period before updating and returns to the payment queue", async () => {
    await expect(updateChargeDueDate(form())).rejects.toThrow();
    expect(lookup.eq).toHaveBeenCalledWith("gym_id", "gym-one");
    expect(lookup.eq).toHaveBeenCalledWith("memberships.member_id", "member-one");
    expect(lookup.is).toHaveBeenCalledWith("memberships.reverted_at", null);
    expect(mutation.update).toHaveBeenCalledWith({ due_on: "2026-09-12" });
    expect(mutation.eq).toHaveBeenCalledWith("gym_id", "gym-one");
    expect(redirect).toHaveBeenCalledTimes(1);
    const url = new URL(redirect.mock.calls[0][0], "http://localhost");
    expect(url.pathname).toBe("/reminders");
    expect(url.searchParams.get("filter")).toBe("payments");
    expect(url.searchParams.get("success")).toBe("Payment follow-up date updated");
  });
  it("does not change a charge absent from the member's allowed records", async () => {
    lookup.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(updateChargeDueDate(form())).rejects.toThrow();
    expect(mutation.update).not.toHaveBeenCalled();
    expect(new URL(redirect.mock.calls[0][0], "http://localhost").searchParams.get("error")).toBe("Membership charge not found");
  });
  it("ignores an unapproved return destination", async () => {
    await expect(updateChargeDueDate(form("https://example.com"))).rejects.toThrow();
    expect(new URL(redirect.mock.calls[0][0], "http://localhost").pathname).toBe("/members/member-one");
  });
});
