import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

export interface AccountIdentity {
  fingerprint: string;
  label: string;
  email: string | null;
  kind: "chatgpt" | "api-key" | "signed-out";
}

export type AuthObservation =
  | { status: "readable"; identity: AccountIdentity }
  | { status: "unavailable"; reason: string };

const unavailable = (reason: string): AuthObservation => ({
  status: "unavailable",
  reason,
});
const MAX_AUTH_BYTES = 1024 * 1024;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function claims(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return record(
      JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")),
    );
  } catch {
    return null;
  }
}

export function parseAuth(contents: string): AuthObservation {
  let auth: Record<string, unknown> | null;
  try {
    auth = record(JSON.parse(contents));
  } catch {
    return unavailable("Codex auth.json is not valid JSON yet.");
  }
  if (!auth) return unavailable("Codex auth.json has an unsupported format.");
  const apiKey = string(auth.OPENAI_API_KEY);
  if (apiKey && auth.auth_mode !== "chatgpt") {
    const key = fingerprint(["api-key", apiKey]);
    return {
      status: "readable",
      identity: {
        kind: "api-key",
        fingerprint: key,
        label: `API credential · ${key.slice(0, 8)}`,
        email: null,
      },
    };
  }
  const tokens = record(auth.tokens);
  const id = claims(tokens?.id_token);
  const access = claims(tokens?.access_token);
  const authClaims =
    record(id?.["https://api.openai.com/auth"]) ??
    record(access?.["https://api.openai.com/auth"]);
  const profile =
    record(id?.["https://api.openai.com/profile"]) ??
    record(access?.["https://api.openai.com/profile"]);
  const accountId =
    string(tokens?.account_id) ?? string(authClaims?.chatgpt_account_id);
  const email = string(id?.email) ?? string(profile?.email);
  const userId =
    string(authClaims?.chatgpt_user_id) ??
    string(id?.sub) ??
    string(access?.sub);
  if (!accountId && !email && !userId) {
    return unavailable(
      "No stable account identity was found. Credential rotation will not be treated as an account switch.",
    );
  }
  const key = fingerprint([
    "chatgpt",
    accountId,
    userId,
    email?.toLowerCase() ?? null,
  ]);
  return {
    status: "readable",
    identity: {
      kind: "chatgpt",
      fingerprint: key,
      email,
      label: email
        ? `${email}${accountId ? ` · ${fingerprint(accountId).slice(0, 6)}` : ""}`
        : `Codex account · ${key.slice(0, 8)}`,
    },
  };
}

export async function readAuth(filePath: string): Promise<AuthObservation> {
  try {
    const file = await open(
      filePath,
      constants.O_RDONLY | constants.O_NONBLOCK,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_AUTH_BYTES)
        return unavailable("Codex auth.json is not a supported regular file.");
      const buffer = Buffer.alloc(MAX_AUTH_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_AUTH_BYTES)
        return unavailable("Codex auth.json exceeds the size limit.");
      return parseAuth(buffer.toString("utf8", 0, bytesRead));
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        status: "readable",
        identity: {
          kind: "signed-out",
          fingerprint: "signed-out",
          label: "Not signed in",
          email: null,
        },
      };
    }
    return unavailable("Cannot read Codex auth.json on this host.");
  }
}

export class SettledAccount {
  private candidate: AccountIdentity | null = null;
  private observed: AccountIdentity | null = null;

  accept(sample: AuthObservation): AccountIdentity | null {
    if (sample.status !== "readable") {
      this.candidate = null;
      return null;
    }
    const identity = sample.identity;
    if (this.candidate?.fingerprint !== identity.fingerprint) {
      this.candidate = identity;
      return null;
    }
    if (this.observed?.fingerprint === identity.fingerprint) return null;
    this.observed = identity;
    return identity;
  }

  current(): AccountIdentity | null {
    return this.observed;
  }
}
