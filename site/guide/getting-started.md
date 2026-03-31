# 快速开始

## 环境要求

- `Node.js >= 14`
- Windows / macOS / Linux

## 安装

### 全局安装

```bash
npm install -g codexmate
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
codexmate proxy <status|set|apply|enable|start|stop>
codexmate workflow <list|get|validate|run|runs>
codexmate qwen [args...]
codexmate export-session --source <codex|claude> --session-id <ID>
```

## 校验建议

- 执行 `codexmate status` 确认当前 provider/model。
- 先在 Web UI 预览后再应用配置。
- 导出会话时先按来源筛选，减少噪音数据。
