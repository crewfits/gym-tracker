import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, requirePermission, verifyQrToken } = vi.hoisted(() => ({ db: { from: vi.fn(), rpc: vi.fn() }, requirePermission: vi.fn(), verifyQrToken: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission }));
vi.mock("@/lib/member-photo", () => ({ signedMemberPhotoUrl: vi.fn().mockResolvedValue(null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/qr-token", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/qr-token")>(), verifyQrToken }));
import { scanAndRecordAttendance, correctScannerAttendance } from "./attendance";
const requestId = "50000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ supabase: db, gym: { id: "gym-a", timezone: "Asia/Kolkata" } });
  db.from.mockImplementation(table => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: table === "members" ? { name: "Test Member", member_code: "TEST-1" } : { member_id: "member-a", version: 1 } }) }));
});
describe("scanner denied attempt feedback", () => {
  it("shows an expired attempt as denied with its recorded time and no correction controls", async () => {
    db.rpc.mockResolvedValue({ data: { status: "denied", attempt: { occurred_at: "2026-09-10T05:00:00Z" }, duplicate: false }, error: null });
    const result = await scanAndRecordAttendance("ABCDEFGHJKLM", requestId);
    expect(result).toMatchObject({ status: "denied", message: expect.stringContaining("Attempt logged"), memberName: "Test Member", occurredAt: expect.any(String) });
    expect(result.token).toBeUndefined(); expect(result.direction).toBeUndefined();
    expect(db.rpc).toHaveBeenCalledWith("process_qr_access", { p_member_id: "member-a", p_qr_version: 1, p_request_id: requestId, p_direction: null });
  });
  it("labels the same request id as already logged", async () => {
    db.rpc.mockResolvedValue({ data: { status: "denied", attempt: { occurred_at: "2026-09-10T05:00:00Z" }, duplicate: true }, error: null });
    expect((await scanAndRecordAttendance("ABCDEFGHJKLM", requestId)).message).toContain("already logged");
  });
  it("keeps normal attendance and immediate corrections working", async () => {
    db.rpc.mockResolvedValue({ data: { status: "recorded", event: { direction: "exit", occurred_at: "2026-09-10T05:00:00Z", request_id: requestId } }, error: null });
    expect(await correctScannerAttendance("ABCDEFGHJKLM", "entry", requestId)).toMatchObject({ status: "recorded", direction: "exit", token: "ABCDEFGHJKLM" });
    expect(db.rpc).toHaveBeenCalledWith("process_qr_access", expect.objectContaining({ p_direction: "exit" }));
  });
  it("does not claim that an attempt was logged when the database fails", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "Database unavailable" } });
    const result = await scanAndRecordAttendance("ABCDEFGHJKLM", requestId);
    expect(result.status).toBe("denied"); expect(result.message).not.toContain("logged");
  });
  it("rejects invalid QR input before reaching the database", async () => {
    expect((await scanAndRecordAttendance("not a QR", requestId)).status).toBe("denied"); expect(db.rpc).not.toHaveBeenCalled();
  });
  it("rejects signed QRs from another gym", async () => {
    verifyQrToken.mockReturnValue({ gymId: "gym-b", memberId: "member-b", version: 1 });
    expect((await scanAndRecordAttendance("legacy_token_value_that_is_long_enough_1234567890", requestId)).status).toBe("denied"); expect(db.rpc).not.toHaveBeenCalled();
  });
});
