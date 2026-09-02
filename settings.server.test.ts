import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SettingsStore } from "./settings.server";
import { DEFAULT_PLUGIN_SETTINGS } from "./settings.shared";

test("persists validated host settings without dropping existing values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "account-settings-test-"));
  const store = new SettingsStore(path.join(root, "plugin"));
  try {
    assert.deepEqual(await store.read(), DEFAULT_PLUGIN_SETTINGS);
    await store.update({ language: "zh-CN", showSetupPill: false });
    const result = await store.update({ showAccountPill: false });
    assert.deepEqual(result, {
      ...DEFAULT_PLUGIN_SETTINGS,
      language: "zh-CN",
      showAccountPill: false,
      showSetupPill: false,
    });
    const file = path.join(root, "plugin", "settings.json");
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), result);
    assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await store.read(), result);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
