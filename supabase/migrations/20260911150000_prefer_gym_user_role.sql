create or replace function public.current_gym_role()
returns public.gym_role language sql stable security definer set search_path = public as $$
  select coalesce(
    (
      select gu.role
      from public.gym_users gu
      where gu.user_id = auth.uid() and gu.status = 'active' and gu.gym_id = public.current_gym_id()
      limit 1
    ),
    (
      select 'owner'::public.gym_role
      from public.gyms g
      where g.owner_id = auth.uid() and g.id = public.current_gym_id()
      limit 1
    )
  )
$$;

notify pgrst, 'reload schema';
