# RBAC and feature flags

FitKiro uses one gym access table for all staff roles:

```text
auth.users
  |-- gyms.owner_id
  `-- gym_users(gym_id, user_id, role, status)
```

Do not create separate role tables for trainers, receptionists, owners, or admins. A role belongs to the user's access row for a gym. When an active `gym_users` row exists, that row is the source of truth for the UI and server permissions; `gyms.owner_id` is only a fallback for legacy owner access.

## Roles

| Capability | Owner | Receptionist | Trainer | Admin |
|---|---:|---:|---:|---:|
| View dashboard member/attendance counts | Yes | Yes | Yes | Yes |
| View financial dashboard cards/trends | Yes | No | Yes | Yes |
| View members | Yes | Yes | Yes | Yes |
| Add member and activate membership | Yes | Yes | Yes | Yes |
| Edit member details / share member QR | Yes | Yes | Yes | Yes |
| Renew membership | Yes | No | Yes | Yes |
| Collect payments | Yes | No | Yes | Yes |
| View transactions and receipts | Yes | No | Yes | Yes |
| Export CSV | Yes | No | No | Yes |
| Manage plans | Yes | No | No | Yes |
| Manage settings | Yes | No | No | Yes |
| Manage staff | Yes | No | No | Yes |
| Manage feature flags | No | No | No | Yes |
| Use scanner | Yes | Yes | Yes | Yes |
| View attendance | Yes | Yes | Yes | Yes |
| Assign trainer | Yes | No | Yes | Yes |

`admin` is internal FitKiro access. It can manage feature flags, preview admin-enabled features, and is excluded from trainer/receptionist seat limits. Admin users should not be treated as gym staff in owner-facing trainer dropdowns.

## Feature Flags

Feature flags answer whether a feature is available for a gym. Role permissions answer whether the signed-in user may use it.

```text
show UI = role permission + feature enabled
admin preview = role is admin + admin_enabled
server security = route/action/API/database checks
```

Current flags:

| Key | Purpose | Initial state |
|---|---|---|
| `staff_roles` | Staff-role access model and staff management configuration | `enabled=false`, `admin_enabled=true` |
| `trainer_assignment` | Trainer dropdowns on activation/enrollment/renewal | `enabled=false`, `admin_enabled=true` |
| `csv_exports` | CSV export capability for permitted roles | `enabled=true`, `admin_enabled=true` |

`staff_roles.config_json` stores the current staff limits:

```json
{
  "trainerLimit": 5,
  "receptionistLimit": 1
}
```

## Testing Checklist

1. Apply migrations.
2. Sign in as owner and open Settings -> Staff.
3. Create one receptionist and up to five trainers.
4. Confirm the sixth active trainer is rejected.
5. Confirm a second active receptionist is rejected.
6. Sign in as receptionist:
   - Dashboard shows member/attendance counts without financial cards or trend selector.
   - Members, Add member, Scanner, and Attendance are visible.
   - Transactions, Reminders, Plans, Settings, Staff, payment collection, renewal, and CSV exports are unavailable.
   - Direct export URLs return `403`.
7. Sign in as trainer:
   - Dashboard financial cards, Members, Add member, Reminders, Transactions, Scanner, and Attendance are visible.
   - Activation, renewal, collection, trainer assignment, and receipt review are available.
   - Staff, Settings, Plans, and CSV exports are unavailable.
8. Sign in as owner:
   - Staff management is available.
   - Feature flags are hidden.
9. Sign in as admin:
   - Admin-enabled feature flags are visible even when `enabled=false`.
   - Staff and feature flag controls are available.
10. Turn on `trainer_assignment` in Settings -> Staff.
11. Confirm owner/receptionist see trainer dropdowns on add member, enroll, and renew.
12. Turn off `trainer_assignment` and leave admin preview on.
13. Confirm only admin sees trainer dropdowns.

## Operational Notes

Staff login creation uses a service-role server action. The temporary password is shown once in the success message and must be shared securely. Staff access can be disabled without deleting the Supabase Auth user.

UI hiding is not the authorization boundary. Server Actions, API routes, route pages, RLS, and database functions must continue to enforce role and gym access for every sensitive operation.
