# QR attendance architecture

## Goal

GymDesk will issue an optional QR pass to each member. An authenticated gym operator scans the pass, reviews the member and membership status, and explicitly records an entry or exit event.

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
- the current short public code;
- its current integer version;
- issuance and rotation timestamps;
- the user who last changed it.

Re-sharing uses the same public code for the current version. Regenerating replaces the code and increments the version atomically, immediately invalidating every older QR. Disabling a QR prevents scans; issuing it again creates a fresh code and increments the version so a previously disabled copy cannot become valid again.

The QR is an identifier, not proof that the person holding it is the member. The scan confirmation screen must show the member code and identifying information to the owner.

## User flow

1. The owner creates and enrolls a member.
2. The owner may select **Generate QR after creation** or skip issuance.
3. If selected, GymDesk issues QR version 1 and opens the QR management screen.
4. GymDesk renders the QR from the short scan URL.
5. The owner can:
   - open WhatsApp with an individual pre-filled message containing the public pass link;
   - download the QR PNG;
   - re-share the current QR without changing it;
   - regenerate it, invalidating older copies;
   - disable it.
6. The member opens the public pass link to display their QR. The public view contains no phone, email, payments, or membership details.
7. An owner scans the QR using any QR scanner. It opens `/s/{token}`.
8. If necessary, GymDesk requests login and returns to the original scan URL.
9. The server validates the HMAC, gym, member, credential version, enabled state, archive state, and active membership.
10. The operator explicitly records **Check-in** or **Check-out** through an authenticated POST action. Stored enum values remain `entry` and `exit` for compatibility.
11. A transactional database function records the event and prevents duplicate submissions.

A GET request never records attendance. This avoids false events caused by link previews, browser refreshes, crawlers, or accidental opens.

## Data model

### `member_qr_credentials`

One current credential per member. No QR image or signed token is stored.

### `attendance_events`

An append-only attendance ledger containing the gym, member, active membership, direction, QR version, scanner, request ID, and timestamp.

Important indexes support recent gym activity and per-member history. At 1,500 members and two events per day, the expected volume is approximately 1.1 million rows per year, which PostgreSQL can handle comfortably with these indexes and paginated reads.

## Authorization

V1 uses the provisioned owner authentication and RLS boundary. Every Server Action independently calls `requireGym`, validates gym ownership, and relies on RLS/database checks. No staff accounts or roles are part of V1.

## WhatsApp constraints

No WhatsApp API is used. Individual sharing opens a `wa.me` click-to-chat link for the member with pre-filled text. The message is sent from the WhatsApp account currently signed into the owner's app or browser, and the owner must press Send.

Click-to-chat cannot attach a generated image reliably. GymDesk therefore shares the public pass link as the primary WhatsApp flow. The member opens that link to view the QR and can download/save the QR PNG from their phone. The owner can also download the QR PNG from the management screen for manual sharing when needed.

Phone numbers are normalized for the link. Ten-digit local numbers use `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` (default `91`); international numbers should be stored with a leading `+`.

## Operational rules

- Membership dates, not QR age, decide whether entry is allowed.
- Attendance direction resets by the gym's configured timezone: the first confirmed scan of each calendar day is Check-in, then movements alternate Check-out/Check-in within that day.
- A previous-day Check-in without a Check-out remains visible as a missing Check-out but never makes the next day's first scan a Check-out. GymDesk does not invent a Check-out time.
- Operators retain a manual Check-in/Check-out override because a missed same-day scan cannot be inferred reliably.
- Archived members and disabled, replaced, malformed, or cross-gym QRs are denied.
- Regeneration is a security action and requires explicit confirmation in the UI.
- Attendance writes use a caller-generated request UUID and a short same-direction duplicate window.
- Attendance history must be paginated before expanding beyond the initial recent-event views.
- `QR_SIGNING_SECRET` must be at least 32 random bytes and must not use a `NEXT_PUBLIC_` prefix.

## Implemented V1 foundation

- Optional QR issuance during member creation.
- Owner QR lifecycle management.
- Public member pass.
- Authenticated scan confirmation.
- Entry/exit attendance ledger.
- Today, current-occupancy, missed-exit, filtered history, pagination, and CSV export.
- Individual WhatsApp click-to-chat using the public pass link and a direct QR PNG download.
