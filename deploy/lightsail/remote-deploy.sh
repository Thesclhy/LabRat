#!/usr/bin/env bash
set -euo pipefail

ARCHIVE_PATH="${1:?usage: remote-deploy.sh <archive> <commit-sha> [deploy-root]}"
COMMIT_SHA="${2:?usage: remote-deploy.sh <archive> <commit-sha> [deploy-root]}"
DEPLOY_ROOT="${3:-/opt/labrat}"
APP_USER="${LABRAT_APP_USER:-labrat}"
ENV_FILE="${LABRAT_ENV_FILE:-/etc/labrat/backend.env}"
SERVICE_NAME="${LABRAT_SERVICE_NAME:-labrat-backend}"
KEEP_RELEASES="${LABRAT_KEEP_RELEASES:-5}"

RELEASES_DIR="$DEPLOY_ROOT/releases"
CURRENT_LINK="$DEPLOY_ROOT/current"
SHORT_SHA="${COMMIT_SHA:0:12}"
STAMP="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="$RELEASES_DIR/$STAMP-$SHORT_SHA"

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

rollback_to() {
  local previous="$1"
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfn "$previous" "$CURRENT_LINK"
    systemctl restart "$SERVICE_NAME"
    echo "rolled back to $previous" >&2
  fi
}

[[ -f "$ARCHIVE_PATH" ]] || fail "archive not found: $ARCHIVE_PATH"
[[ -f "$ENV_FILE" ]] || fail "environment file not found: $ENV_FILE"
id "$APP_USER" >/dev/null 2>&1 || fail "app user not found: $APP_USER"
command -v npm >/dev/null 2>&1 || fail "npm is not installed"
command -v curl >/dev/null 2>&1 || fail "curl is not installed"

mkdir -p "$RELEASES_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"
test -f "$RELEASE_DIR/dist/index.html" || fail "release archive is missing dist/index.html"
test -f "$RELEASE_DIR/backend/package.json" || fail "release archive is missing backend/package.json"
test -d "$RELEASE_DIR/backend/migrations" || fail "release archive is missing backend/migrations"

chown -R "$APP_USER:$APP_USER" "$RELEASE_DIR"

sudo -H -u "$APP_USER" npm --prefix "$RELEASE_DIR/backend" ci --omit=dev
sudo -H -u "$APP_USER" bash -c "set -a; source '$ENV_FILE'; set +a; npm --prefix '$RELEASE_DIR/backend' run migrate"

PREVIOUS_RELEASE=""
if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK" || true)"
fi

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
chown -h "$APP_USER:$APP_USER" "$CURRENT_LINK" || true
systemctl restart "$SERVICE_NAME"

if ! health_check; then
  rollback_to "$PREVIOUS_RELEASE"
  fail "backend health check did not pass after deploying $COMMIT_SHA"
fi

mapfile -t RELEASES < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r)
if (( ${#RELEASES[@]} > KEEP_RELEASES )); then
  for old_release in "${RELEASES[@]:KEEP_RELEASES}"; do
    if [[ "$old_release" != "$(readlink -f "$CURRENT_LINK")" ]]; then
      rm -rf "$old_release"
    fi
  done
fi

rm -f "$ARCHIVE_PATH"
echo "deployed commit $COMMIT_SHA to $RELEASE_DIR"
