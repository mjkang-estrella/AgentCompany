import { createCoinbaseAgenticWalletProvider } from "./coinbase-agentic-wallet-provider.mjs";

export function createWalletClient(options = {}) {
  const providerName = options.provider ?? "coinbase-agentic-wallet";

  switch (providerName) {
    case "coinbase-agentic-wallet":
      return createCoinbaseAgenticWalletProvider(options);
    default:
      throw new Error(`Unsupported wallet provider: ${providerName}`);
  }
}
