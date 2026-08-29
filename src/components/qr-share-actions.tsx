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

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isMobileBrowser(): boolean {
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

function whatsappChatUrl(number: string, text?: string): string {
  const params = new URLSearchParams({ phone: number });
  if (text) params.set("text", text);

  const host = isMobileBrowser() ? "api.whatsapp.com" : "web.whatsapp.com";
  return `https://${host}/send?${params.toString()}`;
}

async function nativeShareQr(file: File, message: string, passUrl: string) {
  if (!navigator.share) return false;

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: file.name, text: message, url: passUrl });
    return true;
  }

  await navigator.share({ title: "GymDesk QR pass", text: message, url: passUrl });
  return true;
}

async function copyMessage(message: string) {
  if (!navigator.clipboard?.writeText) return false;
  await navigator.clipboard.writeText(message);
  return true;
}

export function QrShareActions({ memberCode, memberName, passUrl, phone, qrPngDataUrl, defaultCountryCode }: Props) {
  const [whatsappOpened, setWhatsappOpened] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const number = whatsappNumber(phone, defaultCountryCode);
  const imageFilename = `${slugify(memberName) || "member"}-${slugify(memberCode) || "id"}-gym-pass.png`;
  const message = `Hi ${memberName}, here is your ${memberCode} GymDesk QR pass. Open this link to show your QR at the gym: ${passUrl}`;

  function downloadPng() {
    download(pngFileFromDataUrl(qrPngDataUrl, imageFilename));
  }

  async function shareQrToWhatsApp() {
    const file = pngFileFromDataUrl(qrPngDataUrl, imageFilename);
    try {
      const shared = await nativeShareQr(file, message, passUrl);
      if (shared) {
        setStatus("Share sheet opened. Choose WhatsApp, review the chat, and send.");
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus(null);
        return;
      }
    }

    const copied = await copyMessage(message).catch(() => false);
    window.open(whatsappChatUrl(number, message), "gymdesk-whatsapp-share");
    setWhatsappOpened(true);
    setStatus(copied ? "WhatsApp opened. Message copied too; attach the downloaded QR only if needed." : "WhatsApp opened. Attach the downloaded QR only if needed.");
  }

  async function shareQrLink() {
    const copied = await copyMessage(message).catch(() => false);
    if (whatsappOpened) {
      setStatus(copied ? "WhatsApp is already open. Message copied again — paste it in the chat." : "WhatsApp is already open. Copy the pass link if you need to paste it again.");
      return;
    }

    window.open(whatsappChatUrl(number, message), "gymdesk-whatsapp-share");
    setWhatsappOpened(true);
    setStatus(copied ? "WhatsApp opened in a new tab. Message copied too." : "WhatsApp opened in a new tab.");
  }

  return <div className="stack qr-share-actions">
    <div className="qr-share-buttons">
      <button className="button" type="button" onClick={shareQrToWhatsApp}>Share QR to WhatsApp</button>
      <button className="button" type="button" onClick={shareQrLink}>Share QR link</button>
      <button className="button secondary" type="button" onClick={downloadPng}>Download QR PNG</button>
    </div>
    {status ? <small className="success-text">{status}</small> : null}
    <small className="muted">Share the pass link on WhatsApp. The member can open it anytime to show their QR, or download the QR PNG and save it on their phone.</small>
  </div>;
}
