"use client";

import { useEffect } from "react";

export type PwaInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

declare global {
  interface Window {
    fitKiroInstallPrompt?: PwaInstallPromptEvent;
  }
}

export function PwaRegistration() {
  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      window.fitKiroInstallPrompt = event as PwaInstallPromptEvent;
      window.dispatchEvent(new Event("fitkiroinstallpromptready"));
    };
    const clearInstallPrompt = () => {
      delete window.fitKiroInstallPrompt;
      window.dispatchEvent(new Event("fitkiroappinstalled"));
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", clearInstallPrompt);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", clearInstallPrompt);
    };
  }, []);
  return null;
}
