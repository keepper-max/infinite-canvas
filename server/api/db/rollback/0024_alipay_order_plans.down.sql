update billing_plans
set enabled=false,updated_at=now()
where id in ('alipay-100','alipay-1000','alipay-acceptance');

update billing_plans
set enabled=true,updated_at=now()
where id in ('alipay-starter','alipay-standard','alipay-plus');

delete from platform_schema_migrations where name='0024_alipay_order_plans.sql';
