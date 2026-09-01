# Security

Paseo plugins are trusted, unsandboxed code. Review the source before installing.

The monitor reads the effective file-backed Codex credentials to derive account identity. It never writes the system auth file, calls login/logout, or sends credentials to an external service.

The optional CC Switch importer reads its SQLite database in read-only mode. After explicit confirmation, valid Codex `auth` and `config` values are copied into private profile directories on the same host. Imported `auth.json` files contain raw credentials and must be protected like passwords. They are never returned through plugin RPCs or written to Paseo config; Paseo config receives only the private `CODEX_HOME` path.

Host-private state is stored under `PASEO_HOME/plugin-data/codex-account-watch`:

- `setup.json`: original/effective and installed launch argv.
- Content-addressed launcher assets.
- `runs/*.json`: agent/thread/run IDs, auth-file path, redacted account identity, runtime email, local control port, and a per-process control secret.

The directory uses mode 0700; generated files use 0600. Runtime records are removed on normal process exit. Abnormal termination can leave stale metadata. Metadata includes email addresses: treat it as private.

The local control socket binds to 127.0.0.1 and requires a random 256-bit secret plus exact runtime and agent IDs. Closing additionally requires the thread ID and an idle process. It controls only the child created by that launcher, never an arbitrary PID.

Account migrations are explicit host-wide restart operations. Before restart, the plugin verifies an idle monitored agent, an exact run/thread match, owned launch configuration, stable target credentials, and a bounded regular Codex rollout. Only matching JSONL rollouts are hardlinked into the target profile. The detached runner stores no credentials; it receives IDs, paths, labels, and the exact loopback host, then uses the local Paseo CLI to restart, import, rename, and verify. The old Paseo agent remains as a closed recovery record.

Account labels and fingerprints are sent to the connected Paseo client. Raw tokens and control secrets are not returned by plugin RPCs. The plugin has no telemetry or external account service.

Credentials decoded from JWT payloads are labels, not cryptographic proof of identity. Only a new process's `account/read` email is compared after reload. No paid inference is used for verification.

Do not include auth.json, tokens, setup.json, run records, or unredacted host logs in public issues. For suspected vulnerabilities, contact the repository owner privately through GitHub before disclosing details.
