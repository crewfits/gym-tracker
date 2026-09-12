"use client";

import { CheckCircle2, MessageCircle, Printer, Share2, X } from "lucide-react";
import { useState } from "react";

export function PrintButton() {
  return <button className="button no-print" onClick={() => window.print()}><Printer size={16}/> Print / save PDF</button>;
}

export function ShareReceiptButton({ receiptNumber, url }: { receiptNumber: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function share() {
    setError(null);
    const data = { title: `Receipt ${receiptNumber}`, text: `Payment receipt ${receiptNumber}`, url };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("Could not share the receipt link. Please copy it from the address bar.");
    }
  }

  return <>
    <button className="button secondary no-print" onClick={share}><Share2 size={16}/> Share receipt</button>
    {error && <small className="form-error no-print" role="alert">{error}</small>}
    {copied && <div className="qr-share-modal-backdrop no-print" role="presentation">
      <div className="qr-share-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-share-modal-title">
        <button className="qr-share-modal-close" type="button" onClick={() => setCopied(false)} aria-label="Close"><X size={18}/></button>
        <div className="qr-share-modal-icon"><CheckCircle2 size={30} aria-hidden="true"/></div>
        <h3 id="receipt-share-modal-title">Receipt link copied</h3>
        <p>You can now paste it into WhatsApp, SMS, or another app.</p>
        <button className="button success qr-share-modal-ok" type="button" onClick={() => setCopied(false)}><CheckCircle2 size={18}/> OK</button>
      </div>
    </div>}
  </>;
}

export function WhatsAppReceiptButton({ url }: { url: string }) {
  return <a className="button no-print" href={url} target="_blank" rel="noreferrer"><MessageCircle size={16}/> WhatsApp receipt</a>;
}
