-- Retarget automated WhatsApp reminders to membership-expiry renewal payments only.

insert into public.reminder_rules(gym_id, days_before)
select id, 7
from public.gyms
on conflict (gym_id, days_before) do nothing;

alter table public.gyms
  alter column whatsapp_payment_template_name set default 'fitkiro_membership_expiry_payment_reminder';

update public.gyms
set whatsapp_payment_template_name = 'fitkiro_membership_expiry_payment_reminder'
where whatsapp_payment_template_name in ('gymdesk_payment_follow_up', 'fitkiro_payment_follow_up');

drop function if exists public.claim_whatsapp_payment_reminder(uuid, uuid, uuid, date, text, text, text);

create or replace function public.claim_whatsapp_payment_reminder(
  p_gym_id uuid,
  p_membership_id uuid,
  p_rule_id uuid,
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
    select ms.id as membership_id, ms.gym_id
    from public.memberships ms
    join public.reminder_rules rr on rr.id = p_rule_id and rr.gym_id = ms.gym_id and rr.enabled
    where ms.id = p_membership_id
      and ms.gym_id = p_gym_id
      and ms.starts_on <= p_scheduled_for
      and ms.expires_on = p_scheduled_for + rr.days_before
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
      p_rule_id,
      null,
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
    on conflict (membership_id, rule_id, scheduled_for)
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
      and public.reminder_deliveries.channel = 'whatsapp'
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
  'Atomically claims one WhatsApp membership-expiry payment reminder. Returns no row when already submitted, skipped, not due, or claimed by another worker.';

notify pgrst, 'reload schema';
