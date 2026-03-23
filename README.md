# Codex Mate

<div align="center">

<img src="res/logo.png" alt="Codex Mate logo" width="110">

[![Build](https://img.shields.io/github/actions/workflow/status/SakuraByteCore/codexmate/release.yml?label=build)](https://github.com/SakuraByteCore/codexmate/actions/workflows/release.yml)
[![Version](https://img.shields.io/npm/v/codexmate?label=version&registry_uri=https%3A%2F%2Fregistry.npmjs.org)](https://www.npmjs.com/package/codexmate)
[![Downloads](https://img.shields.io/npm/dt/codexmate?label=downloads)](https://www.npmjs.com/package/codexmate)
[![Status](https://img.shields.io/badge/status-alpha-orange)](https://github.com/SakuraByteCore/codexmate)
[![Maintain](https://img.shields.io/github/commit-activity/m/SakuraByteCore/codexmate?label=maintain%2Fmonth)](https://github.com/SakuraByteCore/codexmate/commits)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-green.svg)](https://nodejs.org)

**轻量级 AI 配置助手：快速切换 Codex 提供商/模型与 Claude Code 配置，统一浏览本地会话**

</div>

---

<p align="center">中文 · <a href="README.en.md">English</a></p>

![Codex Mate Web UI](res/screenshot.png)

## 概览

Codex Mate 让 Codex 与 Claude Code 的提供商/模型切换变成“一条命令或一次点击”，并在同一 Web 页面浏览、导出两者的本地会话记录。

## 60 秒上手（源码一行安装）

环境要求：`Node.js >= 14`、`Git`

```bash
git clone https://github.com/SakuraByteCore/codexmate.git && cd codexmate && npm install && npm link && codexmate run
```

浏览器打开 `http://localhost:3737`。

首次使用建议再执行：

```bash
codexmate setup
codexmate status
```

如果你只想临时试用，可直接用：

```bash
npx codexmate@latest run
```

## 三条高频路径

1. 快速切换 Codex 提供商与模型

```bash
codexmate switch <提供商>
codexmate use <模型>
```

2. 一行写入 Claude Code 配置

```bash
codexmate claude <BaseURL> <API_KEY> <模型>
```

3. 导出本地会话到 Markdown

```bash
codexmate export-session --source codex --session-id <ID>
```

## 核心命令（最常用）

| 目标 | 命令 |
| --- | --- |
| 查看当前状态 | `codexmate status` |
| 启动 Web UI | `codexmate run` |
| 交互式初始化 | `codexmate setup` |
| 查看提供商/模型 | `codexmate list` / `codexmate models` |
| 切换提供商/模型 | `codexmate switch <提供商>` / `codexmate use <模型>` |
| 写入 Claude 配置 | `codexmate claude <BaseURL> <API_KEY> [模型]` |
| 导出会话 | `codexmate export-session --source <codex|claude> ...` |

## 你能获得什么

- 更快的模型/提供商切换
- 更可控的本地配置管理
- 可视化 Web 操作，降低命令行负担
- 配置变更可回溯、有备份
- Codex + Claude Code 统一会话浏览（查看/导出/可用时复制恢复命令）
- 0.0.10 新增：Claude 会话支持关键词搜索（含 `claude code` / `claude-code` / 数字关键词）
- 0.0.14 新增：Skills 管理弹窗加入统计概览、筛选区优化与更细滚动条

## 功能总览

| 模块 | 解决的问题 | 关键能力 |
| --- | --- | --- |
| Codex 配置 | 多提供商/多模型切换麻烦 | 提供商/模型切换、模型管理、CLI + Web 双入口、模板确认写入 |
| Skills 管理 | 本地自定义 skills 分散且难排查 | Skills 弹窗统计概览、关键词/状态筛选、多选删除、跨应用扫描导入 |
| Claude Code 配置 | 多方案共存、写入路径不统一 | 多配置方案管理、默认写入 `~/.claude/settings.json` |
| OpenClaw 配置 | OpenClaw 配置分散 | JSON5 多配置管理、应用到 `~/.openclaw/openclaw.json`、Workspace 指令文件管理 |
| 会话浏览 | 本地会话难以追踪 | 会话列表/筛选、关键词搜索（支持 Codex/Claude）、Markdown 导出、可用时复制恢复命令、删除与批量清理 |
| 附属工具 | 压缩/解压需额外工具 | 优先 7-Zip，JS 库兜底 |

## 为什么选 Codex Mate

- 聚焦三件事：Codex 切换 + Claude Code 配置 + OpenClaw 配置
- 本地优先：配置与密钥落地本机
- 轻量：CLI + Web，无需桌面客户端
- 安全感：首次接管前自动备份

## 范围与边界

- 只做 Codex、Claude Code 与 OpenClaw 的配置管理，不做全量多工具一体化
- 不内置代理/转发/费用面板/云同步（保持轻量）
- Web UI 仅在你启动时运行（`codexmate run`）

## 竞品/替代

- cc-switch: https://github.com/farion1231/cc-switch

## 安装

### 从源码安装（推荐，一行命令）

```bash
git clone https://github.com/SakuraByteCore/codexmate.git && cd codexmate && npm install && npm link
```

安装完成后建议先验证：

```bash
codexmate status
codexmate run
```

### 使用 npx（免安装）

```bash
npx codexmate@latest status
npx codexmate@latest run
```

### 全局安装（npm）

```bash
npm install -g codexmate
```

npm 包名：`codexmate`。若希望每次执行都更新到仓库最新版本，可使用：

```bash
npm install -g github:SakuraByteCore/codexmate
```

### 环境要求

- Node.js >= 14
- 支持 Windows / macOS / Linux

## 命令行速查

| 命令 | 说明 |
| --- | --- |
| `codexmate` | 查看帮助与可用命令 |
| `codexmate setup` | 交互式配置向导 |
| `codexmate status` | 查看当前状态 |
| `codexmate list` | 列出所有提供商 |
| `codexmate switch <提供商名称>` | 切换提供商 |
| `codexmate use <模型名称>` | 切换模型 |
| `codexmate add <名称> <URL> [API密钥]` | 添加新提供商 |
| `codexmate delete <提供商名称>` | 删除提供商 |
| `codexmate claude <BaseURL> <API密钥> [模型]` | 一键写入 Claude Code 配置到 `~/.claude/settings.json` |
| `codexmate models` | 列出所有模型 |
| `codexmate add-model <模型名称>` | 添加模型 |
| `codexmate delete-model <模型名称>` | 删除模型 |
| `codexmate run` | 启动 Web 界面 |
| `codexmate mcp [serve] [--transport stdio] [--allow-write\|--read-only]` | 启动 MCP stdio 服务（默认只读） |
| `codexmate export-session --source <codex|claude> (--session-id <ID>|--file <PATH>) [--output <PATH>] [--max-messages <N|all|Infinity>]` | 导出指定会话为 Markdown |

## MCP（stdio）

- 传输方式：仅支持 `stdio`
- 默认模式：只读工具集
- 写入工具开启方式：`--allow-write` 或 `CODEXMATE_MCP_ALLOW_WRITE=1`
- `codexmate.claude.settings.get` 的敏感字段默认脱敏返回

```bash
# 只读（推荐给外部 Agent 接入）
codexmate mcp serve --read-only

# 显式开启写工具
codexmate mcp serve --allow-write
```

当前提供的 MCP 能力：

- `tools`：状态/提供商/模型/会话/认证/代理/配置等操作
- `resources`：status/providers/sessions 快照资源
- `prompts`：诊断/安全切换/会话导出模板

## Web 界面

启动 Web 界面（自动打开浏览器）：

```bash
codexmate run
```

### Codex 配置模式

- 查看当前提供商和模型状态
- 快速切换提供商与模型
- 管理可用模型列表
- 编辑 `~/.codex/AGENTS.md` 指令文件（与 `config.toml` 同级）
- 打开 `~/.codex/skills` 的 Skills 管理弹窗（统计概览、关键词/状态筛选、多选删除、跨应用扫描导入）
- 添加/删除自定义提供商
- 支持 Linux / Windows 环境下的 Codex 配置管理

### Skills 管理弹窗

- 提供 `总数 / 含 SKILL.md / 缺少 SKILL.md / 可导入` 四项统计，便于快速盘点
- 支持按目录名、显示名、描述关键词检索，并支持 `SKILL.md` 状态筛选
- 支持本地 skills 多选后批量删除
- 支持扫描其他应用中未托管 skill，并勾选后批量导入

### Claude Code 配置模式（Windows / macOS / Linux）

- 管理多个 Claude Code 配置方案
- 配置 API Key、Base URL 和模型
- 默认写入 `~/.claude/settings.json` 的 `env` 字段：`env.ANTHROPIC_API_KEY` / `env.ANTHROPIC_BASE_URL` / `env.ANTHROPIC_MODEL`
- CLI 一行应用示例：

```bash
codexmate claude https://api.example.com/v1 sk-ant-xxx claude-3-7-sonnet
```

- Web 界面中每个 Claude 配置卡片新增“分享导入命令”按钮，可复制一条 `codexmate claude <BaseURL> <API Key> <模型>` 命令便于分享。

### OpenClaw 配置模式

- 管理多个 OpenClaw JSON5 配置方案
- 应用到 `~/.openclaw/openclaw.json`
- 管理 OpenClaw Workspace 下的 `AGENTS.md`（默认 `~/.openclaw/workspace/AGENTS.md`）

### 会话浏览模式

- 在同一 Web 页面查看 Codex 与 Claude Code 的本地会话列表
- 支持按来源筛选（Codex / Claude / 全部）
- 支持按已有会话路径（cwd）筛选，选择后自动刷新
- 支持一键导出指定会话为 Markdown
- 支持在可用时复制恢复命令
- 支持删除指定会话（本地 jsonl 记录）
- 支持勾选多条会话并批量删除，部分失败会汇总提示
- 支持在会话详情内单条删除记录或多选批量删除记录（写回原始 jsonl）

### Codex 模板确认模式

- Web 中的 Codex 配置改动默认进入 `config.toml` 模板编辑器
- 仅在用户点击“确认应用模板”后才写入 `config.toml`
- 不再通过前端一键操作直接改写 `config.toml`

## 配置文件

配置文件位于 `~/.codex/` 目录：

- `config.toml` - Codex 主配置文件
- `auth.json` - API 认证信息
- `models.json` - 可用模型列表
- `provider-current-models.json` - 提供商当前模型配置
- `codexmate-init.json` - 首次初始化标记（用于避免重复重置）
- `config.toml.codexmate-backup-*.bak` - 首次初始化时自动备份的旧配置（若存在）

Claude Code 配置应用涉及：

- `~/.claude/settings.json` - Claude Code 运行时配置（默认写入目标）
- `~/.claude/settings.json.codexmate-backup-*.bak` - 首次改写前自动备份（若存在旧文件）

OpenClaw 配置涉及：

- `~/.openclaw/openclaw.json` - OpenClaw 配置（JSON5）
- `~/.openclaw/workspace/AGENTS.md` - OpenClaw Workspace 指令文件

## 首次运行初始化说明

首次运行 `codexmate` 且检测到已有 `~/.codex/config.toml` 且不是 Codex Mate 管理的配置时，会发生以下行为：

- 会先自动备份原文件为 `config.toml.codexmate-backup-时间戳.bak`
- 默认保留原 `config.toml` 不覆盖，并写入初始化标记
- 仅在显式设置环境变量 `CODEXMATE_FORCE_RESET_EXISTING_CONFIG=1` 时，才会重建默认配置
- 后续运行不会重复处理，避免影响已稳定使用的用户配置

## 使用示例

### 添加自定义 API 提供商

```bash
codexmate add myapi https://api.example.com/v1 sk-your-api-key
codexmate switch myapi
```

### 切换到不同的模型

```bash
codexmate use gpt-4-turbo
```

### 导出会话（CLI）

```bash
codexmate export-session --source codex --session-id 123456
codexmate export-session --source claude --file "~/.claude/projects/demo/session.jsonl" --max-messages=all
```

默认最多导出 1000 条消息；如需完整导出可用 `--max-messages=all`（或 `Infinity`）。

### 配置 Claude Code（跨平台）

1. 启动 Web 界面：`codexmate run`
2. 在浏览器中切换到 "Claude Code 配置" 模式
3. 添加配置方案（例如智谱 GLM）：配置名称=智谱GLM，API Key=你的 API Key，Base URL=`https://open.bigmodel.cn/api/anthropic`，模型=`glm-4.7`
4. 点击配置卡片直接应用，或在编辑弹窗点击“保存并应用到 Claude 配置”
5. 默认写入 `~/.claude/settings.json`
6. 重启 Claude Code，新的配置即生效

### 启动 Web 界面

```bash
codexmate run
```

默认仅监听 `127.0.0.1`。如需局域网访问，可用 `--host` 或 `CODEXMATE_HOST`：

```bash
codexmate run --host 0.0.0.0
```

然后在浏览器中打开 `http://localhost:3737`（或你指定的地址）。注意：监听 `0.0.0.0` 在不可信网络下不安全。

## 常见问题

### Q: 支持哪些操作系统？

A: Codex 功能支持 Windows 和 Linux（CLI 与 Web）。Claude Code 配置应用默认支持 Windows / macOS / Linux（写入 `~/.claude/settings.json`）。

### Q: API key 存储在哪里？

A: API key 存储在本地配置文件 `~/.codex/config.toml` 中，不会上传到任何服务器。

### Q: Web 界面安全吗？

A: Web 界面运行在本地，所有操作都在本地完成。API key 在界面中仅显示脱敏版本。

### Q: Claude Code 配置后如何生效？

A: 点击“应用到 Claude 配置”后会写入 `~/.claude/settings.json`，重启 Claude Code 即生效。

### Q: 如何卸载？

A: 运行 `npm uninstall -g codexmate`。

## 附属功能：压缩/解压

优先使用 7-Zip 多线程压缩/解压。缺失时回退内置 JS 库。

```bash
# 压缩文件或文件夹（默认压缩级别 5）
codexmate zip <文件或文件夹路径>

# 指定压缩级别（0-9，0=仅存储，9=极限压缩）
codexmate zip <路径> --max:9

# 解压 zip 文件（默认解压到同级目录下同名文件夹）
codexmate unzip <zip文件路径>

# 解压到指定目录
codexmate unzip <zip文件路径> <输出目录>
```

使用示例：

```bash
# 压缩项目文件夹
codexmate zip ./my-project

# 极限压缩
codexmate zip ./my-project --max:9

# 快速压缩（仅存储）
codexmate zip ./large-folder --max:0

# 解压文件
codexmate unzip ./my-project.zip

# 解压到指定位置
codexmate unzip ./backup.zip D:/restored
```

注意：7-Zip 非必需。未安装时使用内置 JS 库；`--max` 仅对 7-Zip 生效。

## 技术栈

- **Node.js** - 运行环境
- **@iarna/toml** - TOML 配置文件解析
- **Vue.js 3** - Web 界面框架
- **原生 HTTP** - 内建 Web 服务器

## 发布（GitHub Actions）

创建与 `package.json` 版本一致的标签（例如 `v0.0.14`）。然后在 GitHub Actions 中手动运行 `release` 工作流并输入该标签，系统会创建 GitHub Release，并附带 `npm pack` 生成的 `.tgz` 产物。

## 许可证

Apache-2.0 © [ymkiux](https://github.com/ymkiux)

## 贡献

欢迎提交 Issue 和 Pull Request。

## 更新日志

英文版见 [doc/CHANGELOG.md](doc/CHANGELOG.md)。
中文版见 [doc/CHANGELOG.zh-CN.md](doc/CHANGELOG.zh-CN.md)。

---

Made with [ymkiux](https://github.com/ymkiux)

