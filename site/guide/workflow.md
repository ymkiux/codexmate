# 核心工作流

## 1. 初始化与状态确认

```bash
codexmate setup
codexmate status
```

目标：确保 provider、model、配置文件路径都可读。

## 2. 切换 Codex 提供商与模型

```bash
codexmate switch <provider>
codexmate use <model>
```

目标：在不改业务代码的前提下快速完成路由切换。

## 3. 应用 Claude / OpenClaw 配置

```bash
codexmate claude <BaseURL> <API_KEY> [model]
```

目标：统一写入运行时配置，减少手改 JSON 的风险。

## 4. 启动 Web UI 做集中管理

```bash
codexmate run
```

你可以在 Web UI 中完成：

- Codex provider/model 切换
- Claude 配置方案管理
- OpenClaw JSON5 配置管理
- 会话筛选、删除与导出

## 5. 导出会话用于复盘

```bash
codexmate export-session --source codex --session-id <ID>
```

目标：把关键会话落成 Markdown，便于归档、审阅与分享。
