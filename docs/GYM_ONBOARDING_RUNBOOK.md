# Gym onboarding runbook

Use this runbook when FitKiro onboards a new client gym. It first provisions the gym with the FitKiro internal support team as admins, then assigns the client owner when their email is available.

The first-client access model is deliberately simple:

```text
Supabase Auth identity
        |
        +-- gyms.owner_id                 one client owner per gym
        |
        `-- gym_users(gym_id, role)       one role for each user in that gym
```

The client owner has the `owner` role. Each internal FitKiro team member has a separate Auth identity and one `gym_users` row with the `admin` role for the client gym. Admin access is scoped to that gym; it does not grant access to every gym automatically.

`gyms.owner_id` is required by the database from the moment a gym is created. Until the client owner is known, one internal Admin is recorded there as the **provisioning owner**. That person still receives the `admin` application role through `gym_users`; the field only acts as the required ownership anchor and legacy fallback. Transfer it to the real client owner during the second onboarding step.

FitKiro currently supports one gym context per signed-in identity. Do not make a client owner the owner of more than one gym. If a future multi-gym product is needed, the active-gym selection and access model must be designed before provisioning it.

## Who does what

| Account | Created in | Role for this gym | Purpose |
|---|---|---|---|
| Provisioning owner | One of the three internal Admin accounts | `admin` | Temporary required `gyms.owner_id` while the client owner email is unavailable. |
| Client owner | Supabase Authentication, then ownership-transfer SQL | `owner` | Client's full operational access. Cannot see internal admin accounts or feature flags. |
| FitKiro internal admin (three team accounts) | Supabase Authentication, then onboarding SQL | `admin` | Support, staff management, feature-flag control, and pre-release testing. |
| Trainer / receptionist | Settings -> Staff after owner or admin sign-in | `trainer` / `receptionist` | Day-to-day client staff access. |

Never share one login between people. Do not give the client owner the `admin` role. Keep the three internal admins separate so actions can be audited by account.

## Before starting

1. Choose the correct Supabase project: **dev** for rehearsal and testing, then **prod** for the client.
2. Apply every repository migration to that project before creating the gym.
3. In **Authentication -> Users**, create and confirm the three FitKiro Admin accounts. Have each person use a password-reset email to choose their own password before first sign-in.
4. Choose one of those three as the temporary provisioning owner.
5. Record the exact email addresses. The SQL block below refuses to run if any required Auth user is missing.

Creating Auth users in the Supabase dashboard is intentional. The SQL editor should create the application records and roles; it should not insert passwords directly into `auth.users`.

## One-time onboarding SQL

Run this in **Supabase Dashboard -> SQL Editor** for the intended project. Replace the gym name and the three internal admin emails before running it. Set `v_provisioning_owner_email` to one of the three Admin emails. The whole operation is transactional: if an account is missing or any insert fails, no gym or role mapping is created.

```sql
begin;

do $$
declare
  v_gym_name constant text := 'Client Gym Name';
  v_admin_emails constant text[] := array[
    'admin-one@fitkiro.com',
    'admin-two@fitkiro.com',
    'admin-three@fitkiro.com'
  ];
  v_provisioning_owner_email constant text := 'admin-one@fitkiro.com';
  v_provisioning_owner_id uuid;
  v_admin_id uuid;
  v_gym_id uuid;
  v_email text;
begin
  -- A gym requires owner_id immediately. Use one of the internal Admin
  -- accounts until the real client owner is known.
  select id into v_provisioning_owner_id
  from auth.users
  where lower(email) = lower(v_provisioning_owner_email)
  limit 1;

  if v_provisioning_owner_id is null then
    raise exception 'Provisioning owner % was not found in Authentication -> Users', v_provisioning_owner_email;
  end if;

  if not exists (
    select 1
    from unnest(v_admin_emails) as admin_email
    where lower(admin_email) = lower(v_provisioning_owner_email)
  ) then
    raise exception 'Provisioning owner % must be one of v_admin_emails', v_provisioning_owner_email;
  end if;

  if exists (select 1 from public.gyms where owner_id = v_provisioning_owner_id) then
    raise exception 'Provisioning owner % is already the ownership anchor for another FitKiro gym', v_provisioning_owner_email;
  end if;

  -- Every internal admin must already exist in Supabase Authentication.
  foreach v_email in array v_admin_emails loop
    select id into v_admin_id
    from auth.users
    where lower(email) = lower(v_email)
    limit 1;

    if v_admin_id is null then
      raise exception 'Internal admin % was not found in Authentication -> Users', v_email;
    end if;
  end loop;

  insert into public.gyms (
    owner_id,
    name,
    timezone,
    is_active,
    currency_code
  )
  values (
    v_provisioning_owner_id,
    v_gym_name,
    'Asia/Kolkata',
    true,
    'INR'
  )
  returning id into v_gym_id;

  -- Map every FitKiro internal account to this one gym as an admin.
  foreach v_email in array v_admin_emails loop
    select id into v_admin_id
    from auth.users
    where lower(email) = lower(v_email)
    limit 1;

    insert into public.gym_users (gym_id, user_id, role, status, display_name)
    values (v_gym_id, v_admin_id, 'admin', 'active', split_part(v_email, '@', 1));
  end loop;

  -- Initial feature flags. Admin preview remains available to internal admins.
  insert into public.gym_feature_flags (gym_id, key, enabled, admin_enabled, config_json)
  values
    (v_gym_id, 'staff_roles', true, true,
      '{"trainerLimit": 5, "receptionistLimit": 1}'::jsonb),
    (v_gym_id, 'trainer_assignment', true, true, '{}'::jsonb),
    (v_gym_id, 'csv_exports', true, true, '{}'::jsonb);

  raise notice 'Created gym ID: %', v_gym_id;
end $$;

commit;
```

The three flag defaults mean:

| Flag | Launch value | Effect |
|---|---:|---|
| `staff_roles` | On | Staff-role configuration is available. Trainers are limited to 5 and receptionists to 1. |
| `trainer_assignment` | On | Owner, admin, and permitted staff can assign an active trainer while activating, enrolling, or renewing. |
| `csv_exports` | On | CSV is available only to owner and admin. Trainer and receptionist export endpoints remain blocked. |

To hold back a feature for the client while allowing internal verification, set its `enabled` value to `false` and leave `admin_enabled` as `true`. Only the admins mapped to that gym can use the Admin preview.

## Verify immediately after provisioning

Run this read-only query. Before the client owner is assigned, it should show three active admins and no client owner row.

```sql
select
  g.name as gym_name,
  u.email,
  gu.display_name,
  gu.role,
  gu.status
from public.gym_users gu
join public.gyms g on g.id = gu.gym_id
join auth.users u on u.id = gu.user_id
where g.name = 'Client Gym Name'
order by
  case gu.role when 'owner' then 0 when 'admin' then 1 else 2 end,
  u.email;
```

Then sign in as one internal admin. The gym can now be configured and tested by your team. Do not give client access until the owner-transfer step below is complete.

## Assign the client owner later

When the client owner email is available:

1. Create and confirm their Auth account in **Authentication -> Users**.
2. Copy the gym UUID printed as `Created gym ID` by the first SQL block.
3. Replace the gym UUID, owner email, and display name in the SQL below.
4. Run it in the same Supabase project where the gym was created.

This changes only `gyms.owner_id` and inserts the client owner's `owner` row. Your three Admin mappings remain intact.

```sql
begin;

do $$
declare
  v_gym_id constant uuid := 'replace-with-created-gym-uuid';
  v_owner_email constant text := 'owner@example.com';
  v_owner_name constant text := 'Client Owner Name';
  v_owner_id uuid;
begin
  if not exists (select 1 from public.gyms where id = v_gym_id) then
    raise exception 'Gym % was not found', v_gym_id;
  end if;

  select id into v_owner_id
  from auth.users
  where lower(email) = lower(v_owner_email)
  limit 1;

  if v_owner_id is null then
    raise exception 'Client owner % was not found in Authentication -> Users', v_owner_email;
  end if;

  if exists (select 1 from public.gyms where owner_id = v_owner_id and id <> v_gym_id) then
    raise exception 'Client owner % already owns another FitKiro gym', v_owner_email;
  end if;

  update public.gyms
  set owner_id = v_owner_id
  where id = v_gym_id;

  insert into public.gym_users (gym_id, user_id, role, status, display_name)
  values (v_gym_id, v_owner_id, 'owner', 'active', v_owner_name)
  on conflict (gym_id, user_id) do update
  set role = 'owner', status = 'active', display_name = excluded.display_name, updated_at = now();
end $$;

commit;
```

Then sign in separately as the client owner and one internal admin:

1. The owner should see the gym, staff page, and standard operational screens, but not the internal admin rows or feature-flag controls.
2. The admin should see the same operational access plus internal admin rows and feature flags.
3. In **Settings -> Staff**, create one trainer and one receptionist and verify their reduced navigation and blocked CSV exports.
4. Confirm the gym name, timezone, contact details, receipt prefix, and currency in **Settings** before importing client members.

## Ongoing staff onboarding

After the client owner has been assigned, do not use SQL for trainers, receptionists, or additional admins:

1. Sign in as an internal Admin.
2. Open **Settings -> Staff**.
3. Enter name, email, optional phone, and role.
4. The new user receives an invitation email from Supabase. They use that link to choose their own password before signing in.

The UI creates the Supabase Auth account through an invitation and then creates the correctly scoped `gym_users` row. It enforces the configured trainer and receptionist limits. Only internal Admins can create or edit Admin accounts.

## Offboarding and recovery

- Disable a trainer or receptionist in **Settings -> Staff**; do not delete their Auth account. Their historical actions remain attributable.
- To completely remove an incorrectly created or test user from the current environment, run this from the repository root:

  ```bash
  npm run user:remove -- --email=user@example.com --confirm
  ```

  For the explicitly selected environment, use one of these commands instead of relying on `.env.local`:

  ```bash
  npm run user:remove:dev -- --email=user@example.com --confirm
  npm run user:remove:prod -- --email=user@example.com --confirm
  ```

  The script deletes the Supabase Auth identity and every `gym_users` mapping for that email. It also clears that person's trainer assignments and membership/payment handler references before deletion, so the user can no longer sign in or appear as staff. It refuses to remove a gym owner because deleting that Auth identity would cascade-delete the gym and its client data. Transfer ownership first. Use **Disable** in the Staff screen for normal staff offboarding so past activity continues to identify the staff member.
- Do not remove all three internal admins at once. Keep at least two active internal admins mapped to every production gym.
- To disable a whole client gym, use the controlled owner-access procedure rather than deleting its data.
- Never delete a gym as part of normal offboarding. Back up and follow the agreed retention process first.

## Environment discipline

Repeat the same onboarding only after it has been tested in dev. Keep the identities and data separate:

| Environment | Supabase project | Cloudflare URL | Intended data |
|---|---|---|---|
| Dev | Dev Supabase account/project | `https://dev.fitkiro.com` | Test gym, test users, test members only |
| Prod | Production Supabase account/project | `https://musclefitness.fitkiro.com` | Client gym and real client data only |

See [deployment environments](DEPLOYMENT_ENVIRONMENTS.md) for the deployment commands and [RBAC and feature flags](RBAC_AND_FEATURE_FLAGS.md) for the permissions matrix.
