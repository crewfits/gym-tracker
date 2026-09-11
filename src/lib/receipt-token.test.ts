import { describe, expect, it } from "vitest";
import { createReceiptToken, verifyReceiptToken } from "./receipt-token";

const secret = "test-signing-secret-that-is-at-least-32-bytes-long";
const paymentId = "123e4567-e89b-42d3-a456-426614174000";

describe("public receipt tokens", () => {
  it("creates a compact deterministic bearer link", () => {
    const token = createReceiptToken(paymentId, secret);
    expect(token.length).toBeLessThan(50);
    expect(createReceiptToken(paymentId, secret)).toBe(token);
    expect(verifyReceiptToken(token, secret)).toBe(paymentId);
  });

  it("rejects a modified token", () => {
    const token = createReceiptToken(paymentId, secret);
    expect(verifyReceiptToken(`${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`, secret)).toBeNull();
  });
});
