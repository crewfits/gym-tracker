import { headers } from "next/headers";

function cleanOrigin(value: string): string {
  return value.replace(/\/$/, "");
}

function isLocalHost(host: string): boolean {
  return host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");
}

export function configuredAppOrigin(): string {
  return cleanOrigin(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
}

export async function requestAppOrigin(): Promise<string> {
  const headerStore = await headers();
  const forwardedHost = headerStore.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headerStore.get("host")?.split(",")[0]?.trim();

  if (host) {
    const forwardedProto = headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const proto = forwardedProto || (isLocalHost(host) ? "http" : "https");
    return cleanOrigin(`${proto}://${host}`);
  }

  const origin = headerStore.get("origin");
  if (origin?.startsWith("http://") || origin?.startsWith("https://")) return cleanOrigin(origin);

  return configuredAppOrigin();
}
