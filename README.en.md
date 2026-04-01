<div align="center">

# Codex Mate

**Local configuration and session manager for Codex / Claude Code / OpenClaw**

[![Build](https://img.shields.io/github/actions/workflow/status/SakuraByteCore/codexmate/release.yml?label=build)](https://github.com/SakuraByteCore/codexmate/actions/workflows/release.yml)
[![Version](https://img.shields.io/npm/v/codexmate?label=version&registry_uri=https%3A%2F%2Fregistry.npmjs.org)](https://www.npmjs.com/package/codexmate)
[![Downloads](https://img.shields.io/npm/dt/codexmate?label=downloads)](https://www.npmjs.com/package/codexmate)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-green.svg)](https://nodejs.org)

[Quick Start](#quick-start) · [Commands](#command-reference) · [Web UI](#web-ui) · [MCP](#mcp) · [中文](README.md)

</div>

---

## What Is This?

Codex Mate is a local-first CLI + Web UI for unified management of:

- Codex provider/model switching and config writes
- Claude Code profiles (writes to `~/.claude/settings.json`)
- OpenClaw JSON5 profiles and workspace `AGENTS.md`
- Local skills market for Codex / Claude Code (target switching, local skills management, cross-app import, ZIP distribution)
- Local Codex/Claude sessions (list/filter/export/delete)

It works on local files directly and does not require cloud hosting. The skills market is also local-first: it operates on local directories and does not depend on a remote marketplace.

## Comparison

| Dimension | Codex Mate | Manual File Editing |
| --- | --- | --- |
| Multi-tool management | Codex + Claude Code + OpenClaw in one entry | Different files and folders per tool |
| Operation mode | CLI + local Web UI | Manual TOML/JSON/JSON5 edits |
| Session handling | Browse/export/batch cleanup | Manual file location and processing |
| Skills reuse | Local skills market + cross-app import + ZIP distribution | Manual folder copy and reconciliation |
| Rollback readiness | Backup before first takeover | Easy to overwrite by mistake |
| Automation integration | MCP stdio (read-only by default) | Requires custom scripting |

## Core Features

**Configuration**
- Provider/model switching (`switch`, `use`)
- Codex `config.toml` template confirmation before write
- Claude Code profile management and apply
- OpenClaw JSON5 profile management

**Session Management**
- Unified Codex + Claude session list
- Local session pinning with persistent pinned state and pinned-first ordering
- Keyword/source/cwd filters
- Markdown export
- Session-level and message-level delete (supports batch)

**Skills Market**
- Switch the skills install target between Codex and Claude Code
- Inspect local installed skills, root paths, and status
- Scan importable sources from `Codex` / `Claude Code` / `Agents`
- Support cross-app import, ZIP import/export, and batch delete

**Engineering Utilities**
- MCP stdio domains (`tools`, `resources`, `prompts`)
- Built-in proxy controls (`proxy`)
- Auth profile management (`auth`)
- Zip/unzip utilities

## Architecture

```mermaid
flowchart TB
    subgraph Interfaces["Entry Surfaces"]
      CLI["CLI"]
      WEB["Web UI"]
      MCP["MCP Client"]
      OAI["Codex / OpenAI Client"]
    end

    subgraph Runtime["Codex Mate Runtime"]
      ENTRY["cli.js Entry"]
      API["Local HTTP API"]
      MCPS["MCP stdio Server"]
      PROXY["Built-in Proxy"]
      SERVICES["Config / Sessions / Skills Market / Workflow"]
      CORE["File IO / Network / Diff / Session Utils"]
    end

    subgraph Data["Local Files"]
      CODEX["~/.codex/config + auth + models"]
      CLAUDE["~/.claude/settings.json"]
      OPENCLAW["~/.openclaw/*.json5 + ~/.openclaw/openclaw.json + workspace/AGENTS.md"]
      SKILLS["~/.codex/skills / ~/.claude/skills / ~/.agents/skills"]
      STATE["sessions / trash / workflow runs / skill exports"]
    end

    CLI --> ENTRY
    WEB -->|GET / + POST /api| API
    MCP -->|stdio JSON-RPC| MCPS
    OAI -->|HTTP /v1| PROXY

    ENTRY --> SERVICES
    API --> SERVICES
    MCPS --> SERVICES
    PROXY --> CORE

    SERVICES --> CORE

    CORE --> CODEX
    CORE --> CLAUDE
    CORE --> OPENCLAW
    CORE --> SKILLS
    CORE --> STATE
```

## Quick Start

### Install from npm

```bash
npm install -g codexmate
codexmate setup
codexmate status
codexmate run
```

Default listen address is `0.0.0.0:3737` for LAN access, and browser auto-open is enabled by default.

> Safety note: the unauthenticated management UI is exposed to your current LAN by default. Use trusted networks only; for local-only access, set `CODEXMATE_HOST=127.0.0.1` or pass `--host 127.0.0.1`.

### Run from source

```bash
git clone https://github.com/SakuraByteCore/codexmate.git
cd codexmate
npm install
npm start run
```

### Tests / CI (service only)

```bash
npm start run --no-browser
```

> Convention: automated tests validate service and API behavior only, without opening browser pages.

## Command Reference

| Command | Description |
| --- | --- |
| `codexmate status` | Show current config status |
| `codexmate setup` | Interactive setup |
| `codexmate list` / `codexmate models` | List providers / models |
| `codexmate switch <provider>` / `codexmate use <model>` | Switch provider / model |
| `codexmate add <name> <URL> [API_KEY]` | Add provider |
| `codexmate delete <name>` | Delete provider |
| `codexmate claude <BaseURL> <API_KEY> [model]` | Write Claude Code config |
| `codexmate auth <list\|import\|switch\|delete\|status>` | Auth profile management |
| `codexmate proxy <status\|set\|apply\|enable\|start\|stop>` | Built-in proxy management |
| `codexmate workflow <list\|get\|validate\|run\|runs>` | MCP workflow management |
| `codexmate codex [args...] [--follow-up <text> repeatable]` | Codex CLI passthrough entrypoint (auto-adds `--yolo`, supports queued follow-up appends) |
| `codexmate qwen [args...]` | Qwen CLI passthrough entrypoint |
| `codexmate run [--host <HOST>] [--no-browser]` | Start Web UI |
| `codexmate mcp serve [--read-only\|--allow-write]` | Start MCP stdio server |
| `codexmate export-session --source <codex\|claude> ...` | Export session to Markdown |
| `codexmate zip <path> [--max:0-9]` / `codexmate unzip <zip> [out]` | Zip / unzip |
| `codexmate unzip-ext <zip-dir> [out] [--ext:suffix[,suffix...]] [--no-recursive]` | Extract files with target suffixes from ZIP files in a directory (default `.json`, recursive by default) |

### Codex Follow-up Append (Optional)

```bash
codexmate codex --follow-up "scan repository first" --follow-up "then fix failing tests"
codexmate codex --model gpt-5.3-codex --follow-up "step1" --follow-up "step2"
```

> Note: both `--follow-up` and `--queued-follow-up` are accepted and repeatable.

## Web UI

### Codex Mode
- Provider/model switching
- Model list management
- `~/.codex/AGENTS.md` editing

### Claude Code Mode
- Multi-profile management
- Default write to `~/.claude/settings.json`
- Shareable import command copy

### OpenClaw Mode
- JSON5 multi-profile management
- Apply to `~/.openclaw/openclaw.json`
- Manage `~/.openclaw/workspace/AGENTS.md`

### Sessions Mode
- Unified Codex + Claude sessions
- Local pin/unpin with persistent storage and pinned-first ordering
- Search, filter, export, delete, batch cleanup

### Skills Market Tab
- Switch the skills install target between `Codex` and `Claude Code`
- Show the current local skills root, installed items, and importable items
- Scan importable sources under `Codex` / `Claude Code` / `Agents`
- Support cross-app import, ZIP import/export, and batch delete

## MCP

> Transport: `stdio`

- Default: read-only tools
- Enable writes: `--allow-write` or `CODEXMATE_MCP_ALLOW_WRITE=1`
- Domains: `tools`, `resources`, `prompts`

Examples:

```bash
codexmate mcp serve --read-only
codexmate mcp serve --allow-write
```

## Config Files

- `~/.codex/config.toml`
- `~/.codex/auth.json`
- `~/.codex/models.json`
- `~/.codex/provider-current-models.json`
- `~/.claude/settings.json`
- `~/.openclaw/openclaw.json`
- `~/.openclaw/workspace/AGENTS.md`

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `CODEXMATE_PORT` | `3737` | Web server port |
| `CODEXMATE_HOST` | `0.0.0.0` | Web listen host (set `127.0.0.1` for local-only access) |
| `CODEXMATE_NO_BROWSER` | unset | Set `1` to disable browser auto-open |
| `CODEXMATE_MCP_ALLOW_WRITE` | unset | Set `1` to allow MCP write tools by default |
| `CODEXMATE_FORCE_RESET_EXISTING_CONFIG` | `0` | Set `1` to force bootstrap reset of existing config |

## Tech Stack

- Node.js
- Vue.js 3 (Web UI)
- Native HTTP server
- `@iarna/toml`, `json5`

## Contributing

Issues and pull requests are accepted.

- English changelog: `doc/CHANGELOG.md`
- Chinese changelog: `doc/CHANGELOG.zh-CN.md`

## License

Apache-2.0
