export class WalletCommandError extends Error {
  constructor(message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "WalletCommandError";
    this.command = details.command ?? null;
    this.args = details.args ?? [];
    this.exitCode = details.exitCode ?? null;
    this.stdout = details.stdout ?? "";
    this.stderr = details.stderr ?? "";
  }
}

export class WalletAuthenticationError extends WalletCommandError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "WalletAuthenticationError";
  }
}
