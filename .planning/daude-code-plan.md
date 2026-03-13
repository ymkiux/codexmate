# Daude Code Search Plan

## Context
- Goal: make CLI session search treat "daude code" variants (space/hyphen/concat) as the same intent and surface sessions with code capability plus numeric token 222.
- Scope: list-sessions query pipeline (token normalization, summary/content matching), fixture session data, e2e expectations.

## Socratic Brainstorming
- What user wants: reliable query that finds "daude code" sessions regardless of spacing/punctuation and still matches a numeric clue (222).
- Constraints: reuse existing token-based matchTokensInText logic; avoid heavy content scans (contentScanLimit=10) and keep defaults aligned with SESSION_CONTENT_READ_BYTES (256 KiB).
- Alternatives: (1) General hyphen/underscore splitter; (2) Targeted lexicon expansion for daude code; (3) Add keywords only without query rewrite.
- Trade-offs: general splitter risks false positives; keywords-only leaves hyphen/concat queries unmatched; targeted lexicon is minimal blast radius and predictable.
- Assumptions: "daude code" is a distinct provider/capability like Claude Code; digits like 222 must remain literal tokens.
- Risks/edge: token duplicates, ordering affecting contentScanLimit, numeric tokens getting stripped (avoid); ensure updatedAt keeps fixture within first scanned sessions.
- Simplest workable: targeted lexicon expansion plus fixture keywords; keep default scan limits; place 222 early in content.
- Hardest to change later: token normalization semantics; choose minimal, explicit alias list to reduce future churn.

## Search Flow Notes
- normalizeQueryTokens splits on whitespace and lowercases; tokens feed matchTokensInText for summary/content.
- applySessionQueryFilter uses summary first unless queryScope=content; content scan capped by contentScanLimit (default 10) and bytes (SESSION_CONTENT_READ_BYTES=256 KiB unless overridden).
- buildSessionSummaryText concatenates title/id/cwd/filePath/sourceLabel/keywords; keywords are the easiest place to seed aliases.

## Decisions
### Lexicon & Normalization
- Treat the following as equivalent aliases: "daude code", "daude-code", "daudecode".
- Canonical token set to inject when any alias appears: daude, code, daude code, daudecode, daude_code, daude-code.
- Implementation guidance: after normalizeQueryTokens, run a lexicon expander that (a) detects alias tokens via regex /^daude[-_ ]?code$/i or exact "daudecode"; (b) adds the canonical set; (c) de-duplicates while preserving order.
- Do not strip numeric tokens; keep existing lowercasing behavior only.

### Session Keywords/Metadata
- For any session marked with provider/source label "Daude" (or explicit fixture), ensure keywords include the canonical set above plus an optional provider marker daude.
- Capabilities: set capabilities.code=true so UI/tests can assert code capability similar to Claude Code.

### Content Scan Policy
- Keep defaults: contentScanLimit=DEFAULT_CONTENT_SCAN_LIMIT (10), contentScanBytes fallback=SESSION_CONTENT_READ_BYTES (256 KiB, min 1 KiB guard already in code).
- For tests that need snippets, pass queryScope=all and contentScanBytes=8*1024 to keep fixtures small while still extracting early messages.
- Rationale: targeted overrides keep runtime low while default behavior remains unchanged for real users.

### Fixture & Tests (incl. 222 case)
- Add a fixture session (codex source for simplicity) with updatedAt near now so it stays within the first 10 scanned items.
- Session content: include a user or assistant message containing the exact phrase "daude code" and the token "222" in the first few records to guarantee capture within contentScanBytes.
- Keywords on fixture: ["daudecode", "daude code", "daude_code", "daude-code", "daude", "code", "222"].
- Expected e2e queries:
  - Query "daude code" (summary scope) returns the fixture with provider/capabilities/keywords populated.
  - Queries "daude-code" and "daudecode" hit via lexicon expansion.
  - Query "222" with queryScope=content (and contentScanBytes override 8 KiB) returns the fixture with match.snippets containing the numeric token.

## Validation Plan
- Unit: add coverage for lexicon expander to ensure all aliases map to canonical tokens and digits remain untouched.
- E2E: extend tests/e2e/test-session-search.js to assert the three alias queries plus the 222 content hit with snippets.
- Fixture: update tests/e2e/test-setup.js to seed the session per above and store sessionId in ctx for reuse.

