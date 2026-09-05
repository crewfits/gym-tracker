// The OpenNext worker is generated before Wrangler bundles this entrypoint.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Generated during `opennextjs-cloudflare build`.
import openNextWorker from "./.open-next/worker.js";

export default openNextWorker;

// Scheduled handler paused; preserved for a future explicitly enabled rollout.
/*
type ReminderWorkerEnv = {
  CRON_SECRET?: string;
  NEXT_PUBLIC_APP_URL?: string;
};

type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

const worker = {
  fetch: openNextWorker.fetch,

  async scheduled(_controller: unknown, env: ReminderWorkerEnv, ctx: WorkerExecutionContext) {
    if (!env.CRON_SECRET) throw new Error("CRON_SECRET is not configured");

    const origin = env.NEXT_PUBLIC_APP_URL ?? "https://musclefitness.fitkiro.com";
    const response = await openNextWorker.fetch(new Request(new URL("/api/cron/reminders", origin), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    }), env, ctx);

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Automatic reminder run failed (${response.status}): ${detail}`);
    }
  },
};

export default worker;

*/
