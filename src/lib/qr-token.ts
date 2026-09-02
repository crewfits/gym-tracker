import { createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from "node:crypto";

export type QrTokenPayload = {
  gymId: string;
  memberId: string;
  version: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const shortQrCodePattern = /^[A-HJ-NP-Z2-9]{12}$/;

export function isShortQrCode(value: string): boolean {
  return shortQrCodePattern.test(value);
}

export function attendanceQrToken(value: string): string | null {
  const raw = value.trim();
  if (raw.length < 12 || raw.length > 2000) return null;
  try {
    const match = new URL(raw).pathname.match(/^\/(?:s|scan)\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return isShortQrCode(raw) || /^[A-Za-z0-9._-]{40,1000}$/.test(raw) ? raw : null;
  }
}

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

function uuidBytes(value: string): Buffer {
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

function uuidFromBytes(value: Buffer): string {
  const hex = value.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function compactSignature(payload: Buffer, secret: string): Buffer {
  return createHmac("sha256", secret).update("gymdesk-qr-v2\0").update(payload).digest().subarray(0, 16);
}

function encryptionKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("gymdesk-qr-v3-key\0").digest();
}

function encryptPayload(payload: Buffer, secret: string): Buffer {
  const key = encryptionKey(secret);
  const nonce = createHmac("sha256", key).update("gymdesk-qr-v3-nonce\0").update(payload).digest().subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("gymdesk-qr-v3"));
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}

function decryptPayload(value: Buffer, secret: string): Buffer | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), value.subarray(0, 12));
    decipher.setAAD(Buffer.from("gymdesk-qr-v3"));
    decipher.setAuthTag(value.subarray(48));
    return Buffer.concat([decipher.update(value.subarray(12, 48)), decipher.final()]);
  } catch {
    return null;
  }
}

export function createQrToken(payload: QrTokenPayload, secret = signingSecret()): string {
  if (!uuidPattern.test(payload.gymId) || !uuidPattern.test(payload.memberId)) {
    throw new Error("QR payload contains an invalid identifier");
  }
  if (!Number.isSafeInteger(payload.version) || payload.version <= 0 || payload.version > 0xffff_ffff) {
    throw new Error("QR version must be a positive integer");
  }

  const encodedPayload = Buffer.alloc(36);
  uuidBytes(payload.gymId).copy(encodedPayload, 0);
  uuidBytes(payload.memberId).copy(encodedPayload, 16);
  encodedPayload.writeUInt32BE(payload.version, 32);
  return encryptPayload(encodedPayload, secret).toString("base64url");
}

export function verifyQrToken(token: string, secret = signingSecret()): QrTokenPayload | null {
  if (!token.includes(".")) {
    try {
      const value = Buffer.from(token, "base64url");
      if (value.toString("base64url") !== token) return null;
      let encodedPayload: Buffer;
      if (value.length === 64) {
        const decrypted = decryptPayload(value, secret);
        if (!decrypted) return null;
        encodedPayload = decrypted;
      } else if (value.length === 52) {
        // Backward compatibility for the first compact signed-token rollout.
        encodedPayload = value.subarray(0, 36);
        if (!timingSafeEqual(value.subarray(36), compactSignature(encodedPayload, secret))) return null;
      } else return null;
      const gymId = uuidFromBytes(encodedPayload.subarray(0, 16));
      const memberId = uuidFromBytes(encodedPayload.subarray(16, 32));
      const version = encodedPayload.readUInt32BE(32);
      if (!uuidPattern.test(gymId) || !uuidPattern.test(memberId) || version <= 0) return null;
      return { gymId, memberId, version };
    } catch {
      return null;
    }
  }

  // Keep previously issued JSON tokens valid until the owner rotates that
  // member's credential. New tokens use the opaque compact representation.
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

export function qrUrls(token: string, origin = appUrl()) {
  const base = origin.replace(/\/$/, "");
  return {
    passUrl: `${base}/p/${token}`,
    scanUrl: `${base}/s/${token}`,
  };
}
