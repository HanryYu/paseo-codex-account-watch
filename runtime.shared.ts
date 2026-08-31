import { z } from "zod";

export const IdentitySchema = z.object({
  kind: z.enum(["chatgpt", "api-key", "signed-out"]),
  fingerprint: z.string(),
  email: z.string().nullable(),
  label: z.string(),
});
export const RuntimeAccountSchema = z.object({
  kind: z.enum(["chatgpt", "api-key", "signed-out", "other"]),
  email: z.string().nullable(),
  label: z.string(),
});
export type RuntimeAccount = z.infer<typeof RuntimeAccountSchema>;

export const RuntimeRecordSchema = z.object({
  version: z.literal(1),
  runId: z.string().uuid(),
  agentId: z.string().min(1),
  threadId: z.string().nullable(),
  authPath: z.string(),
  startedAt: z.string(),
  launchIdentity: IdentitySchema.nullable(),
  account: RuntimeAccountSchema.nullable(),
  port: z.number().int().min(1).max(65535),
  secret: z.string().length(64),
});
export type RuntimeRecord = z.infer<typeof RuntimeRecordSchema>;
