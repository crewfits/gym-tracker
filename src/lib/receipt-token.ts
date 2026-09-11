import { createHmac, timingSafeEqual } from "node:crypto";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signingSecret(): string {
  const secret = process.env.QR_SIGNING_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("QR_SIGNING_SECRET must contain at least 32 bytes");
  return secret;
}

function idBytes(value: string): Buffer { return Buffer.from(value.replaceAll("-", ""), "hex"); }
function idFromBytes(value: Buffer): string {
  const hex = value.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function signature(value: Buffer, secret: string): Buffer { return createHmac("sha256", secret).update("gymdesk-receipt-v1\0").update(value).digest().subarray(0, 16); }

export function createReceiptToken(paymentId: string, secret = signingSecret()): string {
  if (!uuidPattern.test(paymentId)) throw new Error("Receipt token contains an invalid identifier");
  const payload = idBytes(paymentId);
  return Buffer.concat([payload, signature(payload, secret)]).toString("base64url");
}

export function verifyReceiptToken(token: string, secret = signingSecret()): string | null {
  try {
    const value = Buffer.from(token, "base64url");
    if (value.length !== 32 || value.toString("base64url") !== token) return null;
    const payload = value.subarray(0, 16);
    if (!timingSafeEqual(value.subarray(16), signature(payload, secret))) return null;
    const paymentId = idFromBytes(payload);
    return uuidPattern.test(paymentId) ? paymentId : null;
  } catch {
    return null;
  }
}
