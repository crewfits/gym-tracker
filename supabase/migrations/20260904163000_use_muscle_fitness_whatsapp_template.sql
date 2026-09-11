-- Use the Meta-approved template created for the first production WhatsApp rollout.

alter table public.gyms
  alter column whatsapp_payment_template_name set default 'muscle_fitness_payment_reminder',
  alter column whatsapp_template_language set default 'en_US';

update public.gyms
set
  whatsapp_payment_template_name = 'muscle_fitness_payment_reminder',
  whatsapp_template_language = 'en_US'
where whatsapp_payment_template_name in (
  'gymdesk_payment_follow_up',
  'fitkiro_payment_follow_up',
  'fitkiro_membership_expiry_payment_reminder'
);

notify pgrst, 'reload schema';
