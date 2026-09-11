-- Production hardening for automated WhatsApp payment reminders.
-- Supabase owns the daily schedule; the app endpoint remains the secured executor.

create extension if not exists pg_net;
create extension if not exists pg_cron;
create extension if not exists supabase_vault;

alter table public.gyms
  alter column whatsapp_payment_template_name set default 'fitkiro_payment_follow_up';

update public.gyms
set whatsapp_payment_template_name = 'fitkiro_payment_follow_up'
where whatsapp_payment_template_name = 'gymdesk_payment_follow_up';

alter table public.reminder_deliveries
  add column if not exists attempt_count integer not null default 0,
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists last_attempted_at timestamptz;

create index if not exists reminder_deliveries_claim_idx
  on public.reminder_deliveries(channel, status, claimed_at)
  where channel = 'whatsapp';

create or replace function public.claim_whatsapp_payment_reminder(
  p_gym_id uuid,
  p_membership_id uuid,
  p_charge_id uuid,
  p_scheduled_for date,
  p_recipient_snapshot text,
  p_subject_snapshot text,
  p_message_snapshot text
)
returns table(delivery_id uuid, claim_token uuid)
language sql
security definer
set search_path = public
as $$
  with valid_target as (
    select c.id as charge_id, m.id as membership_id, m.gym_id
    from public.charges c
    join public.memberships m on m.id = c.membership_id and m.gym_id = c.gym_id
    where c.id = p_charge_id
      and m.id = p_membership_id
      and c.gym_id = p_gym_id
  ),
  claim as (
    select gen_random_uuid() as token
  ),
  inserted as (
    insert into public.reminder_deliveries (
      gym_id,
      membership_id,
      rule_id,
      charge_id,
      scheduled_for,
      status,
      channel,
      recipient_snapshot,
      subject_snapshot,
      message_snapshot,
      error,
      attempt_count,
      claim_token,
      claimed_at,
      last_attempted_at
    )
    select
      valid_target.gym_id,
      valid_target.membership_id,
      null,
      valid_target.charge_id,
      p_scheduled_for,
      'failed'::public.delivery_status,
      'whatsapp',
      p_recipient_snapshot,
      p_subject_snapshot,
      p_message_snapshot,
      'Delivery claimed',
      1,
      claim.token,
      now(),
      now()
    from valid_target, claim
    on conflict (charge_id, scheduled_for, channel)
    do update set
      recipient_snapshot = excluded.recipient_snapshot,
      subject_snapshot = excluded.subject_snapshot,
      message_snapshot = excluded.message_snapshot,
      error = 'Delivery claimed',
      attempt_count = public.reminder_deliveries.attempt_count + 1,
      claim_token = excluded.claim_token,
      claimed_at = excluded.claimed_at,
      last_attempted_at = excluded.last_attempted_at
    where public.reminder_deliveries.status = 'failed'::public.delivery_status
      and (
        public.reminder_deliveries.claimed_at is null
        or public.reminder_deliveries.claimed_at < now() - interval '15 minutes'
      )
    returning id, claim_token
  )
  select inserted.id, inserted.claim_token
  from inserted;
$$;

revoke execute on function public.claim_whatsapp_payment_reminder(uuid, uuid, uuid, date, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_payment_reminder(uuid, uuid, uuid, date, text, text, text) to service_role;

comment on function public.claim_whatsapp_payment_reminder(uuid, uuid, uuid, date, text, text, text) is
  'Atomically claims one WhatsApp payment reminder delivery for a due charge. Returns no row when already submitted, skipped, or claimed by another worker.';

create or replace function public.invoke_payment_reminders_cron()
returns bigint
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  v_app_url text;
  v_cron_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_app_url
  from vault.decrypted_secrets
  where name = 'fitkiro_app_url'
  order by created_at desc
  limit 1;

  select decrypted_secret into v_cron_secret
  from vault.decrypted_secrets
  where name = 'fitkiro_cron_secret'
  order by created_at desc
  limit 1;

  if nullif(trim(v_app_url), '') is null or nullif(trim(v_cron_secret), '') is null then
    raise warning 'Skipping payment reminder cron: fitkiro_app_url or fitkiro_cron_secret is missing in Supabase Vault.';
    return null;
  end if;

  select net.http_post(
    url := trim(trailing '/' from v_app_url) || '/api/cron/reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_cron_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke execute on function public.invoke_payment_reminders_cron() from public, anon, authenticated;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname = 'fitkiro_payment_reminders_daily'
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'fitkiro_payment_reminders_daily',
  '0 3 * * *',
  $$select public.invoke_payment_reminders_cron();$$
);

notify pgrst, 'reload schema';
