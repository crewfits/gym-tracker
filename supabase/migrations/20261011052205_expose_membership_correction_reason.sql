drop function if exists public.list_transactions(text, public.payment_method, text, date, date, integer, integer, text, text);

create function public.list_transactions(
  p_query text default null,
  p_method public.payment_method default null,
  p_status text default null,
  p_from date default null,
  p_to date default null,
  p_page integer default 1,
  p_page_size integer default 50,
  p_sort text default 'paid_on',
  p_order text default 'desc'
)
returns table (
  id uuid, receipt_number text, paid_on date, method public.payment_method,
  reference text, amount_paise bigint, reversed_paise bigint, net_paise bigint,
  voided_at timestamptz, void_reason text, correction_reason text,
  member_id uuid, member_code text, member_name text, plan_name text,
  total_count bigint, view_collected_paise bigint, view_reversed_paise bigint,
  view_completed_count bigint
)
language sql stable security invoker set search_path = public
as $$
  with candidates as (
    select
      p.id, p.receipt_number, p.paid_on, p.method, p.reference, p.amount_paise,
      coalesce(sum(pr.amount_paise), 0)::bigint as reversed_paise,
      case when p.voided_at is not null then 0 else p.amount_paise - coalesce(sum(pr.amount_paise), 0) end::bigint as net_paise,
      p.voided_at, p.void_reason,
      coalesce(
        max(case
          when po.payload->>'kind' = 'membership_correction'
          then nullif(trim(po.payload->>'reason'), '')
        end),
        nullif(string_agg(distinct nullif(trim(pr.reason), ''), '; '), '')
      ) as correction_reason,
      m.id as member_id, m.member_code, m.name as member_name, ms.plan_name,
      p.created_at
    from public.payments p
    join public.charges c on c.id = p.charge_id and c.gym_id = p.gym_id
    join public.memberships ms on ms.id = c.membership_id and ms.gym_id = p.gym_id
    join public.members m on m.id = ms.member_id and m.gym_id = p.gym_id
    left join public.payment_reversals pr on pr.payment_id = p.id and pr.gym_id = p.gym_id
    left join public.payment_operations po on po.id = p.operation_id and po.gym_id = p.gym_id
    where p.gym_id = public.current_gym_id()
      and (p_method is null or p.method = p_method)
      and (p_from is null or p.paid_on >= p_from)
      and (p_to is null or p.paid_on <= p_to)
    group by p.id, m.id, ms.id
  ), filtered as (
    select
      candidates.*, count(*) over() as total_count,
      coalesce(sum(net_paise) over(), 0)::bigint as view_collected_paise,
      coalesce(sum(reversed_paise) over(), 0)::bigint as view_reversed_paise,
      count(*) filter (where net_paise > 0) over() as view_completed_count
    from candidates
    where (
      nullif(trim(coalesce(p_query, '')), '') is null
      or member_name ilike '%' || trim(p_query) || '%'
      or member_code ilike '%' || trim(p_query) || '%'
      or receipt_number ilike '%' || trim(p_query) || '%'
      or reference ilike '%' || trim(p_query) || '%'
      or correction_reason ilike '%' || trim(p_query) || '%'
    )
      and (
        nullif(trim(coalesce(p_status, '')), '') is null
        or (p_status = 'completed' and voided_at is null)
        or (p_status = 'reversed' and voided_at is not null)
        or (p_status = 'partial_reversal' and voided_at is null and reversed_paise > 0)
      )
  )
  select
    filtered.id, filtered.receipt_number, filtered.paid_on, filtered.method,
    filtered.reference, filtered.amount_paise, filtered.reversed_paise,
    filtered.net_paise, filtered.voided_at, filtered.void_reason,
    filtered.correction_reason, filtered.member_id, filtered.member_code,
    filtered.member_name, filtered.plan_name, filtered.total_count,
    filtered.view_collected_paise, filtered.view_reversed_paise,
    filtered.view_completed_count
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

revoke all on function public.list_transactions(text, public.payment_method, text, date, date, integer, integer, text, text) from public, anon;
grant execute on function public.list_transactions(text, public.payment_method, text, date, date, integer, integer, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
