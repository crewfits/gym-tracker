-- Reactivate an archived member without restoring a previously shared QR.

create or replace function public.reactivate_archived_member(p_member_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_gym uuid := public.current_gym_id();
begin
  update public.member_qr_credentials
  set enabled = false,
      rotated_at = now(),
      changed_by = auth.uid(),
      updated_at = now()
  where gym_id = current_gym
    and member_id = p_member_id;

  update public.members
  set is_archived = false,
      updated_at = now()
  where gym_id = current_gym
    and id = p_member_id
    and is_archived;

  if not found then
    raise exception 'Archived member not found';
  end if;
end;
$$;

revoke execute on function public.reactivate_archived_member(uuid) from public, anon;
grant execute on function public.reactivate_archived_member(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
