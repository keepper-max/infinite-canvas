insert into platform_settings(key,value)
values('payment_access','{"publicRechargeEnabled":true}')
on conflict(key) do nothing;
