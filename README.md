# Codex Mate

> A lightweight AI configuration assistant: CLI + Web to manage Codex providers/models and Claude Code configs

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-green.svg)](https://nodejs.org)

English | [Chinese](README.zh-CN.md)

## Overview

If you frequently switch between models, providers, or configuration profiles, Codex Mate turns that into a single command or a single click.

## What You Get

- Faster provider/model switching
- More controllable local configuration management
- A visual Web UI to reduce CLI burden
- Change tracking with backups

## Feature Overview

| Module | Problem | Key Capabilities |
| --- | --- | --- |
| Codex Config | Switching providers/models is painful | Provider/model switching, model management, CLI + Web entry points, template-confirmed writes |
| Claude Code Config | Multiple profiles and inconsistent write paths | Profile management, default write to `~/.claude/settings.json`, compatibility mode env vars |
| Session Browser | Local sessions are hard to track | List/filter sessions, export to Markdown, delete and batch cleanup |
| Utilities | Compression/extraction requires extra tools | Multithreaded compress/unzip via 7-Zip |

## Why Codex Mate

- Focused on two jobs: Codex provider/model switching + Claude Code config apply
- Local-first: configs and API keys are written to local files, not the cloud
- Lightweight: CLI + Web, no desktop app required
- Reversible: auto-backup before first takeover

## Use Cases

- Frequent provider/model switching, want a one-command flow
- Use both Codex and Claude Code, want a single entry point
- Multi-project or multi-environment setups that need quick config changes
- Want a visual UI without a heavy client

## Scope and Boundaries

- Only configuration management for Codex and Claude Code, not a full all-in-one tool suite
- No built-in proxy/relay/billing dashboard/cloud sync (kept lightweight)
- Web UI runs only when you start it (`codexmate start`)

## Quick Start

1. Install (global):
```bash
npm install -g ymkiux/codexmate
```

2. Check status:
```bash
codexmate status
```

3. Start the Web UI:
```bash
codexmate start
```

Then open `http://localhost:3737` in your browser.

## UI Preview

![Codex Mate Web UI](res/screenshot.png)

## Install

### Global (Recommended)

```bash
npm install -g ymkiux/codexmate
```

### From Source

```bash
git clone https://github.com/ymkiux/codexmate.git
cd codexmate
npm install
npm link
```

### Requirements

- Node.js >= 14
- Windows / macOS / Linux

## CLI Cheat Sheet

| Command | Description |
| --- | --- |
| `codexmate` | Show help and available commands |
| `codexmate status` | Show current status |
| `codexmate list` | List all providers |
| `codexmate switch <provider>` | Switch provider |
| `codexmate use <model>` | Switch model |
| `codexmate add <name> <URL> [API key]` | Add a provider |
| `codexmate delete <provider>` | Delete a provider |
| `codexmate models` | List all models |
| `codexmate add-model <model>` | Add a model |
| `codexmate delete-model <model>` | Delete a model |
| `codexmate start` | Start the Web UI |

## Web UI

Start the Web UI (auto opens browser):

```bash
codexmate start
```

### Codex Config Mode

- View current provider and model status
- Quickly switch provider and model
- Manage available model list
- Edit `~/.codex/AGENTS.md` instruction file (same level as `config.toml`)
- Add/delete custom providers
- Supports Codex config management on Linux/Windows

### Claude Code Config Mode (Windows / macOS / Linux)

- Manage multiple Claude Code profiles
- Configure API key, Base URL, and model
- Default write to `env` in `~/.claude/settings.json`: `env.ANTHROPIC_API_KEY` / `env.ANTHROPIC_AUTH_TOKEN` / `env.ANTHROPIC_BASE_URL` / `env.ANTHROPIC_MODEL` / `env.CLAUDE_CODE_USE_KEY`
- Compatibility mode: write to system environment variables (useful for legacy workflows or specific Windows cases)

### Session Browser

- View local Codex and Claude Code sessions in one page
- Filter by source (Codex / Claude / All)
- Filter by session path (cwd), auto refresh on selection
- Export selected sessions to Markdown
- Delete single sessions (local jsonl records)
- Batch delete multiple sessions with partial failure summary
- Delete individual records or multi-select within session details (writes back to original jsonl)

### Codex Template Confirmation Mode

- Codex config changes in Web UI go to a `config.toml` template editor first
- Only writes to `config.toml` after you click "Confirm Apply Template"
- Prevents direct one-click overwrites from the UI

## Configuration Files

Config directory: `~/.codex/`

- `config.toml` - Codex main config
- `auth.json` - API auth info
- `models.json` - Available model list
- `provider-current-models.json` - Per-provider current model config
- `codexmate-init.json` - First-run marker
- `config.toml.codexmate-backup-*.bak` - Backup created on first takeover

Claude Code config files:

- `~/.claude/settings.json` - Runtime config (default write target)
- `~/.claude/settings.json.codexmate-backup-*.bak` - Backup before first overwrite

## First Run Initialization

When you run `codexmate` for the first time and an existing `~/.codex/config.toml` is detected that is not managed by Codex Mate:

- The original file is backed up as `config.toml.codexmate-backup-<timestamp>.bak`
- The original `config.toml` is preserved, and a first-run marker is written
- Only when `CODEXMATE_FORCE_RESET_EXISTING_CONFIG=1` is set will the default config be rebuilt
- Subsequent runs will not repeat this process

## Examples

### Add a Custom API Provider

```bash
codexmate add myapi https://api.example.com/v1 sk-your-api-key
codexmate switch myapi
```

### Switch to a Different Model

```bash
codexmate use gpt-4-turbo
```

### Configure Claude Code (Cross-Platform)

1. Start the Web UI: `codexmate start`
2. Switch to "Claude Code Config" mode in the browser
3. Add a profile (example Zhipu GLM): Name=ZhipuGLM, API Key=your API key, Base URL=`https://open.bigmodel.cn/api/anthropic`, Model=`glm-4.7`
4. Click the card to apply, or use "Save & Apply to Claude Config" in the editor
5. Default write to `~/.claude/settings.json`; compatibility mode writes system env vars
6. Restart Claude Code to apply

### Start the Web UI

```bash
codexmate start
```

Then open `http://localhost:3737`.

## FAQ

### Q: Which operating systems are supported?

A: Codex features support Windows and Linux (CLI and Web). Claude Code config applies to Windows / macOS / Linux (writes to `~/.claude/settings.json`). Compatibility mode env vars are Windows-only.

### Q: Where are API keys stored?

A: API keys are stored locally in `~/.codex/config.toml` and are not uploaded.

### Q: Is the Web UI safe?

A: The Web UI runs locally; all operations happen on your machine. API keys are masked in the UI.

### Q: How do Claude Code configs take effect?

A: After clicking "Apply to Claude Config", it writes to `~/.claude/settings.json`. Restart Claude Code to apply. If using compatibility mode env vars, a restart is also recommended.

### Q: How to uninstall?

A: Run `npm uninstall -g codexmate`.

## Extras: Multithreaded Compression/Extraction

Based on 7-Zip for multithreaded zip/unzip.

```bash
# Compress file or folder (default compression level 5)
codexmate zip <path>

# Set compression level (0-9, 0=store only, 9=max)
codexmate zip <path> --max:9

# Unzip a zip file (default to same-level folder)
codexmate unzip <zip path>

# Unzip to a specific output directory
codexmate unzip <zip path> <output dir>
```

Examples:

```bash
# Compress a project folder
codexmate zip ./my-project

# Max compression
codexmate zip ./my-project --max:9

# Store only (fast)
codexmate zip ./large-folder --max:0

# Unzip
codexmate unzip ./my-project.zip

# Unzip to a target location
codexmate unzip ./backup.zip D:/restored
```

Note: Requires [7-Zip](https://www.7-zip.org/) installed.

## Tech Stack

- **Node.js** - Runtime
- **@iarna/toml** - TOML parser
- **Vue.js 3** - Web UI framework
- **Native HTTP** - Built-in Web server

## License

Apache-2.0 © [ymkiux](https://github.com/ymkiux)

## Contributing

Issues and pull requests are welcome.

---

Made with [ymkiux](https://github.com/ymkiux)
