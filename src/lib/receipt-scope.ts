import type { SupabaseClient } from "@supabase/supabase-js";

export type CustomerReceiptPayment = {
  id: string;
  amount_paise: number;
  method: string;
  reference: string | null;
  voided_at: string | null;
  payment_reversals: { amount_paise: number }[];
};

export type CustomerReceiptLine = {
  id: string;
  amountPaise: number;
  method: string | null;
  reference: string | null;
};

function netPayment(payment: CustomerReceiptPayment) {
  const reversedPaise = payment.payment_reversals.reduce((sum, reversal) => sum + Number(reversal.amount_paise), 0);
  return payment.voided_at ? 0 : Math.max(0, Number(payment.amount_paise) - reversedPaise);
}

export function customerReceiptSummary(payments: CustomerReceiptPayment[], consolidatedCorrection: boolean) {
  const active = payments
    .map((payment) => ({ payment, amountPaise: netPayment(payment) }))
    .filter((item) => item.amountPaise > 0);
  const totalReceivedPaise = active.reduce((sum, item) => sum + item.amountPaise, 0);

  if (consolidatedCorrection) {
    const methods = new Set(active.map((item) => item.payment.method));
    return {
      totalReceivedPaise,
      lines: totalReceivedPaise > 0 ? [{
        id: "corrected-final-payment",
        amountPaise: totalReceivedPaise,
        method: methods.size === 1 ? active[0].payment.method : null,
        reference: null,
      }] satisfies CustomerReceiptLine[] : [],
    };
  }

  return {
    totalReceivedPaise,
    lines: active.map(({ payment, amountPaise }) => ({
      id: payment.id,
      amountPaise,
      method: payment.method,
      reference: payment.reference,
    })) satisfies CustomerReceiptLine[],
  };
}

export async function isConsolidatedCorrectionReceipt(supabase: SupabaseClient, operationId: string | null, gymId?: string) {
  if (!operationId) return false;
  let query = supabase.from("payment_operations").select("payload").eq("id", operationId);
  if (gymId) query = query.eq("gym_id", gymId);
  const { data, error } = await query.maybeSingle<{ payload: { kind?: string } | null }>();
  if (error) throw error;
  return data?.payload?.kind === "membership_correction";
}
