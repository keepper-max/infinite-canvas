update billing_plans
set enabled=false,updated_at=now()
where id in ('alipay-package-990','alipay-package-9900');

update billing_plans
set enabled=true,updated_at=now()
where id in ('alipay-100','alipay-1000','alipay-acceptance');

delete from platform_schema_migrations where name='0025_alipay_published_plans.sql';
