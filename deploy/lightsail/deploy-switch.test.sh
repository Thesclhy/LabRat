#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=provider-env.sh
source "$SCRIPT_DIR/provider-env.sh"
# shellcheck source=deploy-transaction.sh
source "$SCRIPT_DIR/deploy-transaction.sh"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT
POSIX_METADATA_ASSERTIONS=true
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) POSIX_METADATA_ASSERTIONS=false ;;
esac

ANTHROPIC_TEST_KEY="test-anthropic-secret"
DEEPSEEK_TEST_KEY="test-deepseek-secret=with-equals"

fail_test() {
  printf 'deploy switch test failed: %s\n' "$*" >&2
  exit 1
}

write_env_fixture() {
  local file="$1"
  local provider="$2"
  local anthropic_key="$3"
  local deepseek_key="$4"
  local base_url="${5:-https://api.deepseek.com}"
  printf '%s\n' \
    'NODE_ENV=production' \
    'SESSION_SECRET=test-session-secret' \
    "LABRAT_AI_PROVIDER=$provider" \
    "ANTHROPIC_API_KEY=$anthropic_key" \
    'ANTHROPIC_MODEL=claude-test' \
    "DEEPSEEK_API_KEY=$deepseek_key" \
    'DEEPSEEK_MODEL=deepseek-v4-pro' \
    "DEEPSEEK_BASE_URL=$base_url" \
    > "$file"
  chmod 640 "$file"
}

ENV_FILE="$TEST_ROOT/backend.env"
BEFORE_FILE="$TEST_ROOT/backend.before"
NON_PROVIDER_BEFORE="$TEST_ROOT/non-provider.before"
NON_PROVIDER_AFTER="$TEST_ROOT/non-provider.after"
SUCCESS_LOG="$TEST_ROOT/success.log"
FAILURE_LOG="$TEST_ROOT/failure.log"

write_env_fixture "$ENV_FILE" anthropic "$ANTHROPIC_TEST_KEY" "$DEEPSEEK_TEST_KEY"
cp "$ENV_FILE" "$BEFORE_FILE"
grep -v '^LABRAT_AI_PROVIDER=' "$ENV_FILE" > "$NON_PROVIDER_BEFORE"
ORIGINAL_MODE="$(stat -c '%a' "$ENV_FILE")"

bash "$SCRIPT_DIR/provider-env.sh" apply deepseek "$ENV_FILE" > "$SUCCESS_LOG" 2>&1
grep -q '^LABRAT_AI_PROVIDER=deepseek$' "$ENV_FILE" || fail_test "DeepSeek was not selected."
grep -v '^LABRAT_AI_PROVIDER=' "$ENV_FILE" > "$NON_PROVIDER_AFTER"
cmp -s "$NON_PROVIDER_BEFORE" "$NON_PROVIDER_AFTER" || fail_test "non-provider lines changed."
[[ "$(stat -c '%a' "$ENV_FILE")" == "$ORIGINAL_MODE" ]] || fail_test "file mode changed."

bash "$SCRIPT_DIR/provider-env.sh" apply anthropic "$ENV_FILE" >> "$SUCCESS_LOG" 2>&1
cmp -s "$BEFORE_FILE" "$ENV_FILE" || fail_test "round-trip provider switch changed other values."

cp "$ENV_FILE" "$BEFORE_FILE"
if bash "$SCRIPT_DIR/provider-env.sh" apply unsupported "$ENV_FILE" > "$FAILURE_LOG" 2>&1; then
  fail_test "unsupported provider was accepted."
fi
cmp -s "$BEFORE_FILE" "$ENV_FILE" || fail_test "invalid provider changed the environment file."

write_env_fixture "$ENV_FILE" anthropic "$ANTHROPIC_TEST_KEY" ""
cp "$ENV_FILE" "$BEFORE_FILE"
if bash "$SCRIPT_DIR/provider-env.sh" apply deepseek "$ENV_FILE" >> "$FAILURE_LOG" 2>&1; then
  fail_test "missing selected provider key was accepted."
fi
cmp -s "$BEFORE_FILE" "$ENV_FILE" || fail_test "missing key changed the environment file."

write_env_fixture "$ENV_FILE" anthropic "$ANTHROPIC_TEST_KEY" "$DEEPSEEK_TEST_KEY" "http://api.deepseek.com"
cp "$ENV_FILE" "$BEFORE_FILE"
if bash "$SCRIPT_DIR/provider-env.sh" apply deepseek "$ENV_FILE" >> "$FAILURE_LOG" 2>&1; then
  fail_test "non-HTTPS DeepSeek URL was accepted."
fi
cmp -s "$BEFORE_FILE" "$ENV_FILE" || fail_test "invalid URL changed the environment file."

write_env_fixture "$ENV_FILE" anthropic "$ANTHROPIC_TEST_KEY" "$DEEPSEEK_TEST_KEY"
printf '%s\n' 'LABRAT_AI_PROVIDER=deepseek' >> "$ENV_FILE"
cp "$ENV_FILE" "$BEFORE_FILE"
if bash "$SCRIPT_DIR/provider-env.sh" apply deepseek "$ENV_FILE" >> "$FAILURE_LOG" 2>&1; then
  fail_test "duplicate provider lines were accepted."
fi
cmp -s "$BEFORE_FILE" "$ENV_FILE" || fail_test "duplicate provider lines changed the environment file."

write_env_fixture "$ENV_FILE" anthropic "$ANTHROPIC_TEST_KEY" "$DEEPSEEK_TEST_KEY"
OLD_RELEASE="$TEST_ROOT/releases/old"
NEW_RELEASE="$TEST_ROOT/releases/new"
CURRENT_LINK="$TEST_ROOT/current"
mkdir -p "$OLD_RELEASE" "$NEW_RELEASE" "$TEST_ROOT/bin"
ln -s "$OLD_RELEASE" "$CURRENT_LINK"
SYMLINK_ASSERTION_SUPPORTED=false
if [[ -L "$CURRENT_LINK" ]]; then
  SYMLINK_ASSERTION_SUPPORTED=true
fi
ENV_BACKUP="$(create_provider_env_backup "$ENV_FILE")"
apply_provider_env deepseek "$ENV_FILE"
ln -sfn "$NEW_RELEASE" "$CURRENT_LINK"
SYSTEMCTL_LOG="$TEST_ROOT/systemctl.log"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\n" "$*" >> "$SYSTEMCTL_LOG"' \
  > "$TEST_ROOT/bin/systemctl"
chmod 755 "$TEST_ROOT/bin/systemctl"

PATH="$TEST_ROOT/bin:$PATH" SYSTEMCTL_LOG="$SYSTEMCTL_LOG" \
  rollback_deployment_transaction \
    "$ENV_BACKUP" "$ENV_FILE" "$OLD_RELEASE" "$CURRENT_LINK" "labrat-backend" \
    >> "$SUCCESS_LOG" 2>&1
grep -q '^LABRAT_AI_PROVIDER=anthropic$' "$ENV_FILE" || fail_test "rollback did not restore the provider."
if [[ "$SYMLINK_ASSERTION_SUPPORTED" == "true" ]]; then
  [[ "$(readlink -f "$CURRENT_LINK")" == "$(readlink -f "$OLD_RELEASE")" ]] \
    || fail_test "rollback did not restore the previous release."
fi
grep -q '^restart labrat-backend$' "$SYSTEMCTL_LOG" || fail_test "rollback did not restart the old service."
if [[ "$POSIX_METADATA_ASSERTIONS" == "true" ]]; then
  [[ "$(stat -c '%a' "$ENV_FILE")" == "$ORIGINAL_MODE" ]] || fail_test "rollback changed file mode."
fi

if grep -Fq "$ANTHROPIC_TEST_KEY" "$SUCCESS_LOG" "$FAILURE_LOG" "$SYSTEMCTL_LOG"; then
  fail_test "deployment logs exposed the Anthropic test key."
fi
if grep -Fq "$DEEPSEEK_TEST_KEY" "$SUCCESS_LOG" "$FAILURE_LOG" "$SYSTEMCTL_LOG"; then
  fail_test "deployment logs exposed the DeepSeek test key."
fi

printf 'deploy provider switch tests passed.\n'
