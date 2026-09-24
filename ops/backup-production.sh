#!/bin/sh
set -eu

umask 077

compose_file="${COMPOSE_FILE:-docker-compose.yml}"
compose_override_file="${COMPOSE_OVERRIDE_FILE:-}"
env_file="${ENV_FILE:-.env}"
backup_root="${BACKUP_ROOT:-/opt/infinite-canvas-backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${backup_root}/release-${stamp}"

compose() {
  if test -n "$compose_override_file"; then
    docker compose --env-file "$env_file" -f "$compose_file" -f "$compose_override_file" "$@"
  else
    docker compose --env-file "$env_file" -f "$compose_file" "$@"
  fi
}

test -f "$compose_file"
if test -n "$compose_override_file"; then
  test -f "$compose_override_file"
fi
test -f "$env_file"
command -v docker >/dev/null
command -v git >/dev/null

mkdir -p "$backup_dir"
git rev-parse HEAD > "$backup_dir/git-head.txt"
git status --short > "$backup_dir/git-status.txt"
compose ps --all > "$backup_dir/containers.txt"
compose images > "$backup_dir/images.txt"
cp "$env_file" "$backup_dir/environment.env"
chmod 600 "$backup_dir/environment.env"

tar \
  --exclude=.git \
  --exclude=.env \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=coverage \
  -czf "$backup_dir/source.tgz" .

compose exec -T db sh -ec \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  > "$backup_dir/database.dump"

(
  cd "$backup_dir"
  sha256sum git-head.txt git-status.txt containers.txt images.txt environment.env source.tgz database.dump > SHA256SUMS
)

printf '%s\n' "$backup_dir"
