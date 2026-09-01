import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import path from "node:path";
import os from "node:os";
import bridgeSource from "../bridge-source.server.json";
import { control } from "../control.server";
import { RuntimeRecordSchema } from "../runtime.shared";

async function main() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "paseo-codex-account-probe-"),
  );
  const home = path.join(root, "codex");
  const secondHome = path.join(root, "codex-second");
  await Promise.all([mkdir(home), mkdir(secondHome)]);
  function credential(email: string) {
    const payload = {
      email,
      sub: email,
      exp: 9999999999,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "plugin-test",
        chatgpt_plan_type: "plus",
      },
    };
    const token = `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.test`;
    return JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        account_id: "plugin-test",
        id_token: token,
        access_token: token,
        refresh_token: "synthetic-not-a-real-credential",
      },
      last_refresh: new Date().toISOString(),
    });
  }
  await writeFile(
    path.join(home, "auth.json"),
    credential("first@example.test"),
  );
  await writeFile(
    path.join(secondHome, "auth.json"),
    credential("second@example.test"),
  );
  const script = path.join(root, "bridge.cjs");
  await writeFile(script, bridgeSource);
  const children: {
    child: ReturnType<typeof spawn>;
    closed: Promise<unknown>;
  }[] = [];
  async function start(codexHome: string, agentId: string) {
    const child = spawn(
      process.execPath,
      [script, root, JSON.stringify(["codex"]), "app-server"],
      {
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          HTTPS_PROXY: "http://127.0.0.1:9",
          HTTP_PROXY: "http://127.0.0.1:9",
          NO_PROXY: "127.0.0.1,localhost",
          PASEO_AGENT_ID: agentId,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const closed = once(child, "close");
    children.push({ child, closed });
    child.stderr.resume();
    const messages: Record<string, unknown>[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => {
      const message = JSON.parse(line);
      messages.push(message);
      if (message.id === 1 && message.result)
        child.stdin.write(
          JSON.stringify({ method: "initialized", params: {} }) + "\n",
        );
      assert.equal(
        typeof message.id === "string" &&
          message.id.startsWith("paseo-account-watch:"),
        false,
      );
    });
    child.stdin.write(
      JSON.stringify({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "paseo_account_probe", version: "0.1.0" },
          capabilities: {},
        },
      }) + "\n",
    );
    const request = async (id: number, method: string, params: unknown) => {
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      for (let attempt = 0; attempt < 200; attempt++) {
        const response = messages.find((message) => message.id === id);
        if (response) return response;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Real Codex did not answer ${method}`);
    };
    for (let attempt = 0; attempt < 100; attempt++) {
      const files = await readdir(path.join(root, "runs")).catch(() => []);
      for (const file of files.filter((name) => name.endsWith(".json"))) {
        const record = RuntimeRecordSchema.parse(
          JSON.parse(await readFile(path.join(root, "runs", file), "utf8")),
        );
        if (record.agentId === agentId && record.account)
          return { record, child, closed, request };
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error("Real Codex did not report an account");
  }
  try {
    const first = await start(home, "real-codex-probe-a");
    assert.equal(first.record.account?.email, "first@example.test");
    await writeFile(
      path.join(home, "auth.json"),
      credential("second@example.test"),
    );
    const old = await control(first.record, "account");
    assert.deepEqual(old.account, {
      kind: "chatgpt",
      email: "first@example.test",
      label: "first@example.test",
    });
    first.child.kill("SIGTERM");
    await first.closed;
    const second = await start(secondHome, "real-codex-probe-b");
    assert.equal(second.record.account?.email, "second@example.test");
    assert.notEqual(second.record.runId, first.record.runId);
    console.log(
      "真实 Codex account/read：旧进程 A、新进程 B、内部响应隔离通过。使用合成凭据，不启动回合，不验证真实账号额度或推理服务。",
    );
  } finally {
    for (const { child, closed } of children) {
      child.kill("SIGTERM");
      await closed;
    }
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
