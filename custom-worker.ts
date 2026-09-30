// The OpenNext worker is generated before Wrangler bundles this entrypoint.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Generated during `opennextjs-cloudflare build`.
import openNextWorker from "./.open-next/worker.js";

type FitKiroEnv = CloudflareEnv & {
  NEXT_PUBLIC_APP_URL?: string;
  EMAIL_REMINDER_JOB_SECRET?: string;
};

export default {
  fetch: openNextWorker.fetch,
  async scheduled(_controller: unknown, env: FitKiroEnv, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    const origin = env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
    const secret = env.EMAIL_REMINDER_JOB_SECRET;
    if (!origin || !secret) return;
    ctx.waitUntil(fetch(`${origin}/api/jobs/email-reminders`, {
      method: "POST",
      headers: { "x-fitkiro-job-secret": secret, "x-fitkiro-job-source": "cloudflare-cron" },
    }));
  },
};
