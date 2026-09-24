update billing_plans
set enabled=false,updated_at=now()
where metadata->>'paymentProvider'='alipay';

insert into billing_plans(id,name,credits,price_cents,currency,enabled,metadata)
values
  ('alipay-package-990','1000 积分套餐',1000,990,'CNY',true,'{"paymentProvider":"alipay","managedBy":"admin"}'),
  ('alipay-package-9900','10000 积分套餐',10000,9900,'CNY',true,'{"paymentProvider":"alipay","managedBy":"admin"}')
on conflict(id) do update set
  name=excluded.name,
  credits=excluded.credits,
  price_cents=excluded.price_cents,
  currency=excluded.currency,
  enabled=excluded.enabled,
  metadata=excluded.metadata,
  updated_at=now();
