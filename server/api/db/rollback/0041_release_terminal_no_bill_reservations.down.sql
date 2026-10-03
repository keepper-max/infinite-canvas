-- Intentionally no automatic data rollback. Re-freezing corrected reservations
-- after users create new jobs can corrupt the account aggregate. Restore the
-- verified pre-deployment database backup if this correction must be reversed.
select 1;
