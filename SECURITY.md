# Security

Paseo plugins are trusted, unsandboxed code. Review the source before installing.

This plugin reads the effective file-backed Codex credentials to derive account identity. It never writes that file, stores raw Codex tokens, calls login/logout, or sends credentials to an external service.

Host-private state is stored under `PASEO_HOME/plugin-data/codex-account-watch`:

- `setup.json`: original/effective and installed launch argv.
- Content-addressed launcher assets.
- `runs/*.json`: agent/thread/run IDs, auth-file path, redacted account identity, runtime email, local control port, and a per-process control secret.

The directory uses mode 0700; generated files use 0600. Runtime records are removed on normal process exit. Abnormal termination can leave stale metadata. Metadata includes email addresses: treat it as private.

The local control socket binds to 127.0.0.1 and requires a random 256-bit secret plus exact runtime and agent IDs. Closing additionally requires the thread ID and an idle process. It controls only the child created by that launcher, never an arbitrary PID.

Account labels and fingerprints are sent to the connected Paseo client. Raw tokens and control secrets are not returned by plugin RPCs. The plugin has no telemetry or external account service.

Credentials decoded from JWT payloads are labels, not cryptographic proof of identity. Only a new process's `account/read` email is compared after reload. No paid inference is used for verification.

Do not include auth.json, tokens, setup.json, run records, or unredacted host logs in public issues. For suspected vulnerabilities, contact the repository owner privately through GitHub before disclosing details.
