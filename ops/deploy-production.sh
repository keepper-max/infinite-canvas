#!/bin/sh
set -eu

umask 077

compose_file="${COMPOSE_FILE:-docker-compose.yml}"
compose_override_file="${COMPOSE_OVERRIDE_FILE:-}"
env_file="${ENV_FILE:-.env}"
release_root="${RELEASE_ROOT:-/opt/infinite-canvas-releases}"
release_sha="$(git rev-parse HEAD)"
short_sha="$(git rev-parse --short=12 HEAD)"
expected_confirmation="deploy-${release_sha}"

compose() {
  if test -n "$compose_override_file"; then
    docker compose --env-file "$env_file" -f "$compose_file" -f "$compose_override_file" "$@"
  else
    docker compose --env-file "$env_file" -f "$compose_file" "$@"
  fi
}

test "${CONFIRM_PRODUCTION_DEPLOY:-}" = "$expected_confirmation" || {
  printf 'deployment not confirmed; set CONFIRM_PRODUCTION_DEPLOY=%s\n' "$expected_confirmation" >&2
  exit 1
}
public_url="${PUBLIC_URL:?set PUBLIC_URL to the HTTPS site origin}"
health_timeout="${DEPLOY_HEALTH_TIMEOUT_SECONDS:?set DEPLOY_HEALTH_TIMEOUT_SECONDS}"
case "$public_url" in
  https://*) ;;
  *) printf 'PUBLIC_URL must start with https://\n' >&2; exit 1 ;;
esac
case "$health_timeout" in
  *[!0-9]*|'') printf 'DEPLOY_HEALTH_TIMEOUT_SECONDS must be a positive integer\n' >&2; exit 1 ;;
  0) printf 'DEPLOY_HEALTH_TIMEOUT_SECONDS must be greater than zero\n' >&2; exit 1 ;;
esac

COMPOSE_FILE="$compose_file" COMPOSE_OVERRIDE_FILE="$compose_override_file" ENV_FILE="$env_file" sh ops/preflight-production.sh

mkdir -p "$release_root"
backup_dir="$(COMPOSE_FILE="$compose_file" COMPOSE_OVERRIDE_FILE="$compose_override_file" ENV_FILE="$env_file" BACKUP_ROOT="${BACKUP_ROOT:-/opt/infinite-canvas-backups}" sh ops/backup-production.sh)"
COMPOSE_FILE="$compose_file" COMPOSE_OVERRIDE_FILE="$compose_override_file" ENV_FILE="$env_file" sh ops/verify-backup.sh "$backup_dir"
COMPOSE_FILE="$compose_file" COMPOSE_OVERRIDE_FILE="$compose_override_file" ENV_FILE="$env_file" sh ops/check-migration-compatibility.sh "$backup_dir" pending

previous_web="$(compose images -q web 2>/dev/null | head -n 1)"
previous_api="$(compose images -q api 2>/dev/null | head -n 1)"
new_web="infinite-canvas-web:${short_sha}"
new_api="infinite-canvas-api:${short_sha}"
manifest="$release_root/release-${short_sha}.manifest"
if grep -Fxq '0027_versioned_provider_billing_rules.sql' "$backup_dir/schema-migrations.txt"; then
  previous_supports_versioned_billing=true
else
  previous_supports_versioned_billing=false
fi

cat > "$manifest" <<EOF
release_sha=$release_sha
backup_dir=$backup_dir
schema_migrations_file=$backup_dir/schema-migrations.txt
previous_supports_versioned_billing=$previous_supports_versioned_billing
previous_web=$previous_web
previous_api=$previous_api
new_web=$new_web
new_api=$new_api
EOF

rollback_images() {
  printf 'release failed; restoring previous service images\n' >&2
  if test -n "$previous_api"; then
    API_IMAGE="$previous_api" compose up -d --no-deps api worker || true
  else
    compose stop api worker || true
  fi
  if test -n "$previous_web"; then
    WEB_IMAGE="$previous_web" compose up -d --no-deps web || true
  else
    compose stop web || true
  fi
}

docker build --target api -t "$new_api" .
docker build --target web -t "$new_web" .

API_IMAGE="$new_api" compose run --rm --no-deps api node dist/db/migrate-cli.js
switch_started=true
deployment_completed=false
rollback_on_exit() {
  exit_code=$?
  trap - 0
  if test "$switch_started" = true && test "$deployment_completed" != true; then
    rollback_images
  fi
  exit "$exit_code"
}
trap rollback_on_exit 0
trap 'exit 130' INT HUP TERM
API_IMAGE="$new_api" compose up -d --no-deps api worker

wait_for_service() {
  service="$1"
  elapsed=0
  while test "$elapsed" -lt "$health_timeout"; do
    container_id="$(compose ps -q "$service")"
    if test -n "$container_id"; then
      state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
      test "$state" = healthy -o "$state" = running && return 0
      test "$state" = exited -o "$state" = dead && return 1
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

if ! wait_for_service api || ! wait_for_service worker; then
  exit 1
fi

WEB_IMAGE="$new_web" API_IMAGE="$new_api" compose up -d --no-deps web
if ! wait_for_service web || ! COMPOSE_FILE="$compose_file" COMPOSE_OVERRIDE_FILE="$compose_override_file" ENV_FILE="$env_file" PUBLIC_URL="$public_url" sh ops/health-check.sh; then
  exit 1
fi

deployment_completed=true
trap - 0 INT TERM HUP
printf 'release completed: commit=%s manifest=%s backup=%s\n' "$release_sha" "$manifest" "$backup_dir"
