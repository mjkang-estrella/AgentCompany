#!/usr/bin/env bash

set -euo pipefail

if command -v op >/dev/null 2>&1; then
  echo "op is already installed: $(op --version)"
  exit 0
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required to install 1Password CLI automatically." >&2
  exit 1
fi

brew install --cask 1password-cli
echo "Installed op: $(op --version)"
