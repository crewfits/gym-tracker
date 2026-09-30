-- Audit and idempotency log for FitKiro transactional emails.

create table if not exists public.email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  membership_id uuid references public.memberships(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  kind text not null check (kind in (
    'activation_qr_receipt',
    'qr_pass',
    'receipt',
    'membership_expiring',
    'membership_expired'
  )),
  to_email text not null,
  subject text not null,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  provider text not null default 'cloudflare',
  provider_message_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists email_delivery_events_gym_time_idx
  on public.email_delivery_events(gym_id, created_at desc);

create index if not exists email_delivery_events_member_time_idx
  on public.email_delivery_events(member_id, created_at desc);

create unique index if not exists email_delivery_events_sent_reminder_once_idx
  on public.email_delivery_events(gym_id, membership_id, kind)
  where status = 'sent' and kind in ('membership_expiring', 'membership_expired');

create unique index if not exists email_delivery_events_activation_payment_once_idx
  on public.email_delivery_events(gym_id, payment_id, kind)
  where status = 'sent' and kind = 'activation_qr_receipt' and payment_id is not null;

alter table public.email_delivery_events enable row level security;

drop policy if exists "owner email delivery read" on public.email_delivery_events;
create policy "owner email delivery read" on public.email_delivery_events
for select
to authenticated
using (gym_id = public.current_gym_id());

drop policy if exists "owner email delivery insert" on public.email_delivery_events;
create policy "owner email delivery insert" on public.email_delivery_events
for insert
to authenticated
with check (gym_id = public.current_gym_id());

revoke all on table public.email_delivery_events from anon;
grant select, insert on table public.email_delivery_events to authenticated;
grant all on table public.email_delivery_events to service_role;
