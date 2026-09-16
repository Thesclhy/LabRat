#!/usr/bin/env bash
set -euo pipefail

ARCHIVE_PATH="${1:?usage: remote-deploy.sh <archive> <commit-sha> <deploy-root> <provider>}"
COMMIT_SHA="${2:?usage: remote-deploy.sh <archive> <commit-sha> <deploy-root> <provider>}"
DEPLOY_ROOT="${3:-/opt/labrat}"
SELECTED_PROVIDER="${4:?usage: remote-deploy.sh <archive> <commit-sha> <deploy-root> <provider>}"
APP_USER="${LABRAT_APP_USER:-labrat}"
ENV_FILE="${LABRAT_ENV_FILE:-/etc/labrat/backend.env}"
SERVICE_NAME="${LABRAT_SERVICE_NAME:-labrat-backend}"
KEEP_RELEASES="${LABRAT_KEEP_RELEASES:-5}"

RELEASES_DIR="$DEPLOY_ROOT/releases"
CURRENT_LINK="$DEPLOY_ROOT/current"
SHORT_SHA="${COMMIT_SHA:0:12}"
STAMP="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="$RELEASES_DIR/$STAMP-$SHORT_SHA"
ENV_BACKUP=""
PREVIOUS_RELEASE=""
ROLLBACK_ARMED=false

fail() {
  echo "deploy failed: $*" >&2
  exit 1
}

health_check() {
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8787/health >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

rollback_on_exit() {
  local status="$?"
  local keep_env_backup=false
  trap - EXIT
  if (( status != 0 )) && [[ "$ROLLBACK_ARMED" == "true" ]]; then
    if ! rollback_deployment_transaction \
      "$ENV_BACKUP" "$ENV_FILE" "$PREVIOUS_RELEASE" "$CURRENT_LINK" "$SERVICE_NAME"; then
      echo "deploy rollback was incomplete; inspect the service and environment file." >&2
      if [[ -n "$ENV_BACKUP" && -f "$ENV_BACKUP" ]]; then
        keep_env_backup=true
        echo "provider environment backup retained for manual recovery: $ENV_BACKUP" >&2
      fi
    fi
  fi
  if [[ "$keep_env_backup" != "true" && -n "$ENV_BACKUP" && -f "$ENV_BACKUP" ]]; then
    if declare -F discard_provider_env_backup >/dev/null 2>&1; then
      discard_provider_env_backup "$ENV_BACKUP" || true
    else
      rm -f -- "$ENV_BACKUP"
    fi
  fi
  exit "$status"
}

trap rollback_on_exit EXIT

case "$SELECTED_PROVIDER" in
  anthropic|deepseek) ;;
  *) fail "LABRAT_AI_PROVIDER must be anthropic or deepseek" ;;
esac

[[ -f "$ARCHIVE_PATH" ]] || fail "archive not found: $ARCHIVE_PATH"
[[ -f "$ENV_FILE" ]] || fail "environment file not found: $ENV_FILE"
[[ "$(stat -c '%U' "$ENV_FILE")" == "root" ]] || fail "environment file must be owned by root"
[[ "$(stat -c '%a' "$ENV_FILE")" == "640" ]] || fail "environment file permissions must be 640"
id "$APP_USER" >/dev/null 2>&1 || fail "app user not found: $APP_USER"
command -v npm >/dev/null 2>&1 || fail "npm is not installed"
command -v curl >/dev/null 2>&1 || fail "curl is not installed"

mkdir -p "$RELEASES_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"
test -f "$RELEASE_DIR/dist/index.html" || fail "release archive is missing dist/index.html"
test -f "$RELEASE_DIR/backend/package.json" || fail "release archive is missing backend/package.json"
test -f "$RELEASE_DIR/backend/dist-v1/v1/main.js" || fail "release archive is missing the compiled NestJS backend"
test -d "$RELEASE_DIR/backend/migrations" || fail "release archive is missing backend/migrations"
test -f "$RELEASE_DIR/deploy/lightsail/provider-env.sh" \
  || fail "release archive is missing provider-env.sh"
test -f "$RELEASE_DIR/deploy/lightsail/deploy-transaction.sh" \
  || fail "release archive is missing deploy-transaction.sh"

# shellcheck source=deploy-transaction.sh
source "$RELEASE_DIR/deploy/lightsail/deploy-transaction.sh"
validate_provider_env "$SELECTED_PROVIDER" "$ENV_FILE" \
  || fail "selected provider configuration is incomplete"
echo "validated AI provider configuration for $SELECTED_PROVIDER"

chown -R "$APP_USER:$APP_USER" "$RELEASE_DIR"

sudo -H -u "$APP_USER" npm --prefix "$RELEASE_DIR/backend" ci --omit=dev
sudo -H -u "$APP_USER" bash -c "set -a; source '$ENV_FILE'; set +a; npm --prefix '$RELEASE_DIR/backend' run migrate"

if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK" || true)"
fi

ENV_BACKUP="$(create_provider_env_backup "$ENV_FILE")" \
  || fail "could not back up the provider environment"
ROLLBACK_ARMED=true
apply_provider_env "$SELECTED_PROVIDER" "$ENV_FILE" \
  || fail "could not select AI provider $SELECTED_PROVIDER"
echo "selected AI provider: $SELECTED_PROVIDER"

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
chown -h "$APP_USER:$APP_USER" "$CURRENT_LINK" || true
if ! systemctl restart "$SERVICE_NAME"; then
  fail "backend service did not restart after deploying $COMMIT_SHA"
fi

if ! health_check; then
  fail "backend health check did not pass after deploying $COMMIT_SHA"
fi

ROLLBACK_ARMED=false
discard_provider_env_backup "$ENV_BACKUP"
ENV_BACKUP=""

mapfile -t RELEASES < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r)
if (( ${#RELEASES[@]} > KEEP_RELEASES )); then
  for old_release in "${RELEASES[@]:KEEP_RELEASES}"; do
    if [[ "$old_release" != "$(readlink -f "$CURRENT_LINK")" ]]; then
      rm -rf "$old_release"
    fi
  done
fi

rm -f "$ARCHIVE_PATH"
echo "deployed commit $COMMIT_SHA to $RELEASE_DIR with AI provider $SELECTED_PROVIDER"
