import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), requirePermission: vi.fn(), revalidatePath: vi.fn(), savePhoto: vi.fn(), decodePhoto: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/member-photo-upload", () => ({ saveMemberPhoto: mocks.savePhoto, decodePhotoDataUrl: mocks.decodePhoto }));
import { activateWithPayments, collectPayments, enrollWithPayments, renewWithPayments } from "./split-payments";
const member = "41000000-0000-4000-8000-000000000001";
const operation = "51000000-0000-4000-8000-000000000001";
function form(extra: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ request_id: operation, member_id: member, charge_id: member, plan_id: member, starts_on: "2026-09-11", renewal_date: "2026-09-11", expires_on: "2026-10-10", subtotal: "1000", discount: "0", gst_rate: "0", name: "Member", phone: "9876543210", email: "", notes: "", payments: JSON.stringify([{ amount: "300", method: "upi", paid_on: "2026-09-10", reference: "UPI-1" }, { amount: "200", method: "cash", paid_on: "2026-09-11", reference: "" }]), ...extra })) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requirePermission.mockResolvedValue({ supabase: { rpc: mocks.rpc, from: mocks.from }, gym: { id: member }, viewer: { role: "owner", features: {}, adminFeatures: {} } });
  mocks.rpc.mockResolvedValue({ data: { member_id: member, operation_id: operation, payment_ids: [member, operation] }, error: null });
});
describe("atomic split-payment actions", () => {
  it.each([["activate", activateWithPayments], ["enroll", enrollWithPayments], ["renew", renewWithPayments], ["collect", collectPayments]] as const)("saves %s through one transactional RPC", async (kind, action) => {
    expect(await action(form())).toEqual({ ok: true, location: `/payments/${operation}?success=Saved%20successfully.` });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("submit_payment_operation", expect.objectContaining({ p_request_id: operation, p_kind: kind, p_payments: [
      { amount_paise: 30000, method: "upi", paid_on: "2026-09-10", reference: "UPI-1" },
      { amount_paise: 20000, method: "cash", paid_on: "2026-09-11", reference: "" },
    ] }));
  });
  it("allows no-payment renewal and rejects empty collection", async () => {
    mocks.rpc.mockResolvedValue({ data: { member_id: member, operation_id: operation, payment_ids: [] }, error: null });
    expect(await renewWithPayments(form({ payments: "[]" }))).toMatchObject({ ok: true });
    expect(await collectPayments(form({ payments: "[]" }))).toMatchObject({ ok: false, fieldErrors: { payments: expect.any(String) } });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("opens the QR handoff after activation when QR generation is selected", async () => {
    expect(await activateWithPayments(form({ generate_qr: "on" }))).toEqual({ ok: true, location: `/members/${member}/qr?success=Saved%20successfully.` });
  });
  it("includes the optional old member ID in a new-member operation", async () => {
    await activateWithPayments(form({ old_member_id: "REGISTER-104" }));
    expect(mocks.rpc).toHaveBeenCalledWith("submit_payment_operation", expect.objectContaining({
      p_kind: "activate",
      p_details: expect.objectContaining({ old_member_id: "REGISTER-104" }),
    }));
  });
  it("keeps receptionist activation away from the restricted payment summary", async () => {
    mocks.requirePermission.mockResolvedValue({ supabase: { rpc: mocks.rpc, from: mocks.from }, gym: { id: member }, viewer: { role: "receptionist", features: {}, adminFeatures: {} } });
    expect(await activateWithPayments(form())).toEqual({ ok: true, location: `/members/${member}?success=Saved%20successfully.` });
    expect(await activateWithPayments(form({ generate_qr: "on" }))).toEqual({ ok: true, location: `/members/${member}/qr?success=Saved%20successfully.` });
  });
  it("rejects malformed payments before database writes", async () => {
    expect(await activateWithPayments(form({ payments: "not-json" }))).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns field feedback for database validation and preserves the request on retries", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: "Confirm shared phone", hint: "shared_phone" } });
    const data = form();
    expect(await activateWithPayments(data)).toMatchObject({ ok: false, fieldErrors: { shared_phone: "Confirm shared phone" } });
    await activateWithPayments(data);
    expect(mocks.rpc.mock.calls[0][1]).toEqual(mocks.rpc.mock.calls[1][1]);
  });
  it("does not invite duplicate activation after a photo upload failure", async () => {
    mocks.savePhoto.mockRejectedValue(new Error("Storage unavailable"));
    const result = await activateWithPayments(form({ profile_photo_data_url: "photo" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(decodeURIComponent(result.location)).toContain("photo upload failed");
  });
  it("rejects invalid request identifiers and invalid membership amounts", async () => {
    expect(await collectPayments(form({ request_id: "invalid" }))).toMatchObject({ ok: false });
    expect(await renewWithPayments(form({ discount: "1001" }))).toMatchObject({ ok: false, fieldErrors: { discount: expect.any(String) } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
