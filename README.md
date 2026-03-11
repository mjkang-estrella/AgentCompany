# AgentCompany

Multi-product repository with explicit app boundaries.

## Repository map

- `apps/`: product code. Each subdirectory is an independent app with its own runtime, tests, and README.
- `packages/`: intentionally shared code and configuration. Keep this layer small.
- `ops/`: local operations tooling that supports the repo but is not product runtime code.
- `codex/`: agent skills, prompts, and local automation support.
- `docs/`: architecture notes, repo map, and boundary rules.
- `tmp/`: scratch output and references. Not part of the product surface.

## Product apps

- `apps/prism`: AI-guided clarification workspace
- `apps/reader`: Reader-style reading workspace clone
- `apps/inbox`: newsletter ingestion and note extraction server
- `apps/wallet`: Coinbase Agentic Wallet wrapper and CLI

## Boundary rules

- Do not import source code from one app into another app.
- Shared code must move into `packages/*` before more than one app depends on it.
- App-to-app integration must happen through an API, CLI, file contract, or copied fixture data.
- `ops/*`, `codex/*`, and `tmp/*` are not product dependencies.

## Common commands

```bash
npm install
npm run build
npm run test
npm run lint
npm run typecheck
npm run dev:prism
npm run dev:reader
npm run dev:inbox
npm run wallet:status
```

More detail lives in [docs/repository-map.md](docs/repository-map.md).

Environment guidance lives in [docs/environment.md](docs/environment.md).

Workspace policy:

- Install dependencies from the repo root.
- The root [package-lock.json](/Users/mjkang/Develop/AgentCompany/package-lock.json) is the only lockfile that should be committed.
