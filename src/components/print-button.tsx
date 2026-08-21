"use client";

import { Printer, Share2 } from "lucide-react";

export function PrintButton() {
  return <button className="button no-print" onClick={() => window.print()}><Printer size={16}/> Print / save PDF</button>;
}

export function ShareReceiptButton({ receiptNumber }: { receiptNumber: string }) {
  async function share() {
    const data = { title: `Receipt ${receiptNumber}`, text: `Payment receipt ${receiptNumber}`, url: window.location.href };
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(window.location.href); window.alert("Receipt link copied. You can now paste it into WhatsApp, SMS, or another app."); }
  }
  return <button className="button secondary no-print" onClick={share}><Share2 size={16}/> Share receipt</button>;
}
