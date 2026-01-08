# Codex Mate

> 轻量级 AI 工具配置助手，支持 Codex 提供商管理和 Claude Code 环境配置

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-green.svg)](https://nodejs.org)

Codex Mate 是一个简洁的命令行工具，提供两大核心功能：

1. **Codex 提供商管理** - 快速切换 Codex 的 AI 模型提供商和模型
2. **Claude Code 配置** - 一键配置 Claude Code 环境变量（仅限 Windows）

支持通过 CLI 或 Web 界面进行可视化操作，让 AI 工具的配置管理变得简单高效。

## 功能特性

- 🔄 **快速切换** - 一键切换 AI 模型提供商
- 🎯 **模型管理** - 统一管理所有可用模型
- 🌐 **Web 界面** - 内置简洁的可视化界面
- 🔒 **安全可靠** - API key 本地存储，脱敏显示
- ⚡ **轻量高效** - 仅依赖 Node.js 和一个 TOML 解析库

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
- 📊 查看当前提供商和模型状态
- 🔄 快速切换提供商
- 🎯 切换和管理可用模型
- ➕ 添加/删除自定义提供商

#### Claude Code 配置模式（仅限 Windows）
- 🔑 管理多个 Claude Code 配置方案
- ⚙️ 配置 API Key、Base URL 和模型
- 🚀 一键应用到系统环境变量：
  - `ANTHROPIC_API_KEY`
  - `ANTHROPIC_AUTH_TOKEN`
  - `ANTHROPIC_BASE_URL`
  - `ANTHROPIC_MODEL`
  - `CLAUDE_CODE_USE_KEY`

## 配置文件

配置文件位于 `~/.codex/` 目录：

- `config.toml` - Codex 主配置文件
- `auth.json` - API 认证信息
- `models.json` - 可用模型列表
- `provider-current-models.json` - 提供商当前模型配置

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

### 配置 Claude Code（Windows）

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

4. 点击"应用到系统环境变量"

5. 重启 Claude Code，新的配置即生效

### 启动 Web 界面

```bash
codexmate start
```

然后在浏览器中打开 `http://localhost:3737`

## 常见问题

### Q: 支持哪些操作系统？
A: 支持 Windows、macOS 和 Linux。Claude Code 环境变量配置功能仅限 Windows。

### Q: API key 存储在哪里？
A: API key 存储在本地配置文件 `~/.codex/config.toml` 中，不会上传到任何服务器。

### Q: Web 界面安全吗？
A: Web 界面运行在本地，所有操作都在本地完成。API key 在界面中仅显示脱敏版本。

### Q: Claude Code 配置后如何生效？
A: 点击"应用到系统环境变量"后，需要重启 Claude Code 才能使用新配置。环境变量会永久保存，无需每次都应用。

### Q: 如何卸载？
A: 运行 `npm uninstall -g codexmate`

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

Made with ❤️ by [ymkiux](https://github.com/ymkiux)
