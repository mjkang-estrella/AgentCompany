#!/usr/bin/env bash

set -euo pipefail

BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${BIN_DIR}/install-op.sh"
"${BIN_DIR}/signin.sh" >/dev/null
"${BIN_DIR}/ensure-vault.sh" >/dev/null
"${BIN_DIR}/upsert-agent-login.sh"
"${BIN_DIR}/upsert-root-env.sh"
