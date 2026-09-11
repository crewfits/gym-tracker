"use client";

import { MessageCircle, Printer, Share2 } from "lucide-react";

export function PrintButton() {
  return <button className="button no-print" onClick={() => window.print()}><Printer size={16}/> Print / save PDF</button>;
}

export function ShareReceiptButton({ receiptNumber, url }: { receiptNumber: string; url: string }) {
  async function share() {
    const data = { title: `Receipt ${receiptNumber}`, text: `Payment receipt ${receiptNumber}`, url };
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(url); window.alert("Receipt link copied. You can now paste it into WhatsApp, SMS, or another app."); }
  }
  return <button className="button secondary no-print" onClick={share}><Share2 size={16}/> Share receipt</button>;
}

export function WhatsAppReceiptButton({ url }: { url: string }) {
  return <a className="button no-print" href={url} target="_blank" rel="noreferrer"><MessageCircle size={16}/> WhatsApp receipt</a>;
}
