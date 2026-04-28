---
layout: home

hero:
  name: Codex Mate
  text: Codex / Claude Code / OpenClaw 本地配置与会话管理
  tagline: 用一个 CLI + Web UI 管理多工具配置与本地会话。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 核心工作流
      link: /guide/workflow
    - theme: alt
      text: GitHub
      link: https://github.com/SakuraByteCore/codexmate

features:
  - title: 统一入口
    details: Codex、Claude Code、OpenClaw 配置在同一入口管理。
  - title: 本地优先
    details: 配置写入本地文件，首轮接管有备份，便于回滚。
  - title: 会话可管理
    details: 支持会话筛选、导出、删除与批量清理。
  - title: 自动化友好
    details: 提供 MCP stdio 能力，可按需开启写入工具。
---

## 这是什么

Codex Mate 是一个本地优先的配置与会话管理工具，覆盖：

- Codex provider/model 切换与配置写入
- Claude Code 配置方案管理（写入 `~/.claude/settings.json`）
- OpenClaw JSON5 配置与 Workspace `AGENTS.md`
- Codex / Claude / Gemini CLI / CodeBuddy Code 本地会话浏览、导出、删除

## 快速开始

```bash
npm install -g codexmate
codexmate setup
codexmate status
codexmate run
```

仅启动服务（测试 / CI）：

```bash
codexmate run --no-browser
```

## 命令速查

- `codexmate status`
- `codexmate setup`
- `codexmate list` / `codexmate models`
- `codexmate switch <provider>` / `codexmate use <model>`
- `codexmate claude <BaseURL> <API_KEY> [model]`
- `codexmate auth <list|import|switch|delete|status>`
- `codexmate workflow <list|get|validate|run|runs>`
- `codexmate qwen [args...]`
- `codexmate run [--host <HOST>] [--no-browser]`
- `codexmate export-session --source <codex|claude> ...`

## 模块能力

### Codex

- provider / model 切换
- `config.toml` 模板确认写入
- `~/.codex/AGENTS.md` 与 skills 管理


### Claude Code

- 多配置方案管理
- 一键写入 `~/.claude/settings.json`

### OpenClaw

- JSON5 多方案管理
- 写入 `~/.openclaw/openclaw.json`
- 管理 `~/.openclaw/workspace/AGENTS.md`

### 会话

- Codex + Claude + Gemini CLI + CodeBuddy Code 会话统一视图
- 搜索、筛选、导出、删除、批量清理

## 测试约定

- 自动化测试只启动服务，不打开页面。
- 推荐命令：`codexmate run --no-browser`。

## 设计边界

- 不做云端托管与账号体系。
- 不代管密钥，配置写入本地文件。
- 不替代原工具，仅负责配置管理与会话管理层。
