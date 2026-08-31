import { connect } from "node:net";
import type { RuntimeRecord } from "./runtime.shared";

export async function control(
  record: RuntimeRecord,
  operation: "account" | "close",
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: record.port });
    let buffer = "";
    let settled = false;
    const finish = (error?: Error, result?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result!);
    };
    socket.setTimeout(6000, () =>
      finish(new Error("Monitored Codex process did not respond")),
    );
    socket.on("error", () =>
      finish(new Error("Monitored Codex process is no longer reachable")),
    );
    socket.on("end", () =>
      finish(new Error("Monitored Codex connection closed before replying")),
    );
    socket.on("connect", () =>
      socket.write(
        `${JSON.stringify({ operation, secret: record.secret, runId: record.runId, agentId: record.agentId, threadId: record.threadId })}\n`,
      ),
    );
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 16384) {
        finish(new Error("Invalid runtime response"));
        return;
      }
      if (!buffer.includes("\n")) return;
      try {
        const result = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
        if (result.ok !== true) {
          finish(
            new Error(
              typeof result.error === "string"
                ? result.error
                : "Runtime request failed",
            ),
          );
          return;
        }
        if (
          result.runId !== record.runId ||
          result.agentId !== record.agentId
        ) {
          finish(new Error("Runtime identity changed"));
          return;
        }
        finish(undefined, result);
      } catch {
        finish(new Error("Invalid runtime response"));
      }
    });
  });
}
