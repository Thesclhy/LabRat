#!/usr/bin/env bash

DEPLOY_TRANSACTION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=provider-env.sh
source "$DEPLOY_TRANSACTION_DIR/provider-env.sh"

rollback_deployment_transaction() {
  local env_backup="${1:-}"
  local env_file="${2:-}"
  local previous_release="${3:-}"
  local current_link="${4:-}"
  local service_name="${5:-}"
  local failed=0

  if ! restore_provider_env_backup "$env_backup" "$env_file"; then
    printf 'rollback failed: provider environment could not be restored.\n' >&2
    failed=1
  fi

  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    if ! ln -sfn "$previous_release" "$current_link"; then
      printf 'rollback failed: previous release link could not be restored.\n' >&2
      failed=1
    fi
    if ! systemctl restart "$service_name"; then
      printf 'rollback failed: previous backend service did not restart.\n' >&2
      failed=1
    fi
  else
    rm -f -- "$current_link"
    if ! systemctl stop "$service_name"; then
      printf 'rollback failed: backend service did not stop after first-deploy failure.\n' >&2
      failed=1
    fi
  fi

  if (( failed == 0 )); then
    printf 'rolled back provider environment and release to %s.\n' "$previous_release" >&2
  fi
  return "$failed"
}
