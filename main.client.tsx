import React, {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
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
  renameProfileRpc,
  setupRpc,
  statusRpc,
  updateSettingsRpc,
  type AccountSession,
} from "./api.shared";
import type { ProfileSummary } from "./profiles.shared";
import { resolveLocale, translator, type Translate } from "./i18n.client";
import type { PluginLanguage, PluginSettingsPatch } from "./settings.shared";

function localeFromProps(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const locale = (value as { locale?: unknown }).locale;
  return typeof locale === "string" ? locale : undefined;
}

const STATUS_POLL_INTERVAL_MS = 5000;
const pendingMigrationNavigation = new Map<string, string>();

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

function ChoiceDialog<T extends string | number>({
  theme,
  title,
  options,
  value,
  open,
  pending,
  error,
  onSelect,
  onOpenChange,
}: {
  theme: PluginTheme;
  title: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  open: boolean;
  pending: boolean;
  error: Error | null;
  onSelect(value: T): void;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Modal
      title={title}
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <Modal.Content>
        <View style={{ gap: 8 }}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={String(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                disabled={pending}
                onPress={() => onSelect(option.value)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 11,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: selected
                    ? theme.colors.accent
                    : theme.colors.border,
                  backgroundColor: selected
                    ? theme.colors.surface1
                    : theme.colors.surface2,
                }}
              >
                <Text style={{ color: theme.colors.foreground }}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
          {error ? (
            <Text
              accessibilityRole="alert"
              style={{ color: theme.colors.statusDanger }}
            >
              {error.message}
            </Text>
          ) : null}
        </View>
      </Modal.Content>
    </Modal>
  );
}

function RenameAccountDialog({
  profile,
  theme,
  t,
  open,
  onOpenChange,
}: {
  profile: ProfileSummary;
  theme: PluginTheme;
  t: Translate;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const rename = useRpc(renameProfileRpc);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(profile.name);
  const mutation = useMutation({
    mutationFn: () => rename({ profileId: profile.id, name }),
    onSuccess(updated) {
      toast.show(t("accountRenamed", { name: updated.name }), {
        variant: "success",
      });
      void queryClient.invalidateQueries({ queryKey: ["account-watch"] });
      onOpenChange(false);
    },
  });
  const normalized = name.trim().replace(/\s+/g, " ");
  return (
    <Modal
      title={t("renameAccount")}
      icon={<Icon name="Pencil" color={theme.colors.foreground} />}
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) onOpenChange(next);
      }}
    >
      <Modal.Content>
        <View style={{ gap: 12 }}>
          <Text style={{ color: theme.colors.foregroundMuted }}>
            {t("accountName")}
          </Text>
          <TextInput
            autoFocus
            value={name}
            maxLength={64}
            placeholder={t("accountNamePlaceholder")}
            placeholderTextColor={theme.colors.foregroundMuted}
            onChangeText={(next) => {
              mutation.reset();
              setName(next);
            }}
            style={{
              color: theme.colors.foreground,
              backgroundColor: theme.colors.surface2,
              borderColor: theme.colors.border,
              borderWidth: 1,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          />
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
            label={mutation.isPending ? t("saving") : t("save")}
            disabled={
              mutation.isPending ||
              normalized.length === 0 ||
              normalized === profile.name
            }
            onPress={() => mutation.mutate()}
          />
          <Action
            theme={theme}
            secondary
            label={t("cancel")}
            disabled={mutation.isPending}
            onPress={() => onOpenChange(false)}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}

function AccountDialog({
  session,
  theme,
  t,
  open,
  onOpenChange,
}: {
  session: AccountSession;
  theme: PluginTheme;
  t: Translate;
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
        toast.show(t("reloadedAs", { label: result.label }), {
          variant: "success",
        });
        onOpenChange(false);
      } else toast.show(t("reloadUnverified"), { variant: "warning" });
    },
  });
  const busy = session.busy;
  const text = { color: theme.colors.foreground };
  const detail = { color: theme.colors.foregroundMuted };
  return (
    <Modal
      title={t("accountChanged")}
      icon={<Icon name="UserRound" color={theme.colors.foreground} />}
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) onOpenChange(next);
      }}
    >
      <Modal.Content>
        <View style={{ gap: 16 }}>
          <View style={{ gap: 4 }}>
            <Text style={detail}>{t("currentProcessReports")}</Text>
            <Text selectable style={text}>
              {session.previousLabel}
            </Text>
          </View>
          <View style={{ gap: 4 }}>
            <Text style={detail}>{t("credentialsNowIdentify")}</Text>
            <Text selectable style={text}>
              {session.nextLabel}
            </Text>
          </View>
          <Text style={detail}>{t("reloadExplanation")}</Text>
          <Text style={detail}>{t("verificationExplanation")}</Text>
          {busy && !session.problem ? (
            <Text style={{ color: theme.colors.statusWarning }}>
              {t("waitForTurn")}
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
              {t("reloadUnverifiedDetail", {
                label: mutation.data.label,
              })}
            </Text>
          ) : null}
          <View style={{ gap: 8 }}>
            <Action
              theme={theme}
              label={
                mutation.isPending
                  ? t("reloadingAgent")
                  : mutation.error
                    ? t("retryReload")
                    : t("reloadAgent")
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
              label={mutation.data ? t("close") : t("keepSession")}
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
  t,
  open,
  onMigrationScheduled,
  onOpenChange,
}: {
  session: AccountSession;
  profiles: ProfileSummary[];
  theme: PluginTheme;
  t: Translate;
  open: boolean;
  onMigrationScheduled(taskId: string): void;
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
        confirmedSwitch: true,
      }),
    onSuccess(task) {
      toast.show(t("migrationScheduled", { id: task.id.slice(0, 8) }), {
        variant: "success",
      });
      onMigrationScheduled(task.id);
      onOpenChange(false);
    },
  });
  return (
    <Modal
      title={t("chooseAccount")}
      icon={<Icon name="UsersRound" color={theme.colors.foreground} />}
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) onOpenChange(next);
      }}
    >
      <Modal.Content>
        <View style={{ gap: 12 }}>
          <Text style={{ color: theme.colors.foregroundMuted }}>
            {t("migrationExplanation")}
          </Text>
          {session.busy ? (
            <Text style={{ color: theme.colors.statusWarning }}>
              {t("waitForTurn")}
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
                    {current ? ` · ${t("current")}` : ""}
                  </Text>
                  <Text style={{ color: theme.colors.foregroundMuted }}>
                    {profile.accountLabel}
                  </Text>
                </Pressable>
              );
            })
          ) : (
            <Text style={{ color: theme.colors.statusWarning }}>
              {t("importFirst")}
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
              mutation.isPending ? t("restartingHost") : t("restartAndSwitch")
            }
            disabled={!selected || mutation.isPending || unavailable}
            onPress={() => {
              if (selected) mutation.mutate(selected);
            }}
          />
          <Action
            theme={theme}
            secondary
            label={t("cancel")}
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
  const setupEntries = new Map<string, () => void | Promise<void>>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let currentT = translator("en");
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
      currentT = translator(resolveLocale(result.settings.language));
      const t = currentT;
      const active = new Set<string>();
      const accountPillSessions = result.settings.showAccountPill
        ? result.sessions.filter(
            (item) => item.currentAccountLabel && item.workspaceId,
          )
        : [];
      for (const session of accountPillSessions) {
        active.add(session.agentId);
        const profilesKey = result.profiles
          .map((profile) => `${profile.id}:${profile.updatedAt}`)
          .join(",");
        const key = `${session.runId}:${session.currentAccountLabel}:${session.changed ? session.fingerprint : "current"}:${profilesKey}:${result.settings.language}`;
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
        function AccountPill(props: PluginComposerPillProps) {
          const { theme, layout } = props;
          const pillT = translator(
            resolveLocale(result.settings.language, localeFromProps(props)),
          );
          const state = useSyncExternalStore(
            notice.subscribe,
            notice.get,
            notice.get,
          );
          const changed = state.session.changed;
          const currentProfile = state.profiles.find(
            (profile) => profile.id === state.session.currentProfileId,
          );
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
                  ? pillT("accountChangedPill")
                  : (currentProfile?.name ?? state.session.currentAccountLabel)}
              </Text>
              {changed ? (
                <AccountDialog
                  session={state.session}
                  theme={theme}
                  t={pillT}
                  open={state.open}
                  onOpenChange={notice.open}
                />
              ) : (
                <ProfileDialog
                  session={state.session}
                  profiles={state.profiles}
                  theme={theme}
                  t={pillT}
                  open={state.open}
                  onMigrationScheduled={(taskId) => {
                    pendingMigrationNavigation.set(props.host.id, taskId);
                    client.openSurface("main");
                  }}
                  onOpenChange={notice.open}
                />
              )}
            </>
          );
        }
        const remove = client.addComposerPill({
          id: "account-status",
          title: session.changed
            ? t("reviewAccountChange")
            : t("currentAccount", {
                label:
                  result.profiles.find(
                    (profile) => profile.id === session.currentProfileId,
                  )?.name ??
                  session.currentAccountLabel ??
                  "",
              }),
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
      const setupAgents = result.settings.showSetupPill
        ? result.unmonitoredAgents
        : [];
      const setupAgentIds = new Set(setupAgents.map((agent) => agent.agentId));
      for (const agent of setupAgents) {
        if (setupEntries.has(agent.agentId)) continue;
        function SetupPill(props: PluginComposerPillProps) {
          const setupT = translator(
            resolveLocale(result.settings.language, localeFromProps(props)),
          );
          return (
            <>
              <Icon
                name="UserRoundCog"
                size={14}
                color={props.theme.colors.statusWarning}
              />
              <Text style={{ color: props.theme.colors.foregroundMuted }}>
                {setupT("setupPill")}
              </Text>
            </>
          );
        }
        setupEntries.set(
          agent.agentId,
          client.addComposerPill({
            id: "account-setup",
            title: t("setupAccountSwitching"),
            workspaceId: agent.workspaceId,
            agentId: agent.agentId,
            Component: SetupPill,
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
            problem: currentT("monitorUnavailable"),
          });
      }
    } finally {
      if (!stopped)
        timer = setTimeout(() => {
          void poll();
        }, STATUS_POLL_INTERVAL_MS);
    }
  };
  void poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
    clear();
  };
}

export function MainSurface(props: PluginSurfaceProps) {
  const { theme, layout, host } = props;
  const { width } = useWindowDimensions();
  const getStatus = useRpc(statusRpc);
  const setup = useRpc(setupRpc);
  const importProfiles = useRpc(importProfilesRpc);
  const updateSettings = useRpc(updateSettingsRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["account-watch", host.id],
    queryFn: () => getStatus({}),
    refetchInterval: STATUS_POLL_INTERVAL_MS,
  });
  const locale = resolveLocale(
    status.data?.settings.language ?? "auto",
    localeFromProps(props),
  );
  const t = translator(locale);
  useEffect(() => {
    const taskId = pendingMigrationNavigation.get(host.id);
    if (!taskId || !status.data) return;
    const task = status.data.migrations.find((item) => item.id === taskId);
    if (!task) return;
    if (task.state === "failed") {
      pendingMigrationNavigation.delete(host.id);
      return;
    }
    if (task.state === "completed" && task.newAgentId && props.navigation) {
      pendingMigrationNavigation.delete(host.id);
      props.navigation.openAgent({ agentId: task.newAgentId });
    }
  }, [host.id, props.navigation, status.data]);
  const [confirm, setConfirm] = useState<
    "enable" | "restore" | "import" | null
  >(null);
  const [selected, setSelected] = useState<AccountSession | null>(null);
  const [profileToRename, setProfileToRename] = useState<ProfileSummary | null>(
    null,
  );
  const [preference, setPreference] = useState<"language" | null>(null);
  const mutation = useMutation({
    mutationFn: (action: "enable" | "restore") =>
      setup({ action, confirmed: true }),
    onSuccess(_result, action) {
      toast.show(
        action === "enable" ? t("setupComplete") : t("restoreComplete"),
        { variant: "success" },
      );
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
        t("importComplete", {
          imported: result.imported,
          updated: result.updated,
          skipped: result.skipped,
        }),
        { variant: "success" },
      );
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ["account-watch"] });
    },
  });
  const settingsMutation = useMutation({
    mutationFn: (patch: PluginSettingsPatch) => updateSettings(patch),
    onSuccess(settings) {
      const nextT = translator(
        resolveLocale(settings.language, localeFromProps(props)),
      );
      toast.show(nextT("settingsSaved"), { variant: "success" });
      setPreference(null);
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
          <Text style={styles.detail}>{t("hostDescription")}</Text>
        </View>
        {status.isPending ? (
          <Text style={styles.detail}>{t("checkingHost")}</Text>
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
              label={t("retry")}
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
            <SettingsSection theme={theme} title={t("setup")}>
              <SettingsRow
                theme={theme}
                compact={compactRows}
                first
                icon="TerminalSquare"
                title={t("launchIntegration")}
                description={t("launchIntegrationDescription")}
                status={
                  launchIntegrationReady ? t("ready") : t("actionRequired")
                }
                statusTone={launchIntegrationReady ? "success" : "warning"}
                action={
                  !launchIntegrationReady ? (
                    <Action
                      theme={theme}
                      inline
                      label={t("setUp")}
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
                title={t("accountsFromCcSwitch")}
                description={
                  status.data.profiles.length
                    ? t("accountsStored", {
                        count: status.data.profiles.length,
                        unit:
                          status.data.profiles.length === 1
                            ? t("accountUnit")
                            : t("accountsUnit"),
                      })
                    : t("importAccountDescription")
                }
                status={
                  status.data.profiles.length
                    ? t("importedCount", {
                        count: status.data.profiles.length,
                      })
                    : t("notImported")
                }
                statusTone={status.data.profiles.length ? "success" : "muted"}
                action={
                  <Action
                    theme={theme}
                    inline
                    secondary={status.data.profiles.length > 0}
                    label={
                      status.data.profiles.length ? t("sync") : t("import")
                    }
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
                title={t("codexAgents")}
                description={
                  status.data.unmonitoredCount > 0
                    ? t("agentsNeedReload", {
                        count: status.data.unmonitoredCount,
                        unit:
                          status.data.unmonitoredCount === 1
                            ? t("agentUnit")
                            : t("agentsUnit"),
                        verb:
                          status.data.unmonitoredCount === 1
                            ? t("needs")
                            : t("need"),
                      })
                    : status.data.sessions.length > 0
                      ? t("accountPillDescription")
                      : t("startAgentDescription")
                }
                status={
                  status.data.sessions.length
                    ? t("readyCount", { count: status.data.sessions.length })
                    : t("noneReady")
                }
                statusTone={status.data.sessions.length ? "success" : "muted"}
              />
            </SettingsSection>

            <SettingsSection theme={theme} title={t("accounts")}>
              {status.data.profiles.length ? (
                status.data.profiles.map((profile, index) => (
                  <SettingsRow
                    key={profile.id}
                    theme={theme}
                    compact={compactRows}
                    first={index === 0}
                    icon="UserRound"
                    title={profile.name}
                    description={t("importedFromCcSwitch", {
                      label: profile.accountLabel,
                    })}
                    status={t("available")}
                    statusTone="success"
                    action={
                      <Action
                        theme={theme}
                        inline
                        secondary
                        label={t("rename")}
                        onPress={() => setProfileToRename(profile)}
                      />
                    }
                  />
                ))
              ) : (
                <SettingsRow
                  theme={theme}
                  compact={compactRows}
                  first
                  icon="UserRound"
                  title={t("noImportedAccounts")}
                  description={t("noImportedAccountsDescription")}
                />
              )}
            </SettingsSection>

            <SettingsSection theme={theme} title={t("agentsOnHost")}>
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
                        : t("runtimeVerified", {
                            label: session.previousLabel,
                            verification:
                              session.verification === "email"
                                ? t("verified")
                                : session.verification,
                          })
                    }
                    status={
                      session.changed
                        ? t("accountChangedStatus")
                        : session.busy
                          ? t("busy")
                          : t("current")
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
                          label={t("review")}
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
                  title={t("noMonitoredAgents")}
                  description={t("noMonitoredAgentsDescription")}
                />
              )}
            </SettingsSection>

            {status.data.migrations.length ? (
              <SettingsSection theme={theme} title={t("recentMigrations")}>
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
                        ? t("newAgent", { id: task.newAgentId })
                        : t("migrationInProgress"))
                    }
                    status={task.state}
                    statusTone={task.error ? "danger" : "muted"}
                    action={
                      task.state === "completed" &&
                      task.newAgentId &&
                      props.navigation ? (
                        <Action
                          theme={theme}
                          inline
                          secondary
                          label={t("openAgent")}
                          onPress={() =>
                            props.navigation!.openAgent({
                              agentId: task.newAgentId!,
                            })
                          }
                        />
                      ) : undefined
                    }
                  />
                ))}
              </SettingsSection>
            ) : null}

            <SettingsSection theme={theme} title={t("preferences")}>
              <SettingsRow
                theme={theme}
                compact={compactRows}
                first
                icon="Languages"
                title={t("language")}
                description={t("languageDescription")}
                status={
                  status.data.settings.language === "auto"
                    ? t("automatic")
                    : status.data.settings.language === "zh-CN"
                      ? t("simplifiedChinese")
                      : t("english")
                }
                action={
                  <Action
                    theme={theme}
                    inline
                    secondary
                    label={t("change")}
                    onPress={() => {
                      settingsMutation.reset();
                      setPreference("language");
                    }}
                  />
                }
              />
              <SettingsRow
                theme={theme}
                compact={compactRows}
                icon="BadgeUser"
                title={t("accountPillSetting")}
                description={t("accountPillSettingDescription")}
                status={
                  status.data.settings.showAccountPill
                    ? t("enabled")
                    : t("disabled")
                }
                action={
                  <Switch
                    accessibilityLabel={t("accountPillSetting")}
                    value={status.data.settings.showAccountPill}
                    disabled={settingsMutation.isPending}
                    onValueChange={(showAccountPill) =>
                      settingsMutation.mutate({ showAccountPill })
                    }
                  />
                }
              />
              <SettingsRow
                theme={theme}
                compact={compactRows}
                icon="BellDot"
                title={t("setupPillSetting")}
                description={t("setupPillSettingDescription")}
                status={
                  status.data.settings.showSetupPill
                    ? t("enabled")
                    : t("disabled")
                }
                action={
                  <Switch
                    accessibilityLabel={t("setupPillSetting")}
                    value={status.data.settings.showSetupPill}
                    disabled={settingsMutation.isPending}
                    onValueChange={(showSetupPill) =>
                      settingsMutation.mutate({ showSetupPill })
                    }
                  />
                }
              />
            </SettingsSection>

            {settingsMutation.error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {settingsMutation.error.message}
              </Text>
            ) : null}

            {launchIntegrationReady ? (
              <SettingsSection theme={theme} title={t("advanced")}>
                <SettingsRow
                  theme={theme}
                  compact={compactRows}
                  first
                  icon="Undo2"
                  title={t("restoreLaunchCommand")}
                  description={t("restoreLaunchCommandDescription")}
                  action={
                    <Action
                      theme={theme}
                      inline
                      secondary
                      label={t("restore")}
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
            ? t("importAccountsTitle")
            : confirm === "restore"
              ? t("restoreLaunchesTitle")
              : t("setupSwitchingTitle")
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
                ? t("importConfirmation")
                : confirm === "restore"
                  ? t("restoreConfirmation")
                  : t("setupConfirmation")}
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
                  ? t("applying")
                  : confirm === "import"
                    ? t("importAccounts")
                    : confirm === "restore"
                      ? t("restoreCommand")
                      : t("continueSetup")
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
              label={t("cancel")}
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
          t={t}
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        />
      ) : null}
      {profileToRename ? (
        <RenameAccountDialog
          key={`${profileToRename.id}:${profileToRename.updatedAt}`}
          profile={profileToRename}
          theme={theme}
          t={t}
          open
          onOpenChange={(open) => {
            if (!open) setProfileToRename(null);
          }}
        />
      ) : null}
      {status.data ? (
        <>
          <ChoiceDialog<PluginLanguage>
            theme={theme}
            title={t("language")}
            options={[
              { value: "auto", label: t("automatic") },
              { value: "en", label: t("english") },
              { value: "zh-CN", label: t("simplifiedChinese") },
            ]}
            value={status.data.settings.language}
            open={preference === "language"}
            pending={settingsMutation.isPending}
            error={settingsMutation.error}
            onSelect={(language) => settingsMutation.mutate({ language })}
            onOpenChange={(open) => {
              if (!open) setPreference(null);
            }}
          />
        </>
      ) : null}
    </ScrollView>
  );
}
