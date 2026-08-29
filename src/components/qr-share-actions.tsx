"use client";

import { Download, LinkIcon, MessageCircle } from "lucide-react";
import { whatsappClickToChatUrl } from "@/lib/reminders";

type Props = {
  defaultCountryCode: string;
  filename: string;
  gymName: string;
  memberCode: string;
  memberName: string;
  passUrl: string;
  phone: string;
  qrPngDataUrl: string;
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

export function QrShareActions({ defaultCountryCode, filename, gymName, memberCode, memberName, passUrl, phone, qrPngDataUrl }: Props) {
  const message = `Hi ${memberName}, please save the QR pass image I am sending. Use it at the gym for Check-in and Check-out.`;
  let whatsappUrl: string | null = null;
  try {
    whatsappUrl = whatsappClickToChatUrl(phone, defaultCountryCode, message);
  } catch {
    // Older imported members may not yet have a WhatsApp-routable phone number.
  }

  async function copyPassImage() {
    const blob = await buildPassImage({ gymName, memberName, memberCode, qrPngDataUrl });
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      downloadBlob(blob, filename);
      window.alert("QR pass image downloaded. Attach it in WhatsApp and ask the member to save it.");
      return;
    }
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    window.alert("QR pass image copied. Paste it into the WhatsApp chat and send.");
  }

  async function shareToWhatsApp() {
    try {
      await copyPassImage();
    } finally {
      if (whatsappUrl) window.open(whatsappUrl, "gymdesk-whatsapp-qr-share", "noopener,noreferrer");
    }
  }

  async function downloadPassImage() {
    const blob = await buildPassImage({ gymName, memberName, memberCode, qrPngDataUrl });
    downloadBlob(blob, filename);
  }

  async function copyPassLink() {
    await navigator.clipboard.writeText(passUrl);
    window.alert("QR pass link copied. Use this only as a fallback; the QR image is better for daily use.");
  }

  return <div className="qr-share-actions">
    {whatsappUrl ? <button className="button success qr-whatsapp-button" type="button" onClick={shareToWhatsApp}>
      <MessageCircle size={18}/>
      Share QR image to WhatsApp
    </button> : <button className="button secondary qr-whatsapp-button" type="button" onClick={downloadPassImage}><Download size={18}/> Download QR image</button>}
    <div className="qr-secondary-actions">
      <button className="button secondary small" type="button" onClick={copyPassLink}><LinkIcon size={15}/> Share QR link</button>
      <button className="button secondary small" type="button" onClick={downloadPassImage}><Download size={15}/> Download QR image</button>
    </div>
    <small className="muted">{whatsappUrl ? "Copies a ready QR pass image, then opens WhatsApp. Paste the image and send." : "Add a valid WhatsApp phone number to share directly."}</small>
  </div>;
}
