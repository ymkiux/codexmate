# Codex Mate

> 轻量级 AI 工具配置助手：CLI + Web，一站式管理 Codex 提供商与 Claude Code 配置

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-green.svg)](https://nodejs.org)

[English](README.md) | 中文

## 你能获得什么

- 更快的模型/提供商切换
- 更可控的本地配置管理
- 可视化 Web 操作，降低命令行负担
- 配置变更可回溯、有备份

## 功能总览

| 模块 | 解决的问题 | 关键能力 |
| --- | --- | --- |
| Codex 配置 | 多提供商/多模型切换麻烦 | 提供商/模型切换、模型管理、CLI + Web 双入口、模板确认写入 |
| Claude Code 配置 | 多方案共存、写入路径不统一 | 多配置方案管理、默认写入 `~/.claude/settings.json`、兼容模式环境变量 |
| 会话浏览 | 本地会话难以追踪 | 会话列表/筛选、Markdown 导出、删除与批量清理 |
| 附属工具 | 压缩/解压需额外工具 | 基于 7-Zip 的多线程压缩/解压 |

## 为什么选择 Codex Mate

- 聚焦两件事：Codex 提供商/模型切换 + Claude Code 配置应用
- 本地优先：配置与 API Key 写入本地文件，不走云端
- 轻量好用：CLI + Web 双入口，无需安装桌面端
- 可回退：首次接管前自动备份旧配置

## 适用场景

- 频繁切换提供商/模型，想要一条命令完成
- 同时用 Codex 与 Claude Code，需要统一入口
- 多项目/多环境切换，希望快速改写配置
- 想可视化改配置但又不想上大体量客户端

## 范围与边界

- 只做 Codex 与 Claude Code 的配置管理，不做全量多工具一体化
- 不内置代理/转发/费用面板/云同步（保持轻量）
- Web UI 仅在你启动时运行（`codexmate start`）

## 快速开始

1. 安装（全局）：
```bash
npm install -g ymkiux/codexmate
```

2. 查看当前状态：
```bash
codexmate status
```

3. 启动 Web 界面：
```bash
codexmate start
```

然后在浏览器中打开 `http://localhost:3737`。

## 界面预览

![Codex Mate Web UI](res/screenshot.png)

## 安装

### 全局安装（推荐）

```bash
npm install -g ymkiux/codexmate
```

### 从源码安装

```bash
git clone https://github.com/ymkiux/codexmate.git
cd codexmate
npm install
npm link
```

### 环境要求

- Node.js >= 14
- 支持 Windows / macOS / Linux

## 命令行速查

| 命令 | 说明 |
| --- | --- |
| `codexmate` | 查看帮助与可用命令 |
| `codexmate status` | 查看当前状态 |
| `codexmate list` | 列出所有提供商 |
| `codexmate switch <提供商名称>` | 切换提供商 |
| `codexmate use <模型名称>` | 切换模型 |
| `codexmate add <名称> <URL> [API密钥]` | 添加新提供商 |
| `codexmate delete <提供商名称>` | 删除提供商 |
| `codexmate models` | 列出所有模型 |
| `codexmate add-model <模型名称>` | 添加模型 |
| `codexmate delete-model <模型名称>` | 删除模型 |
| `codexmate start` | 启动 Web 界面 |

## Web 界面

启动 Web 界面（自动打开浏览器）：

```bash
codexmate start
```

### Codex 配置模式

- 查看当前提供商和模型状态
- 快速切换提供商与模型
- 管理可用模型列表
- 编辑 `~/.codex/AGENTS.md` 指令文件（与 `config.toml` 同级）
- 添加/删除自定义提供商
- 支持 Linux / Windows 环境下的 Codex 配置管理

### Claude Code 配置模式（Windows / macOS / Linux）

- 管理多个 Claude Code 配置方案
- 配置 API Key、Base URL 和模型
- 默认写入 `~/.claude/settings.json` 的 `env` 字段：`env.ANTHROPIC_API_KEY` / `env.ANTHROPIC_AUTH_TOKEN` / `env.ANTHROPIC_BASE_URL` / `env.ANTHROPIC_MODEL` / `env.CLAUDE_CODE_USE_KEY`
- 兼容模式：写入系统环境变量（适合旧习惯或特定 Windows 场景）

### 会话浏览模式

- 在同一 Web 页面查看 Codex 与 Claude Code 的本地会话列表
- 支持按来源筛选（Codex / Claude / 全部）
- 支持按已有会话路径（cwd）筛选，选择后自动刷新
- 支持一键导出指定会话为 Markdown
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

### 配置 Claude Code（跨平台）

1. 启动 Web 界面：`codexmate start`
2. 在浏览器中切换到 "Claude Code 配置" 模式
3. 添加配置方案（例如智谱 GLM）：配置名称=智谱GLM，API Key=你的 API Key，Base URL=`https://open.bigmodel.cn/api/anthropic`，模型=`glm-4.7`
4. 点击配置卡片直接应用，或在编辑弹窗点击“保存并应用到 Claude 配置”
5. 默认写入 `~/.claude/settings.json`；兼容模式写入系统环境变量
6. 重启 Claude Code，新的配置即生效

### 启动 Web 界面

```bash
codexmate start
```

然后在浏览器中打开 `http://localhost:3737`。

## 常见问题

### Q: 支持哪些操作系统？

A: Codex 功能支持 Windows 和 Linux（CLI 与 Web）。Claude Code 配置应用默认支持 Windows / macOS / Linux（写入 `~/.claude/settings.json`），兼容模式环境变量写入仅支持 Windows。

### Q: API key 存储在哪里？

A: API key 存储在本地配置文件 `~/.codex/config.toml` 中，不会上传到任何服务器。

### Q: Web 界面安全吗？

A: Web 界面运行在本地，所有操作都在本地完成。API key 在界面中仅显示脱敏版本。

### Q: Claude Code 配置后如何生效？

A: 点击“应用到 Claude 配置”后会写入 `~/.claude/settings.json`，重启 Claude Code 即生效；如果使用兼容模式写系统环境变量，也建议重启 Claude Code。

### Q: 如何卸载？

A: 运行 `npm uninstall -g codexmate`。

## 附属功能：多线程压缩/解压

基于 7-Zip 的多线程文件压缩和解压功能。

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

注意：需要系统安装 [7-Zip](https://www.7-zip.org/)。

## 技术栈

- **Node.js** - 运行环境
- **@iarna/toml** - TOML 配置文件解析
- **Vue.js 3** - Web 界面框架
- **原生 HTTP** - 内建 Web 服务器

## 许可证

Apache-2.0 © [ymkiux](https://github.com/ymkiux)

## 贡献

欢迎提交 Issue 和 Pull Request。

---

Made with [ymkiux](https://github.com/ymkiux)
