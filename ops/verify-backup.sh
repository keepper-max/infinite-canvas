#!/bin/sh
set -eu

backup_dir="${1:?usage: verify-backup.sh BACKUP_DIRECTORY}"
compose_file="${COMPOSE_FILE:-docker-compose.yml}"

test -d "$backup_dir"
test -f "$compose_file"
(
  cd "$backup_dir"
  sha256sum --check SHA256SUMS
  tar -tzf source.tgz >/dev/null
)
docker compose -f "$compose_file" exec -T db pg_restore --list < "$backup_dir/database.dump" >/dev/null

printf 'backup verified: %s\n' "$backup_dir"
