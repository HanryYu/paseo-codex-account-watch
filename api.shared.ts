import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

import { StatusSchema } from "./status.shared";
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
