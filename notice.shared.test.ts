import { test } from "node:test";
import assert from "node:assert/strict";
import type { AccountSession } from "./status.shared";
import { sessionForOpenDialog } from "./notice.shared";

const session: AccountSession = {
  agentId: "agent",
  workspaceId: "workspace",
  title: "Title",
  runId: "run-a",
  threadId: "thread",
  currentAccountLabel: "first@example.test",
  currentProfileId: null,
  previousLabel: "first@example.test",
  nextLabel: "second@example.test",
  fingerprint: "second",
  changed: true,
  busy: false,
  verification: "email",
  problem: null,
};
test("an open confirmation cannot silently adopt newer credentials or a replacement process", () => {
  for (const changed of [
    { ...session, fingerprint: "third", nextLabel: "third@example.test" },
    { ...session, runId: "run-b" },
    undefined,
  ]) {
    const locked = sessionForOpenDialog(session, changed);
    assert.equal(locked.fingerprint, "second");
    assert.equal(locked.runId, "run-a");
    assert.equal(locked.busy, true);
    assert.match(locked.problem!, /changed again/);
  }
});
test("busy status still updates for the same confirmed transition", () => {
  assert.deepEqual(sessionForOpenDialog(session, { ...session, busy: true }), {
    ...session,
    busy: true,
  });
});
