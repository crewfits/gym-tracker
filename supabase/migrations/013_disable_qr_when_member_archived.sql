-- Archiving is an access-control action. It must invalidate QR access even
-- when the member is archived outside the application UI.

create or replace function public.disable_archived_member_qr()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.is_archived and not old.is_archived then
    update public.member_qr_credentials
    set enabled = false,
        rotated_at = now()
    where gym_id = new.gym_id
      and member_id = new.id
      and enabled;
  end if;
  return new;
end;
$$;

drop trigger if exists disable_qr_when_member_archived on public.members;
create trigger disable_qr_when_member_archived
after update of is_archived on public.members
for each row execute function public.disable_archived_member_qr();

update public.member_qr_credentials credential
set enabled = false,
    rotated_at = now()
from public.members member
where member.id = credential.member_id
  and member.gym_id = credential.gym_id
  and member.is_archived
  and credential.enabled;

notify pgrst, 'reload schema';
