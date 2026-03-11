#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd op
require_cmd jq
load_id_env
require_id_env_vars OP_ACCOUNT_ADDRESS OP_ACCOUNT_EMAIL OP_SECRET_KEY OP_VAULT

ensure_account_added
ensure_signed_in

op whoami --account "$(account_ref)"
