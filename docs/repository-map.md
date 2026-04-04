# Repository Map

This repository is organized as a multi-product repo.

## Top-level layout

- `apps/`
  - Independent products. Each app owns its runtime, tests, and documentation.
- `packages/`
  - Shared configuration or reusable code with a stable API.
- `ops/`
  - Local support tooling for developers and agents.
- `codex/`
  - Agent support material. Not part of app runtime.
- `tmp/`
  - Scratch files, references, and disposable outputs.

## Product ownership

### `apps/prism`

- Owns the clarification workspace UI and supporting app logic.
- Owns its Supabase schema, migrations, and Vercel deployment/runtime configuration.
- May share only stable config or generic utilities through `packages/*`.
- Must not import code from `apps/reader`, `apps/inbox`, or `apps/wallet`.

### `apps/reader`

- Owns the Reader-inspired UI surface for that app.
- Owns its Convex schema, sync pipeline, Daily Digest generation, newsletter ingestion, cron jobs, import tooling, and static deployment config.
- Must remain isolated from `apps/prism` and `apps/inbox`.

### `apps/inbox`

- Owns ingestion, webhook handling, note extraction, persistence, and inbox-facing APIs.
- Other apps should consume inbox behavior through an integration boundary, not source imports.

### `apps/wallet`

- Owns the wallet CLI wrapper and wallet provider abstractions.
- Acts as a product-level tool, not a shared library for app internals by default.

## Operations ownership

### `ops/id`

- Owns local 1Password bootstrap and secret synchronization scripts.
- Supports the repository but is not deployed with product apps.

## Structural rules

- App-to-app source imports are forbidden.
- Shared packages should stay small and boring.
- Config sharing is preferred over domain sharing.
- Generated folders such as `.next/` and local `node_modules/` are app-local details.
- Dependency installation is owned by the repo root workspace, not by nested app lockfiles.
