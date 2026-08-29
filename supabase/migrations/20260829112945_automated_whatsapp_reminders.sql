-- Replace automated payment email with opt-in WhatsApp Cloud API reminders.

alter table public.gyms
  add column if not exists automatic_payment_whatsapp_enabled boolean not null default false,
  add column if not exists whatsapp_payment_template_name text not null default 'gymdesk_payment_follow_up',
  add column if not exists whatsapp_template_language text not null default 'en';

update public.gyms set automatic_payment_emails_enabled = false;

alter table public.members
  add column if not exists whatsapp_reminders_enabled boolean not null default false;

alter table public.reminder_deliveries
  drop constraint if exists reminder_deliveries_channel_check;

alter table public.reminder_deliveries
  add constraint reminder_deliveries_channel_check check (channel in ('email', 'whatsapp'));

comment on column public.members.whatsapp_reminders_enabled is
  'Owner-confirmed member opt-in for automated WhatsApp operational reminders.';

notify pgrst, 'reload schema';
