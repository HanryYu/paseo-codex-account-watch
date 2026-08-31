import type { AccountSession } from "./status.shared";

export function sessionForOpenDialog(
  original: AccountSession,
  current: AccountSession | undefined,
): AccountSession {
  if (
    !current ||
    original.runId !== current.runId ||
    original.fingerprint !== current.fingerprint
  ) {
    return {
      ...original,
      busy: true,
      problem:
        "The session or credentials changed again. Close this dialog and review the latest account before reloading.",
    };
  }
  return current;
}
