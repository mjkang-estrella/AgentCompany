import test from "node:test";
import assert from "node:assert/strict";

import {
  createCoinbaseAgenticWalletProvider,
  createWalletClient,
} from "../src/index.mjs";

test("provider wires status to awal JSON mode", async () => {
  const calls = [];
  const provider = createCoinbaseAgenticWalletProvider({
    runner: async (args, options) => {
      calls.push({ args, options });
      return { server: { running: true }, auth: { authenticated: false } };
    },
  });

  const result = await provider.getStatus();

  assert.deepEqual(result, {
    server: { running: true },
    auth: { authenticated: false },
  });
  assert.deepEqual(calls, [
    {
      args: ["status", "--json"],
      options: { expectJson: true },
    },
  ]);
});

test("provider composes address and balance flags", async () => {
  const calls = [];
  const provider = createCoinbaseAgenticWalletProvider({
    runner: async (args, options) => {
      calls.push({ args, options });
      return { ok: true };
    },
  });

  await provider.getAddress({ chain: "base" });
  await provider.getBalances({ chain: "base", asset: "usdc" });

  assert.deepEqual(calls, [
    {
      args: ["address", "--chain", "base", "--json"],
      options: { expectJson: true },
    },
    {
      args: ["balance", "--asset", "usdc", "--chain", "base", "--json"],
      options: { expectJson: true },
    },
  ]);
});

test("provider composes send and trade commands", async () => {
  const calls = [];
  const provider = createCoinbaseAgenticWalletProvider({
    runner: async (args, options) => {
      calls.push({ args, options });
      return { ok: true };
    },
  });

  await provider.send({
    amount: "$0.25",
    recipient: "0xabc",
    chain: "base-sepolia",
  });
  await provider.trade({
    amount: "$1.00",
    fromAsset: "usdc",
    toAsset: "eth",
    chain: "base",
    slippageBps: 250,
  });

  assert.deepEqual(calls, [
    {
      args: ["send", "--json", "--chain", "base-sepolia", "$0.25", "0xabc"],
      options: { expectJson: true },
    },
    {
      args: [
        "trade",
        "--json",
        "--chain",
        "base",
        "--slippage",
        "250",
        "$1.00",
        "usdc",
        "eth",
      ],
      options: { expectJson: true },
    },
  ]);
});

test("provider validates required values before spawning awal", async () => {
  const provider = createCoinbaseAgenticWalletProvider({
    runner: async () => {
      throw new Error("runner should not execute");
    },
  });

  await assert.rejects(() => provider.startAuth(""), /email is required/i);
  await assert.rejects(
    () => provider.send({ amount: "", recipient: "0xabc" }),
    /amount is required/i
  );
});

test("createWalletClient returns the Coinbase provider by default", async () => {
  const calls = [];
  const client = createWalletClient({
    runner: async (args, options) => {
      calls.push({ args, options });
      return { ok: true };
    },
  });

  await client.getStatus();

  assert.equal(client.id, "coinbase-agentic-wallet");
  assert.equal(calls.length, 1);
});

test("createWalletClient rejects unsupported providers", () => {
  assert.throws(
    () => createWalletClient({ provider: "unknown-wallet" }),
    /Unsupported wallet provider/i
  );
});
