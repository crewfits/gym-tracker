"use client";

import { Download } from "lucide-react";
import { type ReactNode, useState } from "react";

type Props = {
  emailAction?: ReactNode;
  filename: string;
  gymName: string;
  memberCode: string;
  memberName: string;
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

export function QrShareActions({ emailAction, filename, gymName, memberCode, memberName, qrPngDataUrl }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return <div className="qr-share-actions qr-share-email-first">
    <div className="qr-secondary-actions">
      {emailAction}
      <button className="button secondary small qr-download-subtle" type="button" onClick={downloadPassImage} disabled={pending}>
        <Download size={15}/> {pending ? "Preparing…" : "Download QR image"}
      </button>
    </div>
    {error && <small className="form-error" role="alert">{error}</small>}
  </div>;
}
