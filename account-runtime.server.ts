import type { RuntimeAccount } from "./runtime.shared";

export function accountFromResponse(value: unknown): RuntimeAccount | null {
  if (!value || typeof value !== "object" || !("account" in value)) return null;
  const account = value.account;
  if (account === null)
    return { kind: "signed-out", email: null, label: "Not signed in" };
  if (!account || typeof account !== "object" || !("type" in account))
    return null;
  if (account.type === "chatgpt") {
    const email =
      "email" in account && typeof account.email === "string"
        ? account.email.trim() || null
        : null;
    return {
      kind: "chatgpt",
      email,
      label: email ?? "Codex account (email unavailable)",
    };
  }
  if (account.type === "apiKey")
    return { kind: "api-key", email: null, label: "API credential" };
  return { kind: "other", email: null, label: "Unsupported account type" };
}
