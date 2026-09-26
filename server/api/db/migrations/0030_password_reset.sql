do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'email_verification_purpose_check'
      and conrelid = 'email_verification_codes'::regclass
  ) then
    alter table email_verification_codes
      add constraint email_verification_purpose_check
      check (purpose in ('register', 'password_reset'));
  end if;
end $$;
