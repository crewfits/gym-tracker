import { describe, expect, it } from "vitest";
import { createQrToken, verifyQrToken } from "./qr-token";

const secret = "test-signing-secret-that-is-at-least-32-bytes-long";
const payload = {
  gymId: "123e4567-e89b-42d3-a456-426614174000",
  memberId: "987e6543-e21b-42d3-a456-426614174000",
  version: 3,
};

describe("QR tokens", () => {
  it("recreates the same token for the same member version", () => {
    expect(createQrToken(payload, secret)).toBe(createQrToken(payload, secret));
  });

  it("round-trips a valid signed payload", () => {
    expect(verifyQrToken(createQrToken(payload, secret), secret)).toEqual(payload);
  });

  it("rejects a changed payload or signature", () => {
    const token = createQrToken(payload, secret);
    const [encoded, signature] = token.split(".");
    const changedPayload = `${encoded.slice(0, -1)}A.${signature}`;
    const changedSignature = `${encoded}.${signature.slice(0, -1)}A`;
    expect(verifyQrToken(changedPayload, secret)).toBeNull();
    expect(verifyQrToken(changedSignature, secret)).toBeNull();
  });

  it("changes when the credential version changes", () => {
    expect(createQrToken({ ...payload, version: 4 }, secret)).not.toBe(createQrToken(payload, secret));
  });
});
