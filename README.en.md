# Codex Mate (English)

The full README is maintained in **README.md**.

- Readme (Chinese + most up-to-date): [README.md](README.md)
- Docs site: https://sakurabytecore.github.io/codexmate/

## Quick Start

```bash
npm install -g codexmate
codexmate setup
codexmate status
codexmate run
```

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
- Browser / Usage subview switching
- Local pin/unpin with persistent storage and pinned-first ordering
- Search, filter, export, delete, batch cleanup
- Usage view includes 7d / 30d session trends, message trends, source share, and top paths

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

## License

Apache-2.0
