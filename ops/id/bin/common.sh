#!/usr/bin/env bash

set -euo pipefail

ID_BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ID_DIR="$(cd "${ID_BIN_DIR}/.." && pwd)"
PROJECT_DIR="$(cd "${ID_DIR}/../.." && pwd)"

require_cmd() {
  local cmd="$1"

  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}" >&2
    exit 1
  fi
}

load_id_env() {
  local env_file="${ID_DIR}/.env"

  if [[ ! -f "${env_file}" ]]; then
    echo "Missing ${env_file}. Copy ops/id/.env.example to ops/id/.env first." >&2
    exit 1
  fi

  set -a
  # shellcheck source=/dev/null
  source "${env_file}"
  set +a
}

has_account_password() {
  [[ -n "${OP_ACCOUNT_PASSWORD:-}" ]]
}

require_id_env_vars() {
  local missing=()
  local key

  for key in "$@"; do
    if [[ -z "${!key:-}" ]]; then
      missing+=("${key}")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    printf 'Missing required variables in ops/id/.env: %s\n' "${missing[*]}" >&2
    exit 1
  fi
}

account_ref() {
  if [[ -n "${OP_ACCOUNT_SHORTHAND:-}" ]]; then
    printf '%s\n' "${OP_ACCOUNT_SHORTHAND}"
    return
  fi

  if [[ -n "${OP_ACCOUNT_EMAIL:-}" ]]; then
    printf '%s\n' "${OP_ACCOUNT_EMAIL}"
    return
  fi

  printf '%s\n' "${OP_ACCOUNT_ADDRESS}"
}

ensure_account_added() {
  local account_json

  account_json="$(op account list --format json 2>/dev/null || printf '[]')"

  if jq -e \
    --arg email "${OP_ACCOUNT_EMAIL}" \
    --arg shorthand "${OP_ACCOUNT_SHORTHAND:-}" \
    '.[] | select((.email // "") == $email or (.shorthand // "") == $shorthand)' \
    >/dev/null <<<"${account_json}"; then
    return
  fi

  echo "Adding 1Password account ${OP_ACCOUNT_EMAIL} to the local CLI config..."
  if has_account_password; then
    expect <<'EOF' >/dev/null
set timeout -1
spawn op account add --address $env(OP_ACCOUNT_ADDRESS) --email $env(OP_ACCOUNT_EMAIL) --shorthand $env(OP_ACCOUNT_SHORTHAND)
expect {
  -re "(?i)secret key.*:" {
    send -- "$env(OP_SECRET_KEY)\r"
    exp_continue
  }
  -re "(?i)password.*:" {
    send -- "$env(OP_ACCOUNT_PASSWORD)\r"
    exp_continue
  }
  eof
}
EOF
  else
    op account add \
      --address "${OP_ACCOUNT_ADDRESS}" \
      --email "${OP_ACCOUNT_EMAIL}" \
      --shorthand "${OP_ACCOUNT_SHORTHAND:-agent-ai}" >/dev/null
  fi
}

ensure_signed_in() {
  local ref
  local signin_output

  ref="$(account_ref)"

  if op whoami --account "${ref}" >/dev/null 2>&1; then
    return
  fi

  echo "Signing in to 1Password account ${ref}..."
  if has_account_password; then
    export OP_ACCOUNT_REF="${ref}"
    signin_output="$(
      expect <<'EOF'
set timeout -1
log_user 1
spawn op signin --account $env(OP_ACCOUNT_REF) -f
expect {
  -re "(?i)password.*:" {
    send -- "$env(OP_ACCOUNT_PASSWORD)\r"
    exp_continue
  }
  eof
}
EOF
    )"
    signin_output="$(printf '%s\n' "${signin_output}" | tr -d '\r' | grep '^export OP_SESSION_' | head -n 1)"
    if [[ -z "${signin_output}" ]]; then
      echo "Failed to capture 1Password session export." >&2
      exit 1
    fi
    eval "${signin_output}"
  else
    eval "$(op signin --account "${ref}")"
  fi
}

ensure_vault_exists() {
  if op vault get "${OP_VAULT}" >/dev/null 2>&1; then
    return
  fi

  echo "Creating vault ${OP_VAULT}..."
  op vault create "${OP_VAULT}" --icon vault-door >/dev/null
}

find_item_id_by_title() {
  local title="$1"

  op item list --vault "${OP_VAULT}" --format json |
    jq -r --arg title "${title}" '.[] | select(.title == $title) | .id' |
    head -n 1
}
