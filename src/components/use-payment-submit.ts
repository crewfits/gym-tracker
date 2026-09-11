"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { SplitPaymentResult } from "@/lib/split-payments";

export function usePaymentSubmit(action: (data: FormData) => Promise<SplitPaymentResult>) {
  const router = useRouter();
  const requestId = useRef("");
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    requestId.current ||= crypto.randomUUID();
    data.set("request_id", requestId.current);
    try {
      const result = await action(data);
      if (result.ok) { router.push(result.location); return; }
      setError([result.error, ...Object.values(result.fieldErrors)].filter(Boolean).join(" "));
    } catch { setError("Could not confirm saving. Your entries are still here. Retry with the same details."); }
    submitting.current = false;
    setPending(false);
  }
  return { submit, pending, error };
}
