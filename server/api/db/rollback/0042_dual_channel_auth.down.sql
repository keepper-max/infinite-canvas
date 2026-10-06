-- This migration deliberately has no automatic destructive rollback.
-- Phone-only accounts can exist after deployment; dropping identity columns or
-- restoring NOT NULL constraints would destroy or invalidate those accounts.
-- Roll application code forward, or restore a verified pre-release database
-- into a new database and switch only after explicit operator approval.
select 1;
