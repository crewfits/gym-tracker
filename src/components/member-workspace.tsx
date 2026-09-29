"use client";

import { useRef, useState, type ReactNode } from "react";
import { History, RefreshCw, UserRound } from "lucide-react";

type MemberWorkspaceView = "profile" | "renew" | "history";

export function MemberWorkspace({ profile, renewal, history, initialView = "profile" }: { profile: ReactNode; renewal: ReactNode; history: ReactNode; initialView?: MemberWorkspaceView | "membership" }) {
  const normalizedInitialView: MemberWorkspaceView = initialView === "membership" ? "renew" : initialView;
  const [view, setView] = useState<MemberWorkspaceView>(normalizedInitialView);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const views = ["profile", "renew", "history"] as const;
  const labels: Record<MemberWorkspaceView, string> = { profile: "Member details", renew: "Renew membership", history: "Membership history" };
  const icons: Record<MemberWorkspaceView, ReactNode> = { profile: <UserRound size={17}/>, renew: <RefreshCw size={17}/>, history: <History size={17}/> };

  return <div className="member-workspace">
    <div className="member-view-tabs" role="tablist" aria-label="Manage member">
      {views.map((item, index) => <button key={item} ref={(node) => { tabs.current[index] = node; }} type="button" role="tab" id={`member-${item}-tab`} aria-selected={view === item} aria-controls={`member-${item}-panel`} tabIndex={view === item ? 0 : -1} onClick={() => setView(item)} onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : event.key === "ArrowRight" ? (index + 1) % views.length : (index + views.length - 1) % views.length;
        setView(views[next]);
        tabs.current[next]?.focus();
      }}>{icons[item]}{labels[item]}</button>)}
    </div>
    <div role="tabpanel" id="member-profile-panel" aria-labelledby="member-profile-tab" hidden={view !== "profile"}>{profile}</div>
    <div role="tabpanel" id="member-renew-panel" aria-labelledby="member-renew-tab" hidden={view !== "renew"}>{renewal}</div>
    <div role="tabpanel" id="member-history-panel" aria-labelledby="member-history-tab" hidden={view !== "history"}>{history}</div>
  </div>;
}
