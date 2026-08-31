import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import path from "node:path";
import os from "node:os";
import { control } from "./control.server";
import { RuntimeRecordSchema } from "./runtime.shared";
import bridgeSource from "./bridge-source.server.json";

export function authFixture(email: string) {
  return JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      account_id: "workspace-test",
      id_token: `header.${Buffer.from(JSON.stringify({ email, sub: email })).toString("base64url")}.private-token`,
      refresh_token: "private-refresh-token",
    },
  });
}
async function waitFor<T>(
  read: () => Promise<T | null>,
  timeout = 5000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (result !== null) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Fixture did not reach the expected state");
}
async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-bridge-test-"));
  const home = path.join(root, "codex");
  await mkdir(home);
  await writeFile(
    path.join(home, "auth.json"),
    authFixture("first@example.test"),
  );
  const bridge = path.join(root, "bridge.cjs");
  await writeFile(bridge, bridgeSource);
  const children: ReturnType<typeof launch>[] = [];
  function launch() {
    const child = spawn(
      process.execPath,
      [
        bridge,
        root,
        JSON.stringify([
          process.execPath,
          path.resolve("fixtures/codex-fixture.mjs"),
        ]),
        "app-server",
      ],
      {
        env: { ...process.env, CODEX_HOME: home, PASEO_AGENT_ID: "agent-test" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const exited = once(child, "close");
    const messages: Record<string, unknown>[] = [];
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => messages.push(JSON.parse(line)));
    let id = 0;
    const request = async (method: string, params: unknown = {}) => {
      const requestId = ++id;
      child.stdin.write(
        JSON.stringify({ id: requestId, method, params }) + "\n",
      );
      return waitFor(
        async () =>
          messages.find((message) => message.id === requestId) ?? null,
      );
    };
    const record = () =>
      waitFor(async () => {
        const files = await readdir(path.join(root, "runs")).catch(() => []);
        for (const file of files.filter((name) => name.endsWith(".json"))) {
          try {
            const value = RuntimeRecordSchema.parse(
              JSON.parse(await readFile(path.join(root, "runs", file), "utf8")),
            );
            if (value.account && value.threadId) return value;
          } catch {
            /* The runtime publishes records atomically. */
          }
        }
        return null;
      });
    return { child, exited, request, messages, record };
  }
  return {
    root,
    home,
    start() {
      const child = launch();
      children.push(child);
      return child;
    },
    async close() {
      for (const runtime of children) {
        runtime.child.kill("SIGTERM");
        await runtime.exited;
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}

test(
  "real child processes preserve old auth, privately report runtime email, and hand off an exclusive thread",
  { timeout: 20000 },
  async () => {
    const fixture = await createFixture();
    try {
      const first = fixture.start();
      assert.deepEqual((await first.request("initialize")).result, {
        userAgent: "fixture",
      });
      first.child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
      assert.deepEqual(
        (await first.request("thread/resume", { threadId: "thread-test" }))
          .result,
        { thread: { id: "thread-test" } },
      );
      const oldRecord = await first.record();
      assert.equal(oldRecord.account?.email, "first@example.test");
      assert.equal(JSON.stringify(oldRecord).includes("private-token"), false);
      assert.equal(
        first.messages.some((message) =>
          String(message.id).startsWith("paseo-account-watch:"),
        ),
        false,
      );
      await assert.rejects(
        control({ ...oldRecord, secret: "0".repeat(64) }, "account"),
        /Unauthorized/,
      );
      await assert.rejects(
        control({ ...oldRecord, threadId: "other-thread" }, "close"),
        /Thread identity/,
      );
      await writeFile(
        path.join(fixture.home, "auth.json"),
        authFixture("second@example.test"),
      );
      const oldAccount = await control(oldRecord, "account");
      assert.deepEqual(oldAccount.account, {
        kind: "chatgpt",
        email: "first@example.test",
        label: "first@example.test",
      });
      await first.request("turn/start");
      await assert.rejects(control(oldRecord, "close"), /busy/);
      await first.request("test/finish");
      await control(oldRecord, "close");
      await first.exited;
      const second = fixture.start();
      await second.request("initialize");
      second.child.stdin.write(
        JSON.stringify({ method: "initialized" }) + "\n",
      );
      assert.deepEqual(
        (await second.request("thread/resume", { threadId: "thread-test" }))
          .result,
        { thread: { id: "thread-test" } },
      );
      const newRecord = await second.record();
      assert.notEqual(newRecord.runId, oldRecord.runId);
      assert.equal(newRecord.threadId, oldRecord.threadId);
      assert.equal(newRecord.account?.email, "second@example.test");
      assert.notEqual(
        newRecord.launchIdentity?.fingerprint,
        oldRecord.launchIdentity?.fingerprint,
      );
      await control(newRecord, "close");
      await second.exited;
      assert.deepEqual(
        (await readdir(path.join(fixture.root, "runs"))).filter((name) =>
          name.endsWith(".json"),
        ),
        [],
      );
    } finally {
      await fixture.close();
    }
  },
);
