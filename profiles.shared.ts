import { z } from "zod";

export const ProfileSummarySchema = z.object({
  id: z.string().uuid(),
  providerId: z.string(),
  name: z.string(),
  accountLabel: z.string(),
  authKind: z.enum(["chatgpt", "api-key"]),
  source: z.literal("cc-switch"),
  updatedAt: z.string(),
});
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;

export const ProfileRecordSchema = ProfileSummarySchema.extend({
  version: z.literal(1),
  sourceProviderId: z.string(),
  home: z.string(),
  fingerprint: z.string(),
  createdAt: z.string(),
});
export type ProfileRecord = z.infer<typeof ProfileRecordSchema>;
