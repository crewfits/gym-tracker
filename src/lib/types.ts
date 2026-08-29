export type DurationUnit = "days" | "months";
export type PaymentMethod = "cash" | "upi" | "card" | "bank_transfer";
export type PaymentStatus = "unpaid" | "partial" | "paid";
export type MembershipStatus = "active" | "expiring" | "expired" | "upcoming";
export type AttendanceDirection = "entry" | "exit";

export interface Member { id: string; gym_id: string; member_code: string; name: string; phone: string; email: string | null; notes: string | null; profile_photo_path: string | null; is_archived: boolean; created_at: string }
export interface Plan { id: string; gym_id: string; name: string; duration_value: number; duration_unit: DurationUnit; default_fee_paise: number; is_active: boolean }
export interface Membership { id: string; gym_id: string; member_id: string; plan_id: string | null; plan_name: string; starts_on: string; expires_on: string; created_at: string }
export interface Charge { id: string; gym_id: string; membership_id: string; subtotal_paise: number; discount_paise: number; gst_rate_basis_points: number; tax_paise: number; total_paise: number; paid_paise: number; balance_paise: number }
export interface Payment { id: string; gym_id: string; charge_id: string; amount_paise: number; method: PaymentMethod; reference: string | null; paid_on: string; notes: string | null; receipt_number: string; voided_at: string | null; void_reason: string | null }
export interface Receipt { receipt_number: string; payment: Payment; charge: Charge; member: Member; membership: Membership }
export interface ReminderRule { id: string; gym_id: string; days_before: number; enabled: boolean }
export interface ReminderDelivery { id: string; gym_id: string; membership_id: string; rule_id: string; scheduled_for: string; status: "sent" | "skipped" | "failed"; provider_id: string | null; error: string | null }
export interface MemberQrCredential { member_id: string; gym_id: string; public_code: string; version: number; enabled: boolean; issued_at: string; rotated_at: string | null; changed_by: string | null; shared_at: string | null; shared_by: string | null; share_method: string | null; updated_at: string }
export interface AttendanceEvent { id: string; gym_id: string; member_id: string; membership_id: string | null; direction: AttendanceDirection; qr_version: number; scanned_by: string | null; request_id: string; occurred_at: string; created_at: string }
