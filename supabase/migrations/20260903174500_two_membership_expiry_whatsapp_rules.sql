-- Keep automated expiry-payment WhatsApp reminders to two production rules:
-- 7 days before membership expiry and on the expiry date.

insert into public.reminder_rules(gym_id, days_before, enabled)
select gyms.id, rule_days.days_before, true
from public.gyms
cross join (values (7), (0)) as rule_days(days_before)
on conflict (gym_id, days_before) do update set enabled = true;

update public.reminder_rules
set enabled = false
where days_before in (1, 3);

create or replace function public.bootstrap_gym(gym_name text default 'My Gym')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  insert into public.gyms(owner_id, name)
  values(auth.uid(), coalesce(nullif(trim(gym_name), ''), 'My Gym'))
  on conflict(owner_id) do update set name = excluded.name
  returning id into new_id;

  insert into public.reminder_rules(gym_id, days_before, enabled)
  values(new_id, 7, true), (new_id, 0, true)
  on conflict (gym_id, days_before) do update set enabled = true;

  return new_id;
end $$;

revoke execute on function public.bootstrap_gym(text) from public, anon, authenticated;

comment on table public.reminder_rules is
  'Membership-expiry reminder rules. Current automated WhatsApp production rules are 7 days before expiry and on expiry day; future reminder types should add an explicit type/channel contract.';

notify pgrst, 'reload schema';
