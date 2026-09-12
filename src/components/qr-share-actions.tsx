"use client";

import { CheckCircle2, Download, Share2, X } from "lucide-react";
import { useState } from "react";
import { whatsappAppUrl, whatsappClickToChatUrl } from "@/lib/reminders";

type Props = {
  defaultCountryCode: string;
  filename: string;
  gymName: string;
  memberCode: string;
  memberName: string;
  phone: string;
  qrPngDataUrl: string;
  receipt?: {
    amount: string;
    paidOn: string;
    receiptNumber: string;
    url: string;
  } | null;
};

async function imageFromDataUrl(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
}

async function buildPassImage({ gymName, memberName, memberCode, qrPngDataUrl }: Pick<Props, "gymName" | "memberName" | "memberCode" | "qrPngDataUrl">) {
  const qr = await imageFromDataUrl(qrPngDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1280;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image generation is not supported in this browser");

  ctx.fillStyle = "#f5f8fd";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#dbe5f1";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(70, 70, 760, 1140, 34);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#14213d";
  ctx.textAlign = "center";
  ctx.font = "700 34px Arial, sans-serif";
  ctx.fillText("FitKiro QR pass", 450, 150);
  ctx.font = "800 58px Arial, sans-serif";
  ctx.fillText(gymName.slice(0, 28), 450, 230);
  ctx.fillStyle = "#64748b";
  ctx.font = "500 28px Arial, sans-serif";
  ctx.fillText("Show this QR at gym entry", 450, 288);

  ctx.drawImage(qr, 165, 345, 570, 570);

  ctx.fillStyle = "#14213d";
  ctx.font = "800 38px Arial, sans-serif";
  ctx.fillText(memberName.slice(0, 32), 450, 1000);
  ctx.fillStyle = "#42526e";
  ctx.font = "700 30px Arial, sans-serif";
  ctx.fillText(memberCode, 450, 1048);

  ctx.fillStyle = "#078447";
  ctx.font = "700 24px Arial, sans-serif";
  ctx.fillText("Save this image on your phone", 450, 1125);

  const blob = await canvasToBlob(canvas);
  if (!blob) throw new Error("Could not prepare the QR pass image");
  return blob;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function QrShareActions({ defaultCountryCode, filename, gymName, memberCode, memberName, phone, qrPngDataUrl, receipt }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const message = receipt
    ? `Hi ${memberName}, please save the QR pass image I am sending. Use it at the gym for Check-in and Check-out. Your payment receipt ${receipt.receiptNumber} for ${receipt.amount}, paid on ${receipt.paidOn}: ${receipt.url}`
    : `Hi ${memberName}, please save the QR pass image I am sending. Use it at the gym for Check-in and Check-out.`;
  let whatsappUrl: string | null = null;
  let whatsappDesktopUrl: string | null = null;
  try {
    whatsappUrl = whatsappClickToChatUrl(phone, defaultCountryCode, message);
    whatsappDesktopUrl = whatsappAppUrl(phone, defaultCountryCode, message);
  } catch {
    // Older imported members may not yet have a WhatsApp-routable phone number.
  }

  async function copyPassImage() {
    const blob = await buildPassImage({ gymName, memberName, memberCode, qrPngDataUrl });
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("Image copy is not supported in this browser. Use Download QR image and attach it manually.");
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  }

  async function shareToWhatsApp() {
    if (!whatsappUrl || pending) return;
    setError(null);
    setPending(true);
    try {
      await copyPassImage();
      setConfirmOpen(true);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "Could not copy the QR pass image. Please try again.");
    } finally {
      setPending(false);
    }
  }

  function openWhatsAppApp() {
    if (!whatsappDesktopUrl) return;
    window.location.href = whatsappDesktopUrl;
  }

  function openWhatsAppWeb() {
    if (!whatsappUrl) return;
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  }

  async function downloadPassImage() {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const blob = await buildPassImage({ gymName, memberName, memberCode, qrPngDataUrl });
      downloadBlob(blob, filename);
    } catch {
      setError("Could not download the QR pass. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return <div className="qr-share-actions">
    {whatsappUrl ? <button className="button success qr-whatsapp-button" type="button" onClick={shareToWhatsApp} disabled={pending}>
      <Share2 size={18}/>
      {pending ? "Copying QR image…" : receipt ? "Share QR pass and receipt" : "Share QR pass"}
    </button> : <button className="button secondary qr-whatsapp-button" type="button" onClick={downloadPassImage} disabled={pending}><Download size={18}/> Download QR image</button>}
    {whatsappUrl && <div className="qr-secondary-actions">
      <button className="button secondary small" type="button" onClick={downloadPassImage} disabled={pending}><Download size={15}/> Download QR image</button>
    </div>}
    {error && <small className="form-error" role="alert">{error}</small>}
    {!whatsappUrl && <small className="muted">Add a valid WhatsApp phone number to share directly.</small>}
    {confirmOpen && <div className="qr-share-modal-backdrop" role="presentation">
      <div className="qr-share-modal" role="dialog" aria-modal="true" aria-labelledby="qr-share-modal-title">
        <button className="qr-share-modal-close" type="button" onClick={() => setConfirmOpen(false)} aria-label="Close"><X size={18}/></button>
        <div className="qr-share-modal-icon"><CheckCircle2 size={30} aria-hidden="true"/></div>
        <h3 id="qr-share-modal-title">QR image copied</h3>
        <p>Paste the copied QR image in the WhatsApp chat, then send it to the member.</p>
        <div className="qr-share-modal-actions">
          <button className="button success qr-share-modal-ok" type="button" onClick={openWhatsAppApp}><CheckCircle2 size={18}/> Open WhatsApp app</button>
          <button className="button secondary qr-share-modal-ok" type="button" onClick={openWhatsAppWeb}>Open WhatsApp Web</button>
        </div>
      </div>
    </div>}
  </div>;
}
