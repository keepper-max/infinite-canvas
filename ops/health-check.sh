#!/bin/sh
set -eu

compose_file="${COMPOSE_FILE:-docker-compose.yml}"
compose_override_file="${COMPOSE_OVERRIDE_FILE:-}"
env_file="${ENV_FILE:-.env}"
public_url="${PUBLIC_URL:?set PUBLIC_URL to the HTTPS site origin}"

compose() {
  if test -n "$compose_override_file"; then
    docker compose --env-file "$env_file" -f "$compose_file" -f "$compose_override_file" "$@"
  else
    docker compose --env-file "$env_file" -f "$compose_file" "$@"
  fi
}

compose ps
compose exec -T db sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
compose exec -T redis redis-cli ping
curl --fail --silent --show-error "${public_url%/}/healthz" >/dev/null
curl --fail --silent --show-error "${public_url%/}/api/health/live" >/dev/null
curl --fail --silent --show-error "${public_url%/}/api/health/ready" >/dev/null
df -P .

printf 'health checks passed: %s\n' "$public_url"
