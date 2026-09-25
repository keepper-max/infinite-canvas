#!/bin/sh
set -eu

backup_dir="${1:?usage: check-migration-compatibility.sh BACKUP_DIRECTORY}"
mode="${2:-applied}"
compose_file="${COMPOSE_FILE:-docker-compose.yml}"
compose_override_file="${COMPOSE_OVERRIDE_FILE:-}"
env_file="${ENV_FILE:-.env}"
compatibility_file="${MIGRATION_COMPATIBILITY_FILE:-ops/backward-compatible-migrations.txt}"

compose() {
  if test -n "$compose_override_file"; then
    docker compose --env-file "$env_file" -f "$compose_file" -f "$compose_override_file" "$@"
  else
    docker compose --env-file "$env_file" -f "$compose_file" "$@"
  fi
}

test -f "$backup_dir/schema-migrations.txt"
test -f "$compatibility_file"
current="$(mktemp)"
trap 'rm -f "$current"' 0 INT HUP TERM
compose exec -T db sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select name from platform_schema_migrations order by name"' \
  > "$current"

check_name() {
  name="$1"
  grep -Fxq "$name" "$compatibility_file" || {
    printf 'migration is not declared backward-compatible: %s\n' "$name" >&2
    exit 1
  }
}

case "$mode" in
  pending)
    if test -s "$backup_dir/schema-migrations.txt"; then
      for path in server/api/db/migrations/*.sql; do
        name="$(basename "$path")"
        grep -Fxq "$name" "$current" || check_name "$name"
      done
    fi
    ;;
  applied)
    while IFS= read -r name; do
      test -n "$name" || continue
      grep -Fxq "$name" "$backup_dir/schema-migrations.txt" || check_name "$name"
    done < "$current"
    ;;
  *)
    printf 'unknown compatibility check mode: %s\n' "$mode" >&2
    exit 1
    ;;
esac

printf 'migration compatibility passed: mode=%s\n' "$mode"
