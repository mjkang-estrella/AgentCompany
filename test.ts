import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

type JsonRpcId = number;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  id?: JsonRpcId;
  result?: unknown;
  error?: unknown;
  method?: string;
  params?: unknown;
};

type ThreadStartResult = {
  thread: {
    id: string;
  };
};

const model = process.argv[2] ?? "gpt-5.4";
const prompt = process.argv[3] ?? "Say hello in one short sentence.";
const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");

let nextId = 1;
let threadId: string | null = null;
let assistantText = "";

const proc = spawn("codex", ["app-server"], {
  env: {
    ...process.env,
    CODEX_HOME: codexHome,
  },
  stdio: ["pipe", "pipe", "pipe"],
});

const rl = readline.createInterface({ input: proc.stdout });
const stderrRl = readline.createInterface({ input: proc.stderr });
const stderrBuffer: string[] = [];

const send = (method: string, params?: unknown) => {
  const message: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: nextId++,
    method,
    params,
  };

  proc.stdin.write(JSON.stringify(message) + "\n");
  return message.id!;
};

const notify = (method: string, params?: unknown) => {
  const message: JsonRpcRequest = {
    jsonrpc: "2.0",
    method,
    params,
  };

  proc.stdin.write(JSON.stringify(message) + "\n");
};

let initializeId: JsonRpcId;
let threadStartId: JsonRpcId | null = null;
let turnStartId: JsonRpcId | null = null;
const timeout = setTimeout(() => {
  exitWithError("timed out waiting for codex app-server response");
}, 120_000);

const shutdown = (exitCode = 0) => {
  clearTimeout(timeout);
  rl.close();
  stderrRl.close();
  proc.kill("SIGTERM");
  process.exitCode = exitCode;
};

const exitWithError = (message: string) => {
  console.error(message);
  shutdown(1);
};

proc.on("error", (error) => {
  exitWithError(`failed to start codex app-server: ${error.message}`);
});

proc.on("exit", (code, signal) => {
  if (code === 0 || signal === "SIGTERM") {
    return;
  }

  if (stderrBuffer.length > 0) {
    console.error(stderrBuffer.join("\n"));
  }
  process.exitCode = code ?? 1;
});

stderrRl.on("line", (line) => {
  stderrBuffer.push(line);

  if (stderrBuffer.length > 50) {
    stderrBuffer.shift();
  }

  if (process.env.DEBUG_APP_SERVER === "1") {
    console.error(line);
  }
});

rl.on("line", (line) => {
  const message = JSON.parse(line) as JsonRpcResponse;

  if (message.error) {
    exitWithError(`app-server error: ${JSON.stringify(message.error)}`);
    return;
  }

  if (message.id === initializeId) {
    notify("initialized", {});
    threadStartId = send("thread/start", {
      model,
      cwd: process.cwd(),
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });
    return;
  }

  if (threadStartId !== null && message.id === threadStartId) {
    threadId = (message.result as ThreadStartResult).thread.id;
    turnStartId = send("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: prompt,
          text_elements: [],
        },
      ],
    });
    return;
  }

  if (turnStartId !== null && message.id === turnStartId) {
    return;
  }

  if (message.method === "item/agentMessage/delta") {
    const delta =
      (message.params as { delta?: string } | undefined)?.delta ?? "";
    assistantText += delta;
    process.stdout.write(delta);
    return;
  }

  if (message.method === "turn/completed") {
    process.stdout.write("\n");
    shutdown(0);
  }
});

initializeId = send("initialize", {
  clientInfo: {
    name: "my-workspace",
    title: "My Workspace",
    version: "0.1.0",
  },
  capabilities: null,
});
