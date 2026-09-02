import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

import { StatusSchema } from "./status.shared";
import {
  PluginSettingsPatchSchema,
  PluginSettingsSchema,
} from "./settings.shared";
export type { AccountSession, WatchStatus } from "./status.shared";

export const statusRpc = defineRpc({
  name: "accounts.status",
  input: z.object({}),
  output: StatusSchema,
});
export const setupRpc = defineRpc({
  name: "accounts.setup",
  input: z.object({
    action: z.enum(["enable", "restore"]),
    confirmed: z.literal(true),
  }),
  output: z.object({ message: z.string() }),
});
export const reloadRpc = defineRpc({
  name: "accounts.reload",
  input: z.object({
    agentId: z.string().min(1),
    runId: z.string().uuid(),
    fingerprint: z.string().min(1),
    confirmed: z.literal(true),
  }),
  output: z.object({
    agentId: z.string(),
    threadId: z.string(),
    label: z.string(),
    verification: z.enum(["email", "unavailable", "mismatch"]),
  }),
});
export const importProfilesRpc = defineRpc({
  name: "accounts.profiles.import-cc-switch",
  input: z.object({
    confirmed: z.literal(true),
    databasePath: z.string().min(1).optional(),
  }),
  output: z.object({
    imported: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    profiles: StatusSchema.shape.profiles,
  }),
});
export const renameProfileRpc = defineRpc({
  name: "accounts.profiles.rename",
  input: z.object({
    profileId: z.string().uuid(),
    name: z.string().trim().min(1).max(64),
  }),
  output: StatusSchema.shape.profiles.element,
});
export const updateSettingsRpc = defineRpc({
  name: "accounts.settings.update",
  input: PluginSettingsPatchSchema,
  output: PluginSettingsSchema,
});
export const migrateProfileRpc = defineRpc({
  name: "accounts.profiles.migrate-agent",
  input: z.object({
    agentId: z.string().min(1),
    runId: z.string().uuid(),
    profileId: z.string().uuid(),
    confirmedRestart: z.literal(true),
  }),
  output: StatusSchema.shape.migrations.element,
});
