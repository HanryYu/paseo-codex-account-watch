import type { PaseoApi } from "@getpaseo/client";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseAuth } from "./auth.server";
import {
  ProfileRecordSchema,
  type ProfileRecord,
  type ProfileSummary,
} from "./profiles.shared";

const MAX_DATABASE_BYTES = 256 * 1024 * 1024;
const MAX_AUTH_BYTES = 1024 * 1024;
const MAX_CONFIG_BYTES = 1024 * 1024;
const PROVIDER_ID = /^[a-z][a-z0-9-]{0,63}$/;

type ProviderRow = {
  id: unknown;
  name: unknown;
  settings_config: unknown;
  category: unknown;
};

function summary(profile: ProfileRecord): ProfileSummary {
  return {
    id: profile.id,
    providerId: profile.providerId,
    name: profile.name,
    accountLabel: profile.accountLabel,
    authKind: profile.authKind,
    source: profile.source,
    updatedAt: profile.updatedAt,
  };
}

function profileId(sourceProviderId: string) {
  const digest = createHash("sha256")
    .update(`cc-switch:${sourceProviderId}`)
    .digest("hex")
    .slice(0, 32);
  const value = `${digest.slice(0, 12)}4${digest.slice(13, 16)}8${digest.slice(17)}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function providerId(sourceProviderId: string) {
  const slug = sourceProviderId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  const suffix = createHash("sha256")
    .update(sourceProviderId)
    .digest("hex")
    .slice(0, 8);
  return `codex-cc-${slug || "account"}-${suffix}`;
}

async function privateDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new Error(
      "Account storage must be a private directory owned by this user.",
    );
  await chmod(directory, 0o700);
}

async function atomic(file: string, contents: string) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, file);
}

async function boundedRegularFile(file: string, maxBytes: number) {
  const requestedInfo = await lstat(file);
  if (requestedInfo.isSymbolicLink())
    throw new Error("CC Switch database symlinks are not accepted.");
  const resolved = await realpath(file);
  const info = await lstat(resolved);
  if (
    !info.isFile() ||
    info.size > maxBytes ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new Error("CC Switch database is not a supported private file.");
  return resolved;
}

function parseRow(row: ProviderRow) {
  if (
    typeof row.id !== "string" ||
    !row.id.trim() ||
    typeof row.name !== "string" ||
    !row.name.trim() ||
    typeof row.settings_config !== "string"
  )
    return null;
  let settings: unknown;
  try {
    settings = JSON.parse(row.settings_config);
  } catch {
    return null;
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    return null;
  const record = settings as Record<string, unknown>;
  const auth = record.auth;
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return null;
  const authContents = JSON.stringify(auth);
  if (Buffer.byteLength(authContents) > MAX_AUTH_BYTES) return null;
  const identity = parseAuth(authContents);
  if (identity.status !== "readable") return null;
  const parsedIdentity = identity.identity;
  if (parsedIdentity.kind !== "chatgpt" && parsedIdentity.kind !== "api-key")
    return null;
  const config = typeof record.config === "string" ? record.config : "";
  if (Buffer.byteLength(config) > MAX_CONFIG_BYTES) return null;
  return {
    sourceProviderId: row.id.trim(),
    name: row.name.trim().slice(0, 128),
    authContents,
    config,
    accountLabel: parsedIdentity.label,
    authKind: parsedIdentity.kind,
    fingerprint: parsedIdentity.fingerprint,
  };
}

export class ProfileStore {
  readonly directory: string;
  private writeTail = Promise.resolve();

  constructor(readonly root: string) {
    this.directory = path.join(root, "profiles");
  }

  async listRecords(): Promise<ProfileRecord[]> {
    try {
      const parsed = JSON.parse(
        await readFile(path.join(this.directory, "profiles.json"), "utf8"),
      );
      return ProfileRecordSchema.array().parse(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("Imported account metadata cannot be read.");
    }
  }

  async list(): Promise<ProfileSummary[]> {
    return (await this.listRecords()).map(summary);
  }

  async importCcSwitch(paseo: Pick<PaseoApi, "config">, databasePath?: string) {
    let result!: {
      imported: number;
      updated: number;
      skipped: number;
      profiles: ProfileSummary[];
    };
    const operation = this.writeTail.then(async () => {
      const requested = databasePath?.trim();
      const candidate = requested
        ? path.resolve(requested)
        : path.join(os.homedir(), ".cc-switch", "cc-switch.db");
      const databaseFile = await boundedRegularFile(
        candidate.endsWith(".db")
          ? candidate
          : path.join(candidate, "cc-switch.db"),
        MAX_DATABASE_BYTES,
      );
      const database = new DatabaseSync(databaseFile, { readOnly: true });
      let rows: ProviderRow[];
      try {
        const columns = database
          .prepare("PRAGMA table_info(providers)")
          .all()
          .map((row) => String((row as { name?: unknown }).name ?? ""));
        for (const required of [
          "id",
          "name",
          "settings_config",
          "category",
          "app_type",
        ])
          if (!columns.includes(required))
            throw new Error(
              "CC Switch providers table has an unsupported schema.",
            );
        rows = database
          .prepare(
            "SELECT id, name, settings_config, category FROM providers WHERE app_type = ? ORDER BY COALESCE(sort_index, 999999), created_at, id LIMIT 101",
          )
          .all("codex") as ProviderRow[];
      } finally {
        database.close();
      }
      if (rows.length > 100)
        throw new Error(
          "CC Switch contains too many Codex providers to import safely.",
        );
      const candidates = rows.map(parseRow).filter((row) => row !== null);
      const existing = await this.listRecords();
      const bySource = new Map(
        existing.map((item) => [item.sourceProviderId, item]),
      );
      const { config } = await paseo.config.get();
      const providerPatch: Record<
        string,
        {
          extends: string;
          label: string;
          description: string;
          env: Record<string, string>;
        }
      > = {};
      const now = new Date().toISOString();
      const next = [...existing];
      await privateDirectory(this.directory);
      let imported = 0;
      let updated = 0;
      for (const candidate of candidates) {
        const prior = bySource.get(candidate.sourceProviderId);
        const id = prior?.id ?? profileId(candidate.sourceProviderId);
        const paseoProviderId =
          prior?.providerId ?? providerId(candidate.sourceProviderId);
        if (!PROVIDER_ID.test(paseoProviderId))
          throw new Error("An imported Paseo provider ID is invalid.");
        if (!prior && config.providers[paseoProviderId])
          throw new Error(`Paseo provider ${paseoProviderId} already exists.`);
        const home = prior?.home ?? path.join(this.directory, id, "home");
        await privateDirectory(home);
        await atomic(
          path.join(home, "auth.json"),
          `${candidate.authContents}\n`,
        );
        if (candidate.config.trim())
          await atomic(path.join(home, "config.toml"), candidate.config);
        await atomic(path.join(home, ".paseo-account-profile"), `${id}\n`);
        const profile: ProfileRecord = {
          version: 1,
          id,
          providerId: paseoProviderId,
          name: candidate.name,
          accountLabel: candidate.accountLabel,
          authKind: candidate.authKind,
          source: "cc-switch",
          sourceProviderId: candidate.sourceProviderId,
          home,
          fingerprint: candidate.fingerprint,
          createdAt: prior?.createdAt ?? now,
          updatedAt: now,
        };
        providerPatch[paseoProviderId] = {
          extends: "codex",
          label: `Codex · ${candidate.name}`,
          description: `Isolated account imported from CC Switch (${candidate.accountLabel})`,
          env: { CODEX_HOME: home },
        };
        const index = next.findIndex(
          (item) => item.sourceProviderId === profile.sourceProviderId,
        );
        if (index === -1) {
          next.push(profile);
          imported++;
        } else {
          next[index] = profile;
          updated++;
        }
      }
      if (Object.keys(providerPatch).length)
        await paseo.config.patch({ providers: providerPatch });
      await atomic(
        path.join(this.directory, "profiles.json"),
        JSON.stringify(next),
      );
      result = {
        imported,
        updated,
        skipped: rows.length - candidates.length,
        profiles: next.map(summary),
      };
    });
    this.writeTail = operation.catch(() => {});
    await operation;
    return result;
  }
}
