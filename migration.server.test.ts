import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";
import runnerSource from "./migration-runner-source.server.json";
import { bridgeThread } from "./migration.server";
import { MigrationTaskSchema, type MigrationTask } from "./migration.shared";

test("bridges only the selected Codex rollout into an isolated account home", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "account-session-bridge-"));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  const threadId = "thread-selected";
  const sourceFile = path.join(
    source,
    "sessions",
    "2026",
    "09",
    `rollout-${threadId}.jsonl`,
  );
  const ignored = path.join(
    source,
    "sessions",
    "2026",
    "09",
    "rollout-other.jsonl",
  );
  try {
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await Promise.all([
      writeFile(sourceFile, '{"type":"session_meta"}\n'),
      writeFile(ignored, '{"type":"session_meta"}\n'),
    ]);
    assert.equal(await bridgeThread(source, target, threadId), 1);
    const targetFile = path.join(
      target,
      "sessions",
      "2026",
      "09",
      `rollout-${threadId}.jsonl`,
    );
    assert.equal((await stat(sourceFile)).ino, (await stat(targetFile)).ino);
    await assert.rejects(
      stat(path.join(target, "sessions", "2026", "09", "rollout-other.jsonl")),
    );
    assert.equal(await bridgeThread(source, target, threadId), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detached migration runner imports and renames without restarting the host", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "account-runner-test-"));
  const bin = path.join(root, "bin");
  const log = path.join(root, "calls.jsonl");
  const taskPath = path.join(root, "task.json");
  const runner = path.join(root, "runner.cjs");
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    server.on("connection", (socket) => {
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "hello") {
          socket.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "status",
                payload: { status: "server_info", serverId: "test" },
              },
            }),
          );
        } else if (message.type === "session") {
          const request = message.message;
          assert.equal(request.workspaceId, "workspace");
          assert.equal(request.providerId, "codex-cc-work-12345678");
          assert.equal(request.providerHandleId, "thread-test");
          socket.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "status",
                payload: {
                  status: "agent_resumed",
                  requestId: request.requestId,
                  agentId: "agent-new",
                  agent: {
                    id: "agent-new",
                    workspaceId: "workspace",
                    provider: "codex-cc-work-12345678",
                    runtimeInfo: { sessionId: "thread-test" },
                  },
                },
              },
            }),
          );
        }
      });
    });
    await mkdir(bin);
    const paseo = path.join(bin, "paseo");
    await writeFile(
      paseo,
      `#!/usr/bin/env node\nconst fs=require("node:fs");const args=process.argv.slice(2);fs.appendFileSync(process.env.TEST_CALLS,JSON.stringify(args)+"\\n");if(args[0]==="agent"&&args[1]==="import")console.log(JSON.stringify({agentId:"agent-new"}));else if(args[0]==="agent"&&args[1]==="inspect")console.log(JSON.stringify({Id:"agent-new"}));else console.log("{}");\n`,
    );
    await chmod(paseo, 0o700);
    await writeFile(runner, runnerSource);
    const now = new Date().toISOString();
    const task: MigrationTask = {
      version: 1,
      id: "11111111-1111-4111-8111-111111111111",
      state: "scheduled",
      sourceAgentId: "agent-old",
      newAgentId: null,
      workspaceId: "workspace",
      threadId: "thread-test",
      cwd: root,
      title: "Original title",
      profileId: "22222222-2222-4222-8222-222222222222",
      providerId: "codex-cc-work-12345678",
      home: path.join(root, "home"),
      host: `127.0.0.1:${address.port}`,
      labels: { source: "test" },
      createdAt: now,
      updatedAt: now,
      error: null,
    };
    await writeFile(taskPath, JSON.stringify(task), { mode: 0o600 });
    const child = spawn(process.execPath, [runner, taskPath], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        TEST_CALLS: log,
      },
      stdio: "ignore",
    });
    const [code] = (await once(child, "close")) as [number];
    assert.equal(code, 0);
    const result = MigrationTaskSchema.parse(
      JSON.parse(await readFile(taskPath, "utf8")),
    );
    assert.equal(result.state, "completed");
    assert.equal(result.newAgentId, "agent-new");
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    assert.deepEqual(
      calls.map((args) => args.slice(0, 2)),
      [
        ["agent", "update"],
        ["agent", "inspect"],
      ],
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("failed migration reloads the archived source agent", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "account-runner-recovery-"),
  );
  const bin = path.join(root, "bin");
  const log = path.join(root, "calls.jsonl");
  const taskPath = path.join(root, "task.json");
  const runner = path.join(root, "runner.cjs");
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    server.on("connection", (socket) => {
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "hello") {
          socket.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "status",
                payload: { status: "server_info", serverId: "test" },
              },
            }),
          );
          return;
        }
        if (message.type === "session") {
          socket.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "status",
                payload: {
                  status: "agent_create_failed",
                  requestId: message.message.requestId,
                  error: "synthetic import failure",
                },
              },
            }),
          );
        }
      });
    });
    await mkdir(bin);
    const paseo = path.join(bin, "paseo");
    await writeFile(
      paseo,
      `#!/usr/bin/env node\nconst fs=require("node:fs");const args=process.argv.slice(2);fs.appendFileSync(process.env.TEST_CALLS,JSON.stringify(args)+"\\n");console.log(JSON.stringify({Id:"agent-old"}));\n`,
    );
    await chmod(paseo, 0o700);
    await writeFile(runner, runnerSource);
    const now = new Date().toISOString();
    const task: MigrationTask = {
      version: 1,
      id: "33333333-3333-4333-8333-333333333333",
      state: "scheduled",
      sourceAgentId: "agent-old",
      newAgentId: null,
      workspaceId: "workspace",
      threadId: "thread-test",
      cwd: root,
      title: "Original title",
      profileId: "44444444-4444-4444-8444-444444444444",
      providerId: "codex-cc-work-12345678",
      home: path.join(root, "home"),
      host: `127.0.0.1:${address.port}`,
      labels: {},
      createdAt: now,
      updatedAt: now,
      error: null,
    };
    await writeFile(taskPath, JSON.stringify(task), { mode: 0o600 });
    const child = spawn(process.execPath, [runner, taskPath], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        TEST_CALLS: log,
      },
      stdio: "ignore",
    });
    const [code] = (await once(child, "close")) as [number];
    assert.equal(code, 1);
    const result = MigrationTaskSchema.parse(
      JSON.parse(await readFile(taskPath, "utf8")),
    );
    assert.equal(result.state, "failed");
    assert.equal(result.error, "synthetic import failure");
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    assert.deepEqual(
      calls.map((args) => args.slice(0, 3)),
      [["agent", "reload", "agent-old"]],
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
