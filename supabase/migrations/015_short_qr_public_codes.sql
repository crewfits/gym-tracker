-- Short first-party QR codes for WhatsApp-friendly pass links.
--
-- This keeps the QR image/token out of the database while storing a revocable,
-- non-guessable lookup code on the credential row.

create or replace function public.new_qr_public_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  bytes bytea;
  attempts integer := 0;
  index integer;
begin
  loop
    attempts := attempts + 1;
    candidate := '';
    bytes := extensions.gen_random_bytes(12);

    for index in 0..11 loop
      candidate := candidate || substr(alphabet, (get_byte(bytes, index) % length(alphabet)) + 1, 1);
    end loop;

    exit when not exists (
      select 1 from public.member_qr_credentials
      where public_code = candidate
    );

    if attempts >= 10 then
      raise exception 'Could not generate a unique QR code';
    end if;
  end loop;

  return candidate;
end;
$$;

alter table public.member_qr_credentials
  add column if not exists public_code text;

do $$
declare
  credential record;
begin
  for credential in
    select member_id from public.member_qr_credentials
    where public_code is null
    for update
  loop
    update public.member_qr_credentials
    set public_code = public.new_qr_public_code()
    where member_id = credential.member_id;
  end loop;
end;
$$;

alter table public.member_qr_credentials
  alter column public_code set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'member_qr_credentials_public_code_format'
      and conrelid = 'public.member_qr_credentials'::regclass
  ) then
    alter table public.member_qr_credentials
      add constraint member_qr_credentials_public_code_format
      check (public_code ~ '^[A-HJ-NP-Z2-9]{12}$');
  end if;
end;
$$;

create unique index if not exists member_qr_credentials_public_code_key
  on public.member_qr_credentials(public_code);

create or replace function public.issue_member_qr(p_member_id uuid)
returns public.member_qr_credentials
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_gym uuid;
  result public.member_qr_credentials;
begin
  current_gym := public.current_gym_id();
  if current_gym is null then raise exception 'Gym profile not found'; end if;

  if not exists (
    select 1 from public.members
    where id = p_member_id and members.gym_id = current_gym and not is_archived
  ) then
    raise exception 'Active member not found';
  end if;

  insert into public.member_qr_credentials(member_id, gym_id, public_code, version, enabled, changed_by)
  values (p_member_id, current_gym, public.new_qr_public_code(), 1, true, auth.uid())
  on conflict (member_id) do update
    set version = member_qr_credentials.version + 1,
        public_code = public.new_qr_public_code(),
        enabled = true,
        rotated_at = now(),
        changed_by = auth.uid(),
        updated_at = now()
  returning * into result;

  return result;
end;
$$;

notify pgrst, 'reload schema';
