import React, { useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useRpc,
  type PluginClientContext,
  type PluginComposerPillProps,
  type PluginSurfaceProps,
  type PluginTheme,
} from "@getpaseo/plugin";
import { Icon, Modal, useToast } from "@getpaseo/plugin/react-native";
import { sessionForOpenDialog } from "./notice.shared";
import {
  importProfilesRpc,
  migrateProfileRpc,
  reloadRpc,
  setupRpc,
  statusRpc,
  type AccountSession,
} from "./api.shared";
import type { ProfileSummary } from "./profiles.shared";

function Action({
  theme,
  label,
  disabled = false,
  secondary = false,
  onPress,
}: {
  theme: PluginTheme;
  label: string;
  disabled?: boolean;
  secondary?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: secondary
          ? theme.colors.surface2
          : theme.colors.accent,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text
        style={{
          color: secondary
            ? theme.colors.foreground
            : theme.colors.accentForeground,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function AccountDialog({
  session,
  theme,
  open,
  onOpenChange,
}: {
  session: AccountSession;
  theme: PluginTheme;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const rpc = useRpc(reloadRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      rpc({
        agentId: session.agentId,
        runId: session.runId,
        fingerprint: session.fingerprint,
        confirmed: true,
      }),
    onSuccess(result) {
      void queryClient.invalidateQueries({ queryKey: ["account-watch"] });
      if (result.verification === "email") {
        toast.show(`Agent reloaded. Codex reports ${result.label}.`, {
          variant: "success",
        });
        onOpenChange(false);
      } else
        toast.show(
          "Agent reloaded, but the expected account could not be verified.",
          { variant: "warning" },
        );
    },
  });
  const busy = session.busy;
  const text = { color: theme.colors.foreground };
  const detail = { color: theme.colors.foregroundMuted };
  return (
    <Modal
      title="Codex account changed"
      icon={<Icon name="UserRound" color={theme.colors.foreground} />}
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) onOpenChange(next);
      }}
    >
      <Modal.Content>
        <View style={{ gap: 16 }}>
          <View style={{ gap: 4 }}>
            <Text style={detail}>Current process reports</Text>
            <Text selectable style={text}>
              {session.previousLabel}
            </Text>
          </View>
          <View style={{ gap: 4 }}>
            <Text style={detail}>Credentials on this host now identify</Text>
            <Text selectable style={text}>
              {session.nextLabel}
            </Text>
          </View>
          <Text style={detail}>
            Reload restarts this agent on the same Codex thread. Keeping the
            session does not change or stop its current process.
          </Text>
          <Text style={detail}>
            Codex verifies the email and account type. Its account/read API does
            not expose the workspace ID or API key.
          </Text>
          {busy && !session.problem ? (
            <Text style={{ color: theme.colors.statusWarning }}>
              Wait for the current turn to finish.
            </Text>
          ) : null}
          {session.problem ? (
            <Text style={{ color: theme.colors.statusWarning }}>
              {session.problem}
            </Text>
          ) : null}
          {mutation.error ? (
            <Text
              accessibilityRole="alert"
              style={{ color: theme.colors.statusDanger }}
            >
              {mutation.error.message}
            </Text>
          ) : null}
          {mutation.data?.verification !== undefined &&
          mutation.data.verification !== "email" ? (
            <Text
              accessibilityRole="alert"
              style={{ color: theme.colors.statusWarning }}
            >
              The process restarted and reports {mutation.data.label}, but the
              expected account could not be verified.
            </Text>
          ) : null}
          <View style={{ gap: 8 }}>
            <Action
              theme={theme}
              label={
                mutation.isPending
                  ? "Reloading agent…"
                  : mutation.error
                    ? "Retry reload"
                    : "Reload agent"
              }
              disabled={
                busy ||
                mutation.isPending ||
                Boolean(mutation.data) ||
                !session.changed ||
                !session.fingerprint ||
                Boolean(session.problem)
              }
              onPress={() => mutation.mutate()}
            />
            <Action
              theme={theme}
              label={mutation.data ? "Close" : "Keep current session"}
              secondary
              disabled={mutation.isPending}
              onPress={() => onOpenChange(false)}
            />
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}

function ProfileDialog({
  session,
  profiles,
  theme,
  open,
  onOpenChange,
}: {
  session: AccountSession;
  profiles: ProfileSummary[];
  theme: PluginTheme;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const migrate = useRpc(migrateProfileRpc);
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const unavailable = session.busy || Boolean(session.problem);
  const mutation = useMutation({
    mutationFn: (profileId: string) =>
      migrate({
        agentId: session.agentId,
        runId: session.runId,
        profileId,
        confirmedRestart: true,
      }),
    onSuccess(task) {
      toast.show(
        `Account migration ${task.id.slice(0, 8)} scheduled. This host is restarting.`,
        { variant: "success" },
      );
      onOpenChange(false);
    },
  });
  return (
    <Modal
      title="Choose Codex account"
      icon={<Icon name="UsersRound" color={theme.colors.foreground} />}
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) onOpenChange(next);
      }}
    >
      <Modal.Content>
        <View style={{ gap: 12 }}>
          <Text style={{ color: theme.colors.foregroundMuted }}>
            Switching restarts this Paseo host, imports the same Codex thread
            under the selected account, and keeps the old agent closed as a
            recovery copy. Every running agent on this host is interrupted.
          </Text>
          {session.busy ? (
            <Text style={{ color: theme.colors.statusWarning }}>
              Wait for the current turn to finish.
            </Text>
          ) : null}
          {session.problem ? (
            <Text style={{ color: theme.colors.statusWarning }}>
              {session.problem}
            </Text>
          ) : null}
          {profiles.length ? (
            profiles.map((profile) => {
              const current = profile.id === session.currentProfileId;
              const chosen = profile.id === selected;
              return (
                <Pressable
                  key={profile.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: chosen || current }}
                  disabled={mutation.isPending || current || unavailable}
                  onPress={() => {
                    mutation.reset();
                    setSelected(profile.id);
                  }}
                  style={{
                    padding: 12,
                    gap: 4,
                    borderRadius: 8,
                    backgroundColor:
                      chosen || current
                        ? theme.colors.surface1
                        : theme.colors.surface2,
                    opacity: current ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: theme.colors.foreground }}>
                    {profile.name}
                    {current ? " · Current" : ""}
                  </Text>
                  <Text style={{ color: theme.colors.foregroundMuted }}>
                    {profile.accountLabel}
                  </Text>
                </Pressable>
              );
            })
          ) : (
            <Text style={{ color: theme.colors.statusWarning }}>
              Import CC Switch accounts first.
            </Text>
          )}
          {mutation.error ? (
            <Text
              accessibilityRole="alert"
              style={{ color: theme.colors.statusDanger }}
            >
              {mutation.error.message}
            </Text>
          ) : null}
          <Action
            theme={theme}
            label={
              mutation.isPending
                ? "Restarting host…"
                : "Restart host and switch"
            }
            disabled={!selected || mutation.isPending || unavailable}
            onPress={() => {
              if (selected) mutation.mutate(selected);
            }}
          />
          <Action
            theme={theme}
            secondary
            label="Cancel"
            disabled={mutation.isPending}
            onPress={() => onOpenChange(false)}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}

function createNotice(initial: AccountSession, profiles: ProfileSummary[]) {
  let value = { session: initial, profiles, open: false };
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(session: AccountSession, nextProfiles = value.profiles) {
      value = { ...value, session, profiles: nextProfiles };
      for (const listener of listeners) listener();
    },
    open(open: boolean) {
      value = { ...value, open };
      for (const listener of listeners) listener();
    },
  };
}

export function contributeClient(client: PluginClientContext) {
  const entries = new Map<
    string,
    {
      key: string;
      notice: ReturnType<typeof createNotice>;
      remove: () => void | Promise<void>;
    }
  >();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const clear = () => {
    for (const entry of entries.values()) void entry.remove();
    entries.clear();
  };
  const poll = async () => {
    try {
      const result = await client.rpc(statusRpc, {});
      if (stopped) return;
      const active = new Set<string>();
      for (const session of result.sessions.filter(
        (item) => item.currentAccountLabel && item.workspaceId,
      )) {
        active.add(session.agentId);
        const profilesKey = result.profiles
          .map((profile) => `${profile.id}:${profile.updatedAt}`)
          .join(",");
        const key = `${session.runId}:${session.currentAccountLabel}:${session.changed ? session.fingerprint : "current"}:${profilesKey}`;
        const existing = entries.get(session.agentId);
        if (existing?.notice.get().open) {
          existing.notice.update(
            sessionForOpenDialog(existing.notice.get().session, session),
            result.profiles,
          );
          continue;
        }
        if (existing?.key === key) {
          if (session.changed) existing.notice.update(session, result.profiles);
          continue;
        }
        if (existing) void existing.remove();
        const notice = createNotice(session, result.profiles);
        function AccountPill({ theme, layout }: PluginComposerPillProps) {
          const state = useSyncExternalStore(
            notice.subscribe,
            notice.get,
            notice.get,
          );
          const changed = state.session.changed;
          return (
            <>
              <Icon
                name="UserRound"
                size={14}
                color={
                  changed
                    ? theme.colors.statusWarning
                    : theme.colors.foregroundMuted
                }
              />
              <Text
                numberOfLines={1}
                ellipsizeMode="middle"
                style={{
                  color: changed
                    ? theme.colors.statusWarning
                    : theme.colors.foregroundMuted,
                  maxWidth: layout.compact ? 140 : 220,
                }}
              >
                {changed
                  ? "Codex account changed"
                  : state.session.currentAccountLabel}
              </Text>
              {changed ? (
                <AccountDialog
                  session={state.session}
                  theme={theme}
                  open={state.open}
                  onOpenChange={notice.open}
                />
              ) : (
                <ProfileDialog
                  session={state.session}
                  profiles={state.profiles}
                  theme={theme}
                  open={state.open}
                  onOpenChange={notice.open}
                />
              )}
            </>
          );
        }
        const remove = client.addComposerPill({
          id: "account-status",
          title: session.changed
            ? "Review Codex account change"
            : `Current Codex account: ${session.currentAccountLabel}`,
          workspaceId: session.workspaceId,
          agentId: session.agentId,
          Component: AccountPill,
          onPress() {
            notice.open(true);
          },
        });
        entries.set(session.agentId, { key, notice, remove });
      }
      for (const [agentId, entry] of entries) {
        if (!active.has(agentId)) {
          if (entry.notice.get().open) {
            entry.notice.update(
              sessionForOpenDialog(entry.notice.get().session, undefined),
            );
          } else {
            void entry.remove();
            entries.delete(agentId);
          }
        }
      }
    } catch {
      if (!stopped) {
        for (const entry of entries.values())
          entry.notice.update({
            ...entry.notice.get().session,
            busy: true,
            problem:
              "Cannot reach this host's account monitor. Reload is unavailable until it reconnects.",
          });
      }
    } finally {
      if (!stopped)
        timer = setTimeout(() => {
          void poll();
        }, 3000);
    }
  };
  void poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
    clear();
  };
}

export function MainSurface({ theme, layout, host }: PluginSurfaceProps) {
  const getStatus = useRpc(statusRpc);
  const setup = useRpc(setupRpc);
  const importProfiles = useRpc(importProfilesRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["account-watch", host.id],
    queryFn: () => getStatus({}),
    refetchInterval: 3000,
  });
  const [confirm, setConfirm] = useState<
    "enable" | "restore" | "import" | null
  >(null);
  const [selected, setSelected] = useState<AccountSession | null>(null);
  const mutation = useMutation({
    mutationFn: (action: "enable" | "restore") =>
      setup({ action, confirmed: true }),
    onSuccess(result) {
      toast.show(result.message, { variant: "success" });
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ["account-watch"] });
    },
  });
  const importMutation = useMutation({
    mutationFn: () => importProfiles({ confirmed: true }),
    onSuccess(result) {
      toast.show(
        `CC Switch accounts: ${result.imported} imported, ${result.updated} updated, ${result.skipped} skipped. Restart this Paseo host when idle to activate newly added providers.`,
        { variant: "success" },
      );
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ["account-watch"] });
    },
  });
  const confirmPending =
    confirm === "import" ? importMutation.isPending : mutation.isPending;
  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 16 : 24, gap: 16 },
      title: {
        color: theme.colors.foreground,
        fontSize: 22,
        fontWeight: "600" as const,
      },
      text: { color: theme.colors.foreground },
      detail: { color: theme.colors.foregroundMuted },
      error: { color: theme.colors.statusDanger },
      card: {
        backgroundColor: theme.colors.surface1,
        borderRadius: 8,
        padding: 16,
        gap: 8,
      },
    }),
    [theme, layout.compact],
  );
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Codex account watch</Text>
      <Text style={styles.detail}>Host: {host.label}</Text>
      <Text style={styles.detail}>
        Detect external account changes and choose when each monitored agent
        reloads. This plugin never signs in, switches accounts, or writes Codex
        credentials.
      </Text>
      {status.isPending ? (
        <Text style={styles.detail}>Checking this host…</Text>
      ) : null}
      {status.error ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={styles.error}>
            {status.error.message}
          </Text>
          <Action
            theme={theme}
            secondary
            label="Retry"
            onPress={() => {
              void status.refetch();
            }}
          />
        </View>
      ) : null}
      {status.data ? (
        <>
          {status.data.note ? (
            <Text style={{ color: theme.colors.statusWarning }}>
              {status.data.note}
            </Text>
          ) : null}
          <Action
            theme={theme}
            label={
              status.data.enabled
                ? "Restore original launch command"
                : "Enable monitored Codex launches"
            }
            secondary={status.data.enabled}
            disabled={status.data.enabled && !status.data.commandOwned}
            onPress={() => {
              mutation.reset();
              setConfirm(status.data.enabled ? "restore" : "enable");
            }}
          />
          <Text style={styles.detail}>
            {status.data.sessions.length} monitored ·{" "}
            {status.data.unmonitoredCount} unmonitored sessions
          </Text>
          <Text style={styles.detail}>
            Existing processes are not taken over. Newly launched Codex sessions
            use the monitored command. Restore the original command here before
            uninstalling this plugin.
          </Text>
          <Action
            theme={theme}
            label="Import accounts from CC Switch"
            secondary
            onPress={() => {
              importMutation.reset();
              setConfirm("import");
            }}
          />
          <Text style={styles.detail}>
            Imported accounts become isolated Codex providers. Select one when
            creating an agent after restarting this Paseo host; your system
            Codex account is not replaced.
          </Text>
          {status.data.profiles.map((profile) => (
            <View key={profile.id} style={styles.card}>
              <Text style={styles.text}>{profile.name}</Text>
              <Text selectable style={styles.detail}>
                Account: {profile.accountLabel}
              </Text>
              <Text selectable style={styles.detail}>
                Paseo provider: {profile.providerId}
              </Text>
            </View>
          ))}
          {status.data.migrations.slice(0, 3).map((task) => (
            <View key={task.id} style={styles.card}>
              <Text style={styles.text}>Migration · {task.title}</Text>
              <Text style={styles.detail}>Status: {task.state}</Text>
              {task.newAgentId ? (
                <Text selectable style={styles.detail}>
                  New agent: {task.newAgentId}
                </Text>
              ) : null}
              {task.error ? (
                <Text style={styles.error}>{task.error}</Text>
              ) : null}
            </View>
          ))}
          {status.data.sessions.map((session) => (
            <View key={session.runId} style={styles.card}>
              <Text style={styles.text}>{session.title}</Text>
              <Text selectable style={styles.detail}>
                Process: {session.previousLabel}
              </Text>
              <Text selectable style={styles.detail}>
                Credentials: {session.nextLabel}
              </Text>
              <Text style={styles.detail}>
                Runtime email:{" "}
                {session.verification === "email"
                  ? "matches launch identity"
                  : session.verification}
              </Text>
              {session.problem ? (
                <Text style={styles.error}>{session.problem}</Text>
              ) : null}
              {session.changed ? (
                <Action
                  theme={theme}
                  label="Review account change"
                  onPress={() => setSelected(session)}
                />
              ) : null}
            </View>
          ))}
        </>
      ) : null}
      <Modal
        title={
          confirm === "import"
            ? "Import CC Switch accounts"
            : confirm === "restore"
              ? "Restore Codex launches"
              : "Enable monitored Codex launches"
        }
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !confirmPending) setConfirm(null);
        }}
      >
        <Modal.Content>
          <View style={{ gap: 16 }}>
            <Text style={styles.text}>
              {confirm === "import"
                ? "Read Codex providers from ~/.cc-switch/cc-switch.db on this host. Valid credentials and provider configuration are copied into private, isolated CODEX_HOME directories. Raw credentials stay on this host and are never returned to the client. Official CC Switch rows without stored credentials are skipped."
                : confirm === "restore"
                  ? "Restore the saved Codex command on this host. Existing processes are not stopped. If another tool changed the command, restoration is refused."
                  : "This changes only this host's Codex launch command to a transparent local monitor. It preserves the original command, reads account labels, and can stop a matching idle process only when you confirm an agent reload. Node.js 22+ is required. No Codex token is copied or stored by the plugin."}
            </Text>
            {(confirm === "import" ? importMutation.error : mutation.error) ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {
                  (confirm === "import" ? importMutation.error : mutation.error)
                    ?.message
                }
              </Text>
            ) : null}
            <Action
              theme={theme}
              label={
                confirmPending
                  ? "Applying…"
                  : confirm === "import"
                    ? "Import accounts"
                    : confirm === "restore"
                      ? "Restore command"
                      : "Enable monitoring"
              }
              disabled={confirmPending}
              onPress={() => {
                if (confirm === "import") importMutation.mutate();
                else if (confirm) mutation.mutate(confirm);
              }}
            />
            <Action
              theme={theme}
              secondary
              label="Cancel"
              disabled={confirmPending}
              onPress={() => setConfirm(null)}
            />
          </View>
        </Modal.Content>
      </Modal>
      {selected ? (
        <AccountDialog
          key={`${selected.runId}:${selected.fingerprint}`}
          session={sessionForOpenDialog(
            selected,
            status.data?.sessions.find(
              (item) => item.agentId === selected.agentId,
            ),
          )}
          theme={theme}
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        />
      ) : null}
    </ScrollView>
  );
}
