---
layout: home

hero:
  name: Codex Mate
  text: 一站式管理 Codex / Claude Code / OpenClaw 配置与本地会话
  tagline: 参考 OpenILink 的页面组织方式，强化“上手路径 + 高频操作 + 完整能力全览”。
  actions:
    - theme: brand
      text: 60 秒上手
      link: /guide/getting-started
    - theme: alt
      text: 核心工作流
      link: /guide/workflow
    - theme: alt
      text: GitHub
      link: https://github.com/SakuraByteCore/codexmate

features:
  - title: 配置切换更快
    details: 用同一套 CLI + Web UI 完成 provider/model 切换、配置应用与会话管理。
  - title: 本地优先与可回滚
    details: 配置与会话默认留在本机，首次接管自动备份，避免误覆盖。
  - title: 会话统一视图
    details: 在同一页面浏览 Codex 与 Claude 会话，并支持筛选、导出、批量清理。
  - title: 完整能力覆盖
    details: 覆盖 Codex、Claude、OpenClaw、Skills 管理、会话导出与压缩解压等场景。
---

## 概览

Codex Mate 让 Codex 与 Claude Code 的 provider/model 切换变成“一条命令或一次点击”，并在同一 Web 页面统一管理本地会话。

## 60 秒上手（源码一行安装）

```bash
git clone https://github.com/ymkiux/codexmate.git && cd codexmate && npm install && npm link && codexmate run
```

首次建议补两条确认命令：

```bash
codexmate setup
codexmate status
```

如果你只想临时试用：

```bash
npx codexmate@latest run
```

## 核心命令速查

- 查看状态：`codexmate status`
- 启动 Web：`codexmate run`
- 交互初始化：`codexmate setup`
- 查看提供商/模型：`codexmate list` / `codexmate models`
- 切换提供商/模型：`codexmate switch <provider>` / `codexmate use <model>`
- 一键写入 Claude 配置：`codexmate claude <BaseURL> <API_KEY> [model]`
- 导出会话：`codexmate export-session --source <codex|claude> ...`

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

## 完整功能介绍

### Codex 配置

- 提供商/模型切换
- 模型列表管理
- `config.toml` 模板确认写入
- `~/.codex/AGENTS.md` 指令文件编辑

### Skills 管理

- 统计概览（总数 / 缺少 `SKILL.md` / 可导入）
- 关键词检索与状态筛选
- 多选批量删除
- 跨应用扫描导入

### Claude Code 配置

- 多配置方案管理
- API Key、Base URL、模型统一维护
- 默认写入 `~/.claude/settings.json`
- 支持“分享导入命令”一键复制

### OpenClaw 配置

- OpenClaw JSON5 多方案管理
- 应用到 `~/.openclaw/openclaw.json`
- 管理 Workspace 下 `AGENTS.md`

### 会话浏览与导出

- 同页查看 Codex + Claude 会话
- 来源筛选与 cwd 路径筛选
- 指定会话导出 Markdown
- 会话级与消息级删除、批量清理

### 附属工具

- Zip 压缩/解压（优先 7-Zip，多线程；缺失则 JS 库兜底）
- `codexmate mcp serve`（stdio，默认只读，可选写入）

## 为什么选 Codex Mate

- 聚焦三件事：Codex 切换 + Claude Code 配置 + OpenClaw 配置
- 本地优先：配置与密钥落地本机
- 轻量：CLI + Web，无需额外桌面客户端
- 安全感：接管前自动备份，关键操作可追溯

## 设计边界（避免误解）

- 不做云端托管与账号体系
- 不代管你的密钥，配置写入本地文件
- 不替代原工具，只负责“配置管理 + 会话可视化”这一层
