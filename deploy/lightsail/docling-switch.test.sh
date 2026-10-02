#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/docling-deploy.sh"
ROOT="$(mktemp -d)"
trap 'rm -rf -- "$ROOT"' EXIT
mkdir -p "$ROOT/parser/runtimes/previous" "$ROOT/parser/runtimes/next/venv/bin" "$ROOT/parser/runtimes/next/service"
touch "$ROOT/parser/runtimes/next/.runtime-ready"
ln -s "$ROOT/parser/runtimes/previous" "$ROOT/parser/current"
systemctl() { printf '%s\n' "$*" >> "$ROOT/calls"; [[ "${FAIL_RESTART:-false}" != true || "$1" != restart ]]; }
sudo() { return 0; }
docling_health_check() { return 0; }

activate_docling_runtime "$ROOT/parser/runtimes/next" "$ROOT/parser"
[[ "$(readlink -f "$ROOT/parser/current")" == "$ROOT/parser/runtimes/next" ]]
rollback_docling_runtime "$ROOT/parser/runtimes/previous" "$ROOT/parser"
[[ "$(readlink -f "$ROOT/parser/current")" == "$ROOT/parser/runtimes/previous" ]]

FAIL_RESTART=true
if activate_docling_runtime "$ROOT/parser/runtimes/next" "$ROOT/parser"; then
  echo "A failed restart was accepted." >&2; exit 1
fi
FAIL_RESTART=false
rollback_docling_runtime "$ROOT/parser/runtimes/previous" "$ROOT/parser"
[[ "$(readlink -f "$ROOT/parser/current")" == "$ROOT/parser/runtimes/previous" ]]

if activate_docling_runtime "$ROOT/outside" "$ROOT/parser"; then
  echo "An out-of-root runtime was accepted." >&2; exit 1
fi
rollback_docling_runtime "" "$ROOT/parser"
[[ ! -e "$ROOT/parser/current" ]]
grep -q 'disable --now labrat-docling.service' "$ROOT/calls"
echo "Parser activation and rollback checks passed."
