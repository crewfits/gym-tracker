import { describe, expect, it } from "vitest";
import { attendanceQrToken, createQrToken, verifyQrToken } from "./qr-token";

const secret = "test-signing-secret-that-is-at-least-32-bytes-long";
const payload = {
  gymId: "123e4567-e89b-42d3-a456-426614174000",
  memberId: "987e6543-e21b-42d3-a456-426614174000",
  version: 3,
};

describe("QR tokens", () => {
  it("extracts camera scanner tokens only from supported scan values", () => {
    expect(attendanceQrToken("https://fitkiro.example/s/ABCDEFGHJKLM")).toBe("ABCDEFGHJKLM");
    expect(attendanceQrToken("https://fitkiro.example/scan/legacy_token_value_that_is_long_enough_1234567890")).toBe("legacy_token_value_that_is_long_enough_1234567890");
    expect(attendanceQrToken("ABCDEFGHJKLM")).toBe("ABCDEFGHJKLM");
    expect(attendanceQrToken("https://example.com/not-a-scan/ABCDEFGHJKLM")).toBeNull();
    expect(attendanceQrToken("hello world")).toBeNull();
  });
  it("recreates the same token for the same member version", () => {
    expect(createQrToken(payload, secret)).toBe(createQrToken(payload, secret));
  });

  it("round-trips a valid signed payload", () => {
    const token = createQrToken(payload, secret);
    expect(token.length).toBeLessThan(100);
    expect(Buffer.from(token, "base64url").includes(Buffer.from(payload.memberId.replaceAll("-", ""), "hex"))).toBe(false);
    expect(verifyQrToken(token, secret)).toEqual(payload);
  });

  it("rejects a changed payload or signature", () => {
    const token = createQrToken(payload, secret);
    const replacement = token.endsWith("A") ? "B" : "A";
    expect(verifyQrToken(`${token.slice(0, -1)}${replacement}`, secret)).toBeNull();
  });

  it("changes when the credential version changes", () => {
    expect(createQrToken({ ...payload, version: 4 }, secret)).not.toBe(createQrToken(payload, secret));
  });
});
