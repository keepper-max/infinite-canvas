/** A missing provider task ID does not prove that a paid request was rejected. */
export function hasUnconfirmedSubmission(job: Record<string, unknown>) {
  if (job.provider_job_id) return false;
  const state = String(job.provider_submission_state ?? "legacy");
  return (
    ["dispatching", "unknown"].includes(state) ||
    (state === "legacy" &&
      Number(job.attempt_count ?? 0) > 0 &&
      !["settled", "not_billed"].includes(String(job.billing_status)))
  );
}

export function canReleaseUnsubmittedReservation(job: Record<string, unknown>) {
  if (hasUnconfirmedSubmission(job) || job.provider_job_id) return false;
  return (
    ["not_started", "rejected"].includes(
      String(job.provider_submission_state),
    ) ||
    (String(job.provider_submission_state ?? "legacy") === "legacy" &&
      Number(job.attempt_count ?? 0) === 0) ||
    job.billing_status === "not_billed"
  );
}
