import { createAwalRunner } from "./awal-runner.mjs";

function optionArgs(name, value) {
  return value == null || value === "" ? [] : [name, String(value)];
}

function requireValue(name, value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} is required.`);
  }

  return value;
}

export function createCoinbaseAgenticWalletProvider(options = {}) {
  const runAwal = options.runner ?? createAwalRunner(options);

  return {
    id: "coinbase-agentic-wallet",

    async getStatus() {
      return runAwal(["status", "--json"], { expectJson: true });
    },

    async startAuth(email) {
      return runAwal(
        ["auth", "login", "--json", requireValue("email", email)],
        { expectJson: true }
      );
    },

    async verifyAuth(flowId, otp) {
      return runAwal(
        [
          "auth",
          "verify",
          "--json",
          requireValue("flowId", flowId),
          requireValue("otp", otp),
        ],
        { expectJson: true }
      );
    },

    async show() {
      await runAwal(["show"]);
      return { opened: true };
    },

    async getAddress({ chain } = {}) {
      return runAwal(
        ["address", ...optionArgs("--chain", chain), "--json"],
        { expectJson: true }
      );
    },

    async getBalances({ asset, chain } = {}) {
      return runAwal(
        [
          "balance",
          ...optionArgs("--asset", asset),
          ...optionArgs("--chain", chain),
          "--json",
        ],
        { expectJson: true }
      );
    },

    async send({ amount, recipient, chain = "base" }) {
      return runAwal(
        [
          "send",
          "--json",
          ...optionArgs("--chain", chain),
          requireValue("amount", amount),
          requireValue("recipient", recipient),
        ],
        { expectJson: true }
      );
    },

    async trade({
      amount,
      fromAsset,
      toAsset,
      chain = "base",
      slippageBps = 100,
    }) {
      return runAwal(
        [
          "trade",
          "--json",
          ...optionArgs("--chain", chain),
          ...optionArgs("--slippage", slippageBps),
          requireValue("amount", amount),
          requireValue("fromAsset", fromAsset),
          requireValue("toAsset", toAsset),
        ],
        { expectJson: true }
      );
    },
  };
}
