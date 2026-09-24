#!/bin/sh
set -eu

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

fail() {
  printf 'preflight failed: %s\n' "$1" >&2
  exit 1
}

for command_name in docker git curl sha256sum tar; do
  command -v "$command_name" >/dev/null 2>&1 || fail "missing command: $command_name"
done

test -f "$compose_file" || fail "compose file not found"
if test -n "$compose_override_file"; then
  test -f "$compose_override_file" || fail "compose override file not found"
fi
test -f "$env_file" || fail "environment file not found"
test -z "$(git status --porcelain)" || fail "Git worktree is not clean"

if find "$env_file" -perm /077 -print -quit | grep -q .; then
  fail "environment file must not be readable or writable by group/others"
fi

read_env_value() {
  sed -n "s/^$1=//p" "$env_file" | tail -n 1
}

for name in \
  POSTGRES_PASSWORD \
  OBJECT_STORAGE_PUBLIC_ENDPOINT \
  OBJECT_STORAGE_ACCESS_KEY_ID \
  OBJECT_STORAGE_SECRET_ACCESS_KEY \
  TOKEN360_API_KEY \
  TRUSTED_ORIGINS; do
  test -n "$(read_env_value "$name")" || fail "required variable is empty: $name"
done

test "$(read_env_value COOKIE_SECURE)" = "true" || fail "COOKIE_SECURE must be true"
case "$(read_env_value TRUSTED_ORIGINS)" in
  https://*) ;;
  *) fail "TRUSTED_ORIGINS must start with https://" ;;
esac
case "$(read_env_value OBJECT_STORAGE_PUBLIC_ENDPOINT)" in
  https://*) ;;
  *) fail "OBJECT_STORAGE_PUBLIC_ENDPOINT must start with https://" ;;
esac

compose config --quiet
docker info >/dev/null 2>&1 || fail "Docker engine is unavailable"

printf 'preflight passed: commit=%s compose=%s override=%s env=%s\n' \
  "$(git rev-parse --short HEAD)" "$compose_file" "${compose_override_file:-none}" "$env_file"
