-- Pause scheduled WhatsApp sends without deleting the scheduler implementation.
-- Earlier migrations remain unchanged because they may already be applied.
do $$
declare
  v_job record;
begin
  if to_regclass('cron.job') is not null then
    for v_job in select jobid from cron.job where jobname = 'fitkiro_payment_reminders_daily' loop
      perform cron.unschedule(v_job.jobid);
    end loop;
  end if;
end $$;

-- To re-enable after explicit approval:
-- select cron.schedule(
--   'fitkiro_payment_reminders_daily',
--   '0 3 * * *',
--   $$select public.invoke_payment_reminders_cron();$$
-- );
