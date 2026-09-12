alter table public.gyms
  add column if not exists currency_code text not null default 'INR',
  add constraint gyms_currency_code_check check (currency_code in ('INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'));
