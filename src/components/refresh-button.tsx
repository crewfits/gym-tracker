"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button className="button secondary small" type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
    <RefreshCw size={15} className={pending ? "spin" : undefined}/>{pending ? "Refreshing" : "Refresh status"}
  </button>;
}
