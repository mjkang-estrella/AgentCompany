#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd op
require_cmd jq
load_id_env
require_id_env_vars OP_ACCOUNT_ADDRESS OP_ACCOUNT_EMAIL OP_SECRET_KEY OP_VAULT AGENT_EMAIL AGENT_LOGIN_TITLE

ensure_account_added
ensure_signed_in
ensure_vault_exists

agent_password="${AGENT_LOGIN_PASSWORD:-}"
if [[ -z "${agent_password}" ]]; then
  read -r -s -p "Agent login password: " agent_password
  printf '\n'
fi

if [[ -z "${agent_password}" ]]; then
  echo "Agent login password is required." >&2
  exit 1
fi

existing_item_id="$(find_item_id_by_title "${AGENT_LOGIN_TITLE}")"

args=(
  "--vault=${OP_VAULT}"
  "--title=${AGENT_LOGIN_TITLE}"
  "username=${AGENT_EMAIL}"
  "password=${agent_password}"
  "notesPlain=Managed by /ops/id/bin/upsert-agent-login.sh"
)

if [[ -n "${AGENT_LOGIN_URL:-}" ]]; then
  args+=("--url=${AGENT_LOGIN_URL}")
fi

if [[ -n "${existing_item_id}" ]]; then
  op item edit "${existing_item_id}" "${args[@]}" >/dev/null
  echo "Updated login item: ${AGENT_LOGIN_TITLE}"
else
  op item create --category=login "${args[@]}" >/dev/null
  echo "Created login item: ${AGENT_LOGIN_TITLE}"
fi
