--
-- PostgreSQL database dump
--

\restrict NbL1xJzXQqHEnvicrVMT7AAxgtkCzs7gse5RRBMIETyZX2G6eeN439bEdOvlJNV

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: attendance_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.attendance_direction AS ENUM (
    'entry',
    'exit'
);


--
-- Name: duration_unit; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.duration_unit AS ENUM (
    'days',
    'months'
);


--
-- Name: gym_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.gym_role AS ENUM (
    'owner',
    'receptionist',
    'trainer',
    'admin'
);


--
-- Name: gym_user_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.gym_user_status AS ENUM (
    'active',
    'disabled'
);


--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_method AS ENUM (
    'cash',
    'upi',
    'card',
    'bank_transfer'
);


--
-- Name: admin_import_member(uuid, text, text, text, text, boolean, uuid, date, date, date, bigint, bigint, public.payment_method, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_import_member(p_gym_id uuid, p_name text, p_phone text, p_email text, p_notes text, p_is_archived boolean, p_plan_id uuid, p_starts_on date, p_expires_on date, p_due_on date, p_total_paise bigint, p_paid_paise bigint, p_payment_method public.payment_method, p_payment_date date, p_payment_reference text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  gym_record public.gyms;
  plan_record public.plans;
  member_record public.members;
  membership_id uuid;
  charge_id uuid;
  payment_id uuid;
begin
  select * into gym_record from public.gyms where id = p_gym_id for update;
  if gym_record.id is null then raise exception 'Gym not found'; end if;
  if nullif(trim(p_name), '') is null or length(regexp_replace(p_phone, '\D', '', 'g')) < 7 then raise exception 'Invalid member identity'; end if;

  insert into public.members(gym_id, member_code, name, phone, email, notes, is_archived)
  values(
    gym_record.id,
    'MEM-' || lpad(gym_record.next_member_number::text, 5, '0'),
    trim(p_name), trim(p_phone), nullif(trim(p_email), ''), nullif(trim(p_notes), ''), p_is_archived
  ) returning * into member_record;
  update public.gyms set next_member_number = next_member_number + 1 where id = gym_record.id;

  if p_plan_id is null then
    if not p_is_archived then raise exception 'Current member requires a plan'; end if;
    return jsonb_build_object('member_id', member_record.id, 'membership_id', null, 'payment_id', null);
  end if;

  select * into plan_record from public.plans where id = p_plan_id and gym_id = gym_record.id;
  if plan_record.id is null then raise exception 'Plan not found'; end if;
  if p_starts_on is null or p_expires_on is null or p_expires_on < p_starts_on then raise exception 'Invalid membership dates'; end if;
  if p_due_on is null then raise exception 'Due date is required'; end if;
  if p_total_paise is null or p_total_paise < 0 or p_paid_paise is null or p_paid_paise < 0 or p_paid_paise > p_total_paise then raise exception 'Invalid imported balance'; end if;
  if p_paid_paise > 0 and (p_payment_method is null or p_payment_date is null) then raise exception 'Imported payment requires its method and date'; end if;

  insert into public.memberships(gym_id, member_id, plan_id, plan_name, duration_value, duration_unit, starts_on, expires_on, date_overridden)
  values(gym_record.id, member_record.id, plan_record.id, plan_record.name, plan_record.duration_value, plan_record.duration_unit, p_starts_on, p_expires_on, true)
  returning id into membership_id;

  insert into public.charges(gym_id, membership_id, subtotal_paise, discount_paise, gst_rate_basis_points, tax_paise, total_paise, due_on)
  values(gym_record.id, membership_id, p_total_paise, 0, 0, 0, p_total_paise, p_due_on)
  returning id into charge_id;

  if p_paid_paise > 0 then
    insert into public.payments(gym_id, charge_id, amount_paise, method, reference, paid_on, notes, receipt_number)
    values(
      gym_record.id, charge_id, p_paid_paise, p_payment_method,
      nullif(trim(p_payment_reference), ''), p_payment_date, 'Controlled initial import',
      gym_record.receipt_prefix || '-' || lpad(gym_record.next_receipt_number::text, 6, '0')
    ) returning id into payment_id;
    update public.gyms set next_receipt_number = next_receipt_number + 1 where id = gym_record.id;
  end if;

  return jsonb_build_object('member_id', member_record.id, 'membership_id', membership_id, 'payment_id', payment_id);
end;
$$;


--
-- Name: admin_import_members(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_import_members(p_gym_id uuid, p_rows jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  item jsonb;
  imported integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Import payload must be an array'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Import payload exceeds 5,000 rows'; end if;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    perform public.admin_import_member(
      p_gym_id,
      item->>'name',
      item->>'phone',
      item->>'email',
      item->>'notes',
      coalesce((item->>'is_archived')::boolean, false),
      nullif(item->>'plan_id', '')::uuid,
      nullif(item->>'starts_on', '')::date,
      nullif(item->>'expires_on', '')::date,
      nullif(item->>'due_on', '')::date,
      nullif(item->>'total_paise', '')::bigint,
      coalesce(nullif(item->>'paid_paise', '')::bigint, 0),
      nullif(item->>'payment_method', '')::public.payment_method,
      nullif(item->>'payment_date', '')::date,
      item->>'payment_reference'
    );
    imported := imported + 1;
  end loop;

  return jsonb_build_object('imported', imported);
end;
$$;


--
-- Name: assign_member_trainer(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_member_trainer(p_member_id uuid, p_trainer_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  current_gym uuid := public.current_gym_id();
begin
  if auth.uid() is null or current_gym is null then raise exception 'Gym profile not found'; end if;
  if public.current_gym_role() not in ('owner','receptionist','admin') then raise exception 'Only owner or receptionist can assign trainers'; end if;
  if p_trainer_user_id is not null and not exists (
    select 1 from public.gym_users
    where id = p_trainer_user_id and gym_id = current_gym and role = 'trainer' and status = 'active'
  ) then
    raise exception 'Select an active trainer';
  end if;
  update public.members
  set assigned_trainer_user_id = p_trainer_user_id, updated_at = now()
  where id = p_member_id and gym_id = current_gym and not is_archived;
  if not found then raise exception 'Active member not found'; end if;
end $$;


--
-- Name: bootstrap_gym(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bootstrap_gym(gym_name text DEFAULT 'My Gym'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.gyms(owner_id, name) values(auth.uid(), coalesce(nullif(trim(gym_name), ''), 'My Gym'))
  on conflict(owner_id) do update set name = excluded.name returning id into new_id;
  return new_id;
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: attendance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    membership_id uuid,
    direction public.attendance_direction NOT NULL,
    qr_version integer,
    scanned_by uuid,
    request_id uuid NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'qr'::text NOT NULL,
    voided_at timestamp with time zone,
    void_reason text,
    voided_by uuid,
    replacement_event_id uuid,
    correction_request_id uuid,
    CONSTRAINT attendance_events_correction_check CHECK ((((voided_at IS NULL) AND (void_reason IS NULL) AND (voided_by IS NULL) AND (replacement_event_id IS NULL) AND (correction_request_id IS NULL)) OR ((voided_at IS NOT NULL) AND ((length(TRIM(BOTH FROM COALESCE(void_reason, ''::text))) >= 3) AND (length(TRIM(BOTH FROM COALESCE(void_reason, ''::text))) <= 240)) AND (correction_request_id IS NOT NULL)))),
    CONSTRAINT attendance_events_qr_source_check CHECK (((source <> 'qr'::text) OR (qr_version IS NOT NULL))),
    CONSTRAINT attendance_events_qr_version_check CHECK ((qr_version > 0)),
    CONSTRAINT attendance_events_replacement_not_self_check CHECK (((replacement_event_id IS NULL) OR (replacement_event_id <> id))),
    CONSTRAINT attendance_events_source_check CHECK ((source = ANY (ARRAY['qr'::text, 'manual'::text])))
);


--
-- Name: correct_latest_attendance_event(uuid, public.attendance_direction, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.correct_latest_attendance_event(p_event_id uuid, p_replacement_direction public.attendance_direction, p_request_id uuid, p_reason text) RETURNS public.attendance_events
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  current_gym uuid;
  gym_timezone text;
  local_date date;
  target public.attendance_events;
  latest_event_id uuid;
  prior_direction public.attendance_direction;
  expected_direction public.attendance_direction;
  active_membership_id uuid;
  replacement public.attendance_events;
  existing public.attendance_events;
  result public.attendance_events;
begin
  current_gym := public.current_gym_id();
  if auth.uid() is null or current_gym is null then raise exception 'Gym profile not found'; end if;
  if p_request_id is null then raise exception 'Correction request ID is required'; end if;
  if length(trim(coalesce(p_reason, ''))) not between 3 and 240 then raise exception 'Correction reason must be between 3 and 240 characters'; end if;

  select * into existing from public.attendance_events
  where correction_request_id = p_request_id and attendance_events.gym_id = current_gym;
  if existing.id is not null then return existing; end if;

  select ae.* into target from public.attendance_events ae
  where ae.id = p_event_id and ae.gym_id = current_gym and ae.voided_at is null;
  if target.id is null then raise exception 'Attendance event was not found or is already undone'; end if;

  perform 1 from public.members
  where id = target.member_id and members.gym_id = current_gym
  for update;
  if not found then raise exception 'Member not found'; end if;

  select timezone into gym_timezone from public.gyms where id = current_gym;
  local_date := (now() at time zone gym_timezone)::date;
  if (target.occurred_at at time zone gym_timezone)::date <> local_date then
    raise exception 'Only today''s latest attendance event can be undone';
  end if;
  if target.occurred_at > now() - interval '30 seconds' then
    raise exception 'Use the scanner result to change attendance during the first 30 seconds';
  end if;

  select ae.id into latest_event_id from public.attendance_events ae
  where ae.member_id = target.member_id and ae.gym_id = current_gym and ae.voided_at is null
  order by ae.occurred_at desc, ae.id desc
  limit 1;
  if latest_event_id is distinct from target.id then
    raise exception 'Only this member''s latest attendance event can be undone';
  end if;

  if p_replacement_direction is not null then
    if exists (
      select 1 from public.members
      where id = target.member_id and members.gym_id = current_gym and is_archived
    ) then raise exception 'Archived members cannot receive replacement attendance'; end if;

    select ae.direction into prior_direction from public.attendance_events ae
    where ae.member_id = target.member_id
      and ae.gym_id = current_gym
      and ae.id <> target.id
      and ae.voided_at is null
      and (ae.occurred_at at time zone gym_timezone)::date = local_date
    order by ae.occurred_at desc, ae.id desc
    limit 1;
    expected_direction := case when prior_direction = 'entry' then 'exit'::public.attendance_direction else 'entry'::public.attendance_direction end;
    if p_replacement_direction <> expected_direction then
      raise exception 'Replacement would create an invalid attendance sequence';
    end if;

    select id into active_membership_id from public.memberships
    where member_id = target.member_id
      and memberships.gym_id = current_gym
      and reverted_at is null
      and starts_on <= local_date
      and expires_on >= local_date
    order by expires_on desc
    limit 1;
    if active_membership_id is null then raise exception 'Member does not have an active membership'; end if;

    insert into public.attendance_events(
      gym_id, member_id, membership_id, direction, qr_version, source, scanned_by, request_id
    ) values (
      current_gym, target.member_id, active_membership_id, p_replacement_direction, null, 'manual', auth.uid(), p_request_id
    ) returning * into replacement;
  end if;

  update public.attendance_events
  set voided_at = now(),
      void_reason = trim(p_reason),
      voided_by = auth.uid(),
      replacement_event_id = replacement.id,
      correction_request_id = p_request_id
  where id = target.id and gym_id = current_gym and voided_at is null
  returning * into result;
  if result.id is null then raise exception 'Attendance event could not be undone'; end if;

  return result;
end;
$$;


--
-- Name: members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_code text NOT NULL,
    name text NOT NULL,
    phone text NOT NULL,
    email text,
    notes text,
    is_archived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    profile_photo_path text,
    assigned_trainer_user_id uuid,
    CONSTRAINT members_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT members_phone_check CHECK ((length(TRIM(BOTH FROM phone)) >= 7))
);


--
-- Name: create_member(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_member(p_name text, p_phone text, p_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) RETURNS public.members
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare g public.gyms; result public.members;
begin
  select * into g from public.gyms where owner_id = auth.uid() for update;
  if g.id is null then raise exception 'Gym profile not found'; end if;
  insert into public.members(gym_id, member_code, name, phone, email, notes)
  values(g.id, 'MEM-' || lpad(g.next_member_number::text, 5, '0'), trim(p_name), trim(p_phone), nullif(trim(p_email), ''), nullif(trim(p_notes), '')) returning * into result;
  update public.gyms set next_member_number = next_member_number + 1 where id = g.id;
  return result;
end $$;


--
-- Name: create_member_with_enrollment(text, text, text, text, uuid, date, date, boolean, bigint, bigint, integer, bigint, bigint, date, bigint, public.payment_method, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_member_with_enrollment(p_name text, p_phone text, p_email text, p_notes text, p_plan_id uuid, p_starts_on date, p_expires_on date, p_date_overridden boolean, p_subtotal_paise bigint, p_discount_paise bigint, p_gst_rate_basis_points integer, p_tax_paise bigint, p_total_paise bigint, p_due_on date, p_payment_paise bigint, p_payment_method public.payment_method, p_payment_reference text, p_paid_on date) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  gym_record public.gyms;
  plan_record public.plans;
  member_record public.members;
  membership_id uuid;
  charge_id uuid;
  payment_id uuid;
begin
  select * into gym_record from public.gyms where owner_id = auth.uid() and is_active for update;
  if gym_record.id is null then raise exception 'Active gym profile not found'; end if;

  select * into plan_record from public.plans
  where id = p_plan_id and gym_id = gym_record.id and is_active;
  if plan_record.id is null then raise exception 'Active plan not found'; end if;

  if p_expires_on < p_starts_on then raise exception 'Invalid membership dates'; end if;
  if p_due_on is null then raise exception 'Payment due date is required'; end if;
  if p_subtotal_paise < 0 or p_discount_paise < 0 or p_discount_paise > p_subtotal_paise
    or p_gst_rate_basis_points not between 0 and 10000
    or p_tax_paise != round(((p_subtotal_paise - p_discount_paise) * p_gst_rate_basis_points)::numeric / 10000)
    or p_total_paise != p_subtotal_paise - p_discount_paise + p_tax_paise
    or p_payment_paise < 0 or p_payment_paise > p_total_paise
  then raise exception 'Invalid charge or payment amount'; end if;

  insert into public.members(gym_id, member_code, name, phone, email, notes)
  values(
    gym_record.id,
    'MEM-' || lpad(gym_record.next_member_number::text, 5, '0'),
    trim(p_name), trim(p_phone), nullif(trim(p_email), ''), nullif(trim(p_notes), '')
  ) returning * into member_record;
  update public.gyms set next_member_number = next_member_number + 1 where id = gym_record.id;

  insert into public.memberships(gym_id, member_id, plan_id, plan_name, duration_value, duration_unit, starts_on, expires_on, date_overridden)
  values(gym_record.id, member_record.id, plan_record.id, plan_record.name, plan_record.duration_value, plan_record.duration_unit, p_starts_on, p_expires_on, p_date_overridden)
  returning id into membership_id;

  insert into public.charges(gym_id, membership_id, subtotal_paise, discount_paise, gst_rate_basis_points, tax_paise, total_paise, due_on)
  values(gym_record.id, membership_id, p_subtotal_paise, p_discount_paise, p_gst_rate_basis_points, p_tax_paise, p_total_paise, p_due_on)
  returning id into charge_id;

  if p_payment_paise > 0 then
    insert into public.payments(gym_id, charge_id, amount_paise, method, reference, paid_on, receipt_number)
    values(
      gym_record.id, charge_id, p_payment_paise, p_payment_method,
      nullif(trim(p_payment_reference), ''), p_paid_on,
      gym_record.receipt_prefix || '-' || lpad(gym_record.next_receipt_number::text, 6, '0')
    ) returning id into payment_id;
    update public.gyms set next_receipt_number = next_receipt_number + 1 where id = gym_record.id;
  end if;

  return jsonb_build_object('member_id', member_record.id, 'membership_id', membership_id, 'payment_id', payment_id);
end;
$$;


--
-- Name: create_membership_charge(uuid, uuid, date, date, boolean, bigint, bigint, integer, bigint, bigint, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_membership_charge(p_member_id uuid, p_plan_id uuid, p_starts_on date, p_expires_on date, p_date_overridden boolean, p_subtotal_paise bigint, p_discount_paise bigint, p_gst_rate_basis_points integer, p_tax_paise bigint, p_total_paise bigint, p_due_on date) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  g_id uuid;
  selected_plan public.plans;
  membership_id uuid;
begin
  g_id := public.current_gym_id();
  select * into selected_plan from public.plans where id = p_plan_id and gym_id = g_id and is_active;
  if selected_plan.id is null then raise exception 'Active plan not found'; end if;
  if not exists(select 1 from public.members where id = p_member_id and gym_id = g_id and not is_archived) then raise exception 'Member not found'; end if;
  if p_expires_on < p_starts_on then raise exception 'Invalid membership dates'; end if;
  if p_due_on is null then raise exception 'Payment due date is required'; end if;
  if p_subtotal_paise < 0 or p_discount_paise < 0 or p_discount_paise > p_subtotal_paise or p_gst_rate_basis_points not between 0 and 10000 or p_tax_paise < 0 or p_total_paise != p_subtotal_paise - p_discount_paise + p_tax_paise or p_tax_paise != round(((p_subtotal_paise - p_discount_paise) * p_gst_rate_basis_points)::numeric / 10000) then raise exception 'Invalid charge'; end if;

  insert into public.memberships(gym_id, member_id, plan_id, plan_name, duration_value, duration_unit, starts_on, expires_on, date_overridden)
  values(g_id, p_member_id, selected_plan.id, selected_plan.name, selected_plan.duration_value, selected_plan.duration_unit, p_starts_on, p_expires_on, p_date_overridden)
  returning id into membership_id;

  insert into public.charges(gym_id, membership_id, subtotal_paise, discount_paise, gst_rate_basis_points, tax_paise, total_paise, due_on)
  values(g_id, membership_id, p_subtotal_paise, p_discount_paise, p_gst_rate_basis_points, p_tax_paise, p_total_paise, p_due_on);
  return membership_id;
end;
$$;


--
-- Name: current_gym_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_gym_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select g.id
  from public.gyms g
  where g.owner_id = auth.uid()
  union
  select gu.gym_id
  from public.gym_users gu
  join public.gyms g on g.id = gu.gym_id
  where gu.user_id = auth.uid() and gu.status = 'active' and g.is_active
  limit 1
$$;


--
-- Name: current_gym_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_gym_role() RETURNS public.gym_role
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: disable_archived_member_qr(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.disable_archived_member_qr() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: disable_member_qr(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.disable_member_qr(p_member_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  current_gym uuid;
begin
  current_gym := public.current_gym_id();
  if current_gym is null then raise exception 'Gym profile not found'; end if;

  update public.member_qr_credentials
  set enabled = false,
      shared_at = null,
      shared_by = null,
      share_method = null,
      changed_by = auth.uid(),
      updated_at = now()
  where member_id = p_member_id
    and gym_id = current_gym;

  if not found then raise exception 'QR credential not found'; end if;
end;
$$;


--
-- Name: get_dashboard_monthly_trends(date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_dashboard_monthly_trends(p_today date DEFAULT CURRENT_DATE, p_months integer DEFAULT 6) RETURNS TABLE(month_start date, new_members bigint, collected_paise bigint, payment_count bigint, renewals bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with gym_context as (
    select id, timezone from public.gyms where id = public.current_gym_id()
  ),
  months as (
    select generate_series(
      date_trunc('month', p_today)::date - (least(greatest(coalesce(p_months, 6), 2), 24) - 1) * interval '1 month',
      date_trunc('month', p_today)::date,
      interval '1 month'
    )::date as month_start
  ),
  reversal_totals as (
    select payment_id, sum(amount_paise)::bigint as reversed_paise
    from public.payment_reversals
    where gym_id = public.current_gym_id()
    group by payment_id
  ),
  payments_by_month as (
    select
      date_trunc('month', p.paid_on)::date as month_start,
      sum(case when p.voided_at is not null then 0 else p.amount_paise - coalesce(rt.reversed_paise, 0) end)::bigint as collected_paise,
      count(*) filter (where p.voided_at is null and p.amount_paise - coalesce(rt.reversed_paise, 0) > 0)::bigint as payment_count
    from public.payments p
    left join reversal_totals rt on rt.payment_id = p.id
    where p.gym_id = public.current_gym_id()
      and p.paid_on >= (select min(month_start) from months)
      and p.paid_on <= p_today
    group by 1
  ),
  members_by_month as (
    select date_trunc('month', m.created_at at time zone g.timezone)::date as month_start, count(*)::bigint as new_members
    from public.members m
    join gym_context g on g.id = m.gym_id
    where (m.created_at at time zone g.timezone)::date >= (select min(month_start) from months)
      and (m.created_at at time zone g.timezone)::date <= p_today
    group by 1
  ),
  membership_sequence as (
    select
      ms.created_at,
      g.timezone,
      row_number() over (partition by ms.member_id order by ms.created_at, ms.id) as sequence_number
    from public.memberships ms
    join gym_context g on g.id = ms.gym_id
    where ms.reverted_at is null
  ),
  renewals_by_month as (
    select date_trunc('month', created_at at time zone timezone)::date as month_start, count(*)::bigint as renewals
    from membership_sequence
    where sequence_number > 1
      and (created_at at time zone timezone)::date >= (select min(month_start) from months)
      and (created_at at time zone timezone)::date <= p_today
    group by 1
  )
  select
    mo.month_start,
    coalesce(mm.new_members, 0)::bigint,
    coalesce(pm.collected_paise, 0)::bigint,
    coalesce(pm.payment_count, 0)::bigint,
    coalesce(rm.renewals, 0)::bigint
  from months mo
  left join members_by_month mm using (month_start)
  left join payments_by_month pm using (month_start)
  left join renewals_by_month rm using (month_start)
  order by mo.month_start;
$$;


--
-- Name: get_dashboard_summary(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_dashboard_summary(p_today date DEFAULT CURRENT_DATE) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with gym_context as (
    select id, timezone from public.gyms where id = public.current_gym_id()
  ), member_states as (
    select m.id, m.created_at,
      case
        when current_access.id is not null then case when future_access.id is not null then 'active' when current_access.expires_on <= p_today + 7 then 'expiring' else 'active' end
        when future_access.id is not null then 'upcoming'
        when expired_access.id is not null then 'expired'
        else 'not_enrolled'
      end as membership_status
    from public.members m
    join gym_context g on g.id = m.gym_id
    left join lateral (
      select ms.id, ms.starts_on, ms.expires_on from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null and ms.starts_on <= p_today and ms.expires_on >= p_today
      order by ms.expires_on desc, ms.created_at desc, ms.id desc limit 1
    ) current_access on true
    left join lateral (
      select ms.id from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null and ms.starts_on > p_today
      order by ms.starts_on asc, ms.created_at asc, ms.id asc limit 1
    ) future_access on true
    left join lateral (
      select ms.id from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null and ms.expires_on < p_today
      order by ms.expires_on desc, ms.created_at desc, ms.id desc limit 1
    ) expired_access on true
    where not m.is_archived
  ), member_balances as (
    select ms.member_id, sum(cb.balance_paise)::bigint as balance_paise
    from public.charge_balances cb
    join public.memberships ms on ms.id = cb.membership_id and ms.gym_id = cb.gym_id and ms.reverted_at is null
    join public.members m on m.id = ms.member_id and m.gym_id = cb.gym_id and not m.is_archived
    where cb.gym_id = public.current_gym_id()
    group by ms.member_id
  ), reversal_totals as (
    select payment_id, sum(amount_paise)::bigint as reversed_paise
    from public.payment_reversals where gym_id = public.current_gym_id() group by payment_id
  ), payment_rows as (
    select p.paid_on, p.method,
      case when p.voided_at is not null then 0 else p.amount_paise - coalesce(rt.reversed_paise, 0) end::bigint as net_paise
    from public.payments p left join reversal_totals rt on rt.payment_id = p.id
    where p.gym_id = public.current_gym_id()
  ), membership_sequence as (
    select ms.created_at, row_number() over (partition by ms.member_id order by ms.created_at, ms.id) as sequence_number
    from public.memberships ms where ms.gym_id = public.current_gym_id() and ms.reverted_at is null
  ), attendance_today as (
    select ae.member_id, ae.direction, ae.occurred_at,
      row_number() over (partition by ae.member_id order by ae.occurred_at desc, ae.id desc) as member_rank
    from public.attendance_events ae join gym_context g on g.id = ae.gym_id
    where ae.voided_at is null and (ae.occurred_at at time zone g.timezone)::date = p_today
  )
  select jsonb_build_object(
    'active_members', (select count(*) from member_states where membership_status in ('active', 'expiring')),
    'expiring_members', (select count(*) from member_states where membership_status = 'expiring'),
    'expired_members', (select count(*) from member_states where membership_status = 'expired'),
    'total_members', (select count(*) from member_states),
    'new_members_month', (select count(*) from member_states ms cross join gym_context g where (ms.created_at at time zone g.timezone)::date >= date_trunc('month', p_today)::date),
    'outstanding_paise', coalesce((select sum(balance_paise) from member_balances), 0),
    'overdue_paise', coalesce((select sum(cb.balance_paise) from public.charge_balances cb join public.memberships ms on ms.id = cb.membership_id and ms.gym_id = cb.gym_id and ms.reverted_at is null join public.members m on m.id = ms.member_id and m.gym_id = cb.gym_id and not m.is_archived where cb.gym_id = public.current_gym_id() and cb.balance_paise > 0 and cb.due_on < p_today), 0),
    'pending_accounts', (select count(*) from member_balances where balance_paise > 0),
    'today_collected_paise', coalesce((select sum(net_paise) from payment_rows where paid_on = p_today), 0),
    'today_payment_count', (select count(*) from payment_rows where paid_on = p_today and net_paise > 0),
    'month_collected_paise', coalesce((select sum(net_paise) from payment_rows where paid_on >= date_trunc('month', p_today)::date and paid_on <= p_today), 0),
    'month_payment_count', (select count(*) from payment_rows where paid_on >= date_trunc('month', p_today)::date and paid_on <= p_today and net_paise > 0),
    'renewals_month', (select count(*) from membership_sequence ms cross join gym_context g where ms.sequence_number > 1 and (ms.created_at at time zone g.timezone)::date >= date_trunc('month', p_today)::date),
    'attendance_entries_today', (select count(*) from attendance_today where direction = 'entry'),
    'attendance_exits_today', (select count(*) from attendance_today where direction = 'exit'),
    'attendance_inside_now', (select count(*) from attendance_today where member_rank = 1 and direction = 'entry'),
    'method_cash_paise', coalesce((select sum(net_paise) from payment_rows where method = 'cash' and paid_on >= date_trunc('month', p_today)::date and paid_on <= p_today), 0),
    'method_upi_paise', coalesce((select sum(net_paise) from payment_rows where method = 'upi' and paid_on >= date_trunc('month', p_today)::date and paid_on <= p_today), 0),
    'method_card_paise', coalesce((select sum(net_paise) from payment_rows where method = 'card' and paid_on >= date_trunc('month', p_today)::date and paid_on <= p_today), 0),
    'method_bank_transfer_paise', coalesce((select sum(net_paise) from payment_rows where method = 'bank_transfer' and paid_on >= date_trunc('month', p_today)::date and paid_on <= p_today), 0)
  )
$$;


--
-- Name: member_qr_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_qr_credentials (
    member_id uuid NOT NULL,
    gym_id uuid NOT NULL,
    version integer NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    rotated_at timestamp with time zone,
    changed_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    public_code text NOT NULL,
    shared_at timestamp with time zone,
    shared_by uuid,
    share_method text,
    CONSTRAINT member_qr_credentials_public_code_format CHECK ((public_code ~ '^[A-HJ-NP-Z2-9]{12}$'::text)),
    CONSTRAINT member_qr_credentials_version_check CHECK ((version > 0))
);


--
-- Name: issue_member_qr(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.issue_member_qr(p_member_id uuid) RETURNS public.member_qr_credentials
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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

  insert into public.member_qr_credentials(member_id, gym_id, public_code, version, enabled, changed_by, shared_at, shared_by, share_method)
  values (p_member_id, current_gym, public.new_qr_public_code(), 1, true, auth.uid(), null, null, null)
  on conflict (member_id) do update
    set version = member_qr_credentials.version + 1,
        public_code = public.new_qr_public_code(),
        enabled = true,
        shared_at = null,
        shared_by = null,
        share_method = null,
        rotated_at = now(),
        changed_by = auth.uid(),
        updated_at = now()
  returning * into result;

  return result;
end;
$$;


--
-- Name: list_attendance_events(text, public.attendance_direction, text, date, date, date, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_attendance_events(p_query text DEFAULT NULL::text, p_direction public.attendance_direction DEFAULT NULL::public.attendance_direction, p_view text DEFAULT 'today'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_today date DEFAULT CURRENT_DATE, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_sort text DEFAULT 'occurred_at'::text, p_order text DEFAULT 'desc'::text) RETURNS TABLE(id uuid, member_id uuid, member_code text, member_name text, membership_id uuid, plan_name text, direction public.attendance_direction, qr_version integer, source text, occurred_at timestamp with time zone, business_date date, can_undo boolean, replacement_direction public.attendance_direction, total_count bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with candidates as (
    select
      ae.id, ae.member_id, m.member_code, m.name as member_name,
      ae.membership_id, ms.plan_name, ae.direction, ae.qr_version, ae.source, ae.occurred_at,
      (ae.occurred_at at time zone g.timezone)::date as business_date
    from public.attendance_events ae
    join public.gyms g on g.id = ae.gym_id
    join public.members m on m.id = ae.member_id and m.gym_id = ae.gym_id
    left join public.memberships ms on ms.id = ae.membership_id and ms.gym_id = ae.gym_id
    where ae.gym_id = public.current_gym_id()
      and ae.voided_at is null
      and (
        nullif(trim(coalesce(p_query, '')), '') is null
        or m.name ilike '%' || trim(p_query) || '%'
        or m.member_code ilike '%' || trim(p_query) || '%'
        or m.phone ilike '%' || trim(p_query) || '%'
      )
  ), ranked as (
    select
      candidates.*,
      row_number() over (partition by member_id, business_date order by occurred_at desc, id desc) as day_rank,
      row_number() over (partition by member_id order by occurred_at desc, id desc) as member_rank,
      lead(direction) over (partition by member_id, business_date order by occurred_at desc, id desc) as prior_direction
    from candidates
  ), filtered as (
    select ranked.*, count(*) over() as total_count
    from ranked
    where (p_direction is null or direction = p_direction)
      and case
        when p_view = 'today' then business_date = p_today
        when p_view = 'inside' then business_date = p_today and day_rank = 1 and direction = 'entry'
        when p_view = 'missed' then business_date = p_today - 1 and day_rank = 1 and direction = 'entry'
        else (p_from is null or business_date >= p_from) and (p_to is null or business_date <= p_to)
      end
  )
  select
    filtered.id, filtered.member_id, filtered.member_code, filtered.member_name,
    filtered.membership_id, filtered.plan_name, filtered.direction,
    filtered.qr_version, filtered.source, filtered.occurred_at, filtered.business_date,
    (filtered.member_rank = 1 and filtered.business_date = p_today and filtered.occurred_at <= now() - interval '30 seconds') as can_undo,
    case when filtered.prior_direction = 'entry' then 'exit'::public.attendance_direction else 'entry'::public.attendance_direction end as replacement_direction,
    filtered.total_count
  from filtered
  order by
    case when p_sort = 'member_name' and lower(p_order) = 'asc' then lower(filtered.member_name) end asc,
    case when p_sort = 'member_name' and lower(p_order) = 'desc' then lower(filtered.member_name) end desc,
    case when coalesce(p_sort, 'occurred_at') <> 'member_name' and lower(coalesce(p_order, 'desc')) = 'asc' then filtered.occurred_at end asc,
    case when coalesce(p_sort, 'occurred_at') <> 'member_name' and lower(coalesce(p_order, 'desc')) <> 'asc' then filtered.occurred_at end desc,
    filtered.occurred_at desc, filtered.id desc
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
  limit least(greatest(coalesce(p_page_size, 50), 1), 100)
$$;


--
-- Name: list_denied_access_attempts(text, date, date, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_denied_access_attempts(p_query text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_page integer DEFAULT 1, p_page_size integer DEFAULT 10, p_sort text DEFAULT 'occurred_at'::text, p_order text DEFAULT 'desc'::text) RETURNS TABLE(id uuid, member_id uuid, member_code text, member_name text, plan_name text, reason text, expires_on date, occurred_at timestamp with time zone, business_date date, total_count bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select a.id, a.member_id, m.member_code, m.name, ms.plan_name, a.reason, a.expires_on,
    a.occurred_at, (a.occurred_at at time zone g.timezone)::date, count(*) over()
  from public.denied_access_attempts a
  join public.members m on m.id = a.member_id and m.gym_id = a.gym_id
  join public.memberships ms on ms.id = a.membership_id and ms.gym_id = a.gym_id and ms.member_id = a.member_id
  join public.gyms g on g.id = a.gym_id
  where a.gym_id = public.current_gym_id()
    and (nullif(trim(p_query), '') is null or m.name ilike '%' || trim(p_query) || '%'
      or m.member_code ilike '%' || trim(p_query) || '%' or m.phone ilike '%' || trim(p_query) || '%')
    and (p_from is null or a.occurred_at >= (p_from::timestamp at time zone g.timezone))
    and (p_to is null or a.occurred_at < ((p_to + 1)::timestamp at time zone g.timezone))
  order by
    case when p_sort = 'member_name' and p_order = 'asc' then m.name end asc,
    case when p_sort = 'member_name' and p_order = 'desc' then m.name end desc,
    case when p_sort = 'occurred_at' and p_order = 'asc' then a.occurred_at end asc,
    a.occurred_at desc, a.id desc
  limit greatest(1, least(coalesce(p_page_size, 10), 100))
  offset ((greatest(1, coalesce(p_page, 1)) - 1)::bigint * greatest(1, least(coalesce(p_page_size, 10), 100)));
$$;


--
-- Name: list_members(text, text, date, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_members(p_query text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_today date DEFAULT CURRENT_DATE, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_sort text DEFAULT 'created_at'::text, p_order text DEFAULT 'desc'::text) RETURNS TABLE(id uuid, member_code text, name text, phone text, email text, profile_photo_path text, is_archived boolean, created_at timestamp with time zone, membership_id uuid, plan_name text, starts_on date, expires_on date, membership_status text, balance_paise bigint, qr_version integer, qr_enabled boolean, qr_shared_at timestamp with time zone, total_count bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with candidates as (
    select
      m.id, m.member_code, m.name, m.phone, m.email, m.profile_photo_path,
      m.is_archived, m.created_at,
      coalesce(future_access.id, current_access.id, expired_access.id) as membership_id,
      coalesce(future_access.plan_name, current_access.plan_name, expired_access.plan_name) as plan_name,
      coalesce(future_access.starts_on, current_access.starts_on, expired_access.starts_on) as starts_on,
      coalesce(future_access.expires_on, current_access.expires_on, expired_access.expires_on) as expires_on,
      case
        when current_access.id is not null then
          case
            when future_access.id is not null then 'active'
            when current_access.expires_on <= p_today + 7 then 'expiring'
            else 'active'
          end
        when future_access.id is not null then 'upcoming'
        when expired_access.id is not null then 'expired'
        else 'not_enrolled'
      end as membership_status,
      coalesce(member_balance.balance_paise, 0)::bigint as balance_paise,
      qr.version as qr_version, coalesce(qr.enabled, false) as qr_enabled,
      qr.shared_at as qr_shared_at
    from public.members m
    left join lateral (
      select ms.id, ms.plan_name, ms.starts_on, ms.expires_on
      from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null and ms.starts_on <= p_today and ms.expires_on >= p_today
      order by ms.expires_on desc, ms.created_at desc, ms.id desc
      limit 1
    ) current_access on true
    left join lateral (
      select ms.id, ms.plan_name, ms.starts_on, ms.expires_on
      from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null and ms.starts_on > p_today
      order by ms.starts_on asc, ms.created_at asc, ms.id asc
      limit 1
    ) future_access on true
    left join lateral (
      select ms.id, ms.plan_name, ms.starts_on, ms.expires_on
      from public.memberships ms
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null and ms.expires_on < p_today
      order by ms.expires_on desc, ms.created_at desc, ms.id desc
      limit 1
    ) expired_access on true
    left join lateral (
      select coalesce(sum(cb.balance_paise), 0)::bigint as balance_paise
      from public.memberships ms
      join public.charge_balances cb on cb.membership_id = ms.id
      where ms.member_id = m.id and ms.gym_id = m.gym_id and ms.reverted_at is null
    ) member_balance on true
    left join public.member_qr_credentials qr on qr.member_id = m.id and qr.gym_id = m.gym_id
    where m.gym_id = public.current_gym_id()
      and (
        nullif(trim(coalesce(p_query, '')), '') is null
        or m.name ilike '%' || trim(p_query) || '%'
        or m.phone ilike '%' || trim(p_query) || '%'
        or m.member_code ilike '%' || trim(p_query) || '%'
      )
  ), filtered as (
    select candidates.*, count(*) over() as total_count
    from candidates
    where case
      when p_status = 'archived' then is_archived
      when p_status = 'all' then true
      when p_status = 'qr_not_generated' then not is_archived and qr_version is null
      when p_status = 'qr_not_shared' then not is_archived and qr_enabled and qr_shared_at is null
      when p_status = 'qr_shared' then not is_archived and qr_enabled and qr_shared_at is not null
      when p_status = 'qr_disabled' then not is_archived and qr_version is not null and not qr_enabled
      when is_archived then false
      when nullif(trim(coalesce(p_status, '')), '') is null then true
      when p_status = 'outstanding' then balance_paise > 0
      else membership_status = p_status
    end
  )
  select
    filtered.id, filtered.member_code, filtered.name, filtered.phone, filtered.email,
    filtered.profile_photo_path, filtered.is_archived, filtered.created_at,
    filtered.membership_id, filtered.plan_name, filtered.starts_on, filtered.expires_on,
    filtered.membership_status, filtered.balance_paise, filtered.qr_version,
    filtered.qr_enabled, filtered.qr_shared_at, filtered.total_count
  from filtered
  order by
    case when p_sort = 'member_code' and lower(p_order) = 'asc' then filtered.member_code end asc,
    case when p_sort = 'member_code' and lower(p_order) = 'desc' then filtered.member_code end desc,
    case when p_sort = 'name' and lower(p_order) = 'asc' then lower(filtered.name) end asc,
    case when p_sort = 'name' and lower(p_order) = 'desc' then lower(filtered.name) end desc,
    case when p_sort = 'expires_on' and lower(p_order) = 'asc' then filtered.expires_on end asc nulls last,
    case when p_sort = 'expires_on' and lower(p_order) = 'desc' then filtered.expires_on end desc nulls last,
    case when p_sort = 'balance' and lower(p_order) = 'asc' then filtered.balance_paise end asc,
    case when p_sort = 'balance' and lower(p_order) = 'desc' then filtered.balance_paise end desc,
    case when p_sort = 'status' and lower(p_order) = 'asc' then (case when filtered.is_archived then 'archived' else filtered.membership_status end) end asc,
    case when p_sort = 'status' and lower(p_order) = 'desc' then (case when filtered.is_archived then 'archived' else filtered.membership_status end) end desc,
    case when coalesce(p_sort, 'created_at') not in ('member_code', 'name', 'expires_on', 'balance', 'status') and lower(coalesce(p_order, 'desc')) = 'asc' then filtered.created_at end asc,
    case when coalesce(p_sort, 'created_at') not in ('member_code', 'name', 'expires_on', 'balance', 'status') and lower(coalesce(p_order, 'desc')) <> 'asc' then filtered.created_at end desc,
    filtered.created_at desc, filtered.id
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
  limit least(greatest(coalesce(p_page_size, 50), 1), 100)
$$;


--
-- Name: list_reminder_candidates(text, date, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_reminder_candidates(p_filter text DEFAULT NULL::text, p_today date DEFAULT CURRENT_DATE, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_sort text DEFAULT 'candidate_date'::text, p_order text DEFAULT 'asc'::text) RETURNS TABLE(candidate_kind text, member_id uuid, member_code text, member_name text, phone text, membership_id uuid, charge_id uuid, plan_name text, candidate_date date, balance_paise bigint, total_count bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with payment_candidates as (
    select
      case when cb.due_on < p_today then 'overdue' else 'partial_payment' end as candidate_kind,
      m.id as member_id, m.member_code, m.name as member_name, m.phone,
      ms.id as membership_id, cb.id as charge_id, ms.plan_name,
      cb.due_on as candidate_date, cb.balance_paise
    from public.charge_balances cb
    join public.memberships ms on ms.id = cb.membership_id and ms.gym_id = cb.gym_id and ms.reverted_at is null
    join public.members m on m.id = ms.member_id and m.gym_id = cb.gym_id
    where cb.gym_id = public.current_gym_id()
      and not m.is_archived and cb.balance_paise > 0 and cb.due_on <= p_today + 7
  ), renewal_candidates as (
    select distinct on (m.id)
      'expiring'::text as candidate_kind, m.id as member_id, m.member_code,
      m.name as member_name, m.phone, ms.id as membership_id,
      null::uuid as charge_id, ms.plan_name, ms.expires_on as candidate_date,
      0::bigint as balance_paise
    from public.memberships ms
    join public.members m on m.id = ms.member_id and m.gym_id = ms.gym_id
    where ms.gym_id = public.current_gym_id()
      and ms.reverted_at is null
      and not m.is_archived
      and ms.starts_on <= p_today
      and ms.expires_on between p_today and p_today + 7
      and not exists (
        select 1 from public.memberships future
        where future.member_id = ms.member_id and future.gym_id = ms.gym_id and future.reverted_at is null and future.starts_on > p_today
      )
    order by m.id, ms.expires_on desc, ms.created_at desc
  ), candidates as (
    select * from payment_candidates
    union all
    select * from renewal_candidates
  ), filtered as (
    select candidates.*, count(*) over() as total_count
    from candidates
    where nullif(trim(coalesce(p_filter, '')), '') is null or candidate_kind = p_filter
  )
  select * from filtered
  order by
    case when p_sort = 'member_name' and lower(p_order) = 'asc' then lower(member_name) end asc,
    case when p_sort = 'member_name' and lower(p_order) = 'desc' then lower(member_name) end desc,
    case when p_sort = 'balance' and lower(p_order) = 'asc' then balance_paise end asc,
    case when p_sort = 'balance' and lower(p_order) = 'desc' then balance_paise end desc,
    case when coalesce(p_sort, 'candidate_date') not in ('member_name', 'balance') and lower(coalesce(p_order, 'asc')) = 'desc' then candidate_date end desc,
    case when coalesce(p_sort, 'candidate_date') not in ('member_name', 'balance') and lower(coalesce(p_order, 'asc')) <> 'desc' then candidate_date end asc,
    candidate_date, member_name, member_id
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
  limit least(greatest(coalesce(p_page_size, 50), 1), 100)
$$;


--
-- Name: list_transactions(text, public.payment_method, text, date, date, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_transactions(p_query text DEFAULT NULL::text, p_method public.payment_method DEFAULT NULL::public.payment_method, p_status text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_sort text DEFAULT 'paid_on'::text, p_order text DEFAULT 'desc'::text) RETURNS TABLE(id uuid, receipt_number text, paid_on date, method public.payment_method, reference text, amount_paise bigint, reversed_paise bigint, net_paise bigint, voided_at timestamp with time zone, void_reason text, member_id uuid, member_code text, member_name text, plan_name text, total_count bigint, view_collected_paise bigint, view_reversed_paise bigint, view_completed_count bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with candidates as (
    select
      p.id, p.receipt_number, p.paid_on, p.method, p.reference, p.amount_paise,
      coalesce(sum(pr.amount_paise), 0)::bigint as reversed_paise,
      case when p.voided_at is not null then 0 else p.amount_paise - coalesce(sum(pr.amount_paise), 0) end::bigint as net_paise,
      p.voided_at, p.void_reason, m.id as member_id, m.member_code,
      m.name as member_name, ms.plan_name, p.created_at
    from public.payments p
    join public.charges c on c.id = p.charge_id and c.gym_id = p.gym_id
    join public.memberships ms on ms.id = c.membership_id and ms.gym_id = p.gym_id
    join public.members m on m.id = ms.member_id and m.gym_id = p.gym_id
    left join public.payment_reversals pr on pr.payment_id = p.id and pr.gym_id = p.gym_id
    where p.gym_id = public.current_gym_id()
      and (p_method is null or p.method = p_method)
      and (p_from is null or p.paid_on >= p_from)
      and (p_to is null or p.paid_on <= p_to)
      and (
        nullif(trim(coalesce(p_query, '')), '') is null
        or m.name ilike '%' || trim(p_query) || '%'
        or m.member_code ilike '%' || trim(p_query) || '%'
        or p.receipt_number ilike '%' || trim(p_query) || '%'
        or p.reference ilike '%' || trim(p_query) || '%'
      )
    group by p.id, m.id, ms.id
  ), filtered as (
    select
      candidates.*, count(*) over() as total_count,
      coalesce(sum(net_paise) over(), 0)::bigint as view_collected_paise,
      coalesce(sum(reversed_paise) over(), 0)::bigint as view_reversed_paise,
      count(*) filter (where net_paise > 0) over() as view_completed_count
    from candidates
    where nullif(trim(coalesce(p_status, '')), '') is null
      or (p_status = 'completed' and voided_at is null)
      or (p_status = 'reversed' and voided_at is not null)
      or (p_status = 'partial_reversal' and voided_at is null and reversed_paise > 0)
  )
  select
    filtered.id, filtered.receipt_number, filtered.paid_on, filtered.method,
    filtered.reference, filtered.amount_paise, filtered.reversed_paise, filtered.net_paise,
    filtered.voided_at, filtered.void_reason, filtered.member_id, filtered.member_code,
    filtered.member_name, filtered.plan_name, filtered.total_count,
    filtered.view_collected_paise, filtered.view_reversed_paise, filtered.view_completed_count
  from filtered
  order by
    case when p_sort = 'member_name' and lower(p_order) = 'asc' then lower(filtered.member_name) end asc,
    case when p_sort = 'member_name' and lower(p_order) = 'desc' then lower(filtered.member_name) end desc,
    case when p_sort = 'amount' and lower(p_order) = 'asc' then filtered.net_paise end asc,
    case when p_sort = 'amount' and lower(p_order) = 'desc' then filtered.net_paise end desc,
    case when coalesce(p_sort, 'paid_on') not in ('member_name', 'amount') and lower(coalesce(p_order, 'desc')) = 'asc' then filtered.paid_on end asc,
    case when coalesce(p_sort, 'paid_on') not in ('member_name', 'amount') and lower(coalesce(p_order, 'desc')) <> 'asc' then filtered.paid_on end desc,
    filtered.created_at desc, filtered.id desc
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
  limit least(greatest(coalesce(p_page_size, 50), 1), 100)
$$;


--
-- Name: new_qr_public_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.new_qr_public_code() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: process_qr_access(uuid, integer, uuid, public.attendance_direction, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_qr_access(p_member_id uuid, p_qr_version integer, p_request_id uuid, p_direction public.attendance_direction DEFAULT NULL::public.attendance_direction, p_denied_only boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_gym uuid := public.current_gym_id();
  v_today date;
  v_credential public.member_qr_credentials;
  v_expired public.memberships;
  v_attempt public.denied_access_attempts;
  v_event public.attendance_events;
begin
  if auth.uid() is null or v_gym is null then raise exception 'Gym profile not found'; end if;
  if p_request_id is null then raise exception 'Request ID is required'; end if;
  select (now() at time zone timezone)::date into v_today from public.gyms where id = v_gym;
  perform 1 from public.members where id = p_member_id and gym_id = v_gym and not is_archived for update;
  if not found then raise exception 'Active member not found'; end if;
  select * into v_credential from public.member_qr_credentials where member_id = p_member_id and gym_id = v_gym for update;
  if p_qr_version is null or v_credential.member_id is null or not v_credential.enabled or v_credential.version <> p_qr_version then
    raise exception 'QR has been disabled or replaced';
  end if;

  select * into v_attempt from public.denied_access_attempts where gym_id = v_gym and request_id = p_request_id;
  if found then
    if v_attempt.member_id <> p_member_id or v_attempt.qr_version <> p_qr_version then raise exception 'Request ID already used'; end if;
    return jsonb_build_object('status', 'denied', 'attempt', to_jsonb(v_attempt), 'duplicate', true);
  end if;
  select * into v_event from public.attendance_events where gym_id = v_gym and request_id = p_request_id;
  if found then
    if v_event.member_id <> p_member_id or v_event.qr_version <> p_qr_version then raise exception 'Request ID already used'; end if;
    if v_event.voided_at is not null then raise exception 'Attendance request was already undone'; end if;
    return jsonb_build_object('status', 'recorded', 'event', to_jsonb(v_event));
  end if;

  if exists (select 1 from public.memberships where gym_id = v_gym and member_id = p_member_id
      and reverted_at is null and starts_on <= v_today and expires_on >= v_today) then
    if p_denied_only then return jsonb_build_object('status', 'allowed'); end if;
    if p_direction is null then
      v_event := public.record_scanner_attendance(p_member_id, p_qr_version, p_request_id);
    else
      v_event := public.record_attendance(p_member_id, p_qr_version, p_direction, p_request_id);
    end if;
    return jsonb_build_object('status', 'recorded', 'event', to_jsonb(v_event));
  end if;

  select * into v_expired from public.memberships where gym_id = v_gym and member_id = p_member_id
    and reverted_at is null and expires_on < v_today order by expires_on desc, id desc limit 1;
  if not found then raise exception 'Member does not have an active membership'; end if;
  insert into public.denied_access_attempts(gym_id, member_id, membership_id, qr_version, expires_on, scanned_by, request_id)
    values(v_gym, p_member_id, v_expired.id, p_qr_version, v_expired.expires_on, auth.uid(), p_request_id)
    returning * into v_attempt;
  return jsonb_build_object('status', 'denied', 'attempt', to_jsonb(v_attempt), 'duplicate', false);
end;
$$;


--
-- Name: reactivate_archived_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reactivate_archived_member(p_member_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: record_attendance(uuid, integer, public.attendance_direction, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_attendance(p_member_id uuid, p_qr_version integer, p_direction public.attendance_direction, p_request_id uuid) RETURNS public.attendance_events
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  current_gym uuid;
  credential public.member_qr_credentials;
  active_membership_id uuid;
  local_date date;
  existing public.attendance_events;
  recent public.attendance_events;
  result public.attendance_events;
begin
  current_gym := public.current_gym_id();
  if current_gym is null then raise exception 'Gym profile not found'; end if;

  select (now() at time zone timezone)::date into local_date
  from public.gyms where id = current_gym;

  select * into existing from public.attendance_events
  where request_id = p_request_id and attendance_events.gym_id = current_gym;
  if existing.id is not null then
    if existing.voided_at is not null then raise exception 'Attendance request was already undone'; end if;
    return existing;
  end if;

  perform 1 from public.members
  where id = p_member_id and members.gym_id = current_gym and not is_archived
  for update;
  if not found then raise exception 'Active member not found'; end if;

  select * into credential from public.member_qr_credentials
  where member_id = p_member_id and member_qr_credentials.gym_id = current_gym
  for update;
  if p_qr_version is null or credential.member_id is null or not credential.enabled or credential.version <> p_qr_version then
    raise exception 'QR has been disabled or replaced';
  end if;

  select id into active_membership_id from public.memberships
  where member_id = p_member_id
    and memberships.gym_id = current_gym
    and reverted_at is null
    and starts_on <= local_date
    and expires_on >= local_date
  order by expires_on desc
  limit 1;
  if active_membership_id is null then raise exception 'Member does not have an active membership'; end if;

  select ae.* into recent from public.attendance_events ae
  where ae.member_id = p_member_id
    and ae.gym_id = current_gym
    and ae.direction = p_direction
    and ae.occurred_at >= now() - interval '15 seconds'
    and ae.voided_at is null
  order by ae.occurred_at desc, ae.id desc
  limit 1;
  if recent.id is not null then return recent; end if;

  insert into public.attendance_events(
    gym_id, member_id, membership_id, direction, qr_version, source, scanned_by, request_id
  ) values (
    current_gym, p_member_id, active_membership_id, p_direction, p_qr_version, 'qr', auth.uid(), p_request_id
  ) returning * into result;

  return result;
end;
$$;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    charge_id uuid NOT NULL,
    amount_paise bigint NOT NULL,
    method public.payment_method NOT NULL,
    reference text,
    paid_on date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    receipt_number text NOT NULL,
    voided_at timestamp with time zone,
    void_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    operation_id uuid,
    handled_by_gym_user_id uuid,
    CONSTRAINT payments_amount_paise_check CHECK ((amount_paise > 0)),
    CONSTRAINT payments_check CHECK ((((voided_at IS NULL) AND (void_reason IS NULL)) OR ((voided_at IS NOT NULL) AND (length(TRIM(BOTH FROM void_reason)) > 0))))
);


--
-- Name: record_payment(uuid, bigint, public.payment_method, text, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_payment(p_charge_id uuid, p_amount_paise bigint, p_method public.payment_method, p_reference text, p_paid_on date, p_notes text) RETURNS public.payments
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  g public.gyms;
  selected_charge public.charges;
  paid bigint;
  result public.payments;
begin
  select * into g from public.gyms where owner_id = auth.uid() for update;

  select ch.* into selected_charge
  from public.charges ch
  join public.memberships ms on ms.id = ch.membership_id and ms.gym_id = ch.gym_id
  where ch.id = p_charge_id
    and ch.gym_id = g.id
    and ms.reverted_at is null
  for update of ch;

  if selected_charge.id is null then raise exception 'Charge not found'; end if;

  select coalesce(sum(case when p.voided_at is not null then 0 else p.amount_paise - coalesce(r.reversed_paise, 0) end), 0)
  into paid
  from public.payments p
  left join (select payment_id, sum(amount_paise) reversed_paise from public.payment_reversals group by payment_id) r on r.payment_id = p.id
  where p.charge_id = selected_charge.id;

  if p_amount_paise <= 0 or paid + p_amount_paise > selected_charge.total_paise then
    raise exception 'Payment exceeds outstanding balance';
  end if;

  insert into public.payments(gym_id, charge_id, amount_paise, method, reference, paid_on, notes, receipt_number)
  values(g.id, selected_charge.id, p_amount_paise, p_method, nullif(trim(p_reference), ''), p_paid_on, nullif(trim(p_notes), ''), g.receipt_prefix || '-' || lpad(g.next_receipt_number::text, 6, '0'))
  returning * into result;

  update public.gyms set next_receipt_number = next_receipt_number + 1 where id = g.id;
  return result;
end;
$$;


--
-- Name: record_scanner_attendance(uuid, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_scanner_attendance(p_member_id uuid, p_qr_version integer, p_request_id uuid) RETURNS public.attendance_events
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  current_gym uuid;
  gym_timezone text;
  credential public.member_qr_credentials;
  active_membership_id uuid;
  local_date date;
  last_direction public.attendance_direction;
  next_direction public.attendance_direction;
  existing public.attendance_events;
  recent public.attendance_events;
  result public.attendance_events;
begin
  current_gym := public.current_gym_id();
  if current_gym is null then raise exception 'Gym profile not found'; end if;

  select timezone into gym_timezone from public.gyms where id = current_gym;
  local_date := (now() at time zone gym_timezone)::date;

  select * into existing from public.attendance_events
  where request_id = p_request_id and attendance_events.gym_id = current_gym;
  if existing.id is not null then
    if existing.voided_at is not null then raise exception 'Attendance request was already undone'; end if;
    return existing;
  end if;

  perform 1 from public.members
  where id = p_member_id and members.gym_id = current_gym and not is_archived
  for update;
  if not found then raise exception 'Active member not found'; end if;

  select * into credential from public.member_qr_credentials
  where member_id = p_member_id and member_qr_credentials.gym_id = current_gym
  for update;
  if p_qr_version is null or credential.member_id is null or not credential.enabled or credential.version <> p_qr_version then
    raise exception 'QR has been disabled or replaced';
  end if;

  select id into active_membership_id from public.memberships
  where member_id = p_member_id
    and memberships.gym_id = current_gym
    and reverted_at is null
    and starts_on <= local_date
    and expires_on >= local_date
  order by expires_on desc
  limit 1;
  if active_membership_id is null then raise exception 'Member does not have an active membership'; end if;

  select ae.* into recent from public.attendance_events ae
  where ae.member_id = p_member_id
    and ae.gym_id = current_gym
    and ae.occurred_at >= now() - interval '30 seconds'
    and ae.voided_at is null
  order by ae.occurred_at desc, ae.id desc
  limit 1;
  if recent.id is not null then return recent; end if;

  select ae.direction into last_direction from public.attendance_events ae
  where ae.member_id = p_member_id
    and ae.gym_id = current_gym
    and (ae.occurred_at at time zone gym_timezone)::date = local_date
    and ae.voided_at is null
  order by ae.occurred_at desc, ae.id desc
  limit 1;
  next_direction := case when last_direction = 'entry' then 'exit'::public.attendance_direction else 'entry'::public.attendance_direction end;

  insert into public.attendance_events(
    gym_id, member_id, membership_id, direction, qr_version, source, scanned_by, request_id
  ) values (
    current_gym, p_member_id, active_membership_id, next_direction, p_qr_version, 'qr', auth.uid(), p_request_id
  ) returning * into result;

  return result;
end;
$$;


--
-- Name: payment_reversals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_reversals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    payment_id uuid NOT NULL,
    amount_paise bigint NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_reversals_amount_paise_check CHECK ((amount_paise > 0)),
    CONSTRAINT payment_reversals_reason_check CHECK ((length(TRIM(BOTH FROM reason)) > 0))
);


--
-- Name: reverse_payment(uuid, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reverse_payment(p_payment_id uuid, p_amount_paise bigint, p_reason text) RETURNS public.payment_reversals
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare g_id uuid; selected_payment public.payments; already_reversed bigint; result public.payment_reversals;
begin
  g_id := public.current_gym_id();
  select * into selected_payment from public.payments where id = p_payment_id and gym_id = g_id for update;
  if selected_payment.id is null then raise exception 'Payment not found'; end if;
  select coalesce(sum(amount_paise), 0) into already_reversed from public.payment_reversals where payment_id = selected_payment.id;
  if p_amount_paise <= 0 or p_amount_paise > selected_payment.amount_paise - already_reversed then raise exception 'Reversal exceeds the remaining payment amount'; end if;
  insert into public.payment_reversals(gym_id, payment_id, amount_paise, reason)
  values(g_id, selected_payment.id, p_amount_paise, trim(p_reason)) returning * into result;
  if already_reversed + p_amount_paise = selected_payment.amount_paise then
    update public.payments set voided_at = now(), void_reason = trim(p_reason) where id = selected_payment.id;
  end if;
  return result;
end $$;


--
-- Name: submit_payment_operation(uuid, text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_payment_operation(p_request_id uuid, p_kind text, p_details jsonb, p_payments jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
<<op>>
declare
  g public.gyms;
  prior public.payment_operations;
  operation_id uuid := gen_random_uuid();
  payload jsonb := jsonb_build_object('kind', p_kind, 'details', p_details, 'payments', p_payments);
  plan public.plans;
  member_id uuid;
  membership_id uuid;
  charge_id uuid;
  start_date date;
  end_date date;
  calculated_end date;
  latest_end date;
  due_date date;
  subtotal bigint;
  discount bigint;
  tax_rate integer;
  tax bigint;
  total bigint;
  paid_total bigint := 0;
  row jsonb;
  payment public.payments;
  payment_ids jsonb := '[]'::jsonb;
  result jsonb;
  duplicate public.members;
  duplicate_count integer;
  handler_id uuid;
begin
  select * into g from public.gyms where id = public.current_gym_id() and is_active for update;
  if g.id is null or auth.uid() is null then raise exception 'Active gym profile not found'; end if;
  if p_request_id is null then raise exception 'Request ID is required'; end if;
  if p_kind is null or p_kind not in ('activate', 'enroll', 'renew', 'collect') then raise exception 'Invalid payment operation'; end if;
  select * into prior from public.payment_operations where gym_id=g.id and request_id=p_request_id;
  if found then
    if prior.payload <> payload then raise exception 'This request was already saved with different details. Reload to start a new payment.'; end if;
    return prior.result;
  end if;
  if jsonb_typeof(p_details) is distinct from 'object' or jsonb_typeof(p_payments) is distinct from 'array' then raise exception 'Invalid payment details'; end if;
  handler_id := nullif(p_details->>'handled_by_gym_user_id','')::uuid;
  if handler_id is null then
    select id into handler_id from public.gym_users where gym_id = g.id and user_id = auth.uid() and status = 'active' limit 1;
  end if;
  if handler_id is not null and not exists (
    select 1 from public.gym_users where id = handler_id and gym_id = g.id and status = 'active' and role <> 'admin'
  ) then
    raise exception 'Select an active staff member who handled this operation' using hint='handled_by_gym_user_id';
  end if;
  if jsonb_array_length(p_payments) > 10 or (p_kind='collect' and jsonb_array_length(p_payments)=0) then raise exception 'Enter between 1 and 10 payments for collection'; end if;
  for row in select value from jsonb_array_elements(p_payments) loop
    if jsonb_typeof(row) <> 'object' or coalesce(row->>'amount_paise','') !~ '^[0-9]+$'
      or (row->>'amount_paise')::numeric <= 0 or (row->>'amount_paise')::numeric > 9007199254740991
      or coalesce(row->>'method','') not in ('cash','upi','card','bank_transfer')
      or coalesce(row->>'paid_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or length(coalesce(row->>'reference','')) > 200 then raise exception 'Invalid payment entry'; end if;
    perform (row->>'paid_on')::date;
    paid_total := paid_total + (row->>'amount_paise')::bigint;
  end loop;
  if p_kind <> 'activate' then
    member_id := (p_details->>'member_id')::uuid;
    perform 1 from public.members where id=member_id and gym_id=g.id and not is_archived for update;
    if not found then raise exception 'Active member not found'; end if;
  end if;
  if p_kind = 'collect' then
    select c.id, c.membership_id into charge_id, membership_id from public.charges c
      join public.memberships ms on ms.id=c.membership_id and ms.gym_id=c.gym_id
      where c.id=(p_details->>'charge_id')::uuid and c.gym_id=g.id and ms.member_id=op.member_id and ms.reverted_at is null for update of c;
    if charge_id is null then raise exception 'Membership charge not found'; end if;
  else
    select * into plan from public.plans where id=(p_details->>'plan_id')::uuid and gym_id=g.id and is_active;
    if plan.id is null then raise exception 'Active plan not found' using hint='plan_id'; end if;
    start_date := (p_details->>'starts_on')::date;
    if p_kind='renew' then
      select max(expires_on) into latest_end from public.memberships where gym_id=g.id and memberships.member_id=op.member_id and reverted_at is null;
      start_date := greatest(start_date, latest_end + 1);
    end if;
    calculated_end := (case when plan.duration_unit='months' then start_date + make_interval(months=>plan.duration_value) else start_date + make_interval(days=>plan.duration_value) end)::date - 1;
    end_date := coalesce(nullif(p_details->>'expires_on','')::date, calculated_end);
    due_date := start_date + 7;
    if start_date is null or end_date < start_date then raise exception 'End date must be on or after the membership start date' using hint='expires_on'; end if;
    subtotal := (p_details->>'subtotal_paise')::bigint;
    discount := (p_details->>'discount_paise')::bigint;
    tax_rate := (p_details->>'gst_rate_basis_points')::integer;
    if subtotal is null or discount is null or tax_rate is null or subtotal < 0 or discount < 0 or discount > subtotal or tax_rate not between 0 and 10000 then raise exception 'Invalid membership price, discount or tax'; end if;
    tax := round((subtotal-discount)::numeric*tax_rate/10000);
    total := subtotal-discount+tax;
    if paid_total > total then raise exception 'Total paid cannot exceed the membership total' using hint='payments'; end if;
    if p_kind='activate' then
      if nullif(trim(p_details->>'name'),'') is null or length(trim(coalesce(p_details->>'phone',''))) < 7 then raise exception 'Name and phone are required'; end if;
      select count(*) into duplicate_count from public.members where gym_id=g.id and phone=trim(p_details->>'phone');
      select * into duplicate from public.members where gym_id=g.id and phone=trim(p_details->>'phone') order by is_archived,created_at desc limit 1;
      if duplicate.is_archived then raise exception 'This phone belongs to an archived member. Open that profile to reactivate.' using hint='phone', detail=duplicate.id::text; end if;
      if duplicate_count >= 3 then raise exception 'This phone is already shared by 3 members' using hint='phone'; end if;
      if duplicate_count > 0 and coalesce((p_details->>'shared_phone')::boolean,false)=false then raise exception 'This phone is already used. Select the shared-phone confirmation to continue.' using hint='shared_phone'; end if;
      result := public.create_member_with_enrollment(p_details->>'name', p_details->>'phone', p_details->>'email', p_details->>'notes', plan.id, start_date, end_date, end_date<>calculated_end, subtotal, discount, tax_rate, tax, total, due_date, 0, 'cash', '', start_date);
      member_id := (result->>'member_id')::uuid;
      membership_id := (result->>'membership_id')::uuid;
    else
      membership_id := public.create_membership_charge(member_id, plan.id, start_date, end_date, end_date<>calculated_end, subtotal, discount, tax_rate, tax, total, due_date);
    end if;
    update public.memberships set handled_by_gym_user_id = handler_id where id = membership_id and gym_id = g.id;
    select id into charge_id from public.charges where charges.membership_id=op.membership_id and gym_id=g.id;
  end if;
  if p_kind='activate' and coalesce((p_details->>'generate_qr')::boolean,false) then
    perform public.issue_member_qr(member_id);
  end if;
  insert into public.payment_operations(id,gym_id,request_id,payload,result,created_by) values(operation_id,g.id,p_request_id,payload,'{}',auth.uid());
  for row in select value from jsonb_array_elements(p_payments) loop
    payment := public.record_payment(charge_id,(row->>'amount_paise')::bigint,(row->>'method')::public.payment_method,row->>'reference',(row->>'paid_on')::date,p_details->>'notes');
    update public.payments set operation_id=op.operation_id, handled_by_gym_user_id=handler_id where id=payment.id and gym_id=g.id;
    payment_ids := payment_ids || jsonb_build_array(payment.id);
  end loop;
  result := jsonb_build_object('operation_id',operation_id,'member_id',member_id,'membership_id',membership_id,'charge_id',charge_id,'payment_ids',payment_ids,'paid_paise',paid_total);
  update public.payment_operations set result=op.result where id=operation_id and gym_id=g.id;
  return result;
end;
$_$;


--
-- Name: charge_balances; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.charge_balances AS
SELECT
    NULL::uuid AS id,
    NULL::uuid AS gym_id,
    NULL::uuid AS membership_id,
    NULL::bigint AS subtotal_paise,
    NULL::bigint AS discount_paise,
    NULL::integer AS gst_rate_basis_points,
    NULL::bigint AS tax_paise,
    NULL::bigint AS total_paise,
    NULL::timestamp with time zone AS created_at,
    NULL::bigint AS paid_paise,
    NULL::bigint AS balance_paise,
    NULL::date AS due_on;


--
-- Name: charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    subtotal_paise bigint NOT NULL,
    discount_paise bigint DEFAULT 0 NOT NULL,
    gst_rate_basis_points integer DEFAULT 0 NOT NULL,
    tax_paise bigint NOT NULL,
    total_paise bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    due_on date NOT NULL,
    CONSTRAINT charges_check CHECK (((discount_paise >= 0) AND (discount_paise <= subtotal_paise))),
    CONSTRAINT charges_check1 CHECK ((total_paise = ((subtotal_paise - discount_paise) + tax_paise))),
    CONSTRAINT charges_check2 CHECK (((tax_paise)::numeric = round(((((subtotal_paise - discount_paise) * gst_rate_basis_points))::numeric / (10000)::numeric)))),
    CONSTRAINT charges_gst_rate_basis_points_check CHECK (((gst_rate_basis_points >= 0) AND (gst_rate_basis_points <= 10000))),
    CONSTRAINT charges_subtotal_paise_check CHECK ((subtotal_paise >= 0)),
    CONSTRAINT charges_tax_paise_check CHECK ((tax_paise >= 0)),
    CONSTRAINT charges_total_paise_check CHECK ((total_paise >= 0))
);


--
-- Name: denied_access_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.denied_access_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    qr_version integer NOT NULL,
    reason text DEFAULT 'membership_expired'::text NOT NULL,
    expires_on date NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    scanned_by uuid,
    request_id uuid NOT NULL,
    CONSTRAINT denied_access_attempts_qr_version_check CHECK ((qr_version > 0)),
    CONSTRAINT denied_access_attempts_reason_check CHECK ((reason = 'membership_expired'::text))
);


--
-- Name: gym_feature_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_feature_flags (
    gym_id uuid NOT NULL,
    key text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    admin_enabled boolean DEFAULT false NOT NULL,
    config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gym_feature_flags_key_check CHECK ((key ~ '^[a-z][a-z0-9_]*$'::text))
);


--
-- Name: gym_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role public.gym_role NOT NULL,
    status public.gym_user_status DEFAULT 'active'::public.gym_user_status NOT NULL,
    display_name text DEFAULT ''::text NOT NULL,
    phone text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gym_users_check CHECK (((role <> 'trainer'::public.gym_role) OR (length(TRIM(BOTH FROM display_name)) > 0)))
);


--
-- Name: gyms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gyms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text DEFAULT 'My Gym'::text NOT NULL,
    phone text,
    email text,
    address text,
    gstin text,
    timezone text DEFAULT 'Asia/Kolkata'::text NOT NULL,
    receipt_prefix text DEFAULT 'RCT'::text NOT NULL,
    next_member_number bigint DEFAULT 1 NOT NULL,
    next_receipt_number bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    payment_reminder_template text DEFAULT 'Hi {{name}}, a payment of {{balance}} for your {{plan_name}} membership was due on {{due_date}}. Please complete the payment. — {{gym_name}}'::text NOT NULL,
    renewal_reminder_template text DEFAULT 'Hi {{name}}, your {{plan_name}} membership expires on {{expiry_date}}. Please contact us to renew. — {{gym_name}}'::text NOT NULL,
    currency_code text DEFAULT 'INR'::text NOT NULL,
    CONSTRAINT gyms_currency_code_check CHECK ((currency_code = ANY (ARRAY['INR'::text, 'USD'::text, 'EUR'::text, 'GBP'::text, 'AED'::text, 'SGD'::text]))),
    CONSTRAINT gyms_next_member_number_check CHECK ((next_member_number > 0)),
    CONSTRAINT gyms_next_receipt_number_check CHECK ((next_receipt_number > 0))
);


--
-- Name: manual_reminder_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manual_reminder_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    membership_id uuid,
    charge_id uuid,
    kind text NOT NULL,
    status text NOT NULL,
    channel text DEFAULT 'whatsapp'::text NOT NULL,
    phone_snapshot text NOT NULL,
    message_snapshot text NOT NULL,
    prepared_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT manual_reminder_events_channel_check CHECK ((channel = 'whatsapp'::text)),
    CONSTRAINT manual_reminder_events_kind_check CHECK ((kind = ANY (ARRAY['payment'::text, 'renewal'::text]))),
    CONSTRAINT manual_reminder_events_status_check CHECK ((status = ANY (ARRAY['prepared'::text, 'opened'::text])))
);


--
-- Name: memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    plan_id uuid,
    plan_name text NOT NULL,
    duration_value integer NOT NULL,
    duration_unit public.duration_unit NOT NULL,
    starts_on date NOT NULL,
    expires_on date NOT NULL,
    date_overridden boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reverted_at timestamp with time zone,
    reverted_reason text,
    reverted_by uuid,
    handled_by_gym_user_id uuid,
    CONSTRAINT memberships_check CHECK ((expires_on >= starts_on)),
    CONSTRAINT memberships_duration_value_check CHECK ((duration_value > 0))
);


--
-- Name: payment_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    request_id uuid NOT NULL,
    payload jsonb NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    name text NOT NULL,
    duration_value integer NOT NULL,
    duration_unit public.duration_unit NOT NULL,
    default_fee_paise bigint NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plans_default_fee_paise_check CHECK ((default_fee_paise >= 0)),
    CONSTRAINT plans_duration_value_check CHECK ((duration_value > 0))
);


--
-- Name: attendance_events attendance_events_correction_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_correction_request_id_key UNIQUE (correction_request_id);


--
-- Name: attendance_events attendance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_pkey PRIMARY KEY (id);


--
-- Name: attendance_events attendance_events_replacement_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_replacement_unique UNIQUE (replacement_event_id);


--
-- Name: attendance_events attendance_events_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_request_id_key UNIQUE (request_id);


--
-- Name: charges charges_membership_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_membership_id_key UNIQUE (membership_id);


--
-- Name: charges charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_pkey PRIMARY KEY (id);


--
-- Name: denied_access_attempts denied_access_attempts_gym_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.denied_access_attempts
    ADD CONSTRAINT denied_access_attempts_gym_id_request_id_key UNIQUE (gym_id, request_id);


--
-- Name: denied_access_attempts denied_access_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.denied_access_attempts
    ADD CONSTRAINT denied_access_attempts_pkey PRIMARY KEY (id);


--
-- Name: gym_feature_flags gym_feature_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_feature_flags
    ADD CONSTRAINT gym_feature_flags_pkey PRIMARY KEY (gym_id, key);


--
-- Name: gym_users gym_users_gym_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_users
    ADD CONSTRAINT gym_users_gym_id_id_key UNIQUE (gym_id, id);


--
-- Name: gym_users gym_users_gym_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_users
    ADD CONSTRAINT gym_users_gym_id_user_id_key UNIQUE (gym_id, user_id);


--
-- Name: gym_users gym_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_users
    ADD CONSTRAINT gym_users_pkey PRIMARY KEY (id);


--
-- Name: gyms gyms_owner_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gyms
    ADD CONSTRAINT gyms_owner_id_key UNIQUE (owner_id);


--
-- Name: gyms gyms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gyms
    ADD CONSTRAINT gyms_pkey PRIMARY KEY (id);


--
-- Name: manual_reminder_events manual_reminder_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_reminder_events
    ADD CONSTRAINT manual_reminder_events_pkey PRIMARY KEY (id);


--
-- Name: member_qr_credentials member_qr_credentials_gym_id_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_qr_credentials
    ADD CONSTRAINT member_qr_credentials_gym_id_member_id_key UNIQUE (gym_id, member_id);


--
-- Name: member_qr_credentials member_qr_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_qr_credentials
    ADD CONSTRAINT member_qr_credentials_pkey PRIMARY KEY (member_id);


--
-- Name: members members_gym_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_gym_id_id_unique UNIQUE (gym_id, id);


--
-- Name: members members_gym_id_member_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_gym_id_member_code_key UNIQUE (gym_id, member_code);


--
-- Name: members members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (id);


--
-- Name: memberships memberships_gym_member_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_gym_member_id_unique UNIQUE (gym_id, member_id, id);


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);


--
-- Name: payment_operations payment_operations_gym_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_operations
    ADD CONSTRAINT payment_operations_gym_id_id_key UNIQUE (gym_id, id);


--
-- Name: payment_operations payment_operations_gym_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_operations
    ADD CONSTRAINT payment_operations_gym_id_request_id_key UNIQUE (gym_id, request_id);


--
-- Name: payment_operations payment_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_operations
    ADD CONSTRAINT payment_operations_pkey PRIMARY KEY (id);


--
-- Name: payment_reversals payment_reversals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_reversals
    ADD CONSTRAINT payment_reversals_pkey PRIMARY KEY (id);


--
-- Name: payments payments_gym_id_receipt_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_gym_id_receipt_number_key UNIQUE (gym_id, receipt_number);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: plans plans_gym_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_gym_id_name_key UNIQUE (gym_id, name);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: attendance_events_active_gym_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_events_active_gym_time_idx ON public.attendance_events USING btree (gym_id, occurred_at DESC) WHERE (voided_at IS NULL);


--
-- Name: attendance_events_active_member_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_events_active_member_time_idx ON public.attendance_events USING btree (member_id, occurred_at DESC) WHERE (voided_at IS NULL);


--
-- Name: attendance_events_gym_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_events_gym_time_idx ON public.attendance_events USING btree (gym_id, occurred_at DESC);


--
-- Name: attendance_events_member_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_events_member_time_idx ON public.attendance_events USING btree (member_id, occurred_at DESC);


--
-- Name: charges_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX charges_due_idx ON public.charges USING btree (gym_id, due_on);


--
-- Name: denied_access_gym_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX denied_access_gym_time_idx ON public.denied_access_attempts USING btree (gym_id, occurred_at DESC, id);


--
-- Name: denied_access_member_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX denied_access_member_time_idx ON public.denied_access_attempts USING btree (gym_id, member_id, occurred_at DESC);


--
-- Name: gym_users_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gym_users_role_idx ON public.gym_users USING btree (gym_id, role, status);


--
-- Name: gym_users_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gym_users_user_idx ON public.gym_users USING btree (user_id, status);


--
-- Name: manual_reminder_events_gym_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX manual_reminder_events_gym_time_idx ON public.manual_reminder_events USING btree (gym_id, created_at DESC);


--
-- Name: manual_reminder_events_member_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX manual_reminder_events_member_time_idx ON public.manual_reminder_events USING btree (member_id, created_at DESC);


--
-- Name: member_qr_credentials_public_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX member_qr_credentials_public_code_key ON public.member_qr_credentials USING btree (public_code);


--
-- Name: members_assigned_trainer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX members_assigned_trainer_idx ON public.members USING btree (gym_id, assigned_trainer_user_id) WHERE (assigned_trainer_user_id IS NOT NULL);


--
-- Name: members_search_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX members_search_idx ON public.members USING btree (gym_id, name, phone);


--
-- Name: memberships_active_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memberships_active_period_idx ON public.memberships USING btree (gym_id, member_id, starts_on, expires_on) WHERE (reverted_at IS NULL);


--
-- Name: memberships_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memberships_expiry_idx ON public.memberships USING btree (gym_id, expires_on);


--
-- Name: memberships_handled_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memberships_handled_by_idx ON public.memberships USING btree (gym_id, handled_by_gym_user_id) WHERE (handled_by_gym_user_id IS NOT NULL);


--
-- Name: memberships_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memberships_member_idx ON public.memberships USING btree (member_id, expires_on DESC);


--
-- Name: payment_reversals_payment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_reversals_payment_idx ON public.payment_reversals USING btree (payment_id, created_at);


--
-- Name: payments_charge_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_charge_idx ON public.payments USING btree (charge_id, created_at);


--
-- Name: payments_handled_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_handled_by_idx ON public.payments USING btree (gym_id, handled_by_gym_user_id) WHERE (handled_by_gym_user_id IS NOT NULL);


--
-- Name: payments_operation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_operation_idx ON public.payments USING btree (gym_id, operation_id) WHERE (operation_id IS NOT NULL);


--
-- Name: charge_balances _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.charge_balances WITH (security_invoker='true') AS
 SELECT c.id,
    c.gym_id,
    c.membership_id,
    c.subtotal_paise,
    c.discount_paise,
    c.gst_rate_basis_points,
    c.tax_paise,
    c.total_paise,
    c.created_at,
    (COALESCE(sum(
        CASE
            WHEN (p.voided_at IS NOT NULL) THEN (0)::numeric
            ELSE ((p.amount_paise)::numeric - COALESCE(r.reversed_paise, (0)::numeric))
        END), (0)::numeric))::bigint AS paid_paise,
    (((c.total_paise)::numeric - COALESCE(sum(
        CASE
            WHEN (p.voided_at IS NOT NULL) THEN (0)::numeric
            ELSE ((p.amount_paise)::numeric - COALESCE(r.reversed_paise, (0)::numeric))
        END), (0)::numeric)))::bigint AS balance_paise,
    c.due_on
   FROM (((public.charges c
     JOIN public.memberships ms ON (((ms.id = c.membership_id) AND (ms.gym_id = c.gym_id) AND (ms.reverted_at IS NULL))))
     LEFT JOIN public.payments p ON ((p.charge_id = c.id)))
     LEFT JOIN ( SELECT payment_reversals.payment_id,
            sum(payment_reversals.amount_paise) AS reversed_paise
           FROM public.payment_reversals
          GROUP BY payment_reversals.payment_id) r ON ((r.payment_id = p.id)))
  GROUP BY c.id;


--
-- Name: members disable_qr_when_member_archived; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER disable_qr_when_member_archived AFTER UPDATE OF is_archived ON public.members FOR EACH ROW EXECUTE FUNCTION public.disable_archived_member_qr();


--
-- Name: attendance_events attendance_events_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: attendance_events attendance_events_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: attendance_events attendance_events_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES public.memberships(id) ON DELETE SET NULL;


--
-- Name: attendance_events attendance_events_replacement_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_replacement_event_id_fkey FOREIGN KEY (replacement_event_id) REFERENCES public.attendance_events(id) ON DELETE SET NULL;


--
-- Name: attendance_events attendance_events_scanned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_scanned_by_fkey FOREIGN KEY (scanned_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: attendance_events attendance_events_voided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: charges charges_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: charges charges_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES public.memberships(id);


--
-- Name: denied_access_attempts denied_access_attempts_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.denied_access_attempts
    ADD CONSTRAINT denied_access_attempts_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id);


--
-- Name: denied_access_attempts denied_access_attempts_gym_id_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.denied_access_attempts
    ADD CONSTRAINT denied_access_attempts_gym_id_member_id_fkey FOREIGN KEY (gym_id, member_id) REFERENCES public.members(gym_id, id);


--
-- Name: denied_access_attempts denied_access_attempts_gym_id_member_id_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.denied_access_attempts
    ADD CONSTRAINT denied_access_attempts_gym_id_member_id_membership_id_fkey FOREIGN KEY (gym_id, member_id, membership_id) REFERENCES public.memberships(gym_id, member_id, id);


--
-- Name: denied_access_attempts denied_access_attempts_scanned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.denied_access_attempts
    ADD CONSTRAINT denied_access_attempts_scanned_by_fkey FOREIGN KEY (scanned_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: gym_feature_flags gym_feature_flags_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_feature_flags
    ADD CONSTRAINT gym_feature_flags_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: gym_users gym_users_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_users
    ADD CONSTRAINT gym_users_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: gym_users gym_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_users
    ADD CONSTRAINT gym_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: gyms gyms_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gyms
    ADD CONSTRAINT gyms_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: manual_reminder_events manual_reminder_events_charge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_reminder_events
    ADD CONSTRAINT manual_reminder_events_charge_id_fkey FOREIGN KEY (charge_id) REFERENCES public.charges(id) ON DELETE SET NULL;


--
-- Name: manual_reminder_events manual_reminder_events_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_reminder_events
    ADD CONSTRAINT manual_reminder_events_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: manual_reminder_events manual_reminder_events_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_reminder_events
    ADD CONSTRAINT manual_reminder_events_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: manual_reminder_events manual_reminder_events_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_reminder_events
    ADD CONSTRAINT manual_reminder_events_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES public.memberships(id) ON DELETE SET NULL;


--
-- Name: manual_reminder_events manual_reminder_events_prepared_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_reminder_events
    ADD CONSTRAINT manual_reminder_events_prepared_by_fkey FOREIGN KEY (prepared_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: member_qr_credentials member_qr_credentials_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_qr_credentials
    ADD CONSTRAINT member_qr_credentials_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: member_qr_credentials member_qr_credentials_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_qr_credentials
    ADD CONSTRAINT member_qr_credentials_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: member_qr_credentials member_qr_credentials_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_qr_credentials
    ADD CONSTRAINT member_qr_credentials_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: members members_assigned_trainer_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_assigned_trainer_user_fk FOREIGN KEY (gym_id, assigned_trainer_user_id) REFERENCES public.gym_users(gym_id, id);


--
-- Name: members members_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_handled_by_gym_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_handled_by_gym_user_fk FOREIGN KEY (gym_id, handled_by_gym_user_id) REFERENCES public.gym_users(gym_id, id);


--
-- Name: memberships memberships_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id);


--
-- Name: memberships memberships_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE SET NULL;


--
-- Name: memberships memberships_reverted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_reverted_by_fkey FOREIGN KEY (reverted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: payment_operations payment_operations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_operations
    ADD CONSTRAINT payment_operations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: payment_operations payment_operations_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_operations
    ADD CONSTRAINT payment_operations_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id);


--
-- Name: payment_reversals payment_reversals_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_reversals
    ADD CONSTRAINT payment_reversals_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: payment_reversals payment_reversals_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_reversals
    ADD CONSTRAINT payment_reversals_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--
-- Name: payments payments_charge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_charge_id_fkey FOREIGN KEY (charge_id) REFERENCES public.charges(id);


--
-- Name: payments payments_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: payments payments_handled_by_gym_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_handled_by_gym_user_fk FOREIGN KEY (gym_id, handled_by_gym_user_id) REFERENCES public.gym_users(gym_id, id);


--
-- Name: payments payments_operation_gym_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_operation_gym_fk FOREIGN KEY (gym_id, operation_id) REFERENCES public.payment_operations(gym_id, id);


--
-- Name: plans plans_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: gym_feature_flags active gym users read flags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "active gym users read flags" ON public.gym_feature_flags FOR SELECT TO authenticated USING ((gym_id = public.current_gym_id()));


--
-- Name: gym_users active gym users read staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "active gym users read staff" ON public.gym_users FOR SELECT TO authenticated USING ((gym_id = public.current_gym_id()));


--
-- Name: gyms active owner gym update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "active owner gym update" ON public.gyms FOR UPDATE USING (((owner_id = auth.uid()) AND is_active)) WITH CHECK (((owner_id = auth.uid()) AND is_active));


--
-- Name: gyms active staff gym read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "active staff gym read" ON public.gyms FOR SELECT TO authenticated USING ((id = public.current_gym_id()));


--
-- Name: gym_feature_flags admin manages flags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manages flags" ON public.gym_feature_flags TO authenticated USING (((gym_id = public.current_gym_id()) AND (public.current_gym_role() = 'admin'::public.gym_role))) WITH CHECK (((gym_id = public.current_gym_id()) AND (public.current_gym_role() = 'admin'::public.gym_role)));


--
-- Name: attendance_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_events ENABLE ROW LEVEL SECURITY;

--
-- Name: charges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.charges ENABLE ROW LEVEL SECURITY;

--
-- Name: denied_access_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.denied_access_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: gym_feature_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gym_feature_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: gym_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gym_users ENABLE ROW LEVEL SECURITY;

--
-- Name: gyms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gyms ENABLE ROW LEVEL SECURITY;

--
-- Name: manual_reminder_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.manual_reminder_events ENABLE ROW LEVEL SECURITY;

--
-- Name: member_qr_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_qr_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

--
-- Name: memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_events owner attendance insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner attendance insert" ON public.attendance_events FOR INSERT WITH CHECK ((gym_id = public.current_gym_id()));


--
-- Name: attendance_events owner attendance read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner attendance read" ON public.attendance_events FOR SELECT USING ((gym_id = public.current_gym_id()));


--
-- Name: charges owner charges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner charges" ON public.charges USING ((gym_id = public.current_gym_id())) WITH CHECK ((gym_id = public.current_gym_id()));


--
-- Name: denied_access_attempts owner denied access read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner denied access read" ON public.denied_access_attempts FOR SELECT TO authenticated USING ((gym_id = public.current_gym_id()));


--
-- Name: gyms owner gym read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner gym read" ON public.gyms FOR SELECT USING ((owner_id = auth.uid()));


--
-- Name: gym_users owner manages staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner manages staff" ON public.gym_users TO authenticated USING (((gym_id = public.current_gym_id()) AND (public.current_gym_role() = ANY (ARRAY['owner'::public.gym_role, 'admin'::public.gym_role])))) WITH CHECK (((gym_id = public.current_gym_id()) AND (public.current_gym_role() = ANY (ARRAY['owner'::public.gym_role, 'admin'::public.gym_role]))));


--
-- Name: manual_reminder_events owner manual reminder insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner manual reminder insert" ON public.manual_reminder_events FOR INSERT WITH CHECK (((gym_id = public.current_gym_id()) AND (prepared_by = auth.uid())));


--
-- Name: manual_reminder_events owner manual reminder read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner manual reminder read" ON public.manual_reminder_events FOR SELECT USING ((gym_id = public.current_gym_id()));


--
-- Name: members owner members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner members" ON public.members USING ((gym_id = public.current_gym_id())) WITH CHECK ((gym_id = public.current_gym_id()));


--
-- Name: memberships owner memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner memberships" ON public.memberships USING ((gym_id = public.current_gym_id())) WITH CHECK ((gym_id = public.current_gym_id()));


--
-- Name: payment_operations owner payment operations read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner payment operations read" ON public.payment_operations FOR SELECT TO authenticated USING ((gym_id = public.current_gym_id()));


--
-- Name: payment_reversals owner payment reversals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner payment reversals" ON public.payment_reversals USING ((gym_id = public.current_gym_id())) WITH CHECK ((gym_id = public.current_gym_id()));


--
-- Name: payments owner payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner payments" ON public.payments USING ((gym_id = public.current_gym_id())) WITH CHECK ((gym_id = public.current_gym_id()));


--
-- Name: plans owner plans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner plans" ON public.plans USING ((gym_id = public.current_gym_id())) WITH CHECK ((gym_id = public.current_gym_id()));


--
-- Name: member_qr_credentials owner qr credentials; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner qr credentials" ON public.member_qr_credentials USING ((gym_id = public.current_gym_id())) WITH CHECK ((gym_id = public.current_gym_id()));


--
-- Name: payment_operations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_operations ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_reversals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_reversals ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict NbL1xJzXQqHEnvicrVMT7AAxgtkCzs7gse5RRBMIETyZX2G6eeN439bEdOvlJNV

