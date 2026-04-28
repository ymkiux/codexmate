# 快速开始

## 环境要求

- `Node.js >= 14`
- Windows / macOS / Linux

## 安装

### 全局安装

```bash
npm install -g codexmate
```

### 安装官方 CLI（可选）

Codex Mate 支持透传调用官方 CLI（例如 `codexmate codex ...`），并可在 Web UI 中浏览本地会话。建议先安装：

```bash
# Codex CLI
npm install -g @openai/codex

# Claude Code
npm install -g @anthropic-ai/claude-code

# Gemini CLI
npm install -g @google/gemini-cli
```

### 免安装试用

```bash
npx codexmate@latest status
```

## 最短启动路径

```bash
codexmate setup
codexmate status
codexmate run
```

默认监听 `0.0.0.0:3737`，支持局域网访问，并尝试自动打开浏览器。
如需仅本机访问，可设置 `CODEXMATE_HOST=127.0.0.1`，或启动时传入 `--host 127.0.0.1`。
> 安全提示：默认监听会在当前局域网暴露未鉴权管理界面。请仅在可信网络使用；如涉及 API Key、配置或 skills 管理，建议改用 `127.0.0.1`。

仅启动服务（测试 / CI）：

```bash
codexmate run --no-browser
```

## 常用命令

```bash
codexmate list
codexmate models
codexmate switch <provider>
codexmate use <model>
codexmate claude <BaseURL> <API_KEY> [model]
codexmate auth <list|import|switch|delete|status>
codexmate workflow <list|get|validate|run|runs>
codexmate qwen [args...]
codexmate export-session --source <codex|claude|gemini> --session-id <ID>
```

## 校验建议

- 执行 `codexmate status` 确认当前 provider/model。
- 先在 Web UI 预览后再应用配置。
- 导出会话时先按来源筛选，减少噪音数据。
