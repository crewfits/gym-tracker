-- Run after signing up and calling bootstrap_gym from the onboarding screen.
insert into public.plans (gym_id, name, duration_value, duration_unit, default_fee_paise)
select id, 'Monthly', 1, 'months', 150000 from public.gyms where owner_id = auth.uid()
on conflict (gym_id, name) do nothing;
insert into public.plans (gym_id, name, duration_value, duration_unit, default_fee_paise)
select id, 'Quarterly', 3, 'months', 400000 from public.gyms where owner_id = auth.uid()
on conflict (gym_id, name) do nothing;
