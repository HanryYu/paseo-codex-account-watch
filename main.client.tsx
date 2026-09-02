import React, { useMemo, useState, useSyncExternalStore } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
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
  inline = false,
  onPress,
}: {
  theme: PluginTheme;
  label: string;
  disabled?: boolean;
  secondary?: boolean;
  inline?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingVertical: inline ? 7 : 12,
        paddingHorizontal: inline ? 11 : 12,
        borderRadius: 8,
        backgroundColor: secondary
          ? theme.colors.surface2
          : theme.colors.accent,
        borderWidth: 1,
        borderColor: secondary ? theme.colors.border : "transparent",
        opacity: disabled ? 0.5 : 1,
        alignSelf: inline ? "flex-start" : "stretch",
      }}
    >
      <Text
        style={{
          color: secondary
            ? theme.colors.foreground
            : theme.colors.accentForeground,
          textAlign: "center",
          fontSize: inline ? 14 : undefined,
          fontWeight: secondary ? "400" : "500",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SettingsSection({
  theme,
  title,
  children,
}: {
  theme: PluginTheme;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 12, marginBottom: 24 }}>
      <Text
        style={{
          color: theme.colors.foregroundMuted,
          fontSize: 14,
          marginLeft: 4,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          borderWidth: 1,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </View>
  );
}

type StatusTone = "success" | "warning" | "danger" | "muted";

function StatusLabel({
  theme,
  label,
  tone = "muted",
}: {
  theme: PluginTheme;
  label: string;
  tone?: StatusTone;
}) {
  const color =
    tone === "success"
      ? theme.colors.statusSuccess
      : tone === "warning"
        ? theme.colors.statusWarning
        : tone === "danger"
          ? theme.colors.statusDanger
          : theme.colors.foregroundMuted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: color,
        }}
      />
      <Text style={{ color, fontSize: 14 }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function SettingsRow({
  theme,
  compact,
  first = false,
  icon,
  title,
  description,
  status,
  statusTone,
  action,
}: {
  theme: PluginTheme;
  compact: boolean;
  first?: boolean;
  icon: React.ComponentProps<typeof Icon>["name"];
  title: string;
  description: string;
  status?: string;
  statusTone?: StatusTone;
  action?: React.ReactNode;
}) {
  return (
    <View
      style={{
        borderTopColor: theme.colors.border,
        borderTopWidth: first ? 0 : 1,
        paddingHorizontal: 16,
        paddingVertical: 16,
        gap: compact ? 12 : 16,
        flexDirection: compact ? "column" : "row",
        alignItems: compact ? "stretch" : "center",
      }}
    >
      <View
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <Icon name={icon} size={18} color={theme.colors.foregroundMuted} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text
            style={{ color: theme.colors.foreground, fontSize: 16 }}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>
            {description}
          </Text>
        </View>
      </View>
      {status || action ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: compact ? "space-between" : "flex-end",
            gap: 12,
            marginLeft: compact ? 30 : 0,
          }}
        >
          {status ? (
            <StatusLabel theme={theme} label={status} tone={statusTone} />
          ) : null}
          {action}
        </View>
      ) : null}
    </View>
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

function AccountSetupPill({ theme }: PluginComposerPillProps) {
  return (
    <>
      <Icon name="UserRoundCog" size={14} color={theme.colors.statusWarning} />
      <Text style={{ color: theme.colors.foregroundMuted }}>
        Codex account setup
      </Text>
    </>
  );
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
  const setupEntries = new Map<string, () => void | Promise<void>>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const clear = () => {
    for (const entry of entries.values()) void entry.remove();
    entries.clear();
    for (const remove of setupEntries.values()) void remove();
    setupEntries.clear();
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
      const setupAgentIds = new Set(
        result.unmonitoredAgents.map((agent) => agent.agentId),
      );
      for (const agent of result.unmonitoredAgents) {
        if (setupEntries.has(agent.agentId)) continue;
        setupEntries.set(
          agent.agentId,
          client.addComposerPill({
            id: "account-setup",
            title: "Set up Codex account switching",
            workspaceId: agent.workspaceId,
            agentId: agent.agentId,
            Component: AccountSetupPill,
            onPress() {
              client.openSurface("main");
            },
          }),
        );
      }
      for (const [agentId, remove] of setupEntries) {
        if (setupAgentIds.has(agentId)) continue;
        void remove();
        setupEntries.delete(agentId);
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
  const { width } = useWindowDimensions();
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
    onSuccess(result, action) {
      toast.show(result.message, { variant: "success" });
      setConfirm(
        action === "enable" && status.data?.profiles.length === 0
          ? "import"
          : null,
      );
      void queryClient.invalidateQueries({ queryKey: ["account-watch"] });
    },
  });
  const importMutation = useMutation({
    mutationFn: () => importProfiles({ confirmed: true }),
    onSuccess(result) {
      toast.show(
        `CC Switch accounts: ${result.imported} imported, ${result.updated} updated, ${result.skipped} skipped. Open a monitored agent and click its account pill to switch.`,
        { variant: "success" },
      );
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ["account-watch"] });
    },
  });
  const confirmPending =
    confirm === "import" ? importMutation.isPending : mutation.isPending;
  const launchIntegrationReady = Boolean(
    status.data?.enabled && status.data.commandOwned,
  );
  const compactRows = layout.compact || width < 960;
  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: {
        paddingHorizontal: compactRows ? 16 : 24,
        paddingVertical: 24,
        alignItems: "center" as const,
      },
      frame: { width: "100%" as const, maxWidth: 720 },
      text: { color: theme.colors.foreground },
      detail: { color: theme.colors.foregroundMuted },
      error: { color: theme.colors.statusDanger },
    }),
    [theme, compactRows],
  );
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.frame}>
        <View style={{ gap: 4, marginBottom: 24 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 16 }}>
            {host.label}
          </Text>
          <Text style={styles.detail}>
            Configure isolated Codex accounts for this host. Credentials and
            launch settings stay on the host you selected.
          </Text>
        </View>
        {status.isPending ? (
          <Text style={styles.detail}>Checking this host…</Text>
        ) : null}
        {status.error ? (
          <View style={{ gap: 12 }}>
            <Text accessibilityRole="alert" style={styles.error}>
              {status.error.message}
            </Text>
            <Action
              theme={theme}
              secondary
              inline
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
              <Text
                style={{
                  color: theme.colors.statusWarning,
                  marginBottom: 16,
                }}
              >
                {status.data.note}
              </Text>
            ) : null}
            <SettingsSection theme={theme} title="Setup">
              <SettingsRow
                theme={theme}
                compact={compactRows}
                first
                icon="TerminalSquare"
                title="Agent launch integration"
                description="Identifies the active account and enables safe agent restarts and thread migration."
                status={launchIntegrationReady ? "Ready" : "Action required"}
                statusTone={launchIntegrationReady ? "success" : "warning"}
                action={
                  !launchIntegrationReady ? (
                    <Action
                      theme={theme}
                      inline
                      label="Set up"
                      disabled={
                        status.data.enabled && !status.data.commandOwned
                      }
                      onPress={() => {
                        mutation.reset();
                        setConfirm("enable");
                      }}
                    />
                  ) : undefined
                }
              />
              <SettingsRow
                theme={theme}
                compact={compactRows}
                icon="UsersRound"
                title="Accounts from CC Switch"
                description={
                  status.data.profiles.length
                    ? `${status.data.profiles.length} ${status.data.profiles.length === 1 ? "account" : "accounts"} stored privately on this host.`
                    : "Import account profiles into isolated CODEX_HOME directories."
                }
                status={
                  status.data.profiles.length
                    ? `${status.data.profiles.length} imported`
                    : "Not imported"
                }
                statusTone={status.data.profiles.length ? "success" : "muted"}
                action={
                  <Action
                    theme={theme}
                    inline
                    secondary={status.data.profiles.length > 0}
                    label={status.data.profiles.length ? "Sync" : "Import"}
                    disabled={!launchIntegrationReady}
                    onPress={() => {
                      importMutation.reset();
                      setConfirm("import");
                    }}
                  />
                }
              />
              <SettingsRow
                theme={theme}
                compact={compactRows}
                icon="Bot"
                title="Codex agents"
                description={
                  status.data.unmonitoredCount > 0
                    ? `${status.data.unmonitoredCount} existing ${status.data.unmonitoredCount === 1 ? "agent needs" : "agents need"} to be started again or reloaded after setup.`
                    : status.data.sessions.length > 0
                      ? "Use the account pill above an agent's message box to switch profiles."
                      : "Start a new agent or reload an existing one after importing accounts."
                }
                status={
                  status.data.sessions.length
                    ? `${status.data.sessions.length} ready`
                    : "None ready"
                }
                statusTone={status.data.sessions.length ? "success" : "muted"}
              />
            </SettingsSection>

            <SettingsSection theme={theme} title="Accounts">
              {status.data.profiles.length ? (
                status.data.profiles.map((profile, index) => (
                  <SettingsRow
                    key={profile.id}
                    theme={theme}
                    compact={compactRows}
                    first={index === 0}
                    icon="UserRound"
                    title={profile.name}
                    description={`${profile.accountLabel} · Imported from CC Switch`}
                    status="Available"
                    statusTone="success"
                  />
                ))
              ) : (
                <SettingsRow
                  theme={theme}
                  compact={compactRows}
                  first
                  icon="UserRound"
                  title="No imported accounts"
                  description="Complete setup above, then import accounts from CC Switch."
                />
              )}
            </SettingsSection>

            <SettingsSection theme={theme} title="Agents on this host">
              {status.data.sessions.length ? (
                status.data.sessions.map((session, index) => (
                  <SettingsRow
                    key={session.runId}
                    theme={theme}
                    compact={compactRows}
                    first={index === 0}
                    icon="Bot"
                    title={session.title}
                    description={
                      session.problem
                        ? session.problem
                        : `${session.previousLabel} · Runtime ${session.verification === "email" ? "verified" : session.verification}`
                    }
                    status={
                      session.changed
                        ? "Account changed"
                        : session.busy
                          ? "Busy"
                          : "Current"
                    }
                    statusTone={
                      session.problem
                        ? "danger"
                        : session.changed || session.busy
                          ? "warning"
                          : "success"
                    }
                    action={
                      session.changed ? (
                        <Action
                          theme={theme}
                          inline
                          label="Review"
                          onPress={() => setSelected(session)}
                        />
                      ) : undefined
                    }
                  />
                ))
              ) : (
                <SettingsRow
                  theme={theme}
                  compact={compactRows}
                  first
                  icon="Bot"
                  title="No monitored agents"
                  description="New or reloaded Codex agents will appear here when launch integration is ready."
                />
              )}
            </SettingsSection>

            {status.data.migrations.length ? (
              <SettingsSection theme={theme} title="Recent migrations">
                {status.data.migrations.slice(0, 3).map((task, index) => (
                  <SettingsRow
                    key={task.id}
                    theme={theme}
                    compact={compactRows}
                    first={index === 0}
                    icon="RefreshCw"
                    title={task.title}
                    description={
                      task.error ??
                      (task.newAgentId
                        ? `New agent ${task.newAgentId}`
                        : "Host migration in progress")
                    }
                    status={task.state}
                    statusTone={task.error ? "danger" : "muted"}
                  />
                ))}
              </SettingsSection>
            ) : null}

            {launchIntegrationReady ? (
              <SettingsSection theme={theme} title="Advanced">
                <SettingsRow
                  theme={theme}
                  compact={compactRows}
                  first
                  icon="Undo2"
                  title="Restore original launch command"
                  description="Remove the account wrapper for future Codex processes on this host."
                  action={
                    <Action
                      theme={theme}
                      inline
                      secondary
                      label="Restore"
                      onPress={() => {
                        mutation.reset();
                        setConfirm("restore");
                      }}
                    />
                  }
                />
              </SettingsSection>
            ) : null}
          </>
        ) : null}
      </View>
      <Modal
        title={
          confirm === "import"
            ? "Import CC Switch accounts"
            : confirm === "restore"
              ? "Restore Codex launches"
              : "Set up account switching"
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
                  : "The plugin will configure this host's Codex launch command through Paseo. Future Codex processes run through a transparent local wrapper that reports the active account and enables safe restart and thread migration. The original command is saved and can be restored here. Existing processes are not interrupted. No terminal setup is required."}
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
                      : "Continue setup"
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
