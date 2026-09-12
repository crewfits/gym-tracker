import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown, ReceiptText } from "lucide-react";
import { Feedback } from "@/components/feedback";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { QrCode, qrPngDataUrl } from "@/components/qr-code";
import { QrShareActions } from "@/components/qr-share-actions";
import { ShareReceiptButton, WhatsAppReceiptButton } from "@/components/print-button";
import { SubmitButton } from "@/components/submit-button";
import { QrSharedStatusForm } from "@/components/qr-shared-status-form";
import { disableMemberQr, issueMemberQr, markMemberQrShared } from "@/app/actions/attendance";
import { requirePermission } from "@/lib/auth";
import { requestAppOrigin } from "@/lib/app-origin";
import { attendanceLabel, formatDisplayDate, formatDisplayDateTime, formatInr, formatPaymentMethod, normalizeCurrencyCode } from "@/lib/domain";
import { qrUrls } from "@/lib/qr-token";
import { createReceiptToken } from "@/lib/receipt-token";
import { whatsappClickToChatUrl } from "@/lib/reminders";

type Query = { success?: string; error?: string; receipts?: string };
type Credential = { public_code: string; version: number; enabled: boolean; issued_at: string; rotated_at: string | null; shared_at: string | null };
type MemberPayment = {
  id: string;
  operation_id: string | null;
  receipt_number: string;
  amount_paise: number;
  paid_on: string;
  method: string;
  voided_at: string | null;
  payment_reversals: { amount_paise: number }[];
  charges: { memberships: { plan_name: string; starts_on: string; expires_on: string } };
};

export default async function MemberQrPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [{ supabase, gym }, origin] = await Promise.all([requirePermission("members.manage"), requestAppOrigin()]);
  const currencyCode = normalizeCurrencyCode(gym.currency_code);
  const requestedPage = Number(query.receipts ?? 1);
  const receiptPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 100000 ? requestedPage : 1;
  const pageSize = 8;
  const paymentQuery = () => supabase.from("payments")
    .select("id,operation_id,receipt_number,amount_paise,paid_on,method,voided_at,payment_reversals(amount_paise),charges!inner(memberships!inner(member_id,plan_name,starts_on,expires_on,reverted_at))", { count: "exact" })
    .eq("gym_id", gym.id).eq("charges.memberships.member_id", id)
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  const [{ data: member }, { data: credentialData }, { data: attendance }, { data: paymentData, error: paymentError, count: receiptCount }, { data: latestData, error: latestError }] = await Promise.all([
    supabase.from("members").select("id,member_code,name,phone,is_archived").eq("id", id).eq("gym_id", gym.id).maybeSingle(),
    supabase.from("member_qr_credentials").select("public_code,version,enabled,issued_at,rotated_at,shared_at").eq("member_id", id).eq("gym_id", gym.id).maybeSingle(),
    supabase.from("attendance_events").select("id,direction,occurred_at").eq("member_id", id).eq("gym_id", gym.id).is("voided_at", null).order("occurred_at", { ascending: false }).limit(10),
    paymentQuery().range((receiptPage - 1) * pageSize, receiptPage * pageSize - 1).returns<MemberPayment[]>(),
    paymentQuery().is("charges.memberships.reverted_at", null).is("voided_at", null).limit(1).returns<MemberPayment[]>(),
  ]);
  if (!member) notFound();

  const credential = credentialData as Credential | null;
  const payments = paymentData ?? [];
  const latestPayment = latestData?.[0] ?? null;
  const { data: latestOperationPayments, error: latestOperationError } = latestPayment?.operation_id
    ? await supabase.from("payments")
      .select("id,operation_id,receipt_number,amount_paise,paid_on,method,voided_at,payment_reversals(amount_paise),charges!inner(memberships!inner(member_id,plan_name,starts_on,expires_on,reverted_at))")
      .eq("gym_id", gym.id).eq("operation_id", latestPayment.operation_id).eq("charges.memberships.member_id", id).order("created_at", { ascending: true }).returns<MemberPayment[]>()
    : { data: null, error: null };
  if (latestOperationError) throw latestOperationError;
  const latestReceiptPayments = latestOperationPayments?.length ? latestOperationPayments : latestPayment ? [latestPayment] : [];
  const latestPrimaryPayment = latestReceiptPayments[0] ?? null;
  const receiptGroups = [...payments.reduce((groups, payment) => {
    const key = payment.operation_id ?? payment.id;
    const current = groups.get(key) ?? [];
    current.push(payment);
    groups.set(key, current);
    return groups;
  }, new Map<string, MemberPayment[]>()).values()];
  const token = credential?.enabled ? credential.public_code : null;
  const urls = token ? qrUrls(token, origin) : null;
  const defaultCountryCode = process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE ?? "91";
  const sharedAt = credential?.shared_at ? formatDisplayDateTime(credential.shared_at, gym.timezone) : null;
  const qrPng = urls ? await qrPngDataUrl(urls.scanUrl) : null;
  const memberNameSlug = member.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const qrFilename = `${memberNameSlug || "member"}-${member.member_code.toLowerCase()}-gym-pass.png`;
  const receiptAmountPaise = latestReceiptPayments.reduce((sum, payment) => {
    const reversed = payment.payment_reversals.reduce((total, reversal) => total + Number(reversal.amount_paise), 0);
    return sum + (payment.voided_at ? 0 : Number(payment.amount_paise) - reversed);
  }, 0);
  const receiptAmount = latestPrimaryPayment ? formatInr(receiptAmountPaise, currencyCode) : "";
  const receiptPaidOn = latestPrimaryPayment ? formatDisplayDate(latestPrimaryPayment.paid_on) : "";
  const receiptUrl = latestPrimaryPayment ? `${origin}/r/${createReceiptToken(latestPrimaryPayment.id)}` : "";
  const receiptShare = latestPrimaryPayment ? { amount: receiptAmount, paidOn: receiptPaidOn, receiptNumber: latestPrimaryPayment.receipt_number, url: receiptUrl } : null;
  function receiptWhatsappUrl(payment: MemberPayment, amount: string, url: string) {
    try {
      return whatsappClickToChatUrl(member!.phone, defaultCountryCode, `Hi ${member!.name}, payment receipt ${payment.receipt_number} for ${amount}, paid on ${formatDisplayDate(payment.paid_on)} to ${gym.name}: ${url}`);
    } catch {
      return null;
    }
  }

  return <div className="qr-sharing-page">
    <div className="qr-page-head">
      <div className="qr-page-title"><h1>QR pass & receipts</h1><p className="muted">{member.name} · {member.member_code}</p></div>
      <div className="qr-back-actions"><Link className="button secondary small" href="/members">Back to members list</Link><Link className="button secondary small" href={`/members/${id}`}>Back to profile</Link></div>
    </div>
    <Feedback success={query.success} error={query.error}/>
    {member.is_archived && <div className="alert error">Archived members cannot receive or use a QR pass.</div>}
    <div className="qr-sharing-content">
      <section className="qr-sharing-main">
        {credential?.enabled && urls ? <>
          <div className="qr-manage-layout">
            <div className="qr-preview-panel">
              <div className="qr-manage-image"><QrCode value={urls.scanUrl} label={`Attendance QR for ${member.member_code}`}/></div>
              <div className="qr-member-label"><strong>{member.name}</strong><br/><span className="muted">{member.member_code}</span></div>
            </div>
            <div className="qr-control-panel">
              <div className="qr-handoff-heading"><h2>{receiptShare ? "QR pass & latest receipt" : "QR pass"}</h2></div>
              {latestError && <div className="alert error">The latest receipt could not be loaded. Refresh before sharing.</div>}
              {latestPrimaryPayment && <div className="qr-included-receipt">
                <ReceiptText size={20} aria-hidden="true"/>
                <div><strong>{receiptAmount}</strong><span className="muted">{latestPrimaryPayment.receipt_number} · {receiptPaidOn}</span><small className="muted">{latestPrimaryPayment.charges.memberships.plan_name}</small></div>
                <Link href={`/receipts/${latestPrimaryPayment.id}`} className="qr-receipt-preview">View receipt</Link>
              </div>}
              {qrPng && <QrShareActions defaultCountryCode={defaultCountryCode} filename={qrFilename} gymName={gym.name} memberCode={member.member_code} memberName={member.name} phone={member.phone} qrPngDataUrl={qrPng} receipt={receiptShare}/>}
              {sharedAt
                ? <div className="qr-share-confirm is-shared"><span>{`QR marked shared · ${sharedAt}`}</span></div>
                : <QrSharedStatusForm action={markMemberQrShared} memberId={id}/>}
              <hr className="qr-actions-divider"/>
              <details className="qr-settings"><summary>QR settings</summary><div className="qr-danger-actions">
                <ConfirmActionForm action={issueMemberQr} memberId={id} message="Regenerate this QR? Every previously shared or printed copy will stop working immediately." className="button danger" disabled={member.is_archived} label="Regenerate QR" pendingLabel="Regenerating…"/>
                <form action={disableMemberQr}><input type="hidden" name="member_id" value={id}/><SubmitButton className="button secondary" pendingLabel="Disabling…">Disable QR</SubmitButton></form>
              </div></details>
            </div>
          </div>
        </> : <div className="empty">
          <h2>No active QR</h2>
          <form action={issueMemberQr}><input type="hidden" name="member_id" value={id}/><SubmitButton className="button" disabled={member.is_archived} pendingLabel="Generating QR…">{credential ? "Issue a new QR" : "Generate QR"}</SubmitButton></form>
        </div>}
      </section>
      <div className="qr-sharing-history">
        <details className="qr-history-disclosure" id="receipts" open={receiptPage > 1 || Boolean(paymentError)}>
          <summary><span>Receipt history <small className="muted">({receiptGroups.length}{(receiptCount ?? 0) > payments.length ? "+" : ""})</small></span><ChevronDown size={18} aria-hidden="true"/></summary>
          <div className="qr-history-body">
          {paymentError || latestError ? <div className="alert error">Receipts could not be loaded. Please refresh this page.</div> : <>
            <div className="qr-receipt-list">{receiptGroups.map((group) => {
              const payment = group[0];
              const amountPaise = group.reduce((sum, item) => {
                const reversed = item.payment_reversals.reduce((total, reversal) => total + Number(reversal.amount_paise), 0);
                return sum + (item.voided_at ? 0 : Number(item.amount_paise) - reversed);
              }, 0);
              const amount = formatInr(amountPaise, currencyCode);
              const url = `${origin}/r/${createReceiptToken(payment.id)}`;
              const whatsappUrl = receiptWhatsappUrl(payment, amount, url);
              const methodLabel = group.map(item => `${formatPaymentMethod(item.method)} ${formatInr(item.voided_at ? 0 : Number(item.amount_paise) - item.payment_reversals.reduce((sum, reversal) => sum + Number(reversal.amount_paise), 0), currencyCode)}`).join(" + ");
              const hasReversal = group.some(item => item.voided_at || item.payment_reversals.length > 0);
              return <details className="qr-receipt-record" key={payment.operation_id ?? payment.id}>
                <summary><span><strong>{payment.receipt_number}</strong><small className="muted">{formatDisplayDate(payment.paid_on)} · {methodLabel}</small></span><span className="qr-receipt-amount"><strong>{amount}</strong>{hasReversal ? <small className="badge partial">Adjusted</small> : group.some(item => item.id === latestPrimaryPayment?.id) ? <small className="muted">Latest</small> : null}</span><ChevronDown size={16} className="receipt-chevron" aria-hidden="true"/></summary>
                <div className="qr-receipt-body">
                  <span className="muted">{payment.charges.memberships.plan_name} · {formatDisplayDate(payment.charges.memberships.starts_on)} - {formatDisplayDate(payment.charges.memberships.expires_on)}</span>
                  <div className="qr-receipt-actions">
                    {whatsappUrl && <WhatsAppReceiptButton url={whatsappUrl}/>}
                    <ShareReceiptButton receiptNumber={payment.receipt_number} url={url}/>
                    <Link className="button secondary small" href={`/receipts/${payment.id}`}>Open receipt</Link>
                  </div>
                </div>
              </details>;
            })}</div>
            {!payments.length && <div className="empty">{receiptPage > 1 ? "No receipts on this page." : "No payments recorded yet."}</div>}
            {(receiptPage > 1 || (receiptCount ?? 0) > pageSize) && <nav className="pagination" aria-label="Receipt pages"><span className="muted">Page {receiptPage}</span><div>
              {receiptPage > 1 && <Link className="button secondary small" href={`/members/${id}/qr?receipts=${receiptPage - 1}#receipts`}>Newer</Link>}
              {receiptPage * pageSize < (receiptCount ?? 0) && <Link className="button secondary small" href={`/members/${id}/qr?receipts=${receiptPage + 1}#receipts`}>Older</Link>}
            </div></nav>}
          </>}
          </div>
        </details>
        <details className="qr-history-disclosure">
          <summary><span>Recent attendance</span><ChevronDown size={18} aria-hidden="true"/></summary>
          <div className="timeline qr-history-body">
            {(attendance ?? []).map((event) => <div className="timeline-item" key={event.id}><strong>{attendanceLabel(event.direction)}</strong><br/><small className="muted">{formatDisplayDateTime(event.occurred_at, gym.timezone)}</small></div>)}
            {!attendance?.length && <div className="empty">No attendance recorded yet.</div>}
          </div>
        </details>
      </div>
    </div>
  </div>;
}
