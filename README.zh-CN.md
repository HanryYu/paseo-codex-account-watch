# Paseo Codex 账号监听插件

[English](README.md)

独立的实验性 Paseo 插件，不需要修改 Paseo 源码。监听 CC Switch 等工具对 host 上 Codex 文件凭据的修改，由用户决定是否刷新对应 agent。

## 安装和启用

运行 Codex 的每台 host 需要 macOS 或 Linux、Node.js 22+，并且 daemon 能找到 `paseo`、`codex` 命令。已测试 Paseo `0.7.0-beta.3` 和 Codex `0.149.1`，不支持更早的 Paseo 插件接口。

先在 Paseo **Settings → Plugins** 开启插件，再执行：

```sh
paseo plugin add HanryYu/paseo-codex-account-watch
```

进入侧栏 **Codex accounts**，点击 **Enable monitored Codex launches**，确认后插件会自动保存并修改这个 host 的 Codex 启动命令。安装本身不会修改启动配置；不需要手工编辑项目配置。其他 provider 和原有环境变量会保留。

已运行的进程不会被接管。先新建一个 Codex agent 测试；已有 agent 要等到 Paseo 下一次启动它的进程后才会纳入监听。插件不会强制结束无法刷新的未监听旧进程。

## 使用

1. 在 Paseo 启动一个受监听的 Codex agent。
2. 使用 CC Switch 等工具切换**同一 host** 的 Codex 账号。
3. 输入框附近出现 **Codex account changed** 提醒。点击后显示旧进程报告的账号和 host 上的新凭据身份。
4. **Keep current session** 保持现有进程；**Reload agent** 会先结束匹配的空闲进程，再由 Paseo 恢复原 Codex thread。

刷新时显示进度和错误，成功提示会带上新进程实际报告的邮箱。运行中的回合、过期确认、线程不匹配、凭据不稳定或启动命令被外部修改都会阻止刷新。提醒不会自动弹窗，也不会自动重启 agent。

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
