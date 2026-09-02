import type { PluginLanguage } from "./settings.shared";

export type Locale = "en" | "zh-CN";

const en = {
  accountChanged: "Codex account changed",
  currentProcessReports: "Current process reports",
  credentialsNowIdentify: "Credentials on this host now identify",
  reloadExplanation:
    "Reload restarts this agent on the same Codex thread. Keeping the session does not change or stop its current process.",
  verificationExplanation:
    "Codex verifies the email and account type. Its account/read API does not expose the workspace ID or API key.",
  waitForTurn: "Wait for the current turn to finish.",
  reloadedAs: "Agent reloaded. Codex reports {label}.",
  reloadUnverified:
    "Agent reloaded, but the expected account could not be verified.",
  reloadUnverifiedDetail:
    "The process restarted and reports {label}, but the expected account could not be verified.",
  monitorUnavailable:
    "Cannot reach this host's account monitor. Reload is unavailable until it reconnects.",
  reloadingAgent: "Reloading agent…",
  retryReload: "Retry reload",
  reloadAgent: "Reload agent",
  close: "Close",
  keepSession: "Keep current session",
  chooseAccount: "Choose Codex account",
  migrationExplanation:
    "Switching restarts this Paseo host, imports the same Codex thread under the selected account, and keeps the old agent closed as a recovery copy. Every running agent on this host is interrupted.",
  current: "Current",
  importFirst: "Import CC Switch accounts first.",
  restartingHost: "Restarting host…",
  restartAndSwitch: "Restart host and switch",
  cancel: "Cancel",
  setupPill: "Codex account setup",
  accountChangedPill: "Codex account changed",
  reviewAccountChange: "Review Codex account change",
  currentAccount: "Current Codex account: {label}",
  setupAccountSwitching: "Set up Codex account switching",
  hostDescription:
    "Configure isolated Codex accounts for this host. Credentials and launch settings stay on the host you selected.",
  checkingHost: "Checking this host…",
  retry: "Retry",
  setup: "Setup",
  launchIntegration: "Agent launch integration",
  launchIntegrationDescription:
    "Identifies the active account and enables safe agent restarts and thread migration.",
  ready: "Ready",
  actionRequired: "Action required",
  setUp: "Set up",
  accountsFromCcSwitch: "Accounts from CC Switch",
  accountsStored: "{count} {unit} stored privately on this host.",
  accountUnit: "account",
  accountsUnit: "accounts",
  importAccountDescription:
    "Import account profiles into isolated CODEX_HOME directories.",
  importedCount: "{count} imported",
  notImported: "Not imported",
  sync: "Sync",
  import: "Import",
  codexAgents: "Codex agents",
  agentsNeedReload:
    "{count} existing {unit} {verb} to be started again or reloaded after setup.",
  agentUnit: "agent",
  agentsUnit: "agents",
  needs: "needs",
  need: "need",
  accountPillDescription:
    "Choose an imported Codex provider for a new agent, or use the account pill to switch an existing agent.",
  startAgentDescription:
    "Start a new agent or reload an existing one after importing accounts.",
  readyCount: "{count} ready",
  noneReady: "None ready",
  accounts: "Accounts",
  importedFromCcSwitch: "{label} · Imported from CC Switch",
  available: "Available",
  noImportedAccounts: "No imported accounts",
  noImportedAccountsDescription:
    "Complete setup above, then import accounts from CC Switch.",
  agentsOnHost: "Agents on this host",
  runtimeVerified: "{label} · Runtime {verification}",
  verified: "verified",
  busy: "Busy",
  accountChangedStatus: "Account changed",
  review: "Review",
  change: "Change",
  noMonitoredAgents: "No monitored agents",
  noMonitoredAgentsDescription:
    "New or reloaded Codex agents will appear here when launch integration is ready.",
  recentMigrations: "Recent migrations",
  newAgent: "New agent {id}",
  migrationInProgress: "Host migration in progress",
  advanced: "Advanced",
  restoreLaunchCommand: "Restore original launch command",
  restoreLaunchCommandDescription:
    "Remove the account wrapper for future Codex processes on this host.",
  restore: "Restore",
  preferences: "Preferences",
  language: "Language",
  languageDescription: "Use the Paseo language when available.",
  automatic: "Automatic",
  english: "English",
  simplifiedChinese: "Simplified Chinese",
  accountPillSetting: "Show account in composer",
  accountPillSettingDescription:
    "Display the current account and account switcher above the message box.",
  setupPillSetting: "Show setup reminders",
  setupPillSettingDescription:
    "Show a setup pill for Codex agents that are not monitored yet.",
  enabled: "On",
  disabled: "Off",
  rename: "Rename",
  renameAccount: "Rename account",
  accountName: "Account name",
  accountNamePlaceholder: "Work, Personal, Client…",
  save: "Save",
  saving: "Saving…",
  accountRenamed: "Account renamed to {name}.",
  settingsSaved: "Preferences saved.",
  importAccountsTitle: "Import CC Switch accounts",
  restoreLaunchesTitle: "Restore Codex launches",
  setupSwitchingTitle: "Set up account switching",
  importConfirmation:
    "Read Codex providers from ~/.cc-switch/cc-switch.db on this host. Valid credentials and provider configuration are copied into private, isolated CODEX_HOME directories. Raw credentials stay on this host and are never returned to the client. Official CC Switch rows without stored credentials are skipped.",
  restoreConfirmation:
    "Restore the saved Codex command on this host. Existing processes are not stopped. If another tool changed the command, restoration is refused.",
  setupConfirmation:
    "The plugin will configure this host's Codex launch command through Paseo. Future Codex processes run through a transparent local wrapper that reports the active account and enables safe restart and thread migration. The original command is saved and can be restored here. Existing processes are not interrupted. No terminal setup is required.",
  applying: "Applying…",
  importAccounts: "Import accounts",
  restoreCommand: "Restore command",
  continueSetup: "Continue setup",
  setupComplete: "Account switching is ready on this host.",
  restoreComplete: "The original Codex launch command was restored.",
  importComplete:
    "CC Switch accounts: {imported} imported, {updated} updated, {skipped} skipped. Choose an imported Codex provider when creating a new agent, or use the account pill in an existing agent.",
  migrationScheduled:
    "Account migration {id} scheduled. This host is restarting.",
} as const;

type MessageKey = keyof typeof en;
type Messages = Record<MessageKey, string>;

const zhCN: Messages = {
  accountChanged: "Codex 账号已更改",
  currentProcessReports: "当前进程使用",
  credentialsNowIdentify: "此 Host 当前凭据对应",
  reloadExplanation:
    "重新加载会在同一个 Codex 会话中重启此 Agent。保留当前会话不会更改或停止正在运行的进程。",
  verificationExplanation:
    "Codex 会验证邮箱和账号类型；account/read API 不会返回 Workspace ID 或 API Key。",
  waitForTurn: "请等待当前任务执行完成。",
  reloadedAs: "Agent 已重新加载，Codex 当前报告为 {label}。",
  reloadUnverified: "Agent 已重新加载，但无法验证预期账号。",
  reloadUnverifiedDetail: "进程已重启并报告为 {label}，但无法验证预期账号。",
  monitorUnavailable:
    "无法连接此 Host 的账号监控服务，重新连接前不能重新加载。",
  reloadingAgent: "正在重新加载 Agent…",
  retryReload: "重试重新加载",
  reloadAgent: "重新加载 Agent",
  close: "关闭",
  keepSession: "保留当前会话",
  chooseAccount: "选择 Codex 账号",
  migrationExplanation:
    "切换账号会重启此 Paseo Host，并在所选账号下导入同一个 Codex 会话。旧 Agent 会保持关闭作为恢复副本，此 Host 上所有运行中的 Agent 都会被中断。",
  current: "当前",
  importFirst: "请先导入 CC Switch 账号。",
  restartingHost: "正在重启 Host…",
  restartAndSwitch: "重启 Host 并切换",
  cancel: "取消",
  setupPill: "设置 Codex 账号",
  accountChangedPill: "Codex 账号已更改",
  reviewAccountChange: "检查 Codex 账号变更",
  currentAccount: "当前 Codex 账号：{label}",
  setupAccountSwitching: "设置 Codex 账号切换",
  hostDescription:
    "管理此 Host 上的独立 Codex 账号。凭据和启动设置只保存在当前选择的 Host。",
  checkingHost: "正在检查此 Host…",
  retry: "重试",
  setup: "设置",
  launchIntegration: "Agent 启动集成",
  launchIntegrationDescription:
    "识别当前账号，并支持安全重启 Agent 和迁移会话。",
  ready: "已就绪",
  actionRequired: "需要操作",
  setUp: "设置",
  accountsFromCcSwitch: "CC Switch 账号",
  accountsStored: "此 Host 已安全保存 {count} 个{unit}。",
  accountUnit: "账号",
  accountsUnit: "账号",
  importAccountDescription: "将账号资料导入独立的 CODEX_HOME 目录。",
  importedCount: "已导入 {count} 个",
  notImported: "尚未导入",
  sync: "同步",
  import: "导入",
  codexAgents: "Codex Agent",
  agentsNeedReload: "有 {count} 个现有{unit}{verb}重新启动或加载。",
  agentUnit: " Agent 需要",
  agentsUnit: " Agent 需要",
  needs: "",
  need: "",
  accountPillDescription:
    "新建 Agent 时可直接选择已导入的 Codex Provider；现有 Agent 可通过账号入口切换。",
  startAgentDescription: "导入账号后，新建 Agent 或重新加载现有 Agent。",
  readyCount: "{count} 个已就绪",
  noneReady: "暂无已就绪 Agent",
  accounts: "账号",
  importedFromCcSwitch: "{label} · 从 CC Switch 导入",
  available: "可用",
  noImportedAccounts: "没有已导入账号",
  noImportedAccountsDescription: "请先完成上方设置，然后导入 CC Switch 账号。",
  agentsOnHost: "此 Host 上的 Agent",
  runtimeVerified: "{label} · 运行时{verification}",
  verified: "已验证",
  busy: "执行中",
  accountChangedStatus: "账号已更改",
  review: "检查",
  change: "更改",
  noMonitoredAgents: "没有已监控 Agent",
  noMonitoredAgentsDescription:
    "启动集成就绪后，新建或重新加载的 Codex Agent 会显示在这里。",
  recentMigrations: "最近迁移",
  newAgent: "新 Agent {id}",
  migrationInProgress: "Host 迁移进行中",
  advanced: "高级",
  restoreLaunchCommand: "恢复原始启动命令",
  restoreLaunchCommandDescription:
    "移除以后启动的 Codex 进程所使用的账号包装器。",
  restore: "恢复",
  preferences: "偏好设置",
  language: "语言",
  languageDescription: "可用时跟随 Paseo 的语言设置。",
  automatic: "自动",
  english: "English",
  simplifiedChinese: "简体中文",
  accountPillSetting: "在输入框显示账号",
  accountPillSettingDescription: "在消息输入框上方显示当前账号和账号切换入口。",
  setupPillSetting: "显示设置提醒",
  setupPillSettingDescription: "为尚未纳入监控的 Codex Agent 显示设置入口。",
  enabled: "开启",
  disabled: "关闭",
  rename: "重命名",
  renameAccount: "重命名账号",
  accountName: "账号名称",
  accountNamePlaceholder: "工作、个人、客户……",
  save: "保存",
  saving: "保存中…",
  accountRenamed: "账号已重命名为 {name}。",
  settingsSaved: "偏好设置已保存。",
  importAccountsTitle: "导入 CC Switch 账号",
  restoreLaunchesTitle: "恢复 Codex 启动设置",
  setupSwitchingTitle: "设置账号切换",
  importConfirmation:
    "读取此 Host 上 ~/.cc-switch/cc-switch.db 中的 Codex Provider。有效凭据和 Provider 配置会被复制到独立的 CODEX_HOME 目录。原始凭据不会返回客户端；没有保存凭据的官方 CC Switch 条目会被跳过。",
  restoreConfirmation:
    "恢复此 Host 保存的 Codex 启动命令。现有进程不会停止；如果其他工具修改过该命令，插件会拒绝覆盖。",
  setupConfirmation:
    "插件会通过 Paseo 配置此 Host 的 Codex 启动命令。之后的 Codex 进程会使用透明的本地包装器，用于报告当前账号、安全重启和迁移会话。原始命令会被保存并可在此恢复；现有进程不会中断，也不需要终端设置。",
  applying: "正在应用…",
  importAccounts: "导入账号",
  restoreCommand: "恢复命令",
  continueSetup: "继续设置",
  setupComplete: "此 Host 的账号切换已就绪。",
  restoreComplete: "已恢复原始 Codex 启动命令。",
  importComplete:
    "CC Switch 账号：导入 {imported} 个，更新 {updated} 个，跳过 {skipped} 个。新建 Agent 时请选择导入的 Codex Provider；现有 Agent 可使用账号入口切换。",
  migrationScheduled: "账号迁移 {id} 已安排，此 Host 正在重启。",
};

const dictionaries: Record<Locale, Messages> = { en, "zh-CN": zhCN };

function systemLocale(): string {
  if (typeof navigator !== "undefined" && navigator.languages?.length)
    return navigator.languages[0];
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

export function resolveLocale(
  language: PluginLanguage,
  hostLocale?: string,
): Locale {
  const requested =
    language === "auto" ? hostLocale || systemLocale() : language;
  return requested.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function translate(
  locale: Locale,
  key: MessageKey,
  values: Record<string, string | number> = {},
): string {
  return dictionaries[locale][key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values[name] ?? `{${name}}`),
  );
}

export type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

export function translator(locale: Locale): Translate {
  return (key, values) => translate(locale, key, values);
}
