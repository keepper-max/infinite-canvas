alter table users alter column email drop not null;
alter table users alter column password_hash drop not null;
alter table users add column if not exists phone text;
alter table users add column if not exists phone_verified boolean not null default false;
alter table users add column if not exists email_verified boolean not null default false;
alter table users add column if not exists nickname text;
alter table users add column if not exists avatar text;

create unique index if not exists users_phone_unique_idx on users(phone) where phone is not null;
create unique index if not exists users_email_unique_idx on users(lower(email)) where email is not null;

alter table users drop constraint if exists users_identity_required;
alter table users add constraint users_identity_required check (phone is not null or email is not null) not valid;
alter table users validate constraint users_identity_required;

update users set email_verified=true where email is not null;
