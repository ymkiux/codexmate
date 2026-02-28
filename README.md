# Codex Mate

> 轻量级 AI 工具配置助手，支持 Codex 提供商管理和 Claude Code 环境配置

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-green.svg)](https://nodejs.org)

Codex Mate 是一个简洁的命令行工具，提供两大核心功能：

1. **Codex 提供商管理** - 快速切换 Codex 的 AI 模型提供商和模型
2. **Claude Code 配置** - 一键写入 Claude Code 配置（默认 `~/.claude/settings.json`）

其中 **Codex 配置功能支持 Linux 和 Windows**，Claude 配置应用支持 Windows / macOS / Linux，可通过 Web 统一管理。

支持通过 CLI 或 Web 界面进行可视化操作，让 AI 工具的配置管理变得简单高效。

## 功能特性

- **快速切换** - 一键切换 AI 模型提供商
- **模型管理** - 统一管理所有可用模型
- **Web 界面** - 内置简洁的可视化界面
- **安全可靠** - API key 本地存储，脱敏显示
- **轻量高效** - 仅依赖 Node.js 和一个 TOML 解析库
- **文件压缩** - 基于 7-Zip 的多线程压缩/解压

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

## 使用方法

### 命令行界面

```bash
# 查看帮助
codexmate

# 查看当前状态
codexmate status

# 列出所有提供商
codexmate list

# 切换提供商
codexmate switch <提供商名称>

# 切换模型
codexmate use <模型名称>

# 添加新提供商
codexmate add <名称> <URL> [API密钥]

# 删除提供商
codexmate delete <提供商名称>

# 列出所有模型
codexmate models

# 添加模型
codexmate add-model <模型名称>

# 删除模型
codexmate delete-model <模型名称>
```

### Web 界面

启动 Web 界面（自动打开浏览器）：

```bash
codexmate start
```

然后在浏览器中打开 `http://localhost:3737`

**Web 界面功能：**

#### Codex 配置模式
- 查看当前提供商和模型状态
- 快速切换提供商
- 切换和管理可用模型
- 添加/删除自定义提供商
- 支持 Linux / Windows 环境下的 Codex 配置管理

#### Claude Code 配置模式（Windows / macOS / Linux）
- 管理多个 Claude Code 配置方案
- 配置 API Key、Base URL 和模型
- 默认一键应用到 `~/.claude/settings.json` 的 `env` 字段：
  - `env.ANTHROPIC_API_KEY`
  - `env.ANTHROPIC_AUTH_TOKEN`
  - `env.ANTHROPIC_BASE_URL`
  - `env.ANTHROPIC_MODEL`
  - `env.CLAUDE_CODE_USE_KEY`
- 提供“兼容模式”可回退为系统环境变量写入（适合旧习惯或特定 Windows 场景）

#### 会话浏览模式
- 在同一 Web 页面查看 Codex 与 Claude Code 的本地会话列表
- 支持按来源筛选（Codex / Claude / 全部）
- 支持按已有会话路径（cwd）下拉筛选，选择后自动刷新
- 支持一键导出指定会话为 Markdown，便于提供给其他 AI 继续分析
- 支持直接删除指定会话（本地 jsonl 记录）
- 支持勾选多条会话并批量删除，部分失败会汇总提示
- 支持在会话详情内单条删除记录或多选批量删除记录（写回原始 jsonl）

#### Codex 模板确认模式
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

### 首次运行初始化说明

- 首次运行 `codexmate` 时，如果检测到已有 `~/.codex/config.toml` 且不是 Codex Mate 管理的配置：
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

1. 启动 Web 界面：
```bash
codexmate start
```

2. 在浏览器中切换到 "Claude Code 配置" 模式

3. 添加配置方案（例如智谱 GLM）：
   - 配置名称：智谱GLM
   - API Key：你的 API Key
   - Base URL：`https://open.bigmodel.cn/api/anthropic`
   - 模型：`glm-4.7`

4. 点击配置卡片直接应用，或在编辑弹窗点击“保存并应用到 Claude 配置”
   - 默认写入：`~/.claude/settings.json`
   - 兼容模式：写入系统环境变量

5. 重启 Claude Code，新的配置即生效

### 启动 Web 界面

```bash
codexmate start
```

然后在浏览器中打开 `http://localhost:3737`

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
A: 运行 `npm uninstall -g codexmate`

## 附属功能

### 多线程压缩/解压

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

**使用示例：**

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

**注意：** 需要系统安装 [7-Zip](https://www.7-zip.org/)。

## 技术栈

- **Node.js** - 运行环境
- **@iarna/toml** - TOML 配置文件解析
- **Vue.js 3** - Web 界面框架
- **原生 HTTP** - 内建 Web 服务器

## 许可证

Apache-2.0 © [ymkiux](https://github.com/ymkiux)

## 贡献

欢迎提交 Issue 和 Pull Request！

---

Made with [ymkiux](https://github.com/ymkiux)





