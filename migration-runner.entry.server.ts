import { execFile } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { MigrationTask } from "./migration.shared";

const exec = promisify(execFile);
const taskPath = process.argv[2];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

async function readTask(): Promise<MigrationTask> {
  return JSON.parse(await readFile(taskPath, "utf8")) as MigrationTask;
}

async function save(task: MigrationTask) {
  task.updatedAt = new Date().toISOString();
  const temporary = `${taskPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(task), { mode: 0o600 });
  await rename(temporary, taskPath);
}

async function paseo(args: string[], home: string) {
  const result = await exec("paseo", args, {
    env: { ...env, PASEO_HOME: home },
    timeout: 60000,
    maxBuffer: 512 * 1024,
    windowsHide: true,
  });
  return result.stdout.trim();
}

function outputObject(output: string): Record<string, unknown> {
  const value = JSON.parse(output);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Paseo CLI returned an unexpected result.");
  return value as Record<string, unknown>;
}

async function importAgent(task: MigrationTask) {
  const requestId = `account-migration:${task.id}`;
  const socket = new WebSocket(`ws://${task.host}/ws`);
  return await new Promise<string>((resolve, reject) => {
    let sent = false;
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out while importing the migrated agent."));
    }, 60000);
    const finish = (error: Error | null, agentId?: string) => {
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(agentId!);
    };
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          type: "hello",
          clientId: `account-migration-${task.id}`,
          clientType: "cli",
          protocolVersion: 1,
          capabilities: {},
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      try {
        const envelope = JSON.parse(String(event.data));
        const message = envelope?.type === "session" ? envelope.message : null;
        if (!message || message.type !== "status") return;
        if (!sent && message.payload?.status === "server_info") {
          sent = true;
          socket.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "import_agent_request",
                requestId,
                providerId: task.providerId,
                providerHandleId: task.threadId,
                cwd: task.cwd,
                workspaceId: task.workspaceId,
                labels: task.labels,
              },
            }),
          );
          return;
        }
        if (message.payload?.requestId !== requestId) return;
        if (message.payload.status === "agent_create_failed")
          finish(
            new Error(
              typeof message.payload.error === "string"
                ? message.payload.error
                : "Agent import failed.",
            ),
          );
        else if (message.payload.status === "agent_resumed") {
          const agent = message.payload.agent;
          if (
            !agent ||
            typeof agent.id !== "string" ||
            agent.workspaceId !== task.workspaceId ||
            agent.provider !== task.providerId ||
            agent.runtimeInfo?.sessionId !== task.threadId
          )
            finish(
              new Error("Imported agent did not match the migration task."),
            );
          else finish(null, agent.id);
        }
      } catch {
        finish(new Error("Paseo returned an invalid migration response."));
      }
    });
    socket.addEventListener("error", () =>
      finish(new Error("Could not connect to the restarted Paseo host.")),
    );
  });
}

async function main() {
  await new Promise((resolve) => setTimeout(resolve, 750));
  const task = await readTask();
  try {
    task.state = "restarting";
    await save(task);
    await paseo(
      ["daemon", "restart", "--home", task.home, "--timeout", "15", "--json"],
      task.home,
    );
    task.state = "importing";
    await save(task);
    const agentId = await importAgent(task);
    task.newAgentId = agentId;
    await paseo(
      [
        "agent",
        "update",
        agentId,
        "--name",
        task.title,
        "--host",
        task.host,
        "--json",
      ],
      task.home,
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const inspected = outputObject(
      await paseo(
        ["agent", "inspect", agentId, "--host", task.host, "--json"],
        task.home,
      ),
    );
    const inspectedData =
      inspected.data &&
      typeof inspected.data === "object" &&
      !Array.isArray(inspected.data)
        ? (inspected.data as Record<string, unknown>)
        : inspected;
    if (
      inspectedData.id !== agentId &&
      inspectedData.Id !== agentId &&
      inspectedData.agentId !== agentId
    )
      throw new Error("Imported agent could not be verified after restart.");
    task.state = "completed";
    task.error = null;
    await save(task);
  } catch (error) {
    task.state = "failed";
    task.error =
      error instanceof Error
        ? error.message.replace(/[\r\n]+/g, " ").slice(0, 400)
        : "Account migration failed.";
    await save(task);
    process.exitCode = 1;
  }
}

void main();
