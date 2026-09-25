#!/bin/sh
set -eu

manifest="${1:?usage: rollback-production.sh RELEASE_MANIFEST}"
compose_file="${COMPOSE_FILE:-docker-compose.yml}"
compose_override_file="${COMPOSE_OVERRIDE_FILE:-}"
env_file="${ENV_FILE:-.env}"

compose() {
  if test -n "$compose_override_file"; then
    docker compose --env-file "$env_file" -f "$compose_file" -f "$compose_override_file" "$@"
  else
    docker compose --env-file "$env_file" -f "$compose_file" "$@"
  fi
}

test -f "$manifest"

manifest_value() {
  sed -n "s/^$1=//p" "$manifest" | tail -n 1
}

release_sha="$(manifest_value release_sha)"
backup_dir="$(manifest_value backup_dir)"
previous_web="$(manifest_value previous_web)"
previous_api="$(manifest_value previous_api)"
previous_supports_versioned_billing="$(manifest_value previous_supports_versioned_billing)"

case "$release_sha" in
  *[!0-9a-f]*|'') printf 'invalid release manifest\n' >&2; exit 1 ;;
esac
test "${CONFIRM_PRODUCTION_ROLLBACK:-}" = "rollback-${release_sha}" || {
  printf 'rollback not confirmed; set CONFIRM_PRODUCTION_ROLLBACK=rollback-%s\n' "$release_sha" >&2
  exit 1
}

COMPOSE_FILE="$compose_file" COMPOSE_OVERRIDE_FILE="$compose_override_file" ENV_FILE="$env_file" sh ops/verify-backup.sh "$backup_dir"
COMPOSE_FILE="$compose_file" COMPOSE_OVERRIDE_FILE="$compose_override_file" ENV_FILE="$env_file" sh ops/check-migration-compatibility.sh "$backup_dir" applied

if test "$previous_supports_versioned_billing" != true; then
  incompatible_billing_jobs="$(compose exec -T db sh -ec 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<'SQL'
select count(*)
from generation_jobs
where billing_rule_snapshot<>'{}'::jsonb
  and not (
    billing_rule_snapshot->>'ruleKey' in ('runninghub-seedance-2-5','runninghub-global-seedance-2-5')
    and billing_rule_snapshot->>'discountRate' in ('0.8','0.80000000')
  );
SQL
)"
  test "$incompatible_billing_jobs" = 0 || {
    printf 'rollback refused: previous worker cannot settle %s job(s) with versioned billing rules\n' "$incompatible_billing_jobs" >&2
    exit 1
  }
fi

if test -n "$previous_api"; then
  API_IMAGE="$previous_api" compose up -d --no-deps api worker
else
  compose stop api worker
fi

if test -n "$previous_web"; then
  WEB_IMAGE="$previous_web" compose up -d --no-deps web
else
  compose stop web
fi

compose ps
printf 'image rollback completed for release: %s\n' "$release_sha"
