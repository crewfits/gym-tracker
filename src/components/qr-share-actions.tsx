"use client";

import { useState } from "react";

type Props = {
  memberCode: string;
  memberName: string;
  passUrl: string;
  phone: string;
  qrPngDataUrl: string;
  defaultCountryCode: string;
};

function whatsappNumber(phone: string, defaultCountryCode: string): string {
  const value = phone.trim();
  const digits = value.replace(/\D/g, "");
  if (value.startsWith("+") || digits.length > 10) return digits;
  return digits.length === 10 ? `${defaultCountryCode}${digits}` : digits;
}

function pngFileFromDataUrl(dataUrl: string, filename: string): File {
  const [, base64 = ""] = dataUrl.split(",", 2);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], filename, { type: "image/png" });
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function QrShareActions({ memberCode, memberName, passUrl, phone, qrPngDataUrl, defaultCountryCode }: Props) {
  const [shareMessage, setShareMessage] = useState<string>();
  const [fallbackUrl, setFallbackUrl] = useState<string>();
  const number = whatsappNumber(phone, defaultCountryCode);
  const message = `Hi ${memberName}, here is your ${memberCode} GymDesk QR pass. Open it whenever you need to show your gym QR: ${passUrl}`;
  const whatsappUrl = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;

  async function shareQrToWhatsApp() {
    setFallbackUrl(whatsappUrl);
    setShareMessage("Preparing the QR pass for WhatsApp...");

    try {
      const file = pngFileFromDataUrl(qrPngDataUrl, `${memberCode}-gym-pass.png`);

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${memberCode} gym pass`, text: message });
        setShareMessage("QR image opened in your device share sheet. Choose WhatsApp, review the chat and send it.");
        return;
      }

      const whatsappWindow = window.open("about:blank", "_blank");
      try {
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Image clipboard is unavailable");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": file })]);
        if (whatsappWindow) whatsappWindow.location.href = whatsappUrl;
        else window.location.href = whatsappUrl;
        setShareMessage("QR image copied. In the WhatsApp chat, paste it with Cmd+V or Ctrl+V, then send.");
      } catch {
        download(file);
        if (whatsappWindow) whatsappWindow.location.href = whatsappUrl;
        else window.location.href = whatsappUrl;
        setShareMessage("QR image downloaded. Attach the downloaded PNG in the opened WhatsApp chat, then send.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setShareMessage(undefined);
        return;
      }
      setShareMessage("Could not open WhatsApp automatically. Use the WhatsApp link below and attach the downloaded QR if needed.");
    }
  }

  function downloadPng() {
    download(pngFileFromDataUrl(qrPngDataUrl, `${memberCode}-gym-pass.png`));
  }

  return <div className="stack">
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      <button className="button" type="button" onClick={shareQrToWhatsApp}>Share QR to WhatsApp</button>
      <a className="button secondary" href={whatsappUrl} target="_blank" rel="noreferrer">Send pass link only</a>
      <button className="button secondary" type="button" onClick={downloadPng}>Download QR PNG</button>
    </div>
    {shareMessage && <small className="muted">{shareMessage}{fallbackUrl && <> <a className="text-link" href={fallbackUrl} target="_blank" rel="noreferrer">Open WhatsApp</a></>}</small>}
    <small className="muted">On mobile, choose WhatsApp from the share sheet. On desktop, the QR is copied before the member chat opens; paste it into the chat and send.</small>
  </div>;
}
