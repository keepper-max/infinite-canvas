update billing_plans
set enabled=false,updated_at=now()
where id in ('alipay-starter','alipay-standard','alipay-plus');

insert into billing_plans(id,name,credits,price_cents,currency,enabled,metadata)
values
  ('alipay-100','100 积分套餐',100,990,'CNY',true,'{"paymentProvider":"alipay"}'),
  ('alipay-1000','1000 积分套餐',1000,9990,'CNY',true,'{"paymentProvider":"alipay"}'),
  ('alipay-acceptance','支付验收订单',1,1,'CNY',true,'{"paymentProvider":"alipay","adminOnly":true,"experimental":true}')
on conflict(id) do update set
  name=excluded.name,
  credits=excluded.credits,
  price_cents=excluded.price_cents,
  currency=excluded.currency,
  enabled=excluded.enabled,
  metadata=excluded.metadata,
  updated_at=now();
