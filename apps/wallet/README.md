# Wallet

Basic wallet infrastructure for this workspace, backed by Coinbase Agentic Wallet's `awal` CLI.

## Owns

- Wallet CLI wrapper
- Wallet provider abstraction
- Wallet-specific command composition and errors

## Does not own

- Inbox ingestion
- Reader UI
- Prism workflows

## Boundary rules

- Keep wallet behavior self-contained under `apps/wallet`.
- Do not reach into other apps for runtime behavior.
- If another app needs wallet operations, call the CLI or extract a stable shared package first.

This folder follows the official Coinbase documentation:

- Welcome: <https://docs.cdp.coinbase.com/agentic-wallet/welcome>
- Quickstart: <https://docs.cdp.coinbase.com/agentic-wallet/quickstart>
- Authentication: <https://docs.cdp.coinbase.com/agentic-wallet/authentication>
- Skills reference: <https://docs.cdp.coinbase.com/agentic-wallet/skills-reference>

## What is here

- A thin `awal` command runner with structured errors
- A Coinbase Agentic Wallet provider abstraction
- A small `wallet` CLI for local use
- Unit tests that do not require a live authenticated wallet

## Supported operations

- `status`
- `auth login`
- `auth verify`
- `address`
- `balance`
- `show`
- `send`
- `trade`

## Usage

From this folder:

```bash
npm test
node ./bin/wallet.mjs status
node ./bin/wallet.mjs login you@example.com
node ./bin/wallet.mjs verify <flow-id> <otp>
node ./bin/wallet.mjs address --chain base
node ./bin/wallet.mjs balance --chain base --asset usdc
node ./bin/wallet.mjs send '$0.01' 0xabc... --chain base
node ./bin/wallet.mjs trade '$1.00' usdc eth --chain base --slippage-bps 100
```

Programmatic usage:

```js
import { createWalletClient } from "./index.mjs";

const wallet = createWalletClient();
const status = await wallet.getStatus();

if (!status.auth?.authenticated) {
  const flow = await wallet.startAuth("you@example.com");
  console.log(flow);
}
```

## Notes

- By default this wrapper executes `npx --yes awal@latest ...`.
- If you already have `awal` installed locally or globally, pass `awalCommand` when creating the client.
- Commands that require authentication surface a dedicated `WalletAuthenticationError`.
