# Codex Account Watch for Paseo

[中文说明](README.zh-CN.md)

A host-local Paseo plugin that notices when CC Switch or another tool changes Codex's file-backed account, then lets you review and reload each monitored agent.

This is an independent, experimental plugin. It does not require a Paseo fork.

## Install

Requirements on **each host running Codex**:

- Paseo client and daemon with native plugin modals and composer pills. Tested with `0.7.0-beta.3`; earlier releases are not supported.
- macOS or Linux, Node.js 22+, and the `paseo` and `codex` commands available to the daemon.
- Codex app-server with `account/read`. Tested with Codex `0.149.1`.
- File-backed Codex credentials in `CODEX_HOME/auth.json` (default: `~/.codex/auth.json`).

Enable plugins in Paseo's **Settings → Plugins**, then run:

```sh
paseo plugin add HanryYu/paseo-codex-account-watch
```

Open **Codex accounts** in the sidebar. Choose **Enable monitored Codex launches** and confirm. Installation alone does not change the launch command.

The confirmation changes only this host's built-in Codex provider command, using Paseo's configuration API. It saves the effective original argv and wraps future launches in a local monitor. Provider environment variables and other providers are preserved. No project configuration or Codex credential is written.

Existing processes are not taken over. Start a new Codex agent to test monitoring. Existing agents become monitored when Paseo next launches their process; if an unmonitored old session cannot reload, this plugin does not fix or terminate it.

Install this plugin once per host, using its default ID.

## Use

1. Launch a monitored Codex agent in Paseo.
2. Change the Codex account on that same host with your existing account tool.
3. A **Codex account changed** pill appears in the agent's composer. Click it, or open **Codex accounts**, to review the account reported by the current process and the new credentials on the host.
4. Choose **Keep current session** or **Reload agent**.

Keeping the session leaves its process untouched. Reloading waits for an idle agent, closes only the matching monitored process, and asks Paseo to resume the **same Codex thread**. The plugin then reads the account from the replacement process. The dialog shows progress and errors; a success toast names the email reported by Codex.

Detection requires two stable file observations. With an online client, the reminder usually appears within a few seconds. It does not open a modal automatically or automatically reload any agent.

### What account verification means

Codex `account/read` reports an account type and, for ChatGPT accounts, an email. It does not report the workspace/account ID, API key, or which account a later inference request bills.

- A verified result means the replacement process reports the expected email and the file identity remained stable during reload.
- Different workspaces belonging to the same email can be detected from file metadata, but runtime workspace identity cannot be verified.
- API-key changes can be detected with redacted fingerprints. Their runtime identity cannot be verified; no verified-switch toast is shown.
- Keeping an old process is **not credential isolation**. The plugin does not copy or pin tokens and cannot prevent upstream reauthentication, token expiration, revocation, or Codex changing its own credential behavior.

## Remote hosts

Install and enable monitoring on the Mac mini or other host that actually runs Codex:

```sh
paseo plugin add HanryYu/paseo-codex-account-watch --host ssh://user@mac-mini
```

In Paseo, select that host in **Codex accounts**, then enable monitored launches there. A switch performed on the Mac mini is observed by the Mac mini's plugin. Your connected client receives that host's reminder. The plugin does not look at your laptop's credentials or fall back to your laptop when the remote host is offline.

The host-scoped path is covered by an isolated daemon test. A physical two-machine/SSH test has not been completed.

## Restore, update, and remove

Before uninstalling, choose **Restore original launch command** in the plugin. Existing processes remain running. If another tool changed the command, restore refuses to overwrite it.

The restored command is the saved effective argv. If the original config omitted it, restoration writes `["codex"]`; it does not delete that config field.

```sh
paseo plugin update paseo-codex-account-watch
paseo plugin remove paseo-codex-account-watch
```

Add the same `--host` option when managing a remote installation. Disabling/removing the plugin does **not** automatically restore configuration: restore it first.

Launcher files live outside the Git checkout, under `PASEO_HOME/plugin-data/codex-account-watch`, so a Git update or removal cannot remove an executable still referenced by the provider. To adopt an updated launcher, restore and re-enable monitoring. Existing processes keep their original launcher until they exit.

If the plugin was removed before restoring, reinstall it and use the restore action. Do not delete its state directory while monitored processes or configuration still reference it.

## Boundaries and troubleshooting

- Only the built-in `codex` provider is supported. Custom profiles/providers, Windows hosts, keychain-only credentials, and environment-only API credentials are not supported.
- The launcher must be able to run the original command. Commands with secret-bearing arguments are rejected instead of saving those arguments in plugin state.
- Busy agents, stale confirmations, mismatched thread IDs, changed launch configuration, and uncertain account state block reload.
- A failed restart is not reported as a successful switch. Retry is available if the old process stopped but Paseo failed to resume it. After a plugin/daemon restart, that in-memory retry context is lost; inspect the session before using Paseo's reload action.
- Account switches are detected from local file contents, not verified by sending a model request. Models and quotas are not probed.
- Inspect `paseo plugin status paseo-codex-account-watch` and `paseo plugin logs paseo-codex-account-watch` if the sidebar item is missing. Check Node and Paseo CLI availability on the affected host if setup/reload fails.

## Development and validation

```sh
npm ci
npm run typecheck
npm test
npm run format:check
npm run test:daemon
npm run test:codex
```

`npm test` covers identity parsing, token rotation, transient writes, configuration preservation, stale UI confirmation, and a real wrapper/child-process handoff with an exclusive-writer fixture.

`test:daemon` starts a disposable Paseo daemon with synthetic credentials and a deterministic Codex fixture. It installs the plugin without `node_modules`, enables monitoring, detects A → B, rejects stale/concurrent/externally reconfigured reloads, resumes the same thread, verifies the fixture email, and restores the original command. It does not target your normal daemon.

Add `-- --git` to `npm run test:daemon` to install the public Git repository instead of the local source. This requires network access.

Test cleanup uses the retained connection and the spawned test process group, never `paseo daemon stop` or a default host. Add `-- --exit-before-cleanup` to exercise cleanup after the test daemon has already exited.

`test:codex` uses the real Codex binary with temporary synthetic credentials. It checks `account/read` before and after a process restart, without creating a thread or making a model request. It does not establish that a real authenticated inference request or billing account switched.

For UI checks:

```sh
npm run build
node --import tsx integration/daemon-smoke.ts --ui
```

Open the printed URL. The fixture is paused at a pending account change. Press Ctrl+C to stop and clean up the isolated daemon. Desktop dark/light dialogs and a 390px-wide bottom sheet have been checked in Paseo's web client. Native iOS/Android device testing remains outstanding.

The checked-in `bridge-source.server.json` is generated by `npm run build`. Paseo Git installation does not run npm or build scripts. CI checks that the asset matches its source.

## License

Apache-2.0. See [NOTICE](NOTICE) for Paseo scaffold/type attribution.
