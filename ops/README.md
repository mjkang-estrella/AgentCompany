# Ops

Local operations tooling that supports the repository but is not part of product runtime code.

- `id`: 1Password-based agent identity bootstrap and root secret sync

Rules:

- Ops scripts may read repository configuration.
- Product apps must not depend on `ops/*` at runtime.
