#!/bin/sh
set -eu

manifest="${1:?usage: rollback-production.sh RELEASE_MANIFEST}"
compose_file="${COMPOSE_FILE:-docker-compose.yml}"
env_file="${ENV_FILE:-.env}"

test -f "$manifest"

manifest_value() {
  sed -n "s/^$1=//p" "$manifest" | tail -n 1
}

release_sha="$(manifest_value release_sha)"
backup_dir="$(manifest_value backup_dir)"
previous_web="$(manifest_value previous_web)"
previous_api="$(manifest_value previous_api)"

case "$release_sha" in
  *[!0-9a-f]*|'') printf 'invalid release manifest\n' >&2; exit 1 ;;
esac
test "${CONFIRM_PRODUCTION_ROLLBACK:-}" = "rollback-${release_sha}" || {
  printf 'rollback not confirmed; set CONFIRM_PRODUCTION_ROLLBACK=rollback-%s\n' "$release_sha" >&2
  exit 1
}

COMPOSE_FILE="$compose_file" ENV_FILE="$env_file" sh ops/verify-backup.sh "$backup_dir"

if test -n "$previous_api"; then
  env API_IMAGE="$previous_api" docker compose --env-file "$env_file" -f "$compose_file" up -d --no-deps api worker
else
  docker compose --env-file "$env_file" -f "$compose_file" stop api worker
fi

if test -n "$previous_web"; then
  env WEB_IMAGE="$previous_web" docker compose --env-file "$env_file" -f "$compose_file" up -d --no-deps web
else
  docker compose --env-file "$env_file" -f "$compose_file" stop web
fi

docker compose --env-file "$env_file" -f "$compose_file" ps
printf 'image rollback completed for release: %s\n' "$release_sha"
