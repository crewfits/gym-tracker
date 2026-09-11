"use client";

import { useRouter } from "next/navigation";

export function DashboardViewSelector({ value }: { value: "current" | "trends" }) {
  const router = useRouter();
  return <label className="dashboard-view-select">
    <span>Dashboard view</span>
    <select value={value} onChange={(event) => router.push(event.target.value === "trends" ? "/?view=trends" : "/")}>
      <option value="current">Current month</option>
      <option value="trends">Month-by-month trends</option>
    </select>
  </label>;
}
