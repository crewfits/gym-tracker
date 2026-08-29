"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export function BackButton({ fallback = "/", useHistory = true }: { fallback?: string; useHistory?: boolean }) {
  const router = useRouter();

  function goBack() {
    if (useHistory) {
      router.back();
      return;
    }
    router.push(fallback);
  }

  return <button className="button secondary small" type="button" onClick={goBack} aria-label="Go back to the previous page">
    <ArrowLeft size={15}/> Back
  </button>;
}
