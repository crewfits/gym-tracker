revoke all on table public.payment_reversals from anon;
grant select, insert on table public.payment_reversals to authenticated;
grant all on table public.payment_reversals to service_role;

revoke execute on function public.reverse_payment(uuid, bigint, text) from public, anon;
grant execute on function public.reverse_payment(uuid, bigint, text) to authenticated, service_role;

grant select on table public.charge_balances to authenticated, service_role;

notify pgrst, 'reload schema';
