import type { PaseoApi, PaseoAgent } from "@getpaseo/client";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  rename,
  rm,
  lstat,
  chmod,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import bridgeSource from "./bridge-source.server.json";
import { ProfileStore } from "./profiles.server";
import { bridgeThread, MigrationCoordinator } from "./migration.server";
import { SettingsStore } from "./settings.server";
import { control } from "./control.server";
import { readAuth, SettledAccount, type AccountIdentity } from "./auth.server";
import {
  RuntimeRecordSchema,
  RuntimeAccountSchema,
  type RuntimeRecord,
} from "./runtime.shared";
import type { AccountSession, WatchStatus } from "./api.shared";

const exec = promisify(execFile);
const BackupSchema = z.object({
  version: z.literal(1),
  previousCommand: z.array(z.string()).min(1),
  installedCommand: z.array(z.string()).min(1),
});
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const safeMessage = (message: string) => new Error(message);
const STATUS_CACHE_MS = 5000;

export function localReloadEndpoint(target: unknown): string {
  if (typeof target !== "string")
    throw safeMessage(
      "Cannot resolve this daemon's local endpoint; no process was stopped.",
    );
  if (target.startsWith("/") || target.startsWith("unix://")) return target;
  const match =
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\]):(\d+)$/.exec(target);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535)
    throw safeMessage(
      "A local daemon endpoint is required; remote fallback is disabled.",
    );
  const hostname =
    match[1] === "0.0.0.0"
      ? "127.0.0.1"
      : match[1] === "[::]"
        ? "[::1]"
        : match[1];
  return `${hostname}:${match[2]}`;
}

export interface ProcessPort {
  command(executable: string, args: string[], home: string): Promise<string>;
}
const processPort: ProcessPort = {
  async command(executable, args, home) {
    const env: NodeJS.ProcessEnv = { ...process.env, PASEO_HOME: home };
    delete env.ELECTRON_RUN_AS_NODE;
    try {
      const { stdout } = await exec(executable, args, {
        env,
        timeout: 20000,
        maxBuffer: 512 * 1024,
        windowsHide: true,
      });
      return stdout.trim();
    } catch (error) {
      // Provider stderr can contain credentials. It is deliberately not returned to the client.
      throw safeMessage(
        executable === "node"
          ? "Node.js 22 or newer must be installed on this host."
          : `Paseo CLI ${args[0] === "daemon" ? "host verification" : "agent reload"} failed (${String((error as NodeJS.ErrnoException).code ?? "unknown")}). Check the daemon logs; the plugin did not claim success.`,
      );
    }
  },
};

export class AccountService {
  readonly root: string;
  private readonly settled = new Map<string, SettledAccount>();
  private readonly latest = new Map<string, AccountIdentity>();
  private loop: ReturnType<typeof setInterval> | null = null;
  private sampling = false;
  private stopped = false;
  private writeTail = Promise.resolve();
  private reloads = new Set<string>();
  private closedForReload = new Map<string, RuntimeRecord>();
  private statusCache: { value: WatchStatus; expiresAt: number } | null = null;
  private statusRequest: Promise<WatchStatus> | null = null;
  readonly profiles: ProfileStore;
  readonly migrations: MigrationCoordinator;
  readonly settings: SettingsStore;

  constructor(
    readonly home: string,
    private readonly processes: ProcessPort = processPort,
  ) {
    this.root = path.join(home, "plugin-data", "codex-account-watch");
    this.profiles = new ProfileStore(this.root);
    this.migrations = new MigrationCoordinator(this.root, this.home);
    this.settings = new SettingsStore(this.root);
  }

  start() {
    if (this.loop || this.stopped) return;
    this.loop = setInterval(() => {
      void this.sample();
    }, 1000);
    this.loop.unref();
    void this.sample();
  }
  close() {
    this.stopped = true;
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  private invalidateStatus() {
    this.statusCache = null;
  }

  private async records(): Promise<RuntimeRecord[]> {
    const directory = path.join(this.root, "runs");
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw safeMessage("Cannot read this host's account-monitor state.");
    }
    const records: RuntimeRecord[] = [];
    for (const name of names) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      try {
        records.push(
          RuntimeRecordSchema.parse(
            JSON.parse(await readFile(path.join(directory, name), "utf8")),
          ),
        );
      } catch {
        /* A process may exit between listing and reading. */
      }
    }
    return records;
  }
  private async sample() {
    if (this.sampling || this.stopped) return;
    this.sampling = true;
    try {
      const paths = new Set(
        (await this.records()).map((item) => item.authPath),
      );
      let statusChanged = paths.size !== this.settled.size;
      for (const file of paths) {
        const existing = this.settled.get(file);
        if (!existing) statusChanged = true;
        const state = existing ?? new SettledAccount();
        this.settled.set(file, state);
        const changed = state.accept(await readAuth(file));
        if (changed) {
          this.latest.set(file, changed);
          statusChanged = true;
        }
      }
      for (const file of this.settled.keys())
        if (!paths.has(file)) {
          this.settled.delete(file);
          this.latest.delete(file);
          statusChanged = true;
        }
      if (statusChanged) this.invalidateStatus();
    } catch {
      /* Status RPC reports inaccessible state; polling never logs account data. */
    } finally {
      this.sampling = false;
    }
  }
  private async backup() {
    try {
      return BackupSchema.parse(
        JSON.parse(await readFile(path.join(this.root, "setup.json"), "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw safeMessage(
        "Saved launch configuration cannot be read. It has not been overwritten.",
      );
    }
  }
  private async atomic(file: string, data: string) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, file);
  }

  async setup(
    paseo: Pick<PaseoApi, "config">,
    action: "enable" | "restore",
  ): Promise<{ message: string }> {
    let result!: { message: string };
    const operation = this.writeTail.then(async () => {
      if (this.reloads.size)
        throw safeMessage(
          "Wait for the current agent reload before changing launch configuration.",
        );
      const { config } = await paseo.config.get();
      const current = config.providers.codex?.command;
      const backup = await this.backup();
      if (action === "restore") {
        if (!backup)
          throw safeMessage("No monitored launch configuration is installed.");
        if (!same(current, backup.installedCommand))
          throw safeMessage(
            "The Codex command was changed outside this plugin. Restore was refused to preserve that change.",
          );
        await paseo.config.patch({
          providers: { codex: { command: backup.previousCommand } },
        });
        await rm(path.join(this.root, "setup.json"));
        result = {
          message:
            "Original Codex command restored for future launches. Existing sessions were not interrupted.",
        };
        return;
      }
      if (backup && same(current, backup.installedCommand)) {
        result = { message: "Monitored launches are already enabled." };
        return;
      }
      if (backup && !same(current ?? ["codex"], backup.previousCommand))
        throw safeMessage(
          "The Codex command changed outside this plugin. Resolve the saved setup before enabling again.",
        );
      const previousCommand = z
        .array(z.string().min(1))
        .min(1)
        .parse(current ?? ["codex"]);
      if (
        previousCommand.some((arg) =>
          /api[_-]?key|token|password|secret/i.test(arg),
        )
      )
        throw safeMessage(
          "Commands containing credential arguments are not supported. Keep secrets in provider environment configuration instead.",
        );
      if (
        previousCommand.some((arg) =>
          /^codex-account-watch-[a-f0-9]{16}\.cjs$/.test(path.basename(arg)),
        )
      )
        throw safeMessage(
          "A Codex monitor wrapper is already configured. Nested wrappers are not supported.",
        );
      if (process.platform === "win32")
        throw safeMessage(
          "Automatic setup currently supports macOS and Linux hosts only.",
        );
      const nodeInfo = JSON.parse(
        await this.processes.command(
          "node",
          [
            "-p",
            "JSON.stringify({executable:process.execPath,major:Number(process.versions.node.split('.')[0])})",
          ],
          this.home,
        ),
      );
      if (
        typeof nodeInfo.executable !== "string" ||
        !path.isAbsolute(nodeInfo.executable) ||
        nodeInfo.major < 22
      )
        throw safeMessage(
          "Node.js 22 or newer must be installed on this host.",
        );
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const rootInfo = await lstat(this.root);
      if (
        !rootInfo.isDirectory() ||
        rootInfo.isSymbolicLink() ||
        (process.getuid && rootInfo.uid !== process.getuid())
      )
        throw safeMessage(
          "Plugin state must be a private directory owned by this user.",
        );
      await chmod(this.root, 0o700);
      const digest = createHash("sha256")
        .update(bridgeSource)
        .digest("hex")
        .slice(0, 16);
      const script = path.join(this.root, `codex-account-watch-${digest}.cjs`);
      await this.atomic(script, bridgeSource);
      const installedCommand = [
        nodeInfo.executable,
        script,
        this.root,
        JSON.stringify(previousCommand),
      ];
      await this.atomic(
        path.join(this.root, "setup.json"),
        JSON.stringify({ version: 1, previousCommand, installedCommand }),
      );
      await paseo.config.patch({
        providers: { codex: { command: installedCommand } },
      });
      result = {
        message:
          "Monitored Codex launches enabled. Existing sessions stay unchanged; create or reload a session to enroll it.",
      };
    });
    this.writeTail = operation.catch(() => {});
    await operation;
    this.invalidateStatus();
    return result;
  }

  private async agents(paseo: PaseoApi): Promise<PaseoAgent[]> {
    const agents: PaseoAgent[] = [];
    let cursor: string | undefined;
    do {
      const result = await paseo.agents.list({
        filter: { includeArchived: false },
        page: { limit: 100, ...(cursor ? { cursor } : {}) },
      });
      agents.push(...result.entries.map((entry) => entry.agent));
      cursor = result.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    const profileProviders = new Set(
      (await this.profiles.listRecords()).map((profile) => profile.providerId),
    );
    return agents.filter(
      (agent) =>
        agent.provider === "codex" || profileProviders.has(agent.provider),
    );
  }

  async status(paseo: PaseoApi): Promise<WatchStatus> {
    this.start();
    if (this.statusCache && this.statusCache.expiresAt > Date.now())
      return this.statusCache.value;
    if (this.statusRequest) return this.statusRequest;
    const request = this.computeStatus(paseo);
    this.statusRequest = request;
    try {
      const value = await request;
      this.statusCache = { value, expiresAt: Date.now() + STATUS_CACHE_MS };
      return value;
    } finally {
      if (this.statusRequest === request) this.statusRequest = null;
    }
  }

  private async computeStatus(paseo: PaseoApi): Promise<WatchStatus> {
    const [{ config }, backup, records, agents] = await Promise.all([
      paseo.config.get(),
      this.backup(),
      this.records(),
      this.agents(paseo),
    ]);
    const sessions: AccountSession[] = [];
    const profileRecords = await this.profiles.listRecords();
    const commandOwned = Boolean(
      backup && same(config.providers.codex?.command, backup.installedCommand),
    );
    for (const agent of agents) {
      const owned = records.filter((record) => record.agentId === agent.id);
      if (owned.length !== 1) continue;
      const record = owned[0];
      try {
        const runtime = await control(record, "account");
        const actual = RuntimeAccountSchema.nullable().parse(runtime.account);
        const next = this.latest.get(record.authPath);
        const sample = await readAuth(record.authPath);
        const readable =
          sample.status === "readable" &&
          next?.fingerprint === sample.identity.fingerprint;
        const previous = record.launchIdentity;
        const match =
          previous?.email &&
          actual?.email &&
          previous.email.toLowerCase() === actual.email.toLowerCase();
        sessions.push({
          agentId: agent.id,
          workspaceId: agent.workspaceId ?? "",
          title: agent.title ?? agent.id,
          runId: record.runId,
          threadId: record.threadId,
          currentAccountLabel: actual?.label ?? null,
          currentProfileId:
            profileRecords.find(
              (profile) => profile.home === path.dirname(record.authPath),
            )?.id ?? null,
          previousLabel: actual?.label ?? "Runtime account unavailable",
          nextLabel: readable ? next!.label : "Waiting for stable credentials",
          fingerprint: readable ? next!.fingerprint : "",
          changed: Boolean(
            readable &&
            previous &&
            previous.kind !== "signed-out" &&
            previous.fingerprint !== next!.fingerprint,
          ),
          busy:
            runtime.busy === true ||
            agent.status === "running" ||
            agent.status === "initializing" ||
            this.reloads.has(agent.id),
          verification: match
            ? "email"
            : actual?.email && previous?.email
              ? "mismatch"
              : "unavailable",
          problem: !commandOwned
            ? "Monitored launches are disabled or the launch command changed. Reload was disabled to preserve the current process."
            : readable && next?.kind === "signed-out"
              ? "Sign in to Codex on this host before reloading."
              : sample.status === "unavailable"
                ? sample.reason
                : actual === null
                  ? "Codex account/read did not report an account."
                  : null,
        });
      } catch {
        /* Dead or disconnected wrappers are not represented as verified sessions. */
      }
    }
    const monitoredAgentIds = new Set(
      sessions.map((session) => session.agentId),
    );
    const unmonitoredAgents = agents
      .filter(
        (agent) =>
          !monitoredAgentIds.has(agent.id) && Boolean(agent.workspaceId),
      )
      .map((agent) => ({
        agentId: agent.id,
        workspaceId: agent.workspaceId!,
        title: agent.title ?? agent.id,
      }));
    return {
      enabled: Boolean(backup),
      commandOwned,
      sessions,
      unmonitoredCount: agents.length - sessions.length,
      unmonitoredAgents,
      note:
        backup &&
        !same(config.providers.codex?.command, backup.installedCommand)
          ? "Codex launch configuration changed outside this plugin. It will not be overwritten."
          : null,
      profiles: await this.profiles.list(),
      migrations: await this.migrations.list(),
      settings: await this.settings.read(),
    };
  }

  async importProfiles(paseo: PaseoApi, databasePath?: string) {
    const result = await this.profiles.importCcSwitch(paseo, databasePath);
    this.invalidateStatus();
    return result;
  }

  async renameProfile(paseo: PaseoApi, profileId: string, name: string) {
    const result = await this.profiles.rename(paseo, profileId, name);
    this.invalidateStatus();
    return result;
  }

  async updateSettings(input: Parameters<SettingsStore["update"]>[0]) {
    const result = await this.settings.update(input);
    this.invalidateStatus();
    return result;
  }

  private async reloadTarget(): Promise<string> {
    const pid = JSON.parse(
      await readFile(path.join(this.home, "paseo.pid"), "utf8"),
    );
    const target = typeof pid.listen === "string" ? pid.listen : pid.sockPath;
    return localReloadEndpoint(target);
  }

  private async requireOwnedCommand(paseo: PaseoApi) {
    const [{ config }, backup] = await Promise.all([
      paseo.config.get(),
      this.backup(),
    ]);
    if (
      !backup ||
      !same(config.providers.codex?.command, backup.installedCommand)
    )
      throw safeMessage(
        "Monitored launches are disabled or the launch command changed outside this plugin. No process was stopped.",
      );
  }

  async reload(
    paseo: PaseoApi,
    input: { agentId: string; runId: string; fingerprint: string },
  ) {
    if (this.reloads.has(input.agentId))
      throw safeMessage("This agent is already reloading.");
    this.reloads.add(input.agentId);
    try {
      await this.writeTail;
      await this.requireOwnedCommand(paseo);
      const handle = paseo.agents.ref(input.agentId);
      await handle.refresh();
      const agent = handle.current();
      const profileProviders = new Set(
        (await this.profiles.listRecords()).map(
          (profile) => profile.providerId,
        ),
      );
      if (
        !agent ||
        (agent.provider !== "codex" && !profileProviders.has(agent.provider)) ||
        agent.archivedAt
      )
        throw safeMessage("An active Codex agent is required.");
      if (agent.status === "running" || agent.status === "initializing")
        throw safeMessage("Wait for the agent to finish before reloading.");
      const records = (await this.records()).filter(
        (record) => record.agentId === input.agentId,
      );
      const retryRecord = this.closedForReload.get(input.agentId);
      const retry = records.length === 0 && retryRecord?.runId === input.runId;
      if (!retry && (records.length !== 1 || records[0].runId !== input.runId))
        throw safeMessage(
          "The monitored session changed. Review the current account before reloading.",
        );
      const record = retry ? retryRecord! : records[0];
      const threadId = record.threadId;
      if (!threadId || agent.runtimeInfo?.sessionId !== threadId)
        throw safeMessage(
          "The agent's Codex thread could not be matched safely.",
        );
      const sample = await readAuth(record.authPath);
      if (
        sample.status !== "readable" ||
        sample.identity.fingerprint !== input.fingerprint ||
        sample.identity.kind === "signed-out"
      )
        throw safeMessage(
          "Credentials changed or are unavailable. Review the new account before retrying.",
        );
      const host = await this.reloadTarget();
      if (!/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host))
        throw safeMessage(
          "Account migration currently requires this host to use a loopback TCP listener.",
        );
      const expectedServerId = (
        await readFile(path.join(this.home, "server-id"), "utf8")
      ).trim();
      const daemonStatus = JSON.parse(
        await this.processes.command(
          "paseo",
          ["daemon", "status", "--home", this.home, "--json"],
          this.home,
        ),
      );
      if (daemonStatus.serverId !== expectedServerId)
        throw safeMessage(
          "Paseo CLI resolved a different host. No process was stopped.",
        );
      const finalSample = await readAuth(record.authPath);
      if (
        finalSample.status !== "readable" ||
        finalSample.identity.fingerprint !== input.fingerprint
      )
        throw safeMessage(
          "Credentials changed while preparing reload. No process was stopped.",
        );
      if (!retry) {
        await this.requireOwnedCommand(paseo);
        await control(record, "close");
        this.closedForReload.set(input.agentId, record);
      }
      await this.processes.command(
        "paseo",
        ["agent", "reload", input.agentId, "--host", host, "--json"],
        this.home,
      );
      await handle.refresh();
      if (handle.runtimeInfo?.sessionId !== threadId)
        throw safeMessage(
          "The reloaded agent did not report the original thread. Account verification was not accepted.",
        );
      const replacement = (await this.records()).filter(
        (item) =>
          item.agentId === input.agentId &&
          item.runId !== record.runId &&
          item.threadId === threadId,
      );
      if (replacement.length !== 1)
        throw safeMessage(
          "Agent reloaded, but its new monitored process could not be identified.",
        );
      const current = replacement[0];
      const result = await control(current, "account");
      const actual = RuntimeAccountSchema.nullable().parse(result.account);
      const after = await readAuth(record.authPath);
      const stable =
        after.status === "readable" &&
        after.identity.fingerprint === input.fingerprint &&
        current.launchIdentity?.fingerprint === input.fingerprint;
      const expectedEmail = sample.identity.email?.toLowerCase();
      const actualEmail = actual?.email?.toLowerCase();
      const verification =
        stable && expectedEmail && actualEmail
          ? expectedEmail === actualEmail
            ? "email"
            : "mismatch"
          : "unavailable";
      this.closedForReload.delete(input.agentId);
      return {
        agentId: input.agentId,
        threadId,
        label: actual?.label ?? "Unknown account",
        verification,
      } as const;
    } finally {
      this.reloads.delete(input.agentId);
      this.invalidateStatus();
    }
  }

  async migrateProfile(
    paseo: PaseoApi,
    input: { agentId: string; runId: string; profileId: string },
  ) {
    if (this.reloads.has(input.agentId))
      throw safeMessage("This agent is already changing accounts.");
    this.reloads.add(input.agentId);
    try {
      await this.writeTail;
      await this.requireOwnedCommand(paseo);
      const completed = await this.migrations.completedFor({
        sourceAgentId: input.agentId,
        profileId: input.profileId,
      });
      if (completed?.newAgentId) {
        const switchedHandle = paseo.agents.ref(completed.newAgentId);
        const switched = await switchedHandle.refresh();
        if (switched?.agent) {
          if (
            switched.agent.archivedAt ||
            switched.agent.status === "closed" ||
            switched.agent.status === "error"
          ) {
            const host = await this.reloadTarget();
            await this.processes.command(
              "paseo",
              [
                "agent",
                "reload",
                completed.newAgentId,
                "--host",
                host,
                "--json",
              ],
              this.home,
            );
          }
          return completed;
        }
      }
      const handle = paseo.agents.ref(input.agentId);
      await handle.refresh();
      const agent = handle.current();
      if (!agent || agent.archivedAt)
        throw safeMessage("An active Codex agent is required.");
      if (agent.status === "running" || agent.status === "initializing")
        throw safeMessage(
          "Wait for the agent to finish before changing accounts.",
        );
      if (!agent.workspaceId || !agent.cwd)
        throw safeMessage(
          "The agent must belong to a workspace with a working directory.",
        );
      const profile = (await this.profiles.listRecords()).find(
        (item) => item.id === input.profileId,
      );
      if (!profile)
        throw safeMessage("The selected imported account no longer exists.");
      const records = (await this.records()).filter(
        (record) => record.agentId === input.agentId,
      );
      if (records.length !== 1 || records[0].runId !== input.runId)
        throw safeMessage(
          "The monitored session changed. Review it before retrying.",
        );
      const record = records[0];
      const threadId = record.threadId;
      if (!threadId || agent.runtimeInfo?.sessionId !== threadId)
        throw safeMessage(
          "The agent's Codex thread could not be matched safely.",
        );
      if (path.dirname(record.authPath) === profile.home)
        throw safeMessage("This agent already uses the selected account.");
      const targetAuth = await readAuth(path.join(profile.home, "auth.json"));
      if (
        targetAuth.status !== "readable" ||
        targetAuth.identity.fingerprint !== profile.fingerprint
      )
        throw safeMessage(
          "The selected account credentials changed. Re-import CC Switch first.",
        );
      await bridgeThread(path.dirname(record.authPath), profile.home, threadId);
      const host = await this.reloadTarget();
      const backup = await this.backup();
      const nodeExecutable = backup?.installedCommand[0];
      if (!nodeExecutable || !path.isAbsolute(nodeExecutable))
        throw safeMessage(
          "The monitored Node.js launcher could not be resolved.",
        );
      const labels = Object.fromEntries(
        Object.entries(agent.labels ?? {})
          .filter(
            ([key, value]) =>
              key.length > 0 && key.length <= 128 && value.length <= 512,
          )
          .slice(0, 20),
      );
      const migrationInput = {
        sourceAgentId: agent.id,
        workspaceId: agent.workspaceId,
        threadId,
        cwd: agent.cwd,
        title: agent.title ?? profile.name,
        profileId: profile.id,
        providerId: profile.providerId,
        host,
        labels,
      };
      await handle.archive();
      try {
        return await this.migrations.schedule(nodeExecutable, migrationInput);
      } catch (error) {
        await this.processes
          .command(
            "paseo",
            ["agent", "reload", agent.id, "--host", host, "--json"],
            this.home,
          )
          .catch(() => {});
        throw error;
      }
    } finally {
      this.reloads.delete(input.agentId);
      this.invalidateStatus();
    }
  }
}

let service: AccountService | undefined;
export function getService() {
  service ??= new AccountService(
    path.resolve(process.env.PASEO_HOME || path.join(os.homedir(), ".paseo")),
  );
  return service;
}
export function closeService() {
  service?.close();
  service = undefined;
}
