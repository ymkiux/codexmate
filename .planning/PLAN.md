# Execution Plan

## task_1: Design daude code search plan
- **Assignee:** architect
- **Files:** .planning/daude-code-plan.md

### Action
Review cli session search flow, define normalization for daude code variants (space/hyphen/concat) into tokens/keywords, decide content scan scope/bytes and record decisions plus 222 case in .planning/daude-code-plan.md.

### Verify
Open .planning/daude-code-plan.md and confirm it records lexicon, content-scan defaults, fixture/test updates.

### Done
Design doc exists with normalization, scope, fixture, and test expectations.

## task_2: Normalize daude code query in CLI
- **Assignee:** coder
- **Dependencies:** task_1
- **Files:** cli.js

### Action
In cli.js add daude code lexicon mapping so list-sessions builds normalized tokens/keywords and content scan supports the variant without hardcoding session ids.

### Verify
node tests/unit/run.mjs

### Done
list-sessions query 'daude code' returns code-capable sessions via summary/content without regressions.

## task_3: Add fixture session with daude code & 222
- **Assignee:** coder
- **Dependencies:** task_1
- **Files:** tests/e2e/test-setup.js

### Action
Update tests/e2e/test-setup.js to create a fixture session containing daude code text and 222 in message content, with keywords/capabilities set and sessionId stored in ctx.

### Verify
node tests/e2e/run.js

### Done
Fixture session with daude code and 222 is available for e2e search assertions.

## task_4: Cover daude code search in e2e
- **Assignee:** tester
- **Dependencies:** task_2, task_3
- **Files:** tests/e2e/test-session-search.js

### Action
Expand tests/e2e/test-session-search.js to assert list-sessions with queryScope content finds the daude code session (and 222 query) with match.snippets and expected provider/keyword fields.

### Verify
node tests/e2e/run.js

### Done
Session search e2e covers daude code and 222 and passes.

## task_5: Full test sweep
- **Assignee:** tester
- **Dependencies:** task_2, task_3, task_4

### Action
Run the full suite after changes to ensure no regressions.

### Verify
node tests/unit/run.mjs; node tests/e2e/run.js

### Done
All unit and e2e tests pass.
