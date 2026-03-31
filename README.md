<div align="center">

# Codex Mate

**Codex / Claude Code / OpenClaw 的本地配置与会话管理工具**

[![Build](https://img.shields.io/github/actions/workflow/status/SakuraByteCore/codexmate/release.yml?label=build)](https://github.com/SakuraByteCore/codexmate/actions/workflows/release.yml)
[![Version](https://img.shields.io/npm/v/codexmate?label=version&registry_uri=https%3A%2F%2Fregistry.npmjs.org)](https://www.npmjs.com/package/codexmate)
[![Downloads](https://img.shields.io/npm/dt/codexmate?label=downloads)](https://www.npmjs.com/package/codexmate)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-green.svg)](https://nodejs.org)

[快速开始](#快速开始) · [命令速查](#命令速查) · [Web 界面](#web-界面) · [MCP](#mcp) · [English](README.en.md)

</div>

---

## 这是什么？

Codex Mate 提供一套本地优先的 CLI + Web UI，用于统一管理：

- Codex 的 provider / model 切换与配置写入
- Claude Code 配置方案（写入 `~/.claude/settings.json`）
- OpenClaw JSON5 配置与 Workspace `AGENTS.md`
- Codex / Claude Code Skills 市场（安装目标切换、本地 skills 管理、跨应用导入、ZIP 分发）
- Codex / Claude 本地会话浏览、筛选、导出、删除

项目不依赖云端托管，配置写入你的本地文件，便于审计和回滚。Skills 市场同样坚持本地优先，只操作本地目录，不依赖远程在线市场。

## 为什么选择 Codex Mate？

| 维度 | Codex Mate | 手动维护配置 |
| --- | --- | --- |
| 多工具管理 | Codex + Claude Code + OpenClaw 统一入口 | 多文件、多目录分散修改 |
| 使用方式 | CLI + 本地 Web UI | 纯手改 TOML / JSON / JSON5 |
| 会话处理 | 支持浏览、导出、批量清理 | 需要手动定位和处理文件 |
| Skills 复用 | 本地 Skills 市场 + 跨应用导入 + ZIP 分发 | 目录手动复制，容易遗漏 |
| 可回滚性 | 首次接管前自动备份 | 易误覆盖、回滚成本高 |
| 自动化接入 | 提供 MCP stdio（默认只读） | 需自行封装脚本 |

## 核心特性

**配置管理**
- provider / model 切换（`switch` / `use`）
- Codex `config.toml` 模板确认后写入
- Claude Code 多配置方案管理与一键应用
- OpenClaw JSON5 配置方案管理

**会话管理**
- 同页查看 Codex 与 Claude 会话
- 支持本地会话置顶，置顶状态持久化保存并优先排序显示
- 关键词搜索、来源筛选、cwd 路径筛选
- 会话导出 Markdown
- 会话与消息级删除（支持批量）

**Skills 市场**
- 在 Codex 与 Claude Code 之间切换 skills 安装目标
- 查看本地已安装 skills、根目录与状态
- 扫描 `Codex` / `Claude Code` / `Agents` 可导入来源
- 支持跨应用导入、ZIP 导入 / 导出、批量删除

**工程能力**
- MCP stdio 能力（tools/resources/prompts）
- 内建代理配置与状态控制（`proxy`）
- 认证档案管理（`auth`）
- Zip 压缩/解压（优先系统工具，失败回退 JS 库）

## 架构总览

```mermaid
flowchart TB
    subgraph Interfaces["入口"]
      CLI["CLI"]
      WEB["Web UI"]
      MCP["MCP Client"]
      OAI["Codex / OpenAI Client"]
    end

    subgraph Runtime["Codex Mate Runtime"]
      ENTRY["cli.js Entry"]
      API["Local HTTP API"]
      MCPS["MCP stdio Server"]
      PROXY["Built-in Proxy"]
      SERVICES["Config / Sessions / Skills Market / Workflow"]
      CORE["File IO / Network / Diff / Session Utils"]
    end

    subgraph State["Local State"]
      CODEX["~/.codex/config + auth + models"]
      CLAUDE["~/.claude/settings.json"]
      OPENCLAW["~/.openclaw/*.json5 + ~/.openclaw/openclaw.json + workspace/AGENTS.md"]
      SKILLS["~/.codex/skills / ~/.claude/skills / ~/.agents/skills"]
      STATE["sessions / trash / workflow runs / skill exports"]
    end

    CLI --> ENTRY
    WEB -->|GET / + POST /api| API
    MCP -->|stdio JSON-RPC| MCPS
    OAI -->|HTTP /v1| PROXY

    ENTRY --> SERVICES
    API --> SERVICES
    MCPS --> SERVICES
    PROXY --> CORE

    SERVICES --> CORE

    CORE --> CODEX
    CORE --> CLAUDE
    CORE --> OPENCLAW
    CORE --> SKILLS
    CORE --> STATE
```

## 快速开始

### npm 全局安装

```bash
npm install -g codexmate
codexmate setup
codexmate status
codexmate run
```

默认监听 `0.0.0.0:3737`，支持局域网访问，并尝试自动打开浏览器。

> 安全提示：默认监听会在当前局域网暴露未鉴权的管理界面。若包含 API Key、provider 配置或 skills 管理，请仅在可信网络中使用；如需仅本机访问，可设置 `CODEXMATE_HOST=127.0.0.1` 或启动时传入 `--host 127.0.0.1`。

### 从源码运行

```bash
git clone https://github.com/SakuraByteCore/codexmate.git
cd codexmate
npm install
npm start run
```

### 测试 / CI（只启动服务）

```bash
npm start run --no-browser
```

> 约定：自动化测试仅验证服务与 API，不依赖打开页面。

## 命令速查

| 命令 | 说明 |
| --- | --- |
| `codexmate status` | 查看当前配置状态 |
| `codexmate setup` | 交互式初始化 |
| `codexmate list` / `codexmate models` | 查看提供商 / 模型 |
| `codexmate switch <provider>` / `codexmate use <model>` | 切换 provider / model |
| `codexmate add <name> <URL> [API_KEY]` | 添加提供商 |
| `codexmate delete <name>` | 删除提供商 |
| `codexmate claude <BaseURL> <API_KEY> [model]` | 写入 Claude Code 配置 |
| `codexmate auth <list\|import\|switch\|delete\|status>` | 认证档案管理 |
| `codexmate proxy <status\|set\|apply\|enable\|start\|stop>` | 内建代理管理 |
| `codexmate workflow <list\|get\|validate\|run\|runs>` | MCP 工作流管理 |
| `codexmate codex [args...] [--follow-up <文本> 可重复]` | Codex CLI 透传入口（默认补 `--yolo`，可追加 queued follow-up） |
| `codexmate qwen [args...]` | Qwen CLI 透传入口 |
| `codexmate run [--host <HOST>] [--no-browser]` | 启动 Web UI |
| `codexmate mcp serve [--read-only\|--allow-write]` | 启动 MCP stdio 服务 |
| `codexmate export-session --source <codex\|claude> ...` | 导出会话为 Markdown |
| `codexmate zip <path> [--max:0-9]` / `codexmate unzip <zip> [out]` | 压缩 / 解压 |
| `codexmate unzip-ext <zip-dir> [out] [--ext:suffix[,suffix...]] [--no-recursive]` | 批量提取目录下 ZIP 内指定后缀文件（默认 `.json`，默认递归） |

### Codex follow-up 追加（可选）

```bash
codexmate codex --follow-up "先扫描项目" --follow-up "再修复失败测试"
codexmate codex --model gpt-5.3-codex --follow-up "步骤1" --follow-up "步骤2"
```

> 说明：`--follow-up` / `--queued-follow-up` 都可用，支持重复。

## Web 界面

### Codex 配置模式
- provider / model 切换
- 模型管理
- `~/.codex/AGENTS.md` 编辑

### Claude Code 配置模式
- 多配置方案管理
- 默认写入 `~/.claude/settings.json`
- 支持复制分享导入命令

### OpenClaw 配置模式
- JSON5 多方案管理
- 应用到 `~/.openclaw/openclaw.json`
- 管理 `~/.openclaw/workspace/AGENTS.md`

### 会话模式
- Codex + Claude 会话统一列表
- 支持本地会话置顶、持久化保存与置顶优先排序
- 搜索、筛选、导出、删除、批量清理

### Skills 市场标签页
- 在 `Codex` 与 `Claude Code` 之间切换 skills 安装目标
- 展示当前目标的本地 skills 根目录、已安装项和可导入项
- 扫描 `Codex` / `Claude Code` / `Agents` 目录下未托管的 skills
- 支持跨应用导入、ZIP 导入 / 导出、批量删除

## MCP

> 传输：`stdio`

- 传输：仅 `stdio`
- 默认：只读工具集
- 写入开启：`--allow-write` 或 `CODEXMATE_MCP_ALLOW_WRITE=1`
- 包含域：`tools`、`resources`、`prompts`

示例：

```bash
codexmate mcp serve --read-only
codexmate mcp serve --allow-write
```

## 配置文件

- `~/.codex/config.toml`
- `~/.codex/auth.json`
- `~/.codex/models.json`
- `~/.codex/provider-current-models.json`
- `~/.claude/settings.json`
- `~/.openclaw/openclaw.json`
- `~/.openclaw/workspace/AGENTS.md`

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CODEXMATE_PORT` | `3737` | Web 服务端口 |
| `CODEXMATE_HOST` | `0.0.0.0` | Web 服务监听地址（如需仅本机访问，显式设为 `127.0.0.1`） |
| `CODEXMATE_NO_BROWSER` | 未设置 | 设为 `1` 后不自动打开浏览器 |
| `CODEXMATE_MCP_ALLOW_WRITE` | 未设置 | 设为 `1` 后默认允许 MCP 写工具 |
| `CODEXMATE_FORCE_RESET_EXISTING_CONFIG` | `0` | 设为 `1` 时首次可强制重建托管配置 |

## 技术栈

- Node.js
- Vue.js 3（Web UI）
- 原生 HTTP Server
- `@iarna/toml`、`json5`

## 参与贡献

欢迎提交 Issue 和 Pull Request。

- 英文更新日志：`doc/CHANGELOG.md`
- 中文更新日志：`doc/CHANGELOG.zh-CN.md`

## License

Apache-2.0
