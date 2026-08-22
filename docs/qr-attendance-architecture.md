# QR attendance architecture

## Goal

GymDesk will issue an optional QR pass to each member. An authenticated gym operator scans the pass, reviews the member and membership status, and explicitly records an entry or exit event.

The QR image is never persisted. A PNG is regenerated on demand from a signed URL.

## Security model

The QR URL contains a compact payload with the gym ID, member ID, and credential version. The payload is signed with HMAC-SHA256 using `QR_SIGNING_SECRET`.

```text
payload   = base64url({ gymId, memberId, version })
signature = base64url(HMAC-SHA256(QR_SIGNING_SECRET, payload))
token     = payload.signature
```

The secret is server-only and must be stable across deployments. A plain hash of the member ID is not acceptable because it is unkeyed and cannot be revoked safely.

The database stores only credential state:

- whether the QR is enabled;
- its current integer version;
- issuance and rotation timestamps;
- the user who last changed it.

Re-sharing regenerates the same signed URL for the current version. Regenerating increments the version atomically, immediately invalidating every older QR. Disabling a QR prevents scans; issuing it again increments the version so a previously disabled copy cannot become valid again.

The QR is an identifier, not proof that the person holding it is the member. The scan confirmation screen must show the member code and identifying information to the owner.

## User flow

1. The owner creates and enrolls a member.
2. The owner may select **Generate QR after creation** or skip issuance.
3. If selected, GymDesk issues QR version 1 and opens the QR management screen.
4. GymDesk renders the QR from the signed scan URL.
5. The owner can:
   - open WhatsApp with an individual pre-filled message containing the public pass link;
   - use the operating-system share sheet for the QR PNG where file sharing is supported;
   - copy the PNG to the desktop clipboard and open WhatsApp Web as a fallback;
   - download the QR PNG;
   - re-share the current QR without changing it;
   - regenerate it, invalidating older copies;
   - disable it.
6. The member opens the public pass link to display their QR. The public view contains no phone, email, payments, or membership details.
7. An owner scans the QR using any QR scanner. It opens `/scan/{token}`.
8. If necessary, GymDesk requests login and returns to the original scan URL.
9. The server validates the HMAC, gym, member, credential version, enabled state, archive state, and active membership.
10. The operator explicitly records **Entry** or **Exit** through an authenticated POST action.
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

Click-to-chat cannot attach a generated image. GymDesk therefore uses native Web Share with a generated PNG on supported mobile platforms. On desktop it copies the PNG to the clipboard before opening WhatsApp Web so the owner can paste it into the chat. If image clipboard access is unavailable, GymDesk downloads the PNG for manual attachment. The public pass URL remains in the message as a reliable fallback.

Phone numbers are normalized for the link. Ten-digit local numbers use `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` (default `91`); international numbers should be stored with a leading `+`.

## Operational rules

- Membership dates, not QR age, decide whether entry is allowed.
- Attendance direction resets by the gym's configured timezone: the first confirmed scan of each calendar day is entry, then movements alternate exit/entry within that day.
- A previous-day entry without an exit remains visible as a missed exit but never makes the next day's first scan an exit. GymDesk does not invent an exit time.
- Operators retain a manual entry/exit override because a missed same-day scan cannot be inferred reliably.
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
- Individual WhatsApp click-to-chat, native share, and download fallback.
