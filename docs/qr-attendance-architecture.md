# QR attendance architecture

## Goal

FitKiro issues an optional QR pass to each member. An authenticated gym operator scans it with the Android PWA, which validates and records the next movement automatically before showing the member and result. Directly opening a scan URL retains explicit confirmation as a fallback.

The QR image is never persisted. A PNG is regenerated on demand from a signed URL.

## Security model

The current QR URL contains a short random public code stored on the member's QR credential row.

```text
code = 12 characters from A-H, J-N, P-Z, and 2-9
url  = /p/{code} for the member pass and /s/{code} for the operator scan
```

The code is intentionally non-sequential and avoids visually confusing characters like `I`, `O`, `0`, and `1`. It does not expose the database member ID, gym ID, phone number, or member name. The QR image is still generated on demand and is not stored.

The older encrypted/signed token shape remains accepted for backward compatibility until that member's credential is regenerated. Regenerating a QR replaces the public code and increments the credential version, immediately invalidating the previous short code and any older long-token copies. A plain hash of the member ID is not acceptable because it is predictable and cannot be revoked safely.

The database stores only credential state:

- whether the QR is enabled;
- whether the current QR was manually marked as shared;
- the current short public code;
- its current integer version;
- issuance and rotation timestamps;
- the user who last changed it.

Re-sharing uses the same public code for the current version. After the owner manually shares the QR, they can mark that current credential as shared for operational tracking. Regenerating replaces the code, increments the version atomically, and clears the shared flag because every older QR is immediately invalid. Disabling a QR prevents scans and also clears the shared flag; issuing it again creates a fresh code and increments the version so a previously disabled copy cannot become valid again.

The QR is an identifier, not proof that the person holding it is the member. The scan confirmation screen must show the member code and identifying information to the owner.

## User flow

1. The owner creates and enrolls a member.
2. The owner may select **Generate QR after creation** or skip issuance.
3. If selected, FitKiro issues QR version 1 and opens the QR management screen.
4. FitKiro renders the QR from the short scan URL.
5. The owner can:
   - copy the QR pass PNG (or download it when clipboard access is unavailable) and open WhatsApp with an individual pre-filled message containing the latest receipt link, when available;
   - download the QR PNG;
   - mark the current QR as shared after manual handoff;
   - re-share the current QR without changing it;
   - regenerate it, invalidating older copies;
   - disable it.
6. The member saves the shared pass image. The public pass URL remains available as an alternative; its view contains no phone, email, payments, or membership details.
7. The owner opens the installed **FitKiro Scanner** Android PWA. Its rear-camera view reads `/s/{token}` without navigating or opening another browser tab.
8. The authenticated POST action validates the token, gym, member, credential version, enabled state, archive state, and active membership.
9. A transactional database function atomically selects and records **Check-in** or **Check-out**. Stored enum values remain `entry` and `exit` for compatibility.
10. The PWA shows a green Check-in, blue Check-out, or red denied result for 30 seconds and emits sound/vibration feedback. The operator can close the result sooner after removing the QR; a database-enforced 30-second member cooldown prevents an immediate accidental opposite movement across refreshes and devices.
11. **Make a change** records the opposite movement as a new audited event. It does not mutate or delete the original event.
12. After 30 seconds, Attendance Logs permits undo only for that member's latest event from the current business day. The owner supplies a reason and may either undo it alone or atomically replace it with the next movement allowed by the effective sequence.
13. Opening `/s/{token}` directly remains a confirmation-based fallback, including sign-in return handling.

A GET request never records attendance. Only an authenticated scanner POST or explicit fallback form POST can write an event. This avoids false events caused by link previews, browser refreshes, crawlers, or accidental opens.

## Data model

### `member_qr_credentials`

One current credential per member. No QR image or signed token is stored.

### `attendance_events`

An attendance audit ledger containing the gym, member, active membership, direction, optional QR version, source, scanner, request ID, and timestamp. A corrected event keeps its original direction and time and gains the undo time, owner, reason, idempotency key, and optional replacement-event link. Operational reads use only events without an undo time.

Important indexes support recent gym activity and per-member history. At 1,500 members and two events per day, the expected volume is approximately 1.1 million rows per year, which PostgreSQL can handle comfortably with these indexes and paginated reads.

## Authorization

V1 uses the provisioned owner authentication and RLS boundary. Every Server Action independently calls `requireGym`, validates gym ownership, and relies on RLS/database checks. No staff accounts or roles are part of V1.

## WhatsApp constraints

No WhatsApp API is used. Individual sharing opens a `wa.me` click-to-chat link for the member with pre-filled text. The message is sent from the WhatsApp account currently signed into the owner's app or browser, and the owner must press Send.

Click-to-chat cannot attach a generated image. FitKiro reserves a WhatsApp window during the owner's click, prepares the pass PNG, and copies it to the clipboard. If clipboard support or permission is unavailable, it downloads the PNG instead. The owner pastes or attaches the image manually, reviews the pre-filled message (including the latest receipt link when available), and presses Send. A separate PNG download action is also available. Blocked pop-ups and image preparation failures are reported without claiming a successful share. Older receipts remain individually shareable from collapsed, paginated receipt history.

Because there is no WhatsApp provider callback, FitKiro does not know whether the owner actually pressed Send or whether the member received the message. The `shared_at` status is an owner-maintained operational flag, not delivery proof.

Phone numbers are normalized for the link. Ten-digit local numbers use `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` (default `91`); international numbers should be stored with a leading `+`.

## Operational rules

- Membership dates, not QR age, decide whether entry is allowed. Expiry does not rotate the credential. The same enabled QR works again when a renewal becomes active; the owner can reshare it with the new payment receipt. Explicit regeneration still invalidates every previous copy.
- Attendance direction resets by the gym's configured timezone: the first confirmed scan of each calendar day is Check-in, then movements alternate Check-out/Check-in within that day.
- A previous-day Check-in without a Check-out remains visible as a missing Check-out but never makes the next day's first scan a Check-out. FitKiro does not invent a Check-out time.
- During the scanner result, the owner can choose the opposite movement. Later correction is limited to undoing today's latest event for the member, with an optional replacement that must preserve the alternating sequence.
- Archived members and disabled, replaced, malformed, or cross-gym QRs are denied.
- Regeneration is a security action and requires explicit confirmation in the UI.
- Attendance writes use a caller-generated request UUID and a short same-direction duplicate window.
- Attendance history must be paginated before expanding beyond the initial recent-event views. Undone rows remain in backups/audit data but do not affect operational history or exports.
- `QR_SIGNING_SECRET` must be at least 32 random bytes and must not use a `NEXT_PUBLIC_` prefix.

## Implemented V1 foundation

- Optional QR issuance during member creation.
- Owner QR lifecycle management.
- Public member pass.
- Authenticated scan confirmation.
- Entry/exit attendance ledger.
- Today, current-occupancy, missed-exit, filtered history, pagination, and CSV export.
- Individual WhatsApp click-to-chat with a manual QR PNG attachment and the latest receipt link, plus older receipt sharing.
- Manual QR shared/not-shared tracking with member-list filters.

## Expired-membership access attempts (2026-09-10)

The owner scanner records a denied attempt when a current, enabled QR belongs to a non-archived member with an expired, non-reverted membership and no membership active on the gym-local date. Access remains denied. Memberships expiring today remain active; a future renewal does not grant access before its start date. Invalid, replaced, disabled, archived, and upcoming-only/no-history cases are denied without an expired-attempt entry.

`denied_access_attempts` stores the member, expired membership and expiry date, QR version, timestamp, operator, and request ID. It is a separate audit ledger: attempts never affect check-in/out sequences, occupancy, dashboard attendance totals, or correction eligibility. Gym-scoped RLS restricts reads; only the authenticated `process_qr_access` function writes after validating tenant, credential, and membership state. It locks the member and credential, suppresses repeat attempts within 30 seconds, and returns a denial normally so the audit insert commits. Reusing an original request ID returns its existing result.

The camera scanner logs automatically on its POST action and shows a red denial with “Attempt logged” or “Attempt already logged.” Direct scan URLs remain read-only on GET and offer **Log denied attempt** for eligible expired members; if renewal has since activated, this action does not create attendance. **Attendance → Denied attempts** offers member search, gym-local date filtering, sorting, pagination, and a separate denied-attempt CSV. Existing attendance views remain unchanged. Backups include the new ledger; no automatic purge is enabled.

Rollout: apply `20260910100000_expired_qr_access_attempts.sql` before deploying the app. Older app versions remain compatible but do not log denied attempts. Verify using `supabase/tests/denied_access_attempts.sql` against a disposable migrated database (the test rolls back), then scan an expired test member on the target environment and check the denied view and unchanged occupancy.
