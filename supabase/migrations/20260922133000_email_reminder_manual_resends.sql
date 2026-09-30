-- Keep automated membership reminder emails idempotent while allowing
-- explicitly confirmed manual resends to be audited as separate rows.

drop index if exists public.email_delivery_events_sent_reminder_once_idx;

create unique index if not exists email_delivery_events_sent_automatic_reminder_once_idx
  on public.email_delivery_events(gym_id, membership_id, kind)
  where status = 'sent'
    and kind in ('membership_expiring', 'membership_expired')
    and coalesce(metadata->>'delivery_mode', 'automatic') = 'automatic';
