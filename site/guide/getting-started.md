# 快速开始

## 环境要求

- `Node.js >= 14`
- `Git`
- Windows / macOS / Linux

## 安装方式

### 方式 1：全局安装

```bash
npm install -g codexmate
```

### 方式 2：免安装试用

```bash
npx codexmate@latest status
```

## 最短启动路径

```bash
codexmate setup
codexmate status
codexmate run
```

启动后默认访问：`http://localhost:3737`

## 常用命令

```bash
codexmate list
codexmate models
codexmate switch <provider>
codexmate use <model>
codexmate claude <BaseURL> <API_KEY> [model]
codexmate export-session --source <codex|claude> --session-id <ID>
```

## 使用建议

- 先 `status` 再切换，避免误操作
- 先在 Web UI 预览配置，再应用到运行时文件
- 导出会话时优先按来源筛选，减少无关记录
