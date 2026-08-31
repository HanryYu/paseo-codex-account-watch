import { createInterface } from "node:readline";
import { readFileSync, openSync, closeSync, unlinkSync } from "node:fs";
import path from "node:path";

if (process.argv.includes("--version")) {
  console.log("codex-cli 0.149.1");
  process.exit(0);
}
const auth = JSON.parse(
  readFileSync(path.join(process.env.CODEX_HOME, "auth.json"), "utf8"),
);
const claims = JSON.parse(
  Buffer.from(auth.tokens.id_token.split(".")[1], "base64url"),
);
const lock = path.join(process.env.CODEX_HOME, "writer.lock");
let ownsLock = false;
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const cleanup = () => {
  if (ownsLock) {
    unlinkSync(lock);
    ownsLock = false;
  }
};
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
const input = createInterface({ input: process.stdin });
input.on("close", () => {
  cleanup();
  process.exit(0);
});
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialized") return;
  if (request.method === "initialize")
    return send({ id: request.id, result: { userAgent: "fixture" } });
  if (request.method === "model/list")
    return send({
      id: request.id,
      result: {
        data: [
          {
            id: "gpt-5.4",
            isDefault: true,
            defaultReasoningEffort: "low",
            supportedReasoningEfforts: [{ reasoningEffort: "low" }],
          },
        ],
      },
    });
  if (request.method === "config/read")
    return send({
      id: request.id,
      result: { config: { model: "gpt-5.4", model_reasoning_effort: "low" } },
    });
  if (request.method === "thread/loaded/list")
    return send({ id: request.id, result: { data: [] } });
  if (request.method === "thread/read")
    return send({
      id: request.id,
      result: { thread: { id: "thread-test", turns: [] } },
    });
  if (request.method === "account/read")
    return send({
      id: request.id,
      result: {
        account: { type: "chatgpt", email: claims.email, planType: "plus" },
        requiresOpenaiAuth: true,
      },
    });
  if (request.method === "thread/resume" || request.method === "thread/start") {
    try {
      closeSync(openSync(lock, "wx"));
      ownsLock = true;
    } catch {
      return send({
        id: request.id,
        error: { code: -32000, message: "thread already has an active writer" },
      });
    }
    return send({
      id: request.id,
      result: { thread: { id: request.params?.threadId ?? "thread-test" } },
    });
  }
  if (request.method === "turn/start") {
    send({ method: "turn/started", params: { threadId: "thread-test" } });
    return send({ id: request.id, result: { turn: { id: "turn-test" } } });
  }
  if (request.method === "test/finish")
    send({ method: "turn/completed", params: { threadId: "thread-test" } });
  send({ id: request.id, result: { echo: request.params ?? null } });
});
