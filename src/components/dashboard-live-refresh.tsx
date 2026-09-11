"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

export function DashboardLiveRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState("Updated just now");
  const refreshRequested = useRef(false);

  useEffect(() => {
    if (!isPending && refreshRequested.current) {
      refreshRequested.current = false;
      setStatus("Updated just now");
    }
  }, [isPending]);

  function refresh() {
    if (isPending) return;
    refreshRequested.current = true;
    setStatus("Updating…");
    startTransition(() => router.refresh());
  }

  return <div className="live-refresh">
    <span aria-live="polite">{status}</span>
    <button type="button" onClick={refresh} disabled={isPending} aria-label="Refresh live dashboard data" title="Refresh live dashboard data">
      <RefreshCw className={isPending ? "spin" : ""} size={15}/>
    </button>
  </div>;
}
