"use client";
import { useEffect, useRef, useState } from "react";
import type { PaymentRow } from "@/lib/split-payments";

export function usePaymentRows(totalPaise: number, today: string) {
  const edited = useRef(false);
  const [rows, setRows] = useState<PaymentRow[]>(() => totalPaise > 0 ? [{ key: "initial", amount: (totalPaise / 100).toFixed(2), method: "cash", paid_on: today, reference: "" }] : []);
  useEffect(() => {
    if (!edited.current) setRows(totalPaise > 0 ? [{ key: "initial", amount: (totalPaise / 100).toFixed(2), method: "cash", paid_on: today, reference: "" }] : []);
  }, [totalPaise, today]);
  function changeRows(next: PaymentRow[]) { edited.current = true; setRows(next); }
  return { rows, changeRows };
}
