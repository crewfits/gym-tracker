"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

type NoticeKind = "success" | "error" | "warning";
type Notice = { kind: NoticeKind; message: string };

const dismissAfter: Record<NoticeKind, number> = { success: 5_000, warning: 8_000, error: 10_000 };

function removeFeedbackFromAddressBar() {
  const url = new URL(window.location.href);
  url.searchParams.delete("success");
  url.searchParams.delete("error");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function Feedback({ success, error, warning }: { success?: string; error?: string; warning?: string }) {
  const [notices, setNotices] = useState<Notice[]>(() => [
    ...(success ? [{ kind: "success" as const, message: success }] : []),
    ...(error ? [{ kind: "error" as const, message: error }] : []),
    ...(warning ? [{ kind: "warning" as const, message: warning }] : []),
  ]);

  useEffect(() => {
    if (!notices.length) return;
    removeFeedbackFromAddressBar();
    const timers = notices.map((notice) => window.setTimeout(() => {
      setNotices((current) => current.filter((item) => item !== notice));
    }, dismissAfter[notice.kind]));
    return () => timers.forEach(window.clearTimeout);
  }, [notices]);

  if (!notices.length) return null;
  return <div className="feedback-stack" aria-live="polite">
    {notices.map((notice) => <div className={`alert feedback-toast${notice.kind === "error" ? " error" : notice.kind === "warning" ? " warning" : ""}`} key={`${notice.kind}-${notice.message}`} role={notice.kind === "error" ? "alert" : "status"}>
      <span>{notice.message}</span>
      <button type="button" className="feedback-dismiss" onClick={() => setNotices((current) => current.filter((item) => item !== notice))} aria-label="Dismiss notification"><X size={16}/></button>
    </div>)}
  </div>;
}
