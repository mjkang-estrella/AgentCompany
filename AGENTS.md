# AgentCompany Repository Guide

## Start here

- Product code lives under `apps/*`.
- Shared code and shared config live under `packages/*`.
- Operations tooling lives under `ops/*`.
- `codex/*` contains agent support material, not product runtime code.
- `tmp/*` is scratch space and should not be treated as source of truth.

## App boundaries

- Treat each directory in `apps/*` as a separate product.
- Do not import one app's source code into another app.
- If behavior must be shared across apps, extract a small stable unit into `packages/*`.
- If one app needs data or functionality from another, use an API, CLI, or file boundary.

## Shared package bar

- Extract shared code only when at least two apps need the same thing.
- Prefer sharing config first: TypeScript, ESLint, build scripts.
- Do not move app-specific domain logic into `packages/*` just to "keep things DRY".

## Working rules

- Keep README files current for every app and ops tool.
- Preserve local app ownership: build, test, runtime config, and fixtures stay with the app.
- When changing structure, update [docs/repository-map.md](docs/repository-map.md) and the affected app README in the same change.
