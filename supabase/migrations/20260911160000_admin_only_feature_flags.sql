do $$
begin
  if to_regclass('public.gym_feature_flags') is not null then
    drop policy if exists "owner manages flags" on public.gym_feature_flags;
    create policy "admin manages flags" on public.gym_feature_flags for all to authenticated
      using (gym_id = public.current_gym_id() and public.current_gym_role() = 'admin')
      with check (gym_id = public.current_gym_id() and public.current_gym_role() = 'admin');
  end if;
end $$;

notify pgrst, 'reload schema';
