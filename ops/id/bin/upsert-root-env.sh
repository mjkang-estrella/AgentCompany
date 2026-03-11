#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd op
require_cmd jq
load_id_env
require_id_env_vars OP_ACCOUNT_ADDRESS OP_ACCOUNT_EMAIL OP_SECRET_KEY OP_VAULT ROOT_ENV_SOURCE ROOT_ENV_ITEM_TITLE ROOT_ENV_KEYS

ensure_account_added
ensure_signed_in
ensure_vault_exists

root_env_path="${ID_DIR}/${ROOT_ENV_SOURCE}"
if [[ ! -f "${root_env_path}" ]]; then
  echo "Root env file not found: ${root_env_path}" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "${root_env_path}"
set +a

IFS=',' read -r -a key_list <<<"${ROOT_ENV_KEYS}"

item_args=(
  "--vault=${OP_VAULT}"
  "--title=${ROOT_ENV_ITEM_TITLE}"
  "notesPlain=Managed by /ops/id/bin/upsert-root-env.sh from ${ROOT_ENV_SOURCE}"
)

synced_keys=()
for key in "${key_list[@]}"; do
  trimmed_key="$(printf '%s' "${key}" | xargs)"

  if [[ -z "${trimmed_key}" ]]; then
    continue
  fi

  if [[ -z "${!trimmed_key:-}" ]]; then
    continue
  fi

  item_args+=("${trimmed_key}[password]=${!trimmed_key}")
  synced_keys+=("${trimmed_key}")
done

if (( ${#synced_keys[@]} == 0 )); then
  echo "No matching keys found in ${root_env_path}." >&2
  exit 1
fi

existing_item_id="$(find_item_id_by_title "${ROOT_ENV_ITEM_TITLE}")"

if [[ -n "${existing_item_id}" ]]; then
  op item edit "${existing_item_id}" "${item_args[@]}" >/dev/null
  echo "Updated secure note: ${ROOT_ENV_ITEM_TITLE}"
else
  op item create --category="Secure Note" "${item_args[@]}" >/dev/null
  echo "Created secure note: ${ROOT_ENV_ITEM_TITLE}"
fi

printf 'Synced keys: %s\n' "${synced_keys[*]}"
