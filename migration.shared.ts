import { z } from "zod";

export const MigrationTaskSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  state: z.enum([
    "scheduled",
    "restarting",
    "importing",
    "completed",
    "failed",
  ]),
  sourceAgentId: z.string(),
  newAgentId: z.string().nullable(),
  workspaceId: z.string(),
  threadId: z.string(),
  cwd: z.string(),
  title: z.string(),
  profileId: z.string().uuid(),
  providerId: z.string(),
  home: z.string(),
  host: z.string(),
  labels: z.record(z.string(), z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().nullable(),
});
export type MigrationTask = z.infer<typeof MigrationTaskSchema>;

export const MigrationSummarySchema = MigrationTaskSchema.pick({
  id: true,
  state: true,
  sourceAgentId: true,
  newAgentId: true,
  workspaceId: true,
  threadId: true,
  title: true,
  profileId: true,
  providerId: true,
  updatedAt: true,
  error: true,
});
export type MigrationSummary = z.infer<typeof MigrationSummarySchema>;
