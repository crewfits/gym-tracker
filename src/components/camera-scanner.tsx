"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Camera, CheckCircle2, Download, RefreshCw, ShieldX, SwitchCamera, X } from "lucide-react";
import { correctScannerAttendance, scanAndRecordAttendance, type ScannerAttendanceResult } from "@/app/actions/attendance";
import { attendanceLabel } from "@/lib/domain";
import type { PwaInstallPromptEvent } from "@/components/pwa-registration";

type Detector = { detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>> };
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

function barcodeDetector(): Detector | null {
  const Constructor = (globalThis as typeof globalThis & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
  return Constructor ? new Constructor({ formats: ["qr_code"] }) : null;
}

function signal(success: boolean) {
  navigator.vibrate?.(success ? 90 : [110, 70, 110]);
  try {
    const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = success ? 880 : 220;
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + (success ? 0.14 : 0.3));
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (success ? 0.14 : 0.3));
    oscillator.addEventListener("ended", () => void context.close());
  } catch {}
}

export function CameraScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const resetRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const facingRef = useRef<"environment" | "user">("environment");
  const [result, setResult] = useState<ScannerAttendanceResult | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(true);
  const [restartKey, setRestartKey] = useState(0);
  const [installPrompt, setInstallPrompt] = useState<PwaInstallPromptEvent | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isPending, startTransition] = useTransition();

  const stopCamera = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError(null);
    setIsStarting(true);
    busyRef.current = false;
    const detector = barcodeDetector();
    if (!detector) {
      setCameraError("QR scanning is not supported by this browser. Install or update Google Chrome on Android.");
      setIsStarting(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facingRef.current }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setIsStarting(false);

      const scanFrame = async () => {
        if (!videoRef.current || busyRef.current || videoRef.current.readyState < 2) {
          frameRef.current = requestAnimationFrame(scanFrame);
          return;
        }
        try {
          const codes = await detector.detect(videoRef.current);
          const value = codes[0]?.rawValue;
          if (value) {
            const previous = lastScanRef.current;
            if (previous?.value === value && Date.now() - previous.at < 30_000) {
              frameRef.current = requestAnimationFrame(scanFrame);
              return;
            }
            lastScanRef.current = { value, at: Date.now() };
            busyRef.current = true;
            stopCamera();
            startTransition(async () => {
              const next = await scanAndRecordAttendance(value, crypto.randomUUID());
              setResult(next);
              signal(next.status === "recorded");
              resetRef.current = window.setTimeout(() => {
                setResult(null);
                setRestartKey((value) => value + 1);
              }, 30_000);
            });
            return;
          }
        } catch {}
        frameRef.current = requestAnimationFrame(scanFrame);
      };
      frameRef.current = requestAnimationFrame(scanFrame);
    } catch (error) {
      const blocked = error instanceof DOMException && error.name === "NotAllowedError";
      setCameraError(blocked ? "Camera permission is blocked. Allow Camera for FitKiro in Chrome settings and try again." : "Could not open the camera. Check that another app is not using it, then try again.");
      setIsStarting(false);
    }
  }, [stopCamera]);

  useEffect(() => {
    // Camera startup is an external browser synchronization triggered by mount/restart.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void startCamera();
    return () => {
      stopCamera();
      if (resetRef.current !== null) window.clearTimeout(resetRef.current);
    };
  }, [restartKey, startCamera, stopCamera]);

  useEffect(() => {
    // Installed display mode is a browser-only state discovered after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const handlePrompt = () => {
      setInstallPrompt(window.fitKiroInstallPrompt ?? null);
      setInstallMessage(null);
    };
    const handleInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      setInstallMessage("FitKiro Scanner installed");
    };
    handlePrompt();
    window.addEventListener("fitkiroinstallpromptready", handlePrompt);
    window.addEventListener("fitkiroappinstalled", handleInstalled);
    return () => {
      window.removeEventListener("fitkiroinstallpromptready", handlePrompt);
      window.removeEventListener("fitkiroappinstalled", handleInstalled);
    };
  }, []);

  async function installApp() {
    if (!installPrompt) {
      setInstallMessage("Chrome is preparing installation. Keep this page open for 30 seconds, tap once, then try again.");
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    delete window.fitKiroInstallPrompt;
    setInstallPrompt(null);
    setInstallMessage(choice.outcome === "accepted" ? "Installing FitKiro Scanner…" : "Installation cancelled");
  }

  function scanNext() {
    if (resetRef.current !== null) window.clearTimeout(resetRef.current);
    setResult(null);
    setRestartKey((value) => value + 1);
  }

  function changeMovement() {
    if (!result?.token || !result.direction) return;
    if (resetRef.current !== null) window.clearTimeout(resetRef.current);
    startTransition(async () => {
      const corrected = await correctScannerAttendance(result.token!, result.direction!, crypto.randomUUID());
      setResult(corrected.status === "recorded" ? { ...corrected, message: `${corrected.message} as correction` } : corrected);
      signal(corrected.status === "recorded");
      resetRef.current = window.setTimeout(scanNext, 30_000);
    });
  }

  if (result) {
    const recorded = result.status === "recorded";
    return <div className={`camera-result ${recorded ? result.direction : "denied"}`} aria-live="assertive">
      <button className="camera-result-close" onClick={scanNext} disabled={isPending} aria-label="Close result and scan again"><X/></button>
      <div className="camera-result-icon">{recorded ? <CheckCircle2/> : <ShieldX/>}</div>
      {result.photoUrl && <Image className="camera-result-photo" src={result.photoUrl} width={104} height={104} alt="" unoptimized/>}
      <span className="camera-result-label">{result.message}</span>
      {result.memberName && <h1>{result.memberName}</h1>}
      {result.memberCode && <p>{result.memberCode}{result.occurredAt ? ` · ${result.occurredAt}` : ""}</p>}
      <div className="camera-result-actions">
        {recorded && <button className="button secondary" onClick={changeMovement} disabled={isPending}>Make a change to {attendanceLabel(result.direction === "entry" ? "exit" : "entry")}</button>}
      </div>
      <span className="camera-result-pending">Remove the QR from view. This result closes automatically after 30 seconds.</span>
      {isPending && <span className="camera-result-pending">Updating attendance…</span>}
    </div>;
  }

  return <div className="camera-scanner">
    <div className="camera-scanner-head"><div><p className="eyebrow">Automatic attendance</p><h1>Scan member QR</h1></div><div className="camera-head-actions">{!isInstalled && <button className="button secondary small" onClick={() => void installApp()}><Download size={16}/> Install app</button>}<span className="camera-live"><i/> Live</span></div></div>
    {installMessage && <p className="camera-install-message" role="status">{installMessage}</p>}
    <div className="camera-viewfinder">
      <video ref={videoRef} playsInline muted autoPlay/>
      <div className="camera-frame"><span/><span/><span/><span/></div>
      {(isStarting || isPending) && <div className="camera-overlay"><RefreshCw className="spin"/><strong>{isPending ? "Recording attendance…" : "Opening camera…"}</strong></div>}
      {cameraError && <div className="camera-overlay error"><Camera/><strong>{cameraError}</strong><button className="button" onClick={() => void startCamera()}>Try again</button></div>}
    </div>
    <p className="camera-hint">Point the rear camera at a FitKiro member QR. Attendance records automatically.</p>
    <button className="button secondary camera-switch" onClick={() => { facingRef.current = facingRef.current === "environment" ? "user" : "environment"; void startCamera(); }}><SwitchCamera size={18}/> Switch camera</button>
  </div>;
}
