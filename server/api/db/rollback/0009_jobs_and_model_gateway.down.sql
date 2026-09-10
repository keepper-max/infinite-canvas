-- Non-destructive rollback: pause new routes and models while preserving job history.
update provider_routes set enabled = false, updated_at = now();
update model_catalog set enabled = false, updated_at = now();
