import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import runnerSource from "./migration-runner-source.server.json";
import {
  MigrationSummarySchema,
  MigrationTaskSchema,
  type MigrationSummary,
  type MigrationTask,
} from "./migration.shared";

const MAX_SESSION_ENTRIES = 50000;
const MAX_SESSION_DEPTH = 8;

async function privateDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new Error("Migration storage must be owned by this user.");
}

async function sessionFiles(root: string, threadId: string) {
  const matches: string[] = [];
  let visited = 0;
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > MAX_SESSION_DEPTH) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (++visited > MAX_SESSION_ENTRIES)
        throw new Error("Codex session storage is too large to scan safely.");
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(candidate, depth + 1);
      else if (
        entry.isFile() &&
        entry.name.endsWith(".jsonl") &&
        entry.name.includes(threadId)
      )
        matches.push(candidate);
    }
  }
  await walk(root, 0);
  return matches;
}

export async function bridgeThread(
  sourceHome: string,
  targetHome: string,
  threadId: string,
) {
  const sourceRoot = path.join(sourceHome, "sessions");
  const targetRoot = path.join(targetHome, "sessions");
  const files = await sessionFiles(sourceRoot, threadId);
  if (!files.length)
    throw new Error(
      "The Codex session rollout was not found. The host was not restarted.",
    );
  let linked = 0;
  for (const source of files) {
    const relative = path.relative(sourceRoot, source);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Codex session path escaped its source home.");
    const target = path.join(targetRoot, relative);
    await privateDirectory(path.dirname(target));
    try {
      const existing = await lstat(target);
      if (!existing.isFile() || existing.isSymbolicLink())
        throw new Error("Target Codex session path is not a regular file.");
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await link(source, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await copyFile(source, target);
    }
    linked++;
  }
  return linked;
}

export class MigrationCoordinator {
  readonly directory: string;
  constructor(
    readonly root: string,
    readonly home: string,
  ) {
    this.directory = path.join(root, "migrations");
  }

  async list(): Promise<MigrationSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("Migration status cannot be read.");
    }
    const tasks: MigrationSummary[] = [];
    for (const name of names.filter((item) =>
      /^[a-f0-9-]{36}\.json$/.test(item),
    )) {
      try {
        const task = MigrationTaskSchema.parse(
          JSON.parse(await readFile(path.join(this.directory, name), "utf8")),
        );
        tasks.push(MigrationSummarySchema.parse(task));
      } catch {
        // Ignore interrupted temporary or corrupt records; no migration is started from them.
      }
    }
    return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async completedFor(input: {
    sourceAgentId: string;
    profileId: string;
    threadId?: string;
  }): Promise<MigrationSummary | null> {
    return (
      (await this.list()).find(
        (task) =>
          task.state === "completed" &&
          Boolean(task.newAgentId) &&
          task.sourceAgentId === input.sourceAgentId &&
          (input.threadId === undefined || task.threadId === input.threadId) &&
          task.profileId === input.profileId,
      ) ?? null
    );
  }

  async schedule(
    nodeExecutable: string,
    input: Omit<
      MigrationTask,
      | "version"
      | "id"
      | "state"
      | "newAgentId"
      | "home"
      | "createdAt"
      | "updatedAt"
      | "error"
    >,
  ) {
    const active = (await this.list()).find(
      (task) =>
        task.state === "scheduled" ||
        task.state === "restarting" ||
        task.state === "importing",
    );
    if (active)
      throw new Error("Another account migration is already in progress.");
    await privateDirectory(this.directory);
    const digest = createHash("sha256")
      .update(runnerSource)
      .digest("hex")
      .slice(0, 16);
    const runner = path.join(this.root, `account-migration-${digest}.cjs`);
    await writeFilePrivate(runner, runnerSource);
    const now = new Date().toISOString();
    const task: MigrationTask = {
      version: 1,
      id: randomUUID(),
      state: "scheduled",
      newAgentId: null,
      home: this.home,
      createdAt: now,
      updatedAt: now,
      error: null,
      ...input,
    };
    const taskPath = path.join(this.directory, `${task.id}.json`);
    await writeFilePrivate(taskPath, JSON.stringify(task));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PASEO_HOME: this.home,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(nodeExecutable, [runner, taskPath], {
      detached: true,
      stdio: "ignore",
      env,
    });
    child.unref();
    if (!child.pid)
      throw new Error("The migration runner could not be started.");
    return MigrationSummarySchema.parse(task);
  }
}

async function writeFilePrivate(file: string, contents: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, file);
}
