import type { NextConfig } from "next";

function publicAppHost(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).hostname : undefined;
  } catch {
    return undefined;
  }
}

const allowedDevHost = publicAppHost();
const nextConfig: NextConfig = {
  allowedDevOrigins: allowedDevHost ? [allowedDevHost] : [],
  headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), browsing-topics=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      ],
    }];
  },
};

export default nextConfig;
