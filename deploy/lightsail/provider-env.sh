#!/usr/bin/env bash

provider_env_error() {
  printf 'provider configuration error: %s\n' "$*" >&2
  return 1
}

validate_provider_name() {
  case "${1:-}" in
    anthropic|deepseek) return 0 ;;
    *) provider_env_error "LABRAT_AI_PROVIDER must be anthropic or deepseek." ;;
  esac
}

provider_env_value() {
  local env_file="${1:?environment file is required}"
  local key="${2:?environment key is required}"
  local count
  local value

  count="$(awk -v prefix="$key=" 'index($0, prefix) == 1 { count += 1 } END { print count + 0 }' "$env_file")"
  if [[ "$count" != "1" ]]; then
    provider_env_error "$env_file must contain exactly one $key line."
    return 1
  fi

  value="$(awk -v prefix="$key=" 'index($0, prefix) == 1 { print substr($0, length(prefix) + 1); exit }' "$env_file")"
  value="${value%$'\r'}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ ${#value} -ge 2 ]]; then
    if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi
  printf '%s' "$value"
}

validate_provider_env() {
  local provider="${1:-}"
  local env_file="${2:-}"
  local provider_count
  local selected_key_name
  local selected_key_value
  local deepseek_base_url

  validate_provider_name "$provider" || return 1
  [[ -n "$env_file" && -f "$env_file" ]] || {
    provider_env_error "environment file was not found."
    return 1
  }
  [[ ! -L "$env_file" ]] || {
    provider_env_error "environment file must not be a symbolic link."
    return 1
  }

  provider_count="$(awk 'index($0, "LABRAT_AI_PROVIDER=") == 1 { count += 1 } END { print count + 0 }' "$env_file")"
  if [[ "$provider_count" != "1" ]]; then
    provider_env_error "$env_file must contain exactly one LABRAT_AI_PROVIDER line."
    return 1
  fi

  if [[ "$provider" == "deepseek" ]]; then
    selected_key_name="DEEPSEEK_API_KEY"
  else
    selected_key_name="ANTHROPIC_API_KEY"
  fi
  if ! selected_key_value="$(provider_env_value "$env_file" "$selected_key_name")"; then
    return 1
  fi
  if [[ -z "$selected_key_value" ]]; then
    provider_env_error "$selected_key_name must be configured before selecting $provider."
    return 1
  fi

  if ! deepseek_base_url="$(provider_env_value "$env_file" "DEEPSEEK_BASE_URL")"; then
    return 1
  fi
  if [[ ! "$deepseek_base_url" =~ ^https:// ]]; then
    provider_env_error "DEEPSEEK_BASE_URL must use HTTPS."
    return 1
  fi
}

apply_provider_env() {
  local provider="${1:-}"
  local env_file="${2:-}"
  local env_dir
  local env_name
  local temp_file
  local env_mode

  validate_provider_env "$provider" "$env_file" || return 1
  env_dir="$(dirname -- "$env_file")"
  env_name="$(basename -- "$env_file")"
  env_mode="$(stat -c '%a' "$env_file")"
  umask 077
  temp_file="$(mktemp "$env_dir/.${env_name}.tmp.XXXXXX")"

  if ! awk -v replacement="LABRAT_AI_PROVIDER=$provider" '
    index($0, "LABRAT_AI_PROVIDER=") == 1 { print replacement; next }
    { print }
  ' "$env_file" > "$temp_file"; then
    rm -f -- "$temp_file"
    provider_env_error "could not prepare the provider environment update."
    return 1
  fi
  if ! chown --reference="$env_file" "$temp_file" || ! chmod "$env_mode" "$temp_file"; then
    rm -f -- "$temp_file"
    provider_env_error "could not preserve environment file ownership or permissions."
    return 1
  fi
  if ! mv -f -- "$temp_file" "$env_file"; then
    rm -f -- "$temp_file"
    provider_env_error "could not atomically update the provider environment."
    return 1
  fi
}

create_provider_env_backup() {
  local env_file="${1:-}"
  local env_dir
  local env_name
  local backup_file
  local env_mode

  [[ -n "$env_file" && -f "$env_file" && ! -L "$env_file" ]] || {
    provider_env_error "environment file cannot be backed up."
    return 1
  }
  env_dir="$(dirname -- "$env_file")"
  env_name="$(basename -- "$env_file")"
  env_mode="$(stat -c '%a' "$env_file")"
  umask 077
  backup_file="$(mktemp "$env_dir/.${env_name}.rollback.XXXXXX")"
  if ! cp --preserve=mode,ownership,timestamps -- "$env_file" "$backup_file"; then
    rm -f -- "$backup_file"
    provider_env_error "could not back up the provider environment."
    return 1
  fi
  if ! chown --reference="$env_file" "$backup_file" || ! chmod "$env_mode" "$backup_file"; then
    rm -f -- "$backup_file"
    provider_env_error "could not preserve provider environment backup metadata."
    return 1
  fi
  printf '%s\n' "$backup_file"
}

restore_provider_env_backup() {
  local backup_file="${1:-}"
  local env_file="${2:-}"

  [[ -n "$backup_file" && -f "$backup_file" && ! -L "$backup_file" ]] || {
    provider_env_error "provider environment backup was not found."
    return 1
  }
  [[ "$(dirname -- "$backup_file")" == "$(dirname -- "$env_file")" ]] || {
    provider_env_error "provider environment backup must be in the same directory."
    return 1
  }
  mv -f -- "$backup_file" "$env_file"
}

discard_provider_env_backup() {
  local backup_file="${1:-}"
  if [[ -n "$backup_file" && -f "$backup_file" && ! -L "$backup_file" ]]; then
    rm -f -- "$backup_file"
  fi
}

provider_env_main() {
  local action="${1:-}"
  local provider="${2:-}"
  local env_file="${3:-}"

  case "$action" in
    check)
      validate_provider_env "$provider" "$env_file"
      printf 'AI provider configuration validated for %s.\n' "$provider"
      ;;
    apply)
      apply_provider_env "$provider" "$env_file"
      printf 'AI provider configuration selected: %s.\n' "$provider"
      ;;
    *)
      provider_env_error "usage: provider-env.sh <check|apply> <anthropic|deepseek> <env-file>"
      return 1
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  provider_env_main "$@"
fi
