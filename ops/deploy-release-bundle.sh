#!/bin/sh
set -eu

umask 077

bundle_path="${1:-}"
target_sha="${2:-}"
public_url="${3:-}"
health_timeout="${4:-}"
release_root="${RELEASE_ROOT:-/opt/infinite-canvas-releases}"
override="${COMPOSE_OVERRIDE_FILE:-$release_root/docker-compose.production.yml}"

fail() {
  printf 'bundle deployment failed: %s\n' "$1" >&2
  exit 1
}

printf '%s' "$target_sha" | grep -Eq '^[0-9a-f]{40}$' || fail 'target commit must be a full lowercase SHA-1'
printf '%s' "$public_url" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' || fail 'public URL must be an HTTPS origin without a path'
case "$health_timeout" in
  *[!0-9]*|'') fail 'health timeout must be a positive integer' ;;
  0) fail 'health timeout must be greater than zero' ;;
esac
case "$bundle_path" in
  /tmp/release-*.bundle) ;;
  *) fail 'bundle must use the /tmp/release-*.bundle path' ;;
esac

test "$(hostname)" = shoumiren || fail 'this is not the physical production host'
test -f "$bundle_path" || fail 'release bundle not found'
test -f "$override" || fail 'production Compose override not found'
cleanup() {
  rm -f "$bundle_path" /tmp/deploy-release-bundle.sh
}
trap cleanup EXIT INT TERM HUP

current_release="$(docker inspect infinite-canvas --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null)"
case "$current_release" in
  "$release_root"/*) ;;
  *) fail 'active Web container is not attached to the release root' ;;
esac
test -d "$current_release/.git" || fail 'active release Git checkout not found'
test -f "$current_release/.env" || fail 'active release environment file not found'

short_sha="$(printf '%s' "$target_sha" | cut -c1-12)"
target_release="$release_root/$short_sha"
if test -e "$target_release"; then
  test -d "$target_release/.git" || fail 'target release path exists but is not a Git checkout'
  test "$(git -C "$target_release" rev-parse HEAD)" = "$target_sha" || fail 'target release path contains another commit'
else
  git clone --quiet --branch main "$bundle_path" "$target_release"
fi
test "$(git -C "$target_release" rev-parse HEAD)" = "$target_sha" || fail 'bundle did not resolve to the requested commit'

deploy_uid="$(id -u)"
deploy_gid="$(id -g)"
current_name="$(basename "$current_release")"
if test ! -f "$target_release/.env"; then
  docker run --rm --entrypoint sh -v "$release_root:/releases" docker.m.daocloud.io/library/postgres:16-alpine -ec \
    "cp /releases/$current_name/.env /releases/$short_sha/.env && chown $deploy_uid:$deploy_gid /releases/$short_sha/.env && chmod 600 /releases/$short_sha/.env"
fi

cd "$target_release"
test -z "$(git status --porcelain)" || fail 'target release worktree is not clean'
export COMPOSE_OVERRIDE_FILE="$override"
export PUBLIC_URL="$public_url"
export DEPLOY_HEALTH_TIMEOUT_SECONDS="$health_timeout"
export CONFIRM_PRODUCTION_DEPLOY="deploy-$target_sha"
sh ops/deploy-production.sh </dev/null

deployed_image="$(docker inspect infinite-canvas --format '{{.Config.Image}}')"
test "$deployed_image" = "infinite-canvas-web:$short_sha" || fail 'Web container did not switch to the requested release'
printf 'bundle deployment completed: commit=%s image=%s\n' "$target_sha" "$deployed_image"
