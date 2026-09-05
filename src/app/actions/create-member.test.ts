import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, requireGym, queries } = vi.hoisted(() => ({ db: { from: vi.fn(), rpc: vi.fn() }, requireGym: vi.fn(), queries: [] as Array<{ table: string; eq: ReturnType<typeof vi.fn> }> }));
vi.mock("@/lib/auth", () => ({ requireGym }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("Unexpected redirect on failed enrollment"); }) }));
vi.mock("@/lib/app-origin", () => ({ requestAppOrigin: vi.fn() }));
vi.mock("@/lib/receipt-token", () => ({ createReceiptToken: vi.fn() }));
import { createMember } from "./core";
const valid = { name: "Test Member", phone: "9876543210", email: "", notes: "Keep my notes", plan_id: "cfc70c70-d76e-4788-af97-6a2d97479436", starts_on: "2026-09-05", expires_on: "2026-10-04", subtotal: "1000", discount: "0", gst_rate: "0", amount_paid: "0", method: "cash", reference: "", paid_on: "2026-09-05" };
function form(overrides: Record<string, string> = {}) { const data = new FormData(); for (const [key, value] of Object.entries({ ...valid, ...overrides })) data.set(key, value); return data; }
function setup(duplicates: Array<{ id: string; name: string; member_code: string; is_archived: boolean }> = [], error: unknown = null) {
  db.from.mockImplementation((table: string) => {
    const response = table === "members" ? { data: duplicates, error } : { data: { duration_value: 1, duration_unit: "months" }, error: null };
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue(response), update: vi.fn().mockReturnThis(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve) };
    queries.push({ table, eq: query.eq }); return query;
  });
}
const duplicate = { id: "existing", name: "Santhosh", member_code: "MEM-00001", is_archived: false };
beforeEach(() => { vi.clearAllMocks(); queries.length = 0; requireGym.mockResolvedValue({ supabase: db, gym: { id: "gym-one" } }); setup(); db.rpc.mockResolvedValue({ data: { member_id: "created" }, error: null }); });
describe("member enrollment failures and shared phones", () => {
  it("returns field errors without attempting enrollment", async () => { const result = await createMember(form({ phone: "abc" })); expect(result).toMatchObject({ ok: false, fieldErrors: { phone: expect.any(String) } }); expect(db.rpc).not.toHaveBeenCalled(); });
  it("requires shared-phone consent and scopes lookups to the gym", async () => { setup([duplicate]); const result = await createMember(form()); expect(result).toMatchObject({ ok: false, fieldErrors: { shared_phone: expect.stringContaining("Santhosh") } }); expect(queries[0].eq).toHaveBeenCalledWith("gym_id", "gym-one"); expect(db.rpc).not.toHaveBeenCalled(); });
  it("allows a third member after confirmation", async () => { setup([duplicate, { ...duplicate, id: "second" }]); expect(await createMember(form({ shared_phone: "on" }))).toMatchObject({ ok: true }); expect(db.rpc).toHaveBeenCalledWith("create_member_with_enrollment", expect.objectContaining({ p_phone: "9876543210", p_notes: "Keep my notes" })); });
  it("rejects a fourth member even with confirmation", async () => { setup([duplicate, duplicate, duplicate]); expect(await createMember(form({ shared_phone: "on" }))).toMatchObject({ ok: false, fieldErrors: { phone: expect.stringContaining("3 members") } }); expect(db.rpc).not.toHaveBeenCalled(); });
  it("offers archived reactivation without navigating away from the form", async () => { setup([{ ...duplicate, is_archived: true }]); expect(await createMember(form({ shared_phone: "on" }))).toMatchObject({ ok: false, reactivateUrl: "/members/existing?reactivate=1" }); expect(db.rpc).not.toHaveBeenCalled(); });
  it("returns database failures without redirecting or modifying submitted data", async () => { db.rpc.mockResolvedValue({ data: null, error: { message: "Database unavailable" } }); const data = form(); expect(await createMember(data)).toEqual({ ok: false, fieldErrors: {}, error: "Database unavailable" }); expect(data.get("notes")).toBe("Keep my notes"); });
  it("does not create anything when the duplicate lookup fails", async () => { setup([], { message: "Lookup unavailable" }); expect(await createMember(form())).toMatchObject({ ok: false }); expect(db.rpc).not.toHaveBeenCalled(); });
});
