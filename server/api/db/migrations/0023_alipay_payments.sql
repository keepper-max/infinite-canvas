alter table payment_orders add column if not exists credits bigint not null default 0;
alter table payment_orders add column if not exists expires_at timestamptz;
alter table payment_orders add column if not exists closed_at timestamptz;
alter table payment_orders add column if not exists last_synced_at timestamptz;
alter table payment_orders add column if not exists failure_code text;
alter table payment_orders add column if not exists failure_message text;

create unique index if not exists payment_orders_provider_order_uidx
  on payment_orders(provider,provider_order_id) where provider_order_id is not null;

insert into billing_plans(id,name,credits,price_cents,currency,enabled,metadata)
values
  ('alipay-starter','入门充值',1000,1000,'CNY',true,'{"paymentProvider":"alipay"}'),
  ('alipay-standard','标准充值',5000,5000,'CNY',true,'{"paymentProvider":"alipay"}'),
  ('alipay-plus','进阶充值',10000,10000,'CNY',true,'{"paymentProvider":"alipay"}')
on conflict(id) do nothing;
