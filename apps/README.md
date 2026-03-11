# Apps

Each subdirectory in this folder is an independent product boundary.

- `prism`: clarification workspace
- `reader`: Reader-style app clone
- `inbox`: newsletter ingestion and note extraction server
- `wallet`: wallet CLI and provider wrapper

Rules:

- No direct source imports across apps.
- Shared code must move into `../packages`.
- Runtime state, tests, fixtures, and README ownership stay with the app.
