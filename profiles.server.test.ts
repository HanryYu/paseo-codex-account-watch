import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { ProfileStore } from "./profiles.server";

function oauth(email: string) {
  const token = `header.${Buffer.from(JSON.stringify({ email, sub: email })).toString("base64url")}.synthetic`;
  return {
    auth_mode: "chatgpt",
    tokens: { account_id: "workspace", id_token: token },
  };
}

test("imports valid CC Switch Codex rows into isolated homes without exposing credentials", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "account-profile-test-"));
  const databasePath = path.join(root, "cc-switch.db");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE providers (
      id TEXT NOT NULL,
      app_type TEXT NOT NULL,
      name TEXT NOT NULL,
      settings_config TEXT NOT NULL,
      category TEXT,
      created_at INTEGER,
      sort_index INTEGER,
      PRIMARY KEY (id, app_type)
    )
  `);
  const insert = database.prepare(
    "INSERT INTO providers (id, app_type, name, settings_config, category, created_at, sort_index) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  insert.run(
    "work-api",
    "codex",
    "Work API",
    JSON.stringify({
      auth: { OPENAI_API_KEY: "sk-synthetic-private-one" },
      config: 'model_provider = "custom"\n',
    }),
    "custom",
    1,
    1,
  );
  insert.run(
    "personal-chatgpt",
    "codex",
    "Personal",
    JSON.stringify({ auth: oauth("person@example.test"), config: "" }),
    "custom",
    2,
    2,
  );
  insert.run(
    "official",
    "codex",
    "OpenAI Official",
    JSON.stringify({ auth: {}, config: 'model_provider = "openai"' }),
    "official",
    3,
    3,
  );
  insert.run(
    "claude-row",
    "claude",
    "Claude",
    JSON.stringify({ auth: { token: "not-imported" } }),
    "custom",
    4,
    4,
  );
  database.close();

  const providers: Record<string, unknown> = {};
  const paseo = {
    config: {
      async get() {
        return { config: { providers } };
      },
      async patch(input: { providers?: Record<string, unknown> }) {
        Object.assign(providers, input.providers);
        return {};
      },
    },
  } as unknown as Pick<PaseoApi, "config">;
  const store = new ProfileStore(path.join(root, "plugin"));
  try {
    const first = await store.importCcSwitch(paseo, databasePath);
    assert.deepEqual(
      {
        imported: first.imported,
        updated: first.updated,
        skipped: first.skipped,
      },
      { imported: 2, updated: 0, skipped: 1 },
    );
    assert.equal(first.profiles.length, 2);
    const records = await store.listRecords();
    assert.equal(records.length, 2);
    assert.equal(JSON.stringify(records).includes("synthetic-private"), false);
    assert.equal(
      JSON.stringify(providers).includes("synthetic-private"),
      false,
    );
    for (const profile of records) {
      const provider = providers[profile.providerId] as {
        extends: string;
        env: { CODEX_HOME: string };
      };
      assert.equal(provider.extends, "codex");
      assert.equal(provider.env.CODEX_HOME, profile.home);
      assert.equal((await stat(profile.home)).mode & 0o777, 0o700);
      assert.equal(
        (await stat(path.join(profile.home, "auth.json"))).mode & 0o777,
        0o600,
      );
    }
    assert.equal(
      (
        await readFile(
          path.join(
            records.find((item) => item.authKind === "api-key")!.home,
            "auth.json",
          ),
          "utf8",
        )
      ).includes("sk-synthetic-private-one"),
      true,
    );

    const second = await store.importCcSwitch(paseo, databasePath);
    assert.equal(second.imported, 0);
    assert.equal(second.updated, 2);
    assert.deepEqual(
      second.profiles.map((item) => item.id).sort(),
      first.profiles.map((item) => item.id).sort(),
    );

    const personal = second.profiles.find((profile) =>
      profile.accountLabel.includes("person@example.test"),
    )!;
    const renamed = await store.rename(paseo, personal.id, "  Client   work  ");
    assert.equal(renamed.name, "Client work");
    assert.equal(
      (providers[personal.providerId] as { label: string }).label,
      "Codex · Client work",
    );
    assert.equal(
      (await store.listRecords()).find((profile) => profile.id === personal.id)
        ?.customName,
      "Client work",
    );
    const synced = await store.importCcSwitch(paseo, databasePath);
    assert.equal(
      synced.profiles.find((profile) => profile.id === personal.id)?.name,
      "Client work",
    );
    const other = synced.profiles.find(
      (profile) => profile.id !== personal.id,
    )!;
    await assert.rejects(
      store.rename(paseo, personal.id, other.name),
      /already uses this name/,
    );
    const ownedProvider = providers[personal.providerId] as {
      env: { CODEX_HOME: string };
    };
    providers[personal.providerId] = {
      ...ownedProvider,
      env: { CODEX_HOME: path.join(root, "changed-outside") },
    };
    await assert.rejects(
      store.rename(paseo, personal.id, "Refused"),
      /changed outside/,
    );
    assert.equal(
      (await store.list()).find((profile) => profile.id === personal.id)?.name,
      "Client work",
    );

    const link = path.join(root, "database-link.db");
    await symlink(databasePath, link);
    await assert.rejects(store.importCcSwitch(paseo, link), /symlinks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
