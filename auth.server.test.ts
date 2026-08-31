import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAuth, readAuth, SettledAccount } from "./auth.server";

function auth(
  email = "first@example.test",
  account = "workspace-1",
  secret = "secret-one",
) {
  const payload = {
    email,
    sub: `user-${email}`,
    "https://api.openai.com/auth": { chatgpt_account_id: account },
  };
  return JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      account_id: account,
      id_token: `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${secret}`,
      refresh_token: secret,
    },
  });
}

test("token rotation preserves the stable account identity and exposes no tokens", () => {
  const before = parseAuth(auth());
  const after = parseAuth(auth(undefined, undefined, "secret-two"));
  assert.deepEqual(before, after);
  assert.equal(JSON.stringify(before).includes("secret"), false);
  assert.equal(JSON.stringify(before).includes("header."), false);
});

test("different users in one workspace and one user in different workspaces are distinct", () => {
  const first = parseAuth(auth());
  assert.notDeepEqual(first, parseAuth(auth("second@example.test")));
  assert.notDeepEqual(
    first,
    parseAuth(auth("first@example.test", "workspace-2")),
  );
});

test("opaque OAuth tokens are unknown, not fake account-switch events", () => {
  assert.equal(
    parseAuth(JSON.stringify({ tokens: { id_token: "opaque" } })).status,
    "unavailable",
  );
  assert.equal(parseAuth("{").status, "unavailable");
});

test("API credentials use redacted, distinct labels", () => {
  const first = parseAuth(JSON.stringify({ OPENAI_API_KEY: "secret-one" }));
  const second = parseAuth(JSON.stringify({ OPENAI_API_KEY: "secret-two" }));
  assert.notDeepEqual(first, second);
  assert.equal(JSON.stringify(first).includes("secret-one"), false);
});

test("requires consecutive stable observations and ignores transient missing files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-auth-test-"));
  const file = path.join(directory, "auth.json");
  try {
    const state = new SettledAccount();
    await writeFile(file, auth());
    assert.equal(state.accept(await readAuth(file)), null);
    assert.deepEqual(state.accept(await readAuth(file)), state.current());
    const first = state.current();
    await rm(file);
    assert.equal(state.accept(await readAuth(file)), null);
    await writeFile(`${file}.next`, auth("second@example.test"));
    await rename(`${file}.next`, file);
    assert.equal(state.accept(await readAuth(file)), null);
    const second = state.accept(await readAuth(file));
    assert.notDeepEqual(second, first);
    assert.equal(second?.email, "second@example.test");
    assert.equal(state.accept(await readAuth(file)), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
