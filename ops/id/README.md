# Agent Identity With 1Password CLI

This directory is a local operations workspace for managing the agent's own identity and credentials with `op`.

## What it sets up

- installs `op` if it isn't present
- registers the agent's 1Password account locally
- signs in through the 1Password app integration or the manual CLI flow
- creates a dedicated vault for agent secrets
- stores the agent login as a 1Password Login item
- syncs selected keys from the repo root `.env` into a 1Password Secure Note

## Files

- `bin/install-op.sh`: install 1Password CLI with Homebrew
- `bin/signin.sh`: register the account and verify CLI authentication
- `bin/ensure-vault.sh`: create the vault if it doesn't exist
- `bin/upsert-agent-login.sh`: create or update the agent's login item
- `bin/upsert-root-env.sh`: copy selected secrets from the repo root `.env` into 1Password
- `bin/bootstrap.sh`: run the full setup flow

The expected source shape for the repo root env file is documented in [docs/environment.md](/Users/mjkang/Develop/AgentCompany/docs/environment.md).

## Setup

1. Copy `ops/id/.env.example` to `ops/id/.env`.
2. Fill in:
   - `OP_ACCOUNT_ADDRESS`
   - `OP_SECRET_KEY`
   - `OP_ACCOUNT_PASSWORD` if you want non-interactive 1Password account sign-in
   - `AGENT_LOGIN_PASSWORD` if you want non-interactive login item creation
   - quote values that contain spaces, for example `OP_VAULT="Agent Identity"`
3. Run:

```bash
cd /Users/mjkang/Develop/AgentCompany/ops/id
./bin/bootstrap.sh
```

## Notes

- `op signin` works best with the 1Password desktop app integration turned on.
- If `OP_ACCOUNT_PASSWORD` is set, `bin/signin.sh` uses `expect` to complete the manual password prompt.
- If `OP_ACCOUNT_PASSWORD` is empty, the 1Password authentication step stays interactive.
- The repo root already ignores `.env` files, and this directory also ignores `ops/id/.env`.
- `bin/upsert-root-env.sh` intentionally only syncs keys listed in `ROOT_ENV_KEYS`.
- The sync scripts use `op item create` and `op item edit` assignment syntax. That keeps the implementation small, but 1Password notes that command arguments can be visible to other local processes. This is acceptable for a local bootstrap flow, but if you want stricter handling later, the next step is converting these scripts to JSON template input.

## Useful commands

```bash
./bin/signin.sh
./bin/ensure-vault.sh
./bin/upsert-agent-login.sh
./bin/upsert-root-env.sh
op item list --vault "Agent Identity"
```
