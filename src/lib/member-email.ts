import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requestAppOrigin } from "@/lib/app-origin";
import { formatDisplayDate, formatInr, formatPaymentMethod, normalizeCurrencyCode } from "@/lib/domain";
import { alreadySentEmail, emailShell, latestSentEmail, paragraphText, sendTransactionalEmail, type EmailAttachment, type EmailKind } from "@/lib/email-service";
import { qrUrls } from "@/lib/qr-token";

type GymEmail = {
  id: string;
  name: string;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  gstin?: string | null;
  currency_code?: string | null;
};

type ReceiptLinePayment = {
  id: string;
  amount_paise: number;
  method: string;
  reference: string | null;
  paid_on: string;
  receipt_number: string;
  operation_id: string | null;
  charge_id: string;
  voided_at: string | null;
  payment_reversals: { amount_paise: number }[];
};

type PaymentEmailRow = {
  id: string;
  receipt_number: string;
  amount_paise: number;
  method: string;
  reference: string | null;
  paid_on: string;
  operation_id: string | null;
  charge_id: string;
  voided_at: string | null;
  payment_reversals: { amount_paise: number }[];
  charges: {
    id: string;
    subtotal_paise: number;
    discount_paise: number;
    tax_paise: number;
    gst_rate_basis_points: number;
    total_paise: number;
    memberships: {
      id: string;
      plan_name: string;
      starts_on: string;
      expires_on: string;
      members: {
        id: string;
        member_code: string;
        name: string;
        email: string | null;
        phone?: string | null;
      };
    };
  };
};

type QrCredentialEmail = { public_code: string; enabled: boolean };
type QrCredentialRelation = QrCredentialEmail | QrCredentialEmail[] | null;

type MemberQrEmailRow = {
  id: string;
  member_code: string;
  name: string;
  email: string | null;
  member_qr_credentials: QrCredentialRelation;
};

function activeQrCredential(value: QrCredentialRelation) {
  if (Array.isArray(value)) return value.find((item) => item.enabled) ?? null;
  return value?.enabled ? value : null;
}

function safeAttachmentName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "member";
}

const paymentEmailSelect = "id,receipt_number,amount_paise,method,reference,paid_on,operation_id,charge_id,voided_at,payment_reversals(amount_paise),charges!inner(id,subtotal_paise,discount_paise,tax_paise,gst_rate_basis_points,total_paise,memberships!inner(id,plan_name,starts_on,expires_on,members!inner(id,member_code,name,email,phone)))";
const activationPaymentEmailSelect = "id,receipt_number,amount_paise,method,reference,paid_on,operation_id,charge_id,voided_at,payment_reversals(amount_paise),charges!inner(id,subtotal_paise,discount_paise,tax_paise,gst_rate_basis_points,total_paise,memberships!inner(id,plan_name,starts_on,expires_on,members!inner(id,member_code,name,email,phone,member_qr_credentials(public_code,enabled))))";

function paymentNet(payment: ReceiptLinePayment) {
  const reversed = payment.payment_reversals.reduce((sum, reversal) => sum + Number(reversal.amount_paise), 0);
  return payment.voided_at ? 0 : Math.max(0, Number(payment.amount_paise) - reversed);
}

function pdfSafe(value: string | null | undefined) {
  return (value ?? "").replace(/[₹–—−]/g, "-").replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
}

function pdfEscape(value: string) {
  return pdfSafe(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pdfMoney(paise: number, currencyCode: string) {
  return `${normalizeCurrencyCode(currencyCode)} ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function wrapPdfText(value: string | null | undefined, maxChars: number, maxLines = 2) {
  const words = pdfSafe(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > maxChars ? `${word.slice(0, Math.max(1, maxChars - 1))}.` : word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length > maxLines) return lines.slice(0, maxLines);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(1, maxChars - 1)).trimEnd()}.`;
  }
  return lines;
}

function buildPdf(pageWidth: number, pageHeight: number, lines: string[]) {
  const stream = lines.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function createReceiptPdf(input: {
  gym: GymEmail;
  payment: PaymentEmailRow;
  payments: ReceiptLinePayment[];
  currencyCode: string;
}) {
  const { gym, payment, payments, currencyCode } = input;
  const charge = payment.charges;
  const membership = charge.memberships;
  const member = membership.members;
  const primaryPayment = payments[0] ?? payment;
  const totalReceivedPaise = payments.reduce((sum, item) => sum + paymentNet(item), 0);
  const balanceDuePaise = Math.max(0, Number(charge.total_paise) - totalReceivedPaise);
  const lines: string[] = [];
  const pageWidth = 612;
  const pageHeight = 792;
  const y = (top: number) => pageHeight - top;
  const text = (x: number, top: number, size: number, value: string, font = "F1", color: [number, number, number] = [0.08, 0.13, 0.24]) => {
    lines.push(`${color.join(" ")} rg BT /${font} ${size} Tf ${x} ${y(top)} Td (${pdfEscape(value)}) Tj ET`);
  };
  const rect = (x: number, top: number, width: number, height: number, color: [number, number, number], stroke = false) => {
    lines.push(`${color.join(" ")} ${stroke ? "RG" : "rg"} ${x} ${y(top + height)} ${width} ${height} re ${stroke ? "S" : "f"}`);
  };
  const rule = (x: number, top: number, width: number, color: [number, number, number] = [0.86, 0.9, 0.96]) => rect(x, top, width, 1, color);
  const row = (label: string, value: string, top: number, bold = false) => {
    text(72, top, bold ? 12 : 11, label, bold ? "F2" : "F1", [0.28, 0.35, 0.47]);
    text(412, top, bold ? 12 : 11, value, bold ? "F2" : "F1", [0.08, 0.13, 0.24]);
  };

  rect(0, 0, pageWidth, pageHeight, [0.96, 0.98, 1]);
  rect(48, 42, 516, 708, [1, 1, 1]);
  rect(48, 42, 516, 118, [0.93, 0.96, 1]);
  rect(48, 42, 516, 708, [0.82, 0.88, 0.96], true);
  text(72, 82, 10, "PAYMENT RECEIPT", "F2", [0.15, 0.39, 0.92]);
  text(72, 108, 25, gym.name, "F2", [0.08, 0.13, 0.24]);
  const contactLines = wrapPdfText([gym.address, gym.phone, gym.email].filter(Boolean).join("  "), 58, 2);
  contactLines.forEach((line, index) => text(72, 134 + index * 13, 8, line, "F1", [0.39, 0.45, 0.55]));
  text(426, 88, 15, primaryPayment.receipt_number, "F2", [0.08, 0.13, 0.24]);
  text(426, 111, 10, formatDisplayDate(primaryPayment.paid_on), "F1", [0.39, 0.45, 0.55]);
  if (gym.gstin) wrapPdfText(`GSTIN ${gym.gstin}`, 25, 2).forEach((line, index) => text(426, 130 + index * 12, 8, line, "F1", [0.39, 0.45, 0.55]));

  text(72, 205, 9, "RECEIVED FROM", "F2", [0.39, 0.45, 0.55]);
  text(72, 231, 18, member.name, "F2");
  text(72, 254, 10, [member.member_code, member.phone].filter(Boolean).join(" - "), "F1", [0.39, 0.45, 0.55]);
  text(314, 205, 9, "FOR", "F2", [0.39, 0.45, 0.55]);
  const planLines = wrapPdfText(`${membership.plan_name} membership`, 26, 2);
  planLines.forEach((line, index) => text(314, 231 + index * 18, 17, line, "F2"));
  text(314, 254 + Math.max(0, planLines.length - 1) * 18, 10, `${formatDisplayDate(membership.starts_on)} - ${formatDisplayDate(membership.expires_on)}`, "F1", [0.39, 0.45, 0.55]);

  rule(72, 310, 468);
  row("Plan price", pdfMoney(Number(charge.subtotal_paise), currencyCode), 342);
  rule(72, 362, 468);
  row("Discount", `- ${pdfMoney(Number(charge.discount_paise), currencyCode)}`, 386);
  let nextTop = 406;
  if (Number(charge.gst_rate_basis_points) > 0) {
    rule(72, 406, 468);
    row(`GST (${Number(charge.gst_rate_basis_points) / 100}%)`, pdfMoney(Number(charge.tax_paise), currencyCode), 430);
    nextTop = 450;
  }
  rule(72, nextTop, 468);
  row("Total amount", pdfMoney(Number(charge.total_paise), currencyCode), nextTop + 24, true);
  nextTop += 58;
  for (const item of payments) {
    const reversed = item.payment_reversals.reduce((sum, reversal) => sum + Number(reversal.amount_paise), 0);
    rule(72, nextTop, 468);
    row(`Payment received via ${formatPaymentMethod(item.method)}`, pdfMoney(paymentNet(item), currencyCode), nextTop + 24, true);
    if (item.reference) text(72, nextTop + 43, 9, `Reference: ${item.reference}`, "F1", [0.39, 0.45, 0.55]);
    if (reversed > 0) text(72, nextTop + 57, 9, `Reversed: ${pdfMoney(reversed, currencyCode)}`, "F1", [0.77, 0.18, 0.18]);
    nextTop += reversed > 0 || item.reference ? 78 : 58;
  }
  rule(72, nextTop, 468);
  row("Paid on this receipt", pdfMoney(totalReceivedPaise, currencyCode), nextTop + 26, true);
  nextTop += 60;
  if (balanceDuePaise > 0) {
    rule(72, nextTop, 468);
    row("Balance due", pdfMoney(balanceDuePaise, currencyCode), nextTop + 26, true);
    nextTop += 60;
  }
  text(72, Math.min(710, nextTop + 24), 9, "Generated by FitKiro. This receipt reflects the current payment record.", "F1", [0.39, 0.45, 0.55]);

  return buildPdf(pageWidth, pageHeight, lines);
}

function createQrPassPdf(input: { matrix: Uint8Array; size: number; gymName: string; member: { name: string; member_code: string } }) {
  const { matrix, size, gymName, member } = input;
  const lines: string[] = [];
  const pageWidth = 612;
  const pageHeight = 792;
  const y = (top: number) => pageHeight - top;
  const text = (x: number, top: number, size: number, value: string, font = "F1", color: [number, number, number] = [0.08, 0.13, 0.24]) => {
    lines.push(`${color.join(" ")} rg BT /${font} ${size} Tf ${x} ${y(top)} Td (${pdfEscape(value)}) Tj ET`);
  };
  const centerText = (top: number, size: number, value: string, font = "F1", color: [number, number, number] = [0.08, 0.13, 0.24]) => {
    const safe = pdfSafe(value);
    const averageWidth = font === "F2" ? size * 0.58 : size * 0.52;
    const x = Math.max(66, Math.round((pageWidth - safe.length * averageWidth) / 2));
    text(x, top, size, safe, font, color);
  };
  const rect = (x: number, top: number, width: number, height: number, color: [number, number, number], stroke = false) => {
    lines.push(`${color.join(" ")} ${stroke ? "RG" : "rg"} ${x} ${y(top + height)} ${width} ${height} re ${stroke ? "S" : "f"}`);
  };

  rect(0, 0, pageWidth, pageHeight, [0.96, 0.98, 1]);
  rect(66, 44, 480, 704, [1, 1, 1]);
  rect(66, 44, 480, 704, [0.82, 0.88, 0.96], true);
  rect(66, 44, 480, 122, [0.93, 0.98, 0.9]);
  text(102, 92, 11, "FITKIRO QR PASS", "F2", [0.15, 0.39, 0.92]);
  text(102, 124, 25, gymName, "F2");
  text(102, 151, 10, "Show this QR at gym entry for attendance.", "F1", [0.39, 0.45, 0.55]);

  const quietModules = 2;
  const boxSize = 322;
  const moduleSize = Math.floor(boxSize / (size + quietModules * 2));
  const imageSize = moduleSize * (size + quietModules * 2);
  const x = Math.round((pageWidth - imageSize) / 2);
  const top = 214;
  const startX = x + Math.floor((boxSize - imageSize) / 2);
  const startTop = top + Math.floor((boxSize - imageSize) / 2);
  rect(x - 16, top - 16, imageSize + 32, imageSize + 32, [1, 1, 1]);
  rect(x - 16, top - 16, imageSize + 32, imageSize + 32, [0.86, 0.9, 0.96], true);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (!matrix[row * size + column]) continue;
      rect(startX + (column + quietModules) * moduleSize, startTop + (row + quietModules) * moduleSize, moduleSize, moduleSize, [0.06, 0.15, 0.11]);
    }
  }
  centerText(600, 21, member.name, "F2", [0.08, 0.13, 0.24]);
  centerText(632, 13, member.member_code, "F1", [0.28, 0.35, 0.47]);
  rect(233, 667, 146, 28, [0.93, 0.99, 0.95]);
  centerText(685, 10, "ATTENDANCE QR", "F2", [0.05, 0.52, 0.28]);
  return buildPdf(pageWidth, pageHeight, lines);
}

async function qrPassAttachment(scanUrl: string, gymName: string, member: { name: string; member_code: string }): Promise<EmailAttachment> {
  const QRCode = await import("qrcode");
  const qr = QRCode.create(scanUrl, { errorCorrectionLevel: "M" });
  return {
    filename: `${safeAttachmentName(member.name)}-${member.member_code.toLowerCase()}-qr-pass.pdf`,
    content: createQrPassPdf({ matrix: qr.modules.data, size: qr.modules.size, gymName, member }),
    type: "application/pdf",
    disposition: "attachment",
  };
}

async function receiptAttachment(supabase: SupabaseClient, gym: GymEmail, payment: PaymentEmailRow): Promise<EmailAttachment> {
  const currencyCode = normalizeCurrencyCode(gym.currency_code);
  let receiptPayments: ReceiptLinePayment[] = [payment];
  if (payment.operation_id) {
    const { data, error } = await supabase
      .from("payments")
      .select("id,amount_paise,method,reference,paid_on,receipt_number,operation_id,charge_id,voided_at,payment_reversals(amount_paise)")
      .eq("gym_id", gym.id)
      .eq("operation_id", payment.operation_id)
      .eq("charge_id", payment.charge_id)
      .order("created_at", { ascending: true })
      .returns<ReceiptLinePayment[]>();
    if (error) throw error;
    if (data?.length) receiptPayments = data;
  }
  const content = createReceiptPdf({ gym, payment, payments: receiptPayments, currencyCode });
  return {
    filename: `${safeAttachmentName(payment.receipt_number)}-receipt.pdf`,
    content,
    type: "application/pdf",
    disposition: "attachment",
  };
}

export async function sendReceiptEmail(supabase: SupabaseClient, gym: GymEmail, paymentId: string, options: { origin?: string; kind?: EmailKind; createdBy?: string | null; skipIfAlreadySent?: boolean } = {}) {
  const { data: payment, error } = await supabase
    .from("payments")
    .select(paymentEmailSelect)
    .eq("id", paymentId)
    .eq("gym_id", gym.id)
    .maybeSingle<PaymentEmailRow>();
  if (error) throw error;
  if (!payment) throw new Error("Receipt not found");

  const membership = payment.charges.memberships;
  const member = membership.members;
  if (!member.email) throw new Error("This member has no email address");
  const kind = options.kind ?? "receipt";
  if (options.skipIfAlreadySent && await alreadySentEmail(supabase, { gymId: gym.id, kind, paymentId: payment.id })) {
    return { skipped: true as const };
  }

  const amount = formatInr(Number(payment.amount_paise), normalizeCurrencyCode(gym.currency_code));
  const subject = `Receipt ${payment.receipt_number} from ${gym.name}`;
  const body = [
    paragraphText(`Hi ${member.name},`),
    paragraphText(`We received your payment of ${amount} for your ${membership.plan_name} membership.`),
    paragraphText(`Your receipt is attached.`),
    paragraphText(`Membership period: ${formatDisplayDate(membership.starts_on)} to ${formatDisplayDate(membership.expires_on)}.`),
  ].join("");
  await sendTransactionalEmail(supabase, {
    gymId: gym.id,
    memberId: member.id,
    membershipId: membership.id,
    paymentId: payment.id,
    kind,
    toEmail: member.email,
    subject,
    html: emailShell("Your payment receipt", body, footerFor(gym), gym.name),
    text: `Hi ${member.name},\n\nWe received your payment of ${amount} for your ${membership.plan_name} membership.\n\nYour receipt is attached.\n\nMembership period: ${formatDisplayDate(membership.starts_on)} to ${formatDisplayDate(membership.expires_on)}.\n\n${gym.name}`,
    createdBy: options.createdBy,
    metadata: { receipt_number: payment.receipt_number, operation_id: payment.operation_id, receipt_attachment: "pdf" },
    fromName: gym.name,
    attachments: [await receiptAttachment(supabase, gym, payment)],
  });
  return { skipped: false as const };
}

export async function sendQrPassEmail(supabase: SupabaseClient, gym: GymEmail, memberId: string, options: { origin?: string; createdBy?: string | null; paymentId?: string | null } = {}) {
  const { data: member, error } = await supabase
    .from("members")
    .select("id,member_code,name,email,member_qr_credentials(public_code,enabled)")
    .eq("id", memberId)
    .eq("gym_id", gym.id)
    .maybeSingle<MemberQrEmailRow>();
  if (error) throw error;
  if (!member) throw new Error("Member not found");
  if (!member.email) throw new Error("This member has no email address");
  const credential = activeQrCredential(member.member_qr_credentials);
  if (!credential?.public_code) throw new Error("This member does not have an active QR pass");

  const origin = options.origin ?? await requestAppOrigin();
  const { scanUrl } = qrUrls(credential.public_code, origin);
  let payment: PaymentEmailRow | null = null;
  if (options.paymentId) {
    const { data: paymentData, error: paymentError } = await supabase
      .from("payments")
      .select(paymentEmailSelect)
      .eq("id", options.paymentId)
      .eq("gym_id", gym.id)
      .maybeSingle<PaymentEmailRow>();
    if (paymentError) throw paymentError;
    if (paymentData && paymentData.charges.memberships.members.id !== member.id) throw new Error("Receipt does not belong to this member");
    payment = paymentData;
  }
  const receiptAmount = payment ? formatInr(Number(payment.amount_paise), normalizeCurrencyCode(gym.currency_code)) : null;
  const subject = payment ? `Your ${gym.name} QR pass and receipt` : `Your ${gym.name} QR pass`;
  const body = [
    paragraphText(`Hi ${member.name},`),
    paragraphText(payment
      ? `Your QR pass and receipt ${payment.receipt_number} for ${receiptAmount} are attached.`
      : `Your QR pass is attached. You can save it on your phone and show it at the front desk whenever you need to check in.`),
    paragraphText(`Member ID: ${member.member_code}.`),
  ].join("");
  const attachments = [
    await qrPassAttachment(scanUrl, gym.name, member),
    ...(payment ? [await receiptAttachment(supabase, gym, payment)] : []),
  ];
  await sendTransactionalEmail(supabase, {
    gymId: gym.id,
    memberId: member.id,
    membershipId: payment?.charges.memberships.id ?? null,
    paymentId: payment?.id ?? null,
    kind: "qr_pass",
    toEmail: member.email,
    subject,
    html: emailShell(payment ? "QR pass and receipt" : "Your QR pass is ready", body, footerFor(gym), gym.name),
    text: payment
      ? `Hi ${member.name},\n\nYour QR pass and receipt ${payment.receipt_number} for ${receiptAmount} are attached.\n\nMember ID: ${member.member_code}\n\n${gym.name}`
      : `Hi ${member.name},\n\nYour QR pass is attached. You can save it on your phone and show it at the front desk whenever you need to check in.\n\nMember ID: ${member.member_code}\n\n${gym.name}`,
    createdBy: options.createdBy,
    metadata: { member_code: member.member_code, receipt_number: payment?.receipt_number ?? null, qr_attachment: "pdf", receipt_attachment: payment ? "pdf" : null },
    fromName: gym.name,
    attachments,
  });
}

export async function sendActivationEmail(supabase: SupabaseClient, gym: GymEmail, memberId: string, paymentId: string | null, options: { origin?: string; createdBy?: string | null } = {}) {
  if (!paymentId) {
    await sendQrPassEmail(supabase, gym, memberId, { origin: options.origin, createdBy: options.createdBy });
    return;
  }

  const { data: payment, error } = await supabase
    .from("payments")
    .select(activationPaymentEmailSelect)
    .eq("id", paymentId)
    .eq("gym_id", gym.id)
    .maybeSingle<PaymentEmailRow & { charges: { memberships: PaymentEmailRow["charges"]["memberships"] & { members: PaymentEmailRow["charges"]["memberships"]["members"] & { member_qr_credentials: QrCredentialRelation } } } }>();
  if (error) throw error;
  if (!payment) throw new Error("Activation payment not found");
  if (await alreadySentEmail(supabase, { gymId: gym.id, kind: "activation_qr_receipt", paymentId: payment.id })) return;

  const membership = payment.charges.memberships;
  const member = membership.members;
  if (!member.email) throw new Error("This member has no email address");
  const credential = activeQrCredential(member.member_qr_credentials);
  const origin = options.origin ?? await requestAppOrigin();
  const urls = credential?.public_code ? qrUrls(credential.public_code, origin) : null;
  const amount = formatInr(Number(payment.amount_paise), normalizeCurrencyCode(gym.currency_code));
  const subject = `Welcome to ${gym.name}`;
  const body = [
    paragraphText(`Hi ${member.name},`),
    paragraphText(`Your ${membership.plan_name} membership is active. We received ${amount}.`),
    paragraphText(`Validity period: ${formatDisplayDate(membership.starts_on)} to ${formatDisplayDate(membership.expires_on)}.`),
    urls ? paragraphText("Your QR pass is attached for quick access.") : "",
    paragraphText(`Your receipt ${payment.receipt_number} is attached.`),
  ].join("");
  const attachments = [
    ...(urls ? [await qrPassAttachment(urls.scanUrl, gym.name, member)] : []),
    await receiptAttachment(supabase, gym, payment),
  ];
  await sendTransactionalEmail(supabase, {
    gymId: gym.id,
    memberId: member.id,
    membershipId: membership.id,
    paymentId: payment.id,
    kind: "activation_qr_receipt",
    toEmail: member.email,
    subject,
    html: emailShell("Membership activated", body, footerFor(gym), gym.name),
    text: `Hi ${member.name},\n\nYour ${membership.plan_name} membership is active. We received ${amount}.\n\nValidity period: ${formatDisplayDate(membership.starts_on)} to ${formatDisplayDate(membership.expires_on)}.\n\n${urls ? "Your QR pass is attached for quick access.\n" : ""}Your receipt ${payment.receipt_number} is attached.\n\n${gym.name}`,
    createdBy: options.createdBy,
    metadata: { receipt_number: payment.receipt_number, member_code: member.member_code, qr_attachment: urls ? "pdf" : null, receipt_attachment: "pdf" },
    fromName: gym.name,
    attachments,
  });
}

export async function sendMembershipReminderEmail(supabase: SupabaseClient, input: {
  gym: GymEmail;
  member: { id: string; name: string; email: string; member_code: string };
  membership: { id: string; plan_name: string; expires_on: string };
  kind: "membership_expiring" | "membership_expired";
  deliveryMode?: "automatic" | "manual";
  forceResend?: boolean;
  createdBy?: string | null;
}) {
  const sent = await latestSentEmail(supabase, { gymId: input.gym.id, kind: input.kind, membershipId: input.membership.id });
  if (sent && !input.forceResend) return { skipped: true as const, sentAt: sent.created_at, toEmail: sent.to_email };
  if (!sent && !input.forceResend && await alreadySentEmail(supabase, { gymId: input.gym.id, kind: input.kind, membershipId: input.membership.id })) {
    return { skipped: true as const, sentAt: null, toEmail: input.member.email };
  }

  const isExpired = input.kind === "membership_expired";
  const subject = isExpired ? `${input.gym.name} membership expired` : `${input.gym.name} membership renewal reminder`;
  const title = isExpired ? "Membership expired" : "Membership renewal reminder";
  const body = [
    paragraphText(`Hi ${input.member.name},`),
    paragraphText(isExpired
      ? `Your ${input.membership.plan_name} membership ended on ${formatDisplayDate(input.membership.expires_on)}. Please contact ${input.gym.name} to renew.`
      : `Your ${input.membership.plan_name} membership ends on ${formatDisplayDate(input.membership.expires_on)}. Please contact ${input.gym.name} to renew before access ends.`),
  ].join("");
  await sendTransactionalEmail(supabase, {
    gymId: input.gym.id,
    memberId: input.member.id,
    membershipId: input.membership.id,
    kind: input.kind,
    toEmail: input.member.email,
    subject,
    html: emailShell(title, body, footerFor(input.gym), input.gym.name),
    text: isExpired
      ? `Hi ${input.member.name},\n\nYour ${input.membership.plan_name} membership ended on ${formatDisplayDate(input.membership.expires_on)}. Please contact ${input.gym.name} to renew.\n\n${input.gym.name}`
      : `Hi ${input.member.name},\n\nYour ${input.membership.plan_name} membership ends on ${formatDisplayDate(input.membership.expires_on)}. Please contact ${input.gym.name} to renew before access ends.\n\n${input.gym.name}`,
    createdBy: input.createdBy,
    metadata: { member_code: input.member.member_code, expires_on: input.membership.expires_on, delivery_mode: input.deliveryMode ?? "automatic" },
    fromName: input.gym.name,
  });
  return { skipped: false as const };
}

function footerFor(gym: GymEmail) {
  return `${gym.name}${gym.phone ? ` · ${gym.phone}` : ""}${gym.email ? ` · ${gym.email}` : ""}. Replies go to the gym team.`;
}
