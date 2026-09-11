// Scheduled WhatsApp sending is paused. Keep the implementation below for re-enabling.
export async function POST() {
  return Response.json({ message: "Scheduled WhatsApp reminders are disabled. Use the owner-triggered reminder actions." }, { status: 503 });
}

/*
import { processAutomaticPaymentReminders } from "@/lib/automatic-reminders";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return Response.json(await processAutomaticPaymentReminders());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reminder run failed";
    return Response.json({ error: message }, { status: message.includes("is not configured") ? 503 : 500 });
  }
}

*/
