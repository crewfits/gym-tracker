-- Use the final Meta-approved template name for membership expiry payment reminders.

alter table public.gyms
  alter column whatsapp_payment_template_name set default 'membership_payment_reminder';

update public.gyms
set whatsapp_payment_template_name = 'membership_payment_reminder'
where whatsapp_payment_template_name in (
  'gymdesk_payment_follow_up',
  'fitkiro_payment_follow_up',
  'fitkiro_membership_expiry_payment_reminder',
  'muscle_fitness_payment_reminder'
);

notify pgrst, 'reload schema';
