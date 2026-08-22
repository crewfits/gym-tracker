import { createHmac, timingSafeEqual } from "node:crypto";

export type QrTokenPayload = {
  gymId: string;
  memberId: string;
  version: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signingSecret(): string {
  const secret = process.env.QR_SIGNING_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("QR_SIGNING_SECRET must contain at least 32 bytes");
  }
  return secret;
}

function signatureFor(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createQrToken(payload: QrTokenPayload, secret = signingSecret()): string {
  if (!uuidPattern.test(payload.gymId) || !uuidPattern.test(payload.memberId)) {
    throw new Error("QR payload contains an invalid identifier");
  }
  if (!Number.isSafeInteger(payload.version) || payload.version <= 0) {
    throw new Error("QR version must be a positive integer");
  }

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signatureFor(encodedPayload, secret)}`;
}

export function verifyQrToken(token: string, secret = signingSecret()): QrTokenPayload | null {
  const [encodedPayload, suppliedSignature, extra] = token.split(".");
  if (!encodedPayload || !suppliedSignature || extra) return null;

  const expectedSignature = signatureFor(encodedPayload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const value = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<QrTokenPayload>;
    if (
      typeof value.gymId !== "string" ||
      typeof value.memberId !== "string" ||
      !uuidPattern.test(value.gymId) ||
      !uuidPattern.test(value.memberId) ||
      !Number.isSafeInteger(value.version) ||
      Number(value.version) <= 0
    ) return null;

    return { gymId: value.gymId, memberId: value.memberId, version: Number(value.version) };
  } catch {
    return null;
  }
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function qrUrls(token: string) {
  const base = appUrl();
  return {
    passUrl: `${base}/pass/${token}`,
    scanUrl: `${base}/scan/${token}`,
  };
}
