import test from "node:test";
import assert from "node:assert/strict";

import {
  WalletAuthenticationError,
  WalletCommandError,
  createAwalRunner,
  extractJson,
} from "../src/index.mjs";

test("extractJson parses plain JSON output", () => {
  assert.deepEqual(extractJson('{"ok":true}'), { ok: true });
});

test("extractJson parses JSON surrounded by setup noise", () => {
  const output = [
    "npm warn exec The following package was not found and will be installed: awal@2.2.0",
    '{"server":{"running":true},"auth":{"authenticated":false}}',
  ].join("\n");

  assert.deepEqual(extractJson(output), {
    server: { running: true },
    auth: { authenticated: false },
  });
});

test("createAwalRunner uses the documented npx default command", async () => {
  const calls = [];
  const runAwal = createAwalRunner({
    execFileImpl: async (command, args) => {
      calls.push({ command, args });
      return { stdout: '{"ok":true}', stderr: "" };
    },
  });

  const result = await runAwal(["status", "--json"], { expectJson: true });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    {
      command: "npx",
      args: ["--yes", "awal@latest", "status", "--json"],
    },
  ]);
});

test("createAwalRunner throws WalletAuthenticationError on auth failures", async () => {
  const runAwal = createAwalRunner({
    execFileImpl: async () => {
      const error = new Error("Authentication required.");
      error.code = 1;
      error.stdout = "";
      error.stderr = "Authentication required.";
      throw error;
    },
  });

  await assert.rejects(
    () => runAwal(["address", "--json"], { expectJson: true }),
    WalletAuthenticationError
  );
});

test("createAwalRunner throws WalletCommandError on non-auth failures", async () => {
  const runAwal = createAwalRunner({
    execFileImpl: async () => {
      const error = new Error("boom");
      error.code = 1;
      error.stdout = "";
      error.stderr = "unexpected failure";
      throw error;
    },
  });

  await assert.rejects(
    () => runAwal(["status", "--json"], { expectJson: true }),
    WalletCommandError
  );
});
