# 核心工作流

## 1. 初始化与状态确认

```bash
codexmate setup
codexmate status
```

目标：确认 provider、model 与关键配置路径可读。

## 2. 切换 Codex provider/model

```bash
codexmate switch <provider>
codexmate use <model>
```

目标：在不改业务代码的前提下完成模型路由切换（Codex）。

## 3. 应用 Claude / OpenClaw 配置

```bash
codexmate claude <BaseURL> <API_KEY> [model]
```

目标：通过统一入口写入运行时配置，减少手改错误。

## 4. 启动 Web UI 做集中管理

```bash
codexmate run
```

可在 Web UI 完成：

- Codex provider/model 切换
- Claude 配置方案管理
- OpenClaw JSON5 配置管理
- 会话筛选、删除与导出

无头调试或自动化场景：

```bash
codexmate run --no-browser
```

## 5. 导出会话用于复盘

```bash
codexmate export-session --source codex --session-id <ID>
```

目标：将关键会话沉淀为 Markdown 文档用于归档与审阅。

## 6. 测试约定（不打开页面）

```bash
npm run test:e2e
```

目标：E2E 仅验证服务与 API 行为，不依赖浏览器页面自动打开。
