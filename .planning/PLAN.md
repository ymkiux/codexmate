# Execution Plan

## task_1: Backend claude_code query parsing
- **Assignee:** coder
- **Files:** cli.js

### Action
Implement a query lexicon for 'claude code' variants (claude code/claude-code/claudecode); extend query normalization to emit a claude_code keyword token plus provider=claude/code-capable filters; enrich session summaries with provider, capabilities.code, and derived keywords; adjust session filtering to prioritize keyword/provider matches with text fallback while keeping existing behavior and caches intact.

### Verify
Start `node cli.js run` locally and POST {action:'list-sessions',params:{source:'all',query:'claude code',forceRefresh:true}} to http://localhost:3737/api to confirm Claude Code sessions are returned and other queries still behave the same.

### Done
API search returns Claude Code sessions for any 'claude code' query variant without regressing existing session listing.

## task_2: UI enable claude code search
- **Assignee:** coder
- **Dependencies:** task_1
- **Files:** web-ui/logic.mjs, web-ui/app.js

### Action
Allow session queries when source is claude or all; propagate claude_code-aware query params from the UI; update placeholder/disabled states to reflect new support and keep defaults for other sources; wire any lightweight suggestion/hint if available without altering layout.

### Verify
Run `node tests/unit/run.mjs`; then in the running web UI search for 'claude code' with source=all to see the API payload includes the query and is not disabled.

### Done
Session search box accepts and sends queries for Claude/All sources, including claude_code variants, with UI state consistent with the new capability.

## task_3: Add tests for claude_code search
- **Assignee:** tester
- **Dependencies:** task_1, task_2
- **Files:** tests/e2e/test-setup.js, tests/e2e/test-sessions.js, tests/unit/web-ui-logic.test.mjs

### Action
Add a Claude Code sample session/index in test fixtures; extend unit tests to cover claude_code lexicon detection and session query enablement; extend e2e sessions test to assert that querying 'claude code' returns the Claude session while existing behaviors remain unchanged.

### Verify
Run `node tests/unit/run.mjs` and `node tests/e2e/run.js`.

### Done
Unit and e2e tests cover claude_code search path and all tests pass.
