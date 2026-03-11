#!/usr/bin/env node

import { parseArgs } from "node:util";

import {
  WalletAuthenticationError,
  WalletCommandError,
  createWalletClient,
} from "../index.mjs";

function printUsage() {
  console.error(`Usage:
  node ./bin/wallet.mjs status
  node ./bin/wallet.mjs login <email>
  node ./bin/wallet.mjs verify <flow-id> <otp>
  node ./bin/wallet.mjs show
  node ./bin/wallet.mjs address [--chain <chain>]
  node ./bin/wallet.mjs balance [--chain <chain>] [--asset <asset>]
  node ./bin/wallet.mjs send <amount> <recipient> [--chain <chain>]
  node ./bin/wallet.mjs trade <amount> <from> <to> [--chain <chain>] [--slippage-bps <bps>]`);
}

function parseFlags(args) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      chain: { type: "string" },
      asset: { type: "string" },
      "slippage-bps": { type: "string" },
    },
    strict: true,
  });
}

const client = createWalletClient();
const [, , command, ...rawArgs] = process.argv;

if (!command || command === "--help" || command === "-h" || command === "help") {
  printUsage();
  process.exit(command ? 0 : 1);
}

try {
  let result;

  switch (command) {
    case "status":
      result = await client.getStatus();
      break;
    case "login":
      if (rawArgs.length < 1) {
        throw new TypeError("login requires <email>.");
      }
      result = await client.startAuth(rawArgs[0]);
      break;
    case "verify":
      if (rawArgs.length < 2) {
        throw new TypeError("verify requires <flow-id> <otp>.");
      }
      result = await client.verifyAuth(rawArgs[0], rawArgs[1]);
      break;
    case "show":
      result = await client.show();
      break;
    case "address": {
      const { values } = parseFlags(rawArgs);
      result = await client.getAddress({ chain: values.chain });
      break;
    }
    case "balance": {
      const { values } = parseFlags(rawArgs);
      result = await client.getBalances({
        chain: values.chain,
        asset: values.asset,
      });
      break;
    }
    case "send": {
      const { values, positionals } = parseFlags(rawArgs);
      if (positionals.length < 2) {
        throw new TypeError("send requires <amount> <recipient>.");
      }
      result = await client.send({
        amount: positionals[0],
        recipient: positionals[1],
        chain: values.chain,
      });
      break;
    }
    case "trade": {
      const { values, positionals } = parseFlags(rawArgs);
      if (positionals.length < 3) {
        throw new TypeError("trade requires <amount> <from> <to>.");
      }
      result = await client.trade({
        amount: positionals[0],
        fromAsset: positionals[1],
        toAsset: positionals[2],
        chain: values.chain,
        slippageBps: values["slippage-bps"],
      });
      break;
    }
    default:
      throw new Error(`Unknown wallet command: ${command}`);
  }

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const payload = {
    name: error?.name ?? "Error",
    message: error?.message ?? "Unknown error",
  };

  if (error instanceof WalletCommandError || error instanceof WalletAuthenticationError) {
    payload.command = error.command;
    payload.args = error.args;
    payload.exitCode = error.exitCode;
    payload.stdout = error.stdout;
    payload.stderr = error.stderr;
  }

  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}
