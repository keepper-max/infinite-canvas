#!/bin/sh
set -eu

compose_file="${COMPOSE_FILE:-docker-compose.yml}"
env_file="${ENV_FILE:-.env}"
public_url="${PUBLIC_URL:?set PUBLIC_URL to the HTTPS site origin}"

docker compose --env-file "$env_file" -f "$compose_file" ps
docker compose --env-file "$env_file" -f "$compose_file" exec -T db sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose --env-file "$env_file" -f "$compose_file" exec -T redis redis-cli ping
curl --fail --silent --show-error "${public_url%/}/healthz" >/dev/null
curl --fail --silent --show-error "${public_url%/}/api/health/live" >/dev/null
curl --fail --silent --show-error "${public_url%/}/api/health/ready" >/dev/null
df -P .

printf 'health checks passed: %s\n' "$public_url"
