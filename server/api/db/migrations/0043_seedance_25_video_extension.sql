update model_capabilities
set accepted_parameters = case
      when accepted_parameters @> '["omniReferenceTaskType"]'::jsonb then accepted_parameters
      else accepted_parameters || '["omniReferenceTaskType"]'::jsonb
    end,
    parameter_map = parameter_map || '{"omniReferenceTaskType":"omni_reference_task_type"}'::jsonb,
    overrides_version = overrides_version + 1,
    updated_at = now()
where model_id = 'video.seedance-2-5';
