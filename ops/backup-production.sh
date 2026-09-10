#!/bin/sh
set -eu

umask 077

compose_file="${COMPOSE_FILE:-docker-compose.yml}"
backup_root="${BACKUP_ROOT:-/opt/infinite-canvas-backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${backup_root}/release-${stamp}"

test -f "$compose_file"
test -f .env
command -v docker >/dev/null
command -v git >/dev/null

mkdir -p "$backup_dir"
git rev-parse HEAD > "$backup_dir/git-head.txt"
git status --short > "$backup_dir/git-status.txt"
docker compose -f "$compose_file" ps --all > "$backup_dir/containers.txt"
docker compose -f "$compose_file" images > "$backup_dir/images.txt"
cp .env "$backup_dir/environment.env"
chmod 600 "$backup_dir/environment.env"

tar \
  --exclude=.git \
  --exclude=.env \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=coverage \
  -czf "$backup_dir/source.tgz" .

docker compose -f "$compose_file" exec -T db sh -ec \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  > "$backup_dir/database.dump"

(
  cd "$backup_dir"
  sha256sum git-head.txt git-status.txt containers.txt images.txt environment.env source.tgz database.dump > SHA256SUMS
)

printf '%s\n' "$backup_dir"
