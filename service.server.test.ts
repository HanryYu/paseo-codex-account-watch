import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { PaseoApi } from "@getpaseo/client";
import { AccountService, localReloadEndpoint } from "./service.server";

test("reload endpoints stay host-local and preserve IPv6 loopback", () => {
  assert.equal(localReloadEndpoint("0.0.0.0:6767"), "127.0.0.1:6767");
  assert.equal(localReloadEndpoint("[::]:6767"), "[::1]:6767");
  assert.equal(localReloadEndpoint("[::1]:6767"), "[::1]:6767");
  assert.equal(localReloadEndpoint("localhost:6767"), "localhost:6767");
  assert.equal(localReloadEndpoint("/tmp/fixture.sock"), "/tmp/fixture.sock");
  for (const value of [
    undefined,
    "192.168.1.2:6767",
    "evil.example:6767",
    "127.0.0.1:99999",
    "127.0.0.1:0",
  ])
    assert.throws(() => localReloadEndpoint(value));
});

async function fixture(command?: string[]) {
  const home = await mkdtemp(path.join(os.tmpdir(), "account-setup-test-"));
  let current = command;
  let writes = 0;
  const config = {
    async get() {
      return { config: { providers: { codex: { command: current } } } };
    },
    async patch(patch: { providers: { codex: { command: string[] } } }) {
      writes++;
      current = patch.providers.codex.command;
      return {};
    },
  } as unknown as PaseoApi["config"];
  const service = new AccountService(home, {
    async command() {
      return JSON.stringify({ executable: process.execPath, major: 22 });
    },
  });
  return {
    service,
    paseo: { config },
    command: () => current,
    writes: () => writes,
    replace(command: string[]) {
      current = command;
    },
    async close() {
      service.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}

test("setup saves only the command, is idempotent, and restores the effective default", async () => {
  const f = await fixture();
  try {
    await f.service.setup(f.paseo, "enable");
    const installed = f.command()!;
    assert.equal(installed[0], process.execPath);
    assert.deepEqual(JSON.parse(installed[3]), ["codex"]);
    assert.equal((await stat(f.service.root)).mode & 0o777, 0o700);
    assert.equal((await stat(installed[1])).mode & 0o777, 0o600);
    const backup = JSON.parse(
      await readFile(path.join(f.service.root, "setup.json"), "utf8"),
    );
    assert.deepEqual(Object.keys(backup).sort(), [
      "installedCommand",
      "previousCommand",
      "version",
    ]);
    await f.service.setup(f.paseo, "enable");
    assert.equal(f.writes(), 1);
    await f.service.setup(f.paseo, "restore");
    assert.deepEqual(f.command(), ["codex"]);
    assert.ok((await readFile(installed[1], "utf8")).length > 0);
  } finally {
    await f.close();
  }
});

test("setup restores custom argv and refuses external changes", async () => {
  const original = ["/custom/codex", "--config", 'model="gpt-5.4"'];
  const f = await fixture(original);
  try {
    await f.service.setup(f.paseo, "enable");
    const installed = f.command()!;
    f.replace(["/another/codex"]);
    await assert.rejects(
      f.service.setup(f.paseo, "restore"),
      /changed outside/,
    );
    await assert.rejects(f.service.setup(f.paseo, "enable"), /changed outside/);
    assert.deepEqual(f.command(), ["/another/codex"]);
    f.replace(installed);
    await f.service.setup(f.paseo, "restore");
    assert.deepEqual(f.command(), original);
  } finally {
    await f.close();
  }
});

test("credential-bearing argv is rejected before configuration is saved", async () => {
  const f = await fixture(["codex", "--api-key", "synthetic-secret"]);
  try {
    await assert.rejects(
      f.service.setup(f.paseo, "enable"),
      /credential arguments/,
    );
    assert.equal(f.writes(), 0);
    await assert.rejects(stat(f.service.root), { code: "ENOENT" });
  } finally {
    await f.close();
  }
});
