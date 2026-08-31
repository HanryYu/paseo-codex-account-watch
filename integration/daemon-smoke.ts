import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import os from "node:os";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { StatusSchema } from "../status.shared";

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
async function main() {
  const ui = process.argv.includes("--ui");
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-plugin-e2e-"));
  const home = path.join(root, "daemon");
  const codexHome = path.join(root, "codex");
  const repo = path.join(root, "project");
  await Promise.all([mkdir(home), mkdir(codexHome), mkdir(repo)]);
  const credential = (email: string) =>
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        account_id: "workspace-test",
        id_token: `header.${Buffer.from(JSON.stringify({ email, sub: email })).toString("base64url")}.synthetic-token`,
      },
    });
  await writeFile(
    path.join(codexHome, "auth.json"),
    credential("first@example.test"),
  );
  const originalCommand = [
    process.execPath,
    path.resolve("fixtures/codex-fixture.mjs"),
  ];
  await writeFile(
    path.join(home, "config.json"),
    JSON.stringify({
      pluginsEnabled: true,
      features: {
        voiceMode: { enabled: false },
        dictation: { enabled: false },
      },
      agents: {
        providers: {
          codex: { command: originalCommand, env: { CODEX_HOME: codexHome } },
          claude: { enabled: false },
          opencode: { enabled: false },
          copilot: { enabled: false },
          pi: { enabled: false },
          omp: { enabled: false },
        },
        metadataGeneration: { providers: [] },
      },
    }),
  );
  const port = await freePort();
  const host = `127.0.0.1:${port}`;
  const daemon = spawn(
    "paseo",
    [
      "daemon",
      "start",
      "--home",
      home,
      "--listen",
      host,
      "--foreground",
      "--no-relay",
      "--no-mcp",
      "--no-inject-mcp",
      ui ? "--web-ui" : "--no-web-ui",
    ],
    {
      env: { ...process.env, PASEO_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  const closed = once(daemon, "close");
  let daemonExited = false;
  void closed.then(() => {
    daemonExited = true;
  });
  async function waitForExit(milliseconds: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      closed,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, milliseconds);
      }),
    ]);
    clearTimeout(timer);
  }
  function signalTestGroup(signal: NodeJS.Signals) {
    if (!daemonExited && daemon.pid) {
      try {
        process.kill(-daemon.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
  }
  let startupOutput = "";
  daemon.stdout.on("data", (chunk) => {
    startupOutput = (startupOutput + chunk).slice(-6000);
  });
  daemon.stderr.on("data", (chunk) => {
    startupOutput = (startupOutput + chunk).slice(-6000);
  });
  const client = new DaemonClient({
    url: `ws://${host}/ws`,
    clientId: "plugin-integration",
    clientType: "cli",
    reconnect: { enabled: false },
    connectTimeoutMs: 2000,
  });
  let projectId: string | undefined;
  try {
    for (let retry = 0; retry < 80; retry++) {
      try {
        await client.connect();
        break;
      } catch {
        if (retry === 79 || daemon.exitCode !== null)
          throw new Error(`Isolated daemon did not start: ${startupOutput}`);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    const cleanSource = path.join(root, "clean-source");
    await cp(path.resolve("."), cleanSource, {
      recursive: true,
      filter: (source) =>
        !source
          .split(path.sep)
          .some((part) => part === "node_modules" || part === ".git"),
    });
    const plugin = process.argv.includes("--git")
      ? await client.installPluginSource({
          source: "https://github.com/HanryYu/paseo-codex-account-watch.git",
        })
      : await client.installDirectoryPlugin(cleanSource);
    assert.equal(plugin.status, "running");
    console.log("隔离 daemon：插件安装并运行通过。");
    const setup = await client.invokePluginRpc(plugin.id, "accounts.setup", {
      action: "enable",
      confirmed: true,
    });
    console.log(JSON.stringify(setup));
    const workspace = await client.createWorkspace({
      source: { kind: "directory", path: repo },
      title: "Plugin account test",
    });
    if (!workspace.workspace) throw new Error("Workspace not created");
    projectId = workspace.workspace.projectId;
    const agent = await client.createAgent({
      provider: "codex",
      model: "gpt-5.4",
      thinkingOptionId: "low",
      cwd: repo,
      workspaceId: workspace.workspace.id,
      title: "Account switch test",
    });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    let status = StatusSchema.parse(
      await client.invokePluginRpc(plugin.id, "accounts.status", {}),
    );
    for (let attempt = 0; attempt < 15 && !status.sessions.length; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      status = StatusSchema.parse(
        await client.invokePluginRpc(plugin.id, "accounts.status", {}),
      );
    }
    assert.equal(status.enabled, true);
    assert.equal(status.sessions.length, 1);
    assert.equal(status.sessions[0].previousLabel, "first@example.test");
    await writeFile(
      path.join(codexHome, "auth.json"),
      credential("second@example.test"),
    );
    for (
      let attempt = 0;
      attempt < 15 && !status.sessions[0]?.changed;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      status = StatusSchema.parse(
        await client.invokePluginRpc(plugin.id, "accounts.status", {}),
      );
    }
    const pending = status.sessions[0];
    assert.equal(pending.changed, true);
    assert.equal(pending.previousLabel, "first@example.test");
    assert.match(pending.nextLabel, /second@example.test/);
    if (ui) {
      console.log(
        JSON.stringify({
          url: `http://${host}`,
          home,
          codexHome,
          workspaceId: workspace.workspace.id,
          agentId: agent.id,
          serverId: (
            await readFile(path.join(home, "server-id"), "utf8")
          ).trim(),
        }),
      );
      await new Promise<void>((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
      return;
    }
    await assert.rejects(
      client.invokePluginRpc(plugin.id, "accounts.reload", {
        agentId: agent.id,
        runId: pending.runId,
        fingerprint: "stale-fingerprint",
        confirmed: true,
      }),
    );
    const reloadInput = {
      agentId: agent.id,
      runId: pending.runId,
      fingerprint: pending.fingerprint,
      confirmed: true,
    };
    const beforeReloadConfig = await client.getDaemonConfig();
    await client.patchDaemonConfig({
      providers: { codex: { command: originalCommand } },
    });
    await assert.rejects(
      client.invokePluginRpc(plugin.id, "accounts.reload", reloadInput),
      /launch command changed/,
    );
    const untouched = StatusSchema.parse(
      await client.invokePluginRpc(plugin.id, "accounts.status", {}),
    );
    assert.equal(untouched.sessions[0].runId, pending.runId);
    assert.equal(untouched.sessions[0].previousLabel, "first@example.test");
    await client.patchDaemonConfig({
      providers: {
        codex: { command: beforeReloadConfig.config.providers.codex.command },
      },
    });
    const concurrent = await Promise.allSettled([
      client.invokePluginRpc(plugin.id, "accounts.reload", reloadInput),
      client.invokePluginRpc(plugin.id, "accounts.reload", reloadInput),
    ]);
    assert.equal(
      concurrent.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const result = concurrent.find((result) => result.status === "fulfilled");
    assert.equal(result?.status, "fulfilled");
    const refreshed = result?.status === "fulfilled" ? result.value : null;
    assert.deepEqual(refreshed, {
      agentId: agent.id,
      threadId: "thread-test",
      label: "second@example.test",
      verification: "email",
    });
    const installedConfig = await client.getDaemonConfig();
    const installedCommand = installedConfig.config.providers.codex.command;
    await client.patchDaemonConfig({
      providers: {
        codex: { command: [...originalCommand, "--changed-outside"] },
      },
    });
    await assert.rejects(
      client.invokePluginRpc(plugin.id, "accounts.setup", {
        action: "restore",
        confirmed: true,
      }),
      /changed outside/,
    );
    assert.deepEqual(
      (await client.getDaemonConfig()).config.providers.codex.command,
      [...originalCommand, "--changed-outside"],
    );
    await client.patchDaemonConfig({
      providers: { codex: { command: installedCommand } },
    });
    await client.invokePluginRpc(plugin.id, "accounts.setup", {
      action: "restore",
      confirmed: true,
    });
    const persisted = JSON.parse(
      await readFile(path.join(home, "config.json"), "utf8"),
    );
    assert.deepEqual(persisted.agents.providers.codex.command, originalCommand);
    assert.equal(persisted.agents.providers.codex.env.CODEX_HOME, codexHome);
    console.log(
      "隔离 daemon：无 node_modules 安装、自动配置、A→B 检测、拒绝过期确认、并发刷新去重、同 thread 切换、邮箱确认、外部配置保护与恢复通过。",
    );
    if (process.argv.includes("--exit-before-cleanup")) {
      await client.shutdownServer({ timeout: 3000 });
      await waitForExit(3000);
      assert.equal(daemonExited, true);
    }
  } catch (error) {
    console.error(
      (await readFile(path.join(home, "daemon.log"), "utf8"))
        .split("\n")
        .filter((line) =>
          /Refreshing agent|Failed to refresh|Reload|SIGTERM|error.*message/.test(
            line,
          ),
        )
        .slice(-8)
        .join("\n"),
    );
    throw error;
  } finally {
    if (projectId) await client.removeProject(projectId).catch(() => {});
    // Keep the exact test connection: CLI stop can fall back when the PID file is gone.
    await client.shutdownServer({ timeout: 3000 }).catch(() => {});
    await client.close().catch(() => {});
    await waitForExit(3000);
    signalTestGroup("SIGTERM");
    await waitForExit(2000);
    signalTestGroup("SIGKILL");
    await closed;
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
