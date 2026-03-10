import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import {
  WalletAuthenticationError,
  WalletCommandError,
} from "./errors.mjs";

const execFile = promisify(execFileCallback);
const DEFAULT_AWAL_COMMAND = ["npx", "--yes", "awal@latest"];

function trimToEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

function commandToDisplay(command, args) {
  return [command, ...args].join(" ");
}

function isAuthenticationFailure(text) {
  return /authentication required/i.test(text);
}

export function extractJson(text) {
  const source = trimToEmpty(text);

  if (!source) {
    throw new WalletCommandError("Expected JSON output from awal, received an empty response.");
  }

  try {
    return JSON.parse(source);
  } catch {}

  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new WalletCommandError("Expected JSON output from awal, but no JSON object was found.", {
      stdout: source,
    });
  }

  const candidate = source.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(candidate);
  } catch (cause) {
    throw new WalletCommandError("Failed to parse JSON output from awal.", {
      stdout: source,
      cause,
    });
  }
}

export function createAwalRunner(options = {}) {
  const execFileImpl = options.execFileImpl ?? execFile;
  const awalCommand = options.awalCommand ?? DEFAULT_AWAL_COMMAND;
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const timeout = options.timeoutMs ?? 60_000;
  const maxBuffer = options.maxBuffer ?? 1024 * 1024;

  if (!Array.isArray(awalCommand) || awalCommand.length === 0) {
    throw new TypeError("awalCommand must be a non-empty string array.");
  }

  const [command, ...baseArgs] = awalCommand;

  return async function runAwal(args, runOptions = {}) {
    const finalArgs = [...baseArgs, ...args];

    try {
      const result = await execFileImpl(command, finalArgs, {
        cwd,
        env,
        timeout,
        maxBuffer,
      });

      if (runOptions.expectJson) {
        return extractJson(result.stdout);
      }

      return {
        stdout: trimToEmpty(result.stdout),
        stderr: trimToEmpty(result.stderr),
      };
    } catch (cause) {
      const stdout = trimToEmpty(cause?.stdout);
      const stderr = trimToEmpty(cause?.stderr);
      const combined = [stdout, stderr].filter(Boolean).join("\n");
      const message = combined || `awal command failed: ${commandToDisplay(command, finalArgs)}`;
      const ErrorClass = isAuthenticationFailure(combined)
        ? WalletAuthenticationError
        : WalletCommandError;

      throw new ErrorClass(message, {
        command,
        args: finalArgs,
        exitCode: cause?.code ?? null,
        stdout,
        stderr,
        cause,
      });
    }
  };
}
