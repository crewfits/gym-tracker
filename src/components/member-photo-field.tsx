"use client";

import { Camera, ImageUp, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Props = {
  existingUrl?: string | null;
  memberName?: string;
};

const maxSide = 512;
const maxPayloadBytes = 180 * 1024;

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read the selected image"));
    };
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not prepare the selected image"));
    reader.readAsDataURL(blob);
  });
}

async function compressCanvas(canvas: HTMLCanvasElement) {
  for (const quality of [0.82, 0.72, 0.62]) {
    const blob = await canvasBlob(canvas, "image/webp", quality) ?? await canvasBlob(canvas, "image/jpeg", quality);
    if (blob && blob.size <= maxPayloadBytes) return { dataUrl: await blobToDataUrl(blob), size: blob.size };
  }

  throw new Error("Photo is still too large after compression. Try a clearer close-up photo.");
}

async function compressPhoto(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  const image = await loadImage(file);
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot resize the photo");
  context.drawImage(image, 0, 0, width, height);
  return compressCanvas(canvas);
}

function cameraSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

export function MemberPhotoField({ existingUrl, memberName }: Props) {
  const fallbackCaptureInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [preview, setPreview] = useState(existingUrl ?? "");
  const [dataUrl, setDataUrl] = useState("");
  const [removed, setRemoved] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const initials = (memberName ?? "Member").trim().slice(0, 1).toUpperCase() || "M";
  const hasPendingPhotoChange = Boolean(dataUrl || removed);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    if (!hasPendingPhotoChange) return;
    const message = "You captured or changed a member photo but have not saved the profile yet.";
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
    };
    const guardNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      if (target.target === "_blank" || target.href === window.location.href || target.getAttribute("href")?.startsWith("#")) return;
      if (window.confirm(`${message}\n\nLeave without saving?`)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", guardNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", guardNavigation, true);
    };
  }, [hasPendingPhotoChange]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!cameraOpen || !video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => setStatus("Camera opened, but preview could not start. Try another camera or upload a photo."));
  }, [cameraOpen]);

  async function refreshCameraDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput");
    setCameraDevices(cameras);
    return cameras;
  }

  async function openCamera(deviceId = selectedDeviceId) {
    if (!cameraSupported()) {
      setStatus("Live camera is not supported here. Use upload photo instead.");
      fallbackCaptureInputRef.current?.click();
      return;
    }

    setStatus("Requesting camera permission...");
    stopCamera();
    setCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" },
      });
      streamRef.current = stream;
      setCameraOpen(true);
      window.setTimeout(() => {
        if (!videoRef.current || streamRef.current !== stream) return;
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => setStatus("Camera opened, but preview could not start. Try another camera or upload a photo."));
      }, 0);
      const cameras = await refreshCameraDevices();
      const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (activeDeviceId) setSelectedDeviceId(activeDeviceId);
      else if (!selectedDeviceId && cameras[0]) setSelectedDeviceId(cameras[0].deviceId);
      setStatus("Camera ready. Align the member face and capture.");
    } catch (error) {
      stopCamera();
      setStatus(error instanceof DOMException && error.name === "NotAllowedError" ? "Camera permission is blocked for this site. Click the camera/tune icon near the address bar, allow Camera, then try again." : "Could not open camera. Try upload photo instead.");
    }
  }

  async function chooseCamera(deviceId: string) {
    setSelectedDeviceId(deviceId);
    await openCamera(deviceId);
  }

  async function captureFromCamera() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setStatus("Camera preview is not ready yet.");
      return;
    }

    setStatus("Preparing captured photo...");
    const sourceSize = Math.min(video.videoWidth, video.videoHeight);
    const sourceX = Math.floor((video.videoWidth - sourceSize) / 2);
    const sourceY = Math.floor((video.videoHeight - sourceSize) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = maxSide;
    canvas.height = maxSide;
    const context = canvas.getContext("2d");
    if (!context) {
      setStatus("This browser cannot capture the photo.");
      return;
    }
    context.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, 0, 0, maxSide, maxSide);
    try {
      const compressed = await compressCanvas(canvas);
      setPreview(compressed.dataUrl);
      setDataUrl(compressed.dataUrl);
      setRemoved(false);
      setStatus(`Captured photo ready · ${Math.max(1, Math.round(compressed.size / 1024))} KB. Click Save profile to upload.`);
      stopCamera();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not prepare captured photo");
    }
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setStatus("Preparing photo...");
    try {
      const compressed = await compressPhoto(file);
      setPreview(compressed.dataUrl);
      setDataUrl(compressed.dataUrl);
      setRemoved(false);
      setStatus(`Photo ready · ${Math.max(1, Math.round(compressed.size / 1024))} KB. Click Save profile to upload.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not prepare photo");
      if (fallbackCaptureInputRef.current) fallbackCaptureInputRef.current.value = "";
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  function removePhoto() {
    if (fallbackCaptureInputRef.current) fallbackCaptureInputRef.current.value = "";
    if (uploadInputRef.current) uploadInputRef.current.value = "";
    stopCamera();
    setPreview("");
    setDataUrl("");
    setRemoved(true);
    setStatus("Photo will be removed after saving.");
  }

  return <div className="member-photo-field">
    <input type="hidden" name="profile_photo_data_url" value={dataUrl}/>
    <input type="hidden" name="profile_photo_removed" value={removed ? "true" : ""}/>
    <div className="member-photo-preview" aria-label="Member photo preview">
      {preview ? <img src={preview} alt={memberName ? `${memberName} profile photo` : "Member profile photo"}/> : <span>{initials}</span>}
    </div>
    <div className="member-photo-actions">
      <button className="button secondary small" type="button" onClick={() => void openCamera()}><Camera size={14}/> Capture photo</button>
      <button className="button secondary small" type="button" onClick={() => uploadInputRef.current?.click()}><ImageUp size={14}/> {preview ? "Upload replacement" : "Upload photo"}</button>
      {preview && <button className="button danger small" type="button" onClick={removePhoto}><Trash2 size={14}/> Remove</button>}
      <input ref={fallbackCaptureInputRef} type="file" accept="image/*" capture="user" hidden onChange={(event) => void choosePhoto(event.target.files?.[0])}/>
      <input ref={uploadInputRef} type="file" accept="image/*" hidden onChange={(event) => void choosePhoto(event.target.files?.[0])}/>
      {status && <small className="muted">{status}</small>}
      {cameraOpen && <div className="camera-panel">
        <video ref={videoRef} className="camera-preview" playsInline muted autoPlay/>
        {cameraDevices.length > 1 && <label className="camera-select">Camera
          <select value={selectedDeviceId} onChange={(event) => void chooseCamera(event.target.value)}>
            {cameraDevices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
          </select>
        </label>}
        <div className="camera-actions">
          <button className="button small" type="button" onClick={() => void captureFromCamera()}><Camera size={14}/> Use this photo</button>
          <button className="button secondary small" type="button" onClick={stopCamera}><X size={14}/> Cancel</button>
        </div>
      </div>}
    </div>
  </div>;
}
