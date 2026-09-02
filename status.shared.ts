import { z } from "zod";
import { ProfileSummarySchema } from "./profiles.shared";
import { MigrationSummarySchema } from "./migration.shared";

export const SessionSchema = z.object({
  agentId: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  runId: z.string(),
  threadId: z.string().nullable(),
  currentAccountLabel: z.string().nullable(),
  currentProfileId: z.string().uuid().nullable(),
  previousLabel: z.string(),
  nextLabel: z.string(),
  fingerprint: z.string(),
  changed: z.boolean(),
  busy: z.boolean(),
  verification: z.enum(["email", "unavailable", "mismatch"]),
  problem: z.string().nullable(),
});
export type AccountSession = z.infer<typeof SessionSchema>;
export const UnmonitoredAgentSchema = z.object({
  agentId: z.string(),
  workspaceId: z.string(),
  title: z.string(),
});
export const StatusSchema = z.object({
  enabled: z.boolean(),
  commandOwned: z.boolean(),
  sessions: z.array(SessionSchema),
  unmonitoredCount: z.number(),
  unmonitoredAgents: z.array(UnmonitoredAgentSchema),
  note: z.string().nullable(),
  profiles: z.array(ProfileSummarySchema),
  migrations: z.array(MigrationSummarySchema),
});
export type WatchStatus = z.infer<typeof StatusSchema>;
