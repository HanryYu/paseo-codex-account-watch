import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readAuth } from "./auth.server";
import type { RuntimeRecord } from "./runtime.shared";
import { accountFromResponse } from "./account-runtime.server";

async function main() {
  const [stateRoot, commandJson, ...args] = process.argv.slice(2);
  const command: unknown = JSON.parse(commandJson);
  if (
    !stateRoot ||
    !Array.isArray(command) ||
    !command.length ||
    !command.every((item) => typeof item === "string" && item.length)
  ) {
    throw new Error("Invalid Codex monitor launch configuration");
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const agentId = process.env.PASEO_AGENT_ID;
  const monitored = Boolean(agentId && args.includes("app-server"));
  if (!monitored) {
    const child = spawn(command[0], [...command.slice(1), ...args], {
      env,
      stdio: "inherit",
    });
    child.on("error", () => {
      process.exitCode = 1;
    });
    child.on("close", (code) => {
      process.exitCode = code ?? 1;
    });
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      process.on(signal, () => child.kill(signal));
    return;
  }

  const runId = randomUUID();
  const authPath = path.resolve(
    process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    "auth.json",
  );
  const initial = await readAuth(authPath);
  const runsDir = path.join(stateRoot, "runs");
  await mkdir(runsDir, { recursive: true, mode: 0o700 });
  const recordPath = path.join(runsDir, `${runId}.json`);
  const secret = randomBytes(32).toString("hex");
  const launch = () =>
    spawn(command[0], [...command.slice(1), ...args], {
      env,
      stdio: ["pipe", "pipe", "inherit"],
    });
  let child: ReturnType<typeof launch>;
  const record: RuntimeRecord = {
    version: 1,
    runId,
    agentId: agentId!,
    threadId: null,
    authPath,
    startedAt: new Date().toISOString(),
    launchIdentity: initial.status === "readable" ? initial.identity : null,
    account: null,
    port: 1,
    secret,
  };
  let persistTail = Promise.resolve();
  const persist = () => {
    const serialized = JSON.stringify(record);
    persistTail = persistTail.then(async () => {
      await writeFile(`${recordPath}.tmp`, serialized, { mode: 0o600 });
      await rename(`${recordPath}.tmp`, recordPath);
    });
    return persistTail;
  };
  let initialized = false;
  let busy = false;
  let closing = false;
  let exited = false;
  let sequence = 0;
  const requests = new Map<string | number, string>();
  const probes = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const probeAccount = async () => {
    if (!initialized || exited || closing)
      throw new Error("Codex runtime is not ready");
    const id = `paseo-account-watch:${runId}:${++sequence}`;
    const result = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        probes.delete(id);
        reject(new Error("Codex account/read timed out"));
      }, 4000);
      probes.set(id, { resolve, reject, timer });
      child.stdin.write(
        `${JSON.stringify({ id, method: "account/read", params: { refreshToken: false } })}\n`,
      );
    });
    record.account = accountFromResponse(result);
    await persist();
    return record.account;
  };

  const server = createServer((socket) => {
    socket.setTimeout(6000, () => socket.destroy());
    let input = "";
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      input += chunk.toString();
      if (Buffer.byteLength(input) > 4096) {
        socket.destroy();
        return;
      }
      if (!input.includes("\n")) return;
      socket.pause();
      void (async () => {
        const request = JSON.parse(input.slice(0, input.indexOf("\n")));
        if (
          typeof request.secret !== "string" ||
          request.secret.length !== secret.length ||
          !timingSafeEqual(Buffer.from(request.secret), Buffer.from(secret))
        ) {
          throw new Error("Unauthorized runtime request");
        }
        if (request.runId !== runId || request.agentId !== agentId)
          throw new Error("Runtime identity changed");
        if (request.operation === "account") {
          const account = await probeAccount();
          socket.end(
            `${JSON.stringify({ ok: true, runId, agentId, threadId: record.threadId, account, busy })}\n`,
          );
        } else if (request.operation === "close") {
          if (!record.threadId || request.threadId !== record.threadId)
            throw new Error("Thread identity changed");
          if (busy || requests.size || closing)
            throw new Error("Agent is busy; wait for the turn to finish");
          closing = true;
          child.kill("SIGTERM");
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              closed,
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(
                      new Error(
                        "Previous Codex process did not exit; reload was not attempted",
                      ),
                    ),
                  4500,
                );
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
          socket.end(
            `${JSON.stringify({ ok: true, runId, agentId, closed: true })}\n`,
          );
        } else throw new Error("Unknown runtime request");
      })().catch((error) =>
        socket.end(
          `${JSON.stringify({ ok: false, error: error instanceof SyntaxError ? "Invalid runtime request" : (error as Error).message })}\n`,
        ),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Runtime control channel unavailable");
  record.port = address.port;
  child = launch();

  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  input.on("line", (line) => {
    let activateProbe = false;
    try {
      const message = JSON.parse(line);
      if (closing) {
        if (message.id !== undefined)
          process.stdout.write(
            `${JSON.stringify({ id: message.id, error: { code: -32000, message: "Agent account reload is in progress" } })}\n`,
          );
        return;
      }
      if (message.id !== undefined && typeof message.method === "string") {
        requests.set(message.id, message.method);
        if (message.method === "turn/start") busy = true;
      }
      if (message.method === "initialized") {
        initialized = true;
        activateProbe = true;
      }
    } catch {
      /* Forward provider protocol lines unchanged. */
    }
    if (!child.stdin.write(`${line}\n`)) {
      input.pause();
      child.stdin.once("drain", () => input.resume());
    }
    if (activateProbe) void probeAccount().catch(() => {});
  });
  child.stdin.on("error", () => {});
  output.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      const probe = probes.get(message.id);
      if (probe) {
        probes.delete(message.id);
        clearTimeout(probe.timer);
        if (message.error)
          probe.reject(new Error("Codex could not report its active account"));
        else probe.resolve(message.result);
        return;
      }
      // Late private responses must never enter Paseo's request stream.
      if (
        typeof message.id === "string" &&
        message.id.startsWith(`paseo-account-watch:${runId}:`)
      )
        return;
      const method = requests.get(message.id);
      requests.delete(message.id);
      if (
        (method === "thread/start" || method === "thread/resume") &&
        typeof message.result?.thread?.id === "string"
      ) {
        record.threadId = message.result.thread.id;
        void persist().catch(() => {});
      }
      if (method === "turn/start" && message.error) busy = false;
      if (message.method === "turn/started") busy = true;
      if (message.method === "turn/completed") busy = false;
    } catch {
      /* Forward provider protocol lines unchanged. */
    }
    if (!process.stdout.write(`${line}\n`)) {
      output.pause();
      process.stdout.once("drain", () => output.resume());
    }
  });
  input.on("close", () => {
    closing = true;
    child.kill("SIGTERM");
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      closing = true;
      child.kill(signal);
    });
  child.on("error", () => {
    process.stderr.write(
      "Codex monitor could not launch the configured command.\n",
    );
  });
  child.on("close", (code) => {
    exited = true;
    resolveClosed();
    input.close();
    for (const probe of probes.values()) {
      clearTimeout(probe.timer);
      probe.reject(new Error("Codex process exited"));
    }
    probes.clear();
    void persistTail
      .catch(() => {})
      .then(() => rm(recordPath, { force: true }))
      .finally(() => {
        server.close();
        process.exitCode = code ?? 0;
        process.stdin.destroy();
      });
  });
  await persist();
}

void main().catch(() => {
  process.stderr.write("Codex account monitor could not start.\n");
  process.exitCode = 1;
});
