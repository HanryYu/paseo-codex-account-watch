# Paseo Codex 账号监听插件

[English](README.md)

独立的实验性 Paseo 插件，不需要修改 Paseo 源码。监听 CC Switch 等工具对 host 上 Codex 文件凭据的修改，由用户决定是否刷新对应 agent。

## 安装和启用

运行 Codex 的每台 host 需要 macOS 或 Linux、Node.js 22.13+，并且 daemon 能找到 `paseo`、`codex` 命令。已测试 Paseo `0.7.0-beta.3` 和 Codex `0.149.1`，不支持更早的 Paseo 插件接口。

先在 Paseo **Settings → Plugins** 开启插件，再执行：

```sh
paseo plugin add HanryYu/paseo-codex-account-watch
```

进入侧栏 **Codex accounts**，确认页面显示的是目标 host，点击 **Set up account switching**，再按引导导入账号。插件会自动保存并修改该 host 的 Codex 启动命令；不需要终端或手工编辑配置。安装本身不会改启动命令，也不会复制凭据。

Paseo 插件 API 暂未开放 Host Settings 区块或原生 Settings 路由，因此当前入口仍是 host-scoped sidebar surface。Host picker 由 Paseo 管理，所有操作只会作用于页面选中的 host。未接管的旧 Codex agent 会显示 **Codex account setup** 输入框入口并打开该页面。

已运行的进程不会被接管。先新建一个 Codex agent 测试；已有 agent 要等到 Paseo 下一次启动它的进程后才会纳入监听。插件不会强制结束无法刷新的未监听旧进程。

### 导入 CC Switch 账号

在 **Codex accounts** 中选择 **Import accounts from CC Switch**。插件以只读方式打开当前 host 默认的 `~/.cc-switch/cc-switch.db`，把包含有效 `auth` 数据的 Codex provider 复制到 host 私有目录，并为每份数据创建一个具有独立 `CODEX_HOME` 的 Paseo Codex provider。

点击空闲受监听 agent 的账号入口并选择导入账号。再次确认后，插件会先持久化迁移任务，把该 Codex thread 的 rollout 硬链接到目标账号目录，再启动独立 runner。runner 会重启准确的 Paseo host，使用 `Codex · <CC Switch 名称>` 自动导入原 thread、恢复 agent 名称，并通过 CLI 再次确认新 agent 存在。旧 agent 保持关闭且不归档，作为恢复副本。

host 重启会中断该 host 上所有正在运行的 agent，因此所选 agent 忙碌时不能迁移，确认弹窗也会明确提示影响范围。导入失败会保留为可见迁移记录，不会显示切换成功。

目标进程只会读取和刷新 profile 的凭据，不覆盖全局 `~/.codex/auth.json`，也不修改 CC Switch 数据库。重新导入可以同步凭据和配置。无需重启即可注册新 provider 的能力仍在 [Paseo PR #2785](https://github.com/getpaseo/paseo/pull/2785) 中。

CC Switch 的官方 provider 行通常不保存当前 ChatGPT 凭据，插件会跳过，而不会把全局 Codex 账号冒充为已导入账号。本版也不会自动发现 CC Switch 的自定义数据目录。

Paseo 当前不能修改既有 agent 的 provider，因此插件会在重启后为同一 Codex thread 创建新的 Paseo agent，而不是改写旧记录。

## 使用

1. 在 Paseo 启动一个受监听的 Codex agent。输入框上方会用紧凑入口显示当前账号，点击可打开该 host 的账号页面。
2. 使用 CC Switch 等工具切换**同一 host** 的 Codex 账号。
3. 输入框附近出现 **Codex account changed** 提醒。点击后显示旧进程报告的账号和 host 上的新凭据身份。
4. **Keep current session** 保持现有进程；**Reload agent** 会先结束匹配的空闲进程，再由 Paseo 恢复原 Codex thread。

刷新时显示进度和错误，成功提示会带上新进程实际报告的邮箱。运行中的回合、过期确认、线程不匹配、凭据不稳定或启动命令被外部修改都会阻止刷新。提醒不会自动弹窗，也不会自动重启 agent。

Paseo 插件 API 暂未开放内置的上下文/额度 tooltip。账号使用官方 composer pill 入口显示在它附近，不注入 DOM，也不修改 Paseo 主程序。

“保持原进程”不是冻结旧凭据：插件不会复制或固定 token，无法保证账号被撤销、token 到期或 Codex 自行重新认证后仍使用旧账号。

Codex 的 `account/read` 可以报告邮箱和账号类型，但不提供 workspace ID、API key 或后续请求的计费账号。因此，同邮箱下切换 workspace 可以检测，但不能确认运行时的 workspace；API key 变化也只能检测，不能给出已验证切换的成功提示。

## Mac mini 等远程 host

```sh
paseo plugin add HanryYu/paseo-codex-account-watch --host ssh://user@mac-mini
```

然后在 Paseo 的插件页面选择该 host 并启用监听。Mac mini 上的插件负责读 Mac mini 的凭据，本机只显示远程提醒并发送确认。远程离线不会退回本机执行。每个 host 安装一次，使用默认插件 ID。

已验证独立 daemon 的 host 隔离；尚未完成两台实体机器之间的 SSH 实测。

## 恢复与卸载

先在插件内选择 **Restore original launch command**，再执行：

```sh
paseo plugin remove paseo-codex-account-watch
```

远程操作加上原来的 `--host`。恢复不结束已运行的进程；若启动命令被其他工具修改，插件会拒绝覆盖。原来没有显式命令时，恢复为 `["codex"]`，不是删除该配置字段。

禁用、卸载不会自动恢复命令。若已误卸载，重新安装后使用恢复按钮。launcher 保存在 host 的 `PASEO_HOME/plugin-data/codex-account-watch`，不依赖插件 Git 目录。

更新命令为 `paseo plugin update paseo-codex-account-watch`。若要让新进程使用更新后的 launcher，恢复后重新启用；旧进程等退出后才替换。

## 支持范围与验证

目前仅支持内置 Codex provider，以及 `CODEX_HOME/auth.json`（默认 `~/.codex/auth.json`）中的文件凭据。不支持 Windows host、自定义 provider/profile、仅钥匙串或仅环境变量中的认证。

已完成类型检查、自动化测试、真实 Paseo 隔离 daemon 测试，以及真实 Codex 的只读 `account/read` 测试。UI 已检查英文版桌面深浅色弹窗和窄屏面板。

没有用两个真实付费账号发送模型请求，也没有验证额度归属；原生 iOS/Android 和远程实体机器测试仍需补充。测试方式和实现边界见 [英文文档](README.md#development-and-validation)。

隔离 daemon 测试还会导入合成的 CC Switch SQLite 账号、仅重启该测试 host，并确认迁移任务把相同 thread 导入到原 workspace 的独立 provider。
