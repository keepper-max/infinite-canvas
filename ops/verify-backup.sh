#!/bin/sh
set -eu

backup_dir="${1:?usage: verify-backup.sh BACKUP_DIRECTORY}"
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

test -d "$backup_dir"
test -f "$compose_file"
(
  cd "$backup_dir"
  sha256sum --check SHA256SUMS
  tar -tzf source.tgz >/dev/null
)
test -f "$backup_dir/schema-migrations.txt"
compose exec -T db pg_restore --list < "$backup_dir/database.dump" >/dev/null

printf 'backup verified: %s\n' "$backup_dir"
