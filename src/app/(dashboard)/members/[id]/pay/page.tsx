import Link from "next/link";
import { notFound } from "next/navigation";
import { requireGym } from "@/lib/auth";
import { businessDate, formatInr } from "@/lib/domain";
import { recordPayment } from "@/app/actions/core";
import { Feedback } from "@/components/feedback";
import { SubmitButton } from "@/components/submit-button";

export default async function Pay({ params, searchParams }: PageProps<"/members/[id]/pay">) {
  const [{ id }, p] = await Promise.all([params, searchParams]);
  if (!p.charge || typeof p.charge !== "string") notFound();

  const { supabase, gym } = await requireGym();
  const error = typeof p.error === "string" ? p.error : undefined;
  const { data: charge } = await supabase
    .from("charges")
    .select("*, memberships!inner(member_id,plan_name,reverted_at)")
    .eq("id", p.charge)
    .eq("gym_id", gym.id)
    .single();

  if (!charge || charge.memberships.member_id !== id || charge.memberships.reverted_at) notFound();

  const { data: payments } = await supabase
    .from("payments")
    .select("amount_paise,payment_reversals(amount_paise)")
    .eq("charge_id", charge.id)
    .is("voided_at", null);

  const paid = (payments ?? []).reduce(
    (sum, payment) => sum + Number(payment.amount_paise) - payment.payment_reversals.reduce((reversed, item) => reversed + Number(item.amount_paise), 0),
    0,
  );
  const balance = Number(charge.total_paise) - paid;
  const today = businessDate(gym.timezone);

  return <>
    <div className="page-head">
      <div>
        <p className="eyebrow">Payment</p>
        <h1>Record payment</h1>
        <p className="muted">{charge.memberships.plan_name} · Outstanding balance: <strong>{formatInr(balance)}</strong></p>
      </div>
      <Link className="button secondary" href={`/members/${id}`}>Cancel</Link>
    </div>
    <Feedback error={error}/>
    <form action={recordPayment} className="card form" style={{ maxWidth: 700 }}>
      <input type="hidden" name="member_id" value={id}/>
      <input type="hidden" name="charge_id" value={charge.id}/>
      <div className="form-grid">
        <div className="field">
          <label>Amount (₹) *</label>
          <input type="number" name="amount" min="0.01" max={(balance / 100).toFixed(2)} step="0.01" defaultValue={(balance / 100).toFixed(2)} required/>
        </div>
        <div className="field">
          <label>Payment date *</label>
          <input type="date" name="paid_on" defaultValue={today} required/>
        </div>
        <div className="field">
          <label>Method *</label>
          <select name="method">
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="bank_transfer">Bank Transfer</option>
          </select>
        </div>
        <div className="field">
          <label>Transaction/reference</label>
          <input name="reference"/>
        </div>
      </div>
      <div className="field">
        <label>Notes</label>
        <textarea name="notes" rows={3}/>
      </div>
      <SubmitButton className="button" style={{ justifySelf: "start" }} pendingLabel="Recording payment...">Record and issue receipt</SubmitButton>
    </form>
  </>;
}
