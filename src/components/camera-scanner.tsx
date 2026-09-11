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

function signal(success: boolean, strength = 10) {
  if (strength <= 0) return;
  navigator.vibrate?.(success ? [140, 45, 140] : [180, 80, 180, 80, 220]);
  try {
    const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    void context.resume();
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const normalizedStrength = Math.min(10, Math.max(0, strength)) / 10;
    master.gain.value = 0.35 + normalizedStrength * 1.4;
    compressor.threshold.value = -18;
    compressor.knee.value = 24;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.16;
    master.connect(compressor).connect(context.destination);
    const playTone = (frequency: number, offset: number, duration: number, volume = 0.44) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startAt = context.currentTime + offset;
      oscillator.type = success ? "triangle" : "square";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.001, startAt);
      gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
      oscillator.connect(gain).connect(master);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration);
    };
    if (success) {
      playTone(880, 0, 0.18, 0.48);
      playTone(1318, 0.2, 0.2, 0.52);
      playTone(1760, 0.42, 0.18, 0.48);
    } else {
      playTone(294, 0, 0.2, 0.48);
      playTone(196, 0.24, 0.22, 0.52);
      playTone(147, 0.52, 0.28, 0.52);
    }
    window.setTimeout(() => void context.close(), success ? 920 : 1200);
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
  const beepStrengthRef = useRef(10);
  const closeSecondsRef = useRef(30);
  const [result, setResult] = useState<ScannerAttendanceResult | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(true);
  const [restartKey, setRestartKey] = useState(0);
  const [installPrompt, setInstallPrompt] = useState<PwaInstallPromptEvent | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [beepStrength, setBeepStrength] = useState(10);
  const [closeSeconds, setCloseSeconds] = useState(30);
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
      setCameraError("QR scanning is not supported by this browser. Use the latest Chrome or Edge on this device.");
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
              signal(next.status === "recorded", beepStrengthRef.current);
              resetRef.current = window.setTimeout(() => {
                setResult(null);
                setRestartKey((value) => value + 1);
              }, closeSecondsRef.current * 1000);
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
    const savedBeepStrength = Number(window.localStorage.getItem("fitkiro-scanner-beep-strength"));
    const savedCloseSeconds = Number(window.localStorage.getItem("fitkiro-scanner-close-seconds"));
    if (Number.isInteger(savedBeepStrength) && savedBeepStrength >= 0 && savedBeepStrength <= 10) {
      setBeepStrength(savedBeepStrength);
      beepStrengthRef.current = savedBeepStrength;
    }
    if ([2, 5, 10, 30].includes(savedCloseSeconds)) {
      setCloseSeconds(savedCloseSeconds);
      closeSecondsRef.current = savedCloseSeconds;
    }
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
      signal(corrected.status === "recorded", beepStrengthRef.current);
      resetRef.current = window.setTimeout(scanNext, closeSecondsRef.current * 1000);
    });
  }

  function updateBeepStrength(value: string) {
    const next = Math.min(10, Math.max(0, Number(value)));
    setBeepStrength(next);
    beepStrengthRef.current = next;
    window.localStorage.setItem("fitkiro-scanner-beep-strength", String(next));
  }

  function updateCloseSeconds(next: number) {
    setCloseSeconds(next);
    closeSecondsRef.current = next;
    window.localStorage.setItem("fitkiro-scanner-close-seconds", String(next));
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
      <span className="camera-result-pending">This result closes automatically after {closeSeconds} seconds.</span>
      {isPending && <span className="camera-result-pending">Updating attendance…</span>}
    </div>;
  }

  return <div className="camera-scanner">
    <div className="camera-scanner-head"><div><p className="eyebrow">Webcam attendance</p><h1>Show QR to camera</h1><p className="camera-subtitle">Members can hold their QR pass anywhere clearly visible in this camera view. Attendance records automatically with a loud sound for every result.</p></div><div className="camera-head-actions">{!isInstalled && <button className="button secondary small" onClick={() => void installApp()}><Download size={16}/> Install app</button>}<span className="camera-live"><i/> Live</span></div></div>
    {installMessage && <p className="camera-install-message" role="status">{installMessage}</p>}
    <div className="camera-viewfinder">
      <video ref={videoRef} playsInline muted autoPlay/>
      <div className="camera-scan-area"><span/><strong>Scanning full camera view</strong></div>
      {(isStarting || isPending) && <div className="camera-overlay"><RefreshCw className="spin"/><strong>{isPending ? "Recording attendance…" : "Opening camera…"}</strong></div>}
      {cameraError && <div className="camera-overlay error"><Camera/><strong>{cameraError}</strong><button className="button" onClick={() => void startCamera()}>Try again</button></div>}
    </div>
    <div className="camera-controls">
      <label><span>Beep volume <strong>{beepStrength === 0 ? "Muted" : `${beepStrength}/10`}</strong></span><input type="range" min="0" max="10" step="1" value={beepStrength} onChange={(event) => updateBeepStrength(event.target.value)}/></label>
      <div className="camera-timer-options" role="group" aria-label="Result close timer"><span>Result closes after <strong>{closeSeconds}s</strong></span>{[2, 5, 10, 30].map((seconds) => <button key={seconds} type="button" className={seconds === closeSeconds ? "selected" : ""} onClick={() => updateCloseSeconds(seconds)}>{seconds}s</button>)}</div>
      <div className="camera-control-actions">
        <button type="button" className="button secondary small" onClick={() => signal(true, beepStrengthRef.current)}>Test beep</button>
        <button type="button" className="button secondary small camera-switch" onClick={() => { facingRef.current = facingRef.current === "environment" ? "user" : "environment"; void startCamera(); }}><SwitchCamera size={18}/> Switch camera</button>
      </div>
    </div>
  </div>;
}
