import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appPath = path.join(__dirname, '..', '..', 'web-ui', 'app.js');
const cliPath = path.join(__dirname, '..', '..', 'cli.js');
const appSource = fs.readFileSync(appPath, 'utf-8');
const cliSource = fs.readFileSync(cliPath, 'utf-8');

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatchingBraceRespectingSyntax(source, braceStart) {
    let depth = 0;
    const contexts = [];
    const topContext = () => contexts[contexts.length - 1];

    for (let i = braceStart; i < source.length; i += 1) {
        const ch = source[i];
        const next = source[i + 1];
        const ctx = topContext();

        if (!ctx) {
            if (ch === '\'') {
                contexts.push({ type: 'single', escape: false });
                continue;
            }
            if (ch === '"') {
                contexts.push({ type: 'double', escape: false });
                continue;
            }
            if (ch === '`') {
                contexts.push({ type: 'templateString', escape: false });
                continue;
            }
            if (ch === '/' && next === '/') {
                contexts.push({ type: 'lineComment' });
                i += 1;
                continue;
            }
            if (ch === '/' && next === '*') {
                contexts.push({ type: 'blockComment' });
                i += 1;
                continue;
            }
            if (ch === '{') {
                depth += 1;
                continue;
            }
            if (ch === '}') {
                depth -= 1;
                if (depth === 0) {
                    return i;
                }
            }
            continue;
        }

        if (ctx.type === 'single' || ctx.type === 'double') {
            if (ctx.escape) {
                ctx.escape = false;
                continue;
            }
            if (ch === '\\') {
                ctx.escape = true;
                continue;
            }
            const target = ctx.type === 'single' ? '\'' : '"';
            if (ch === target) {
                contexts.pop();
            }
            continue;
        }

        if (ctx.type === 'lineComment') {
            if (ch === '\n') {
                contexts.pop();
            }
            continue;
        }

        if (ctx.type === 'blockComment') {
            if (ch === '*' && next === '/') {
                contexts.pop();
                i += 1;
            }
            continue;
        }

        if (ctx.type === 'templateString') {
            if (ctx.escape) {
                ctx.escape = false;
                continue;
            }
            if (ch === '\\') {
                ctx.escape = true;
                continue;
            }
            if (ch === '`') {
                contexts.pop();
                continue;
            }
            if (ch === '$' && next === '{') {
                contexts.push({ type: 'templateExpr', depth: 1 });
                i += 1;
            }
            continue;
        }

        if (ctx.type === 'templateExpr') {
            if (ch === '\'') {
                contexts.push({ type: 'single', escape: false });
                continue;
            }
            if (ch === '"') {
                contexts.push({ type: 'double', escape: false });
                continue;
            }
            if (ch === '`') {
                contexts.push({ type: 'templateString', escape: false });
                continue;
            }
            if (ch === '/' && next === '/') {
                contexts.push({ type: 'lineComment' });
                i += 1;
                continue;
            }
            if (ch === '/' && next === '*') {
                contexts.push({ type: 'blockComment' });
                i += 1;
                continue;
            }
            if (ch === '{') {
                ctx.depth += 1;
                continue;
            }
            if (ch === '}') {
                ctx.depth -= 1;
                if (ctx.depth === 0) {
                    contexts.pop();
                }
            }
        }
    }

    throw new Error('Closing brace not found for block');
}

function extractMethodAsFunction(source, methodName) {
    const pattern = new RegExp(
        `(?:^|\\n)([\\t ]*(?:async\\s+)?${escapeRegExp(methodName)}\\s*\\([^)]*\\)\\s*\\{)`,
        'm'
    );
    const match = pattern.exec(source);
    if (!match) {
        throw new Error(`Method signature not found: ${methodName}`);
    }
    const signatureText = match[1];
    const startIndex = match.index + match[0].lastIndexOf(signatureText);
    const braceStart = startIndex + signatureText.lastIndexOf('{');
    const endIndex = findMatchingBraceRespectingSyntax(source, braceStart);
    const methodBlock = source.slice(startIndex, endIndex + 1).trim();
    if (methodBlock.startsWith(`async ${methodName}(`)) {
        return `async function ${methodBlock.slice('async '.length)}`;
    }
    return `function ${methodBlock}`;
}

function extractFunctionBySignature(source, signature, funcName) {
    const startIndex = source.indexOf(signature);
    if (startIndex === -1) {
        throw new Error(`Signature not found: ${signature}`);
    }
    const signatureBraceOffset = signature.lastIndexOf('{');
    const braceStart = signatureBraceOffset >= 0
        ? (startIndex + signatureBraceOffset)
        : source.indexOf('{', startIndex + signature.length);
    const endIndex = findMatchingBraceRespectingSyntax(source, braceStart);
    const funcBlock = source.slice(startIndex, endIndex + 1).trim();
    return `${funcBlock}\nreturn ${funcName};`;
}

function instantiateFunction(funcSource, funcName, bindings = {}) {
    const bindingNames = Object.keys(bindings);
    const bindingValues = Object.values(bindings);
    return Function(...bindingNames, `${funcSource}\nreturn ${funcName};`)(...bindingValues);
}

test('buildClaudeSessionIndexEntry rebuilds stored messageCount semantics when original index entry is missing', () => {
    const buildClaudeStoredIndexMessageCountSource = extractFunctionBySignature(
        cliSource,
        'function buildClaudeStoredIndexMessageCount(messageCount) {',
        'buildClaudeStoredIndexMessageCount'
    );
    const buildClaudeStoredIndexMessageCount = Function(buildClaudeStoredIndexMessageCountSource)();
    const buildClaudeSessionIndexEntrySource = extractFunctionBySignature(
        cliSource,
        'function buildClaudeSessionIndexEntry(entry, sessionFilePath) {',
        'buildClaudeSessionIndexEntry'
    );
    const buildClaudeSessionIndexEntry = instantiateFunction(buildClaudeSessionIndexEntrySource, 'buildClaudeSessionIndexEntry', {
        normalizeSessionTrashEntry: (entry) => entry,
        normalizeCapabilities: (value) => value || {},
        normalizeKeywords: (value) => value || [],
        buildClaudeStoredIndexMessageCount,
        fs: {
            statSync: () => ({
                mtime: {
                    toISOString: () => '2025-03-30T00:00:00.000Z'
                }
            })
        },
        path: {
            dirname: () => '/tmp/claude-project'
        }
    });

    const result = buildClaudeSessionIndexEntry({
        source: 'claude',
        sessionId: 'claude-missing-index',
        title: 'missing index entry',
        provider: 'claude',
        capabilities: { code: true },
        keywords: ['claude_code'],
        messageCount: 7,
        createdAt: '2025-03-01T00:00:00.000Z',
        updatedAt: '2025-03-01T00:00:07.000Z'
    }, '/tmp/claude-project/claude-missing-index.jsonl');

    assert.strictEqual(result.messageCount, 8);
});

test('resolveClaudeSessionRestoreIndexPath ignores untrusted stored index path', () => {
    const resolveClaudeSessionRestoreIndexPathSource = extractFunctionBySignature(
        cliSource,
        'function resolveClaudeSessionRestoreIndexPath(entry, targetFilePath) {',
        'resolveClaudeSessionRestoreIndexPath'
    );
    const resolveClaudeSessionRestoreIndexPath = instantiateFunction(
        resolveClaudeSessionRestoreIndexPathSource,
        'resolveClaudeSessionRestoreIndexPath',
        {
            findClaudeSessionIndexPath(targetFilePath) {
                return path.join(path.dirname(targetFilePath), 'sessions-index.json');
            },
            getClaudeProjectsDir() {
                return '/tmp/claude-projects';
            },
            isPathInside(targetPath, rootPath) {
                const resolvedTarget = path.resolve(targetPath);
                const resolvedRoot = path.resolve(rootPath);
                return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
            },
            path
        }
    );

    const fallbackPath = '/tmp/claude-projects/project-a/sessions-index.json';
    const targetFilePath = '/tmp/claude-projects/project-a/session.jsonl';

    assert.strictEqual(
        resolveClaudeSessionRestoreIndexPath({ claudeIndexPath: '/tmp/outside/sessions-index.json' }, targetFilePath),
        fallbackPath
    );
    assert.strictEqual(
        resolveClaudeSessionRestoreIndexPath({ claudeIndexPath: '/tmp/claude-projects/project-b/sessions-index.json' }, targetFilePath),
        fallbackPath
    );
    assert.strictEqual(
        resolveClaudeSessionRestoreIndexPath({ claudeIndexPath: fallbackPath }, targetFilePath),
        fallbackPath
    );
});

test('loadSessionTrashCount ignores stale responses after a newer trash request invalidates them', async () => {
    let resolveApi = null;
    const loadSessionTrashCountSource = extractMethodAsFunction(appSource, 'loadSessionTrashCount');
    const loadSessionTrashCount = instantiateFunction(loadSessionTrashCountSource, 'loadSessionTrashCount', {
        api: async () => await new Promise((resolve) => {
            resolveApi = resolve;
        })
    });

    const context = {
        sessionTrashCountLoading: false,
        sessionTrashRequestToken: 0,
        sessionTrashTotalCount: 3,
        sessionTrashCountLoadedOnce: false,
        sessionTrashItems: [],
        issueSessionTrashRequestToken() {
            this.sessionTrashRequestToken += 1;
            return this.sessionTrashRequestToken;
        },
        invalidateSessionTrashRequests() {
            this.sessionTrashRequestToken += 1;
            return this.sessionTrashRequestToken;
        },
        isLatestSessionTrashRequestToken(token) {
            return Number(token) === Number(this.sessionTrashRequestToken);
        },
        normalizeSessionTrashTotalCount(totalCount, fallbackItems = this.sessionTrashItems) {
            const fallbackCount = Array.isArray(fallbackItems) ? fallbackItems.length : 0;
            const numericTotal = Number(totalCount);
            if (!Number.isFinite(numericTotal) || numericTotal < 0) {
                return fallbackCount;
            }
            return Math.max(fallbackCount, Math.floor(numericTotal));
        },
        showMessage() {
            throw new Error('stale request should not surface a toast');
        }
    };

    const pending = loadSessionTrashCount.call(context, { silent: true });
    context.invalidateSessionTrashRequests();
    context.sessionTrashTotalCount = 9;
    resolveApi({ totalCount: 4, items: [] });
    await pending;

    assert.strictEqual(context.sessionTrashTotalCount, 9);
    assert.strictEqual(context.sessionTrashCountLoadedOnce, false);
    assert.strictEqual(context.sessionTrashCountLoading, false);
});

test('getSessionTrashViewState returns retry when badge count exists but list has never loaded', () => {
    const getSessionTrashViewStateSource = extractMethodAsFunction(appSource, 'getSessionTrashViewState');
    const getSessionTrashViewState = instantiateFunction(getSessionTrashViewStateSource, 'getSessionTrashViewState');

    assert.strictEqual(getSessionTrashViewState.call({
        sessionTrashLoading: false,
        sessionTrashLoadedOnce: false,
        sessionTrashLastLoadFailed: true,
        sessionTrashCount: 0,
        sessionTrashItems: []
    }), 'retry');

    assert.strictEqual(getSessionTrashViewState.call({
        sessionTrashLoading: false,
        sessionTrashLoadedOnce: false,
        sessionTrashLastLoadFailed: false,
        sessionTrashCount: 4,
        sessionTrashItems: []
    }), 'retry');

    assert.strictEqual(getSessionTrashViewState.call({
        sessionTrashLoading: false,
        sessionTrashLoadedOnce: true,
        sessionTrashLastLoadFailed: false,
        sessionTrashCount: 0,
        sessionTrashItems: []
    }), 'empty');
});

test('loadSessionTrash marks latest failures as retryable and clears the failure state after a successful reload', async () => {
    let callCount = 0;
    const loadSessionTrashSource = extractMethodAsFunction(appSource, 'loadSessionTrash');
    const loadSessionTrash = instantiateFunction(loadSessionTrashSource, 'loadSessionTrash', {
        SESSION_TRASH_LIST_LIMIT: 50,
        api: async () => {
            callCount += 1;
            if (callCount === 1) {
                return { error: 'load failed' };
            }
            return {
                totalCount: 1,
                items: [{
                    trashId: 'trash-1',
                    sessionId: 'session-1'
                }]
            };
        }
    });

    const messages = [];
    const context = {
        sessionTrashItems: [],
        sessionTrashTotalCount: 0,
        sessionTrashCountLoadedOnce: false,
        sessionTrashLoadedOnce: false,
        sessionTrashLastLoadFailed: false,
        sessionTrashRequestToken: 0,
        sessionTrashLoading: false,
        issueSessionTrashRequestToken() {
            this.sessionTrashRequestToken += 1;
            return this.sessionTrashRequestToken;
        },
        isLatestSessionTrashRequestToken(requestToken) {
            return requestToken === this.sessionTrashRequestToken;
        },
        normalizeSessionTrashTotalCount(totalCount, fallbackItems = this.sessionTrashItems) {
            const fallbackCount = Array.isArray(fallbackItems) ? fallbackItems.length : 0;
            const numericTotal = Number(totalCount);
            if (!Number.isFinite(numericTotal) || numericTotal < 0) {
                return fallbackCount;
            }
            return Math.max(fallbackCount, Math.floor(numericTotal));
        },
        showMessage(message, tone) {
            messages.push({ message, tone });
        }
    };

    await loadSessionTrash.call(context);

    assert.strictEqual(context.sessionTrashLastLoadFailed, true);
    assert.strictEqual(context.sessionTrashLoadedOnce, false);
    assert.strictEqual(context.sessionTrashLoading, false);
    assert.deepStrictEqual(messages, [{ message: 'load failed', tone: 'error' }]);

    await loadSessionTrash.call(context, { forceRefresh: true });

    assert.strictEqual(context.sessionTrashLastLoadFailed, false);
    assert.strictEqual(context.sessionTrashLoadedOnce, true);
    assert.strictEqual(context.sessionTrashCountLoadedOnce, true);
    assert.strictEqual(context.sessionTrashLoading, false);
    assert.strictEqual(context.sessionTrashTotalCount, 1);
    assert.deepStrictEqual(context.sessionTrashItems, [{
        trashId: 'trash-1',
        sessionId: 'session-1'
    }]);
});

test('getSessionFileArg prefers filePath and falls back to file', () => {
    const getSessionFileArgSource = extractFunctionBySignature(
        cliSource,
        'function getSessionFileArg(params = {}) {',
        'getSessionFileArg'
    );
    const getSessionFileArg = Function(getSessionFileArgSource)();

    assert.strictEqual(getSessionFileArg({ filePath: ' /tmp/new-path.jsonl ', file: '/tmp/legacy-path.jsonl' }), '/tmp/new-path.jsonl');
    assert.strictEqual(getSessionFileArg({ file: ' /tmp/legacy-path.jsonl ' }), '/tmp/legacy-path.jsonl');
    assert.strictEqual(getSessionFileArg({}), '');
});

test('deleteSession increments trash badge count when only total count has been loaded', async () => {
    let requestedAction = '';
    const deleteSessionSource = extractMethodAsFunction(appSource, 'deleteSession');
    const deleteSession = instantiateFunction(deleteSessionSource, 'deleteSession', {
        api: async (action) => {
            requestedAction = action;
            return ({
            trashId: 'trash-1',
            deletedAt: '2025-03-30T00:00:00.000Z',
            messageCount: 2
            });
        }
    });

    let removed = false;
    const messages = [];
    const context = {
        sessionDeleting: {},
        sessionTrashLoadedOnce: false,
        sessionTrashCountLoadedOnce: true,
        sessionTrashTotalCount: 5,
        sessionTrashItems: [],
        sessionTrashRequestToken: 0,
        isDeleteAvailable: () => true,
        getSessionExportKey: () => 'codex:session-1',
        invalidateSessionTrashRequests() {
            this.sessionTrashRequestToken += 1;
            return this.sessionTrashRequestToken;
        },
        normalizeSessionTrashTotalCount(totalCount, fallbackItems = this.sessionTrashItems) {
            const fallbackCount = Array.isArray(fallbackItems) ? fallbackItems.length : 0;
            const numericTotal = Number(totalCount);
            if (!Number.isFinite(numericTotal) || numericTotal < 0) {
                return fallbackCount;
            }
            return Math.max(fallbackCount, Math.floor(numericTotal));
        },
        prependSessionTrashItem() {
            throw new Error('list hydration path should not run when only count is loaded');
        },
        buildSessionTrashItemFromSession() {
            throw new Error('list hydration path should not run when only count is loaded');
        },
        async removeSessionFromCurrentList() {
            removed = true;
        },
        showMessage(message, tone) {
            messages.push({ message, tone });
        }
    };

    await deleteSession.call(context, {
        source: 'codex',
        sessionId: 'session-1',
        filePath: '/tmp/session-1.jsonl'
    });

    assert.strictEqual(context.sessionTrashTotalCount, 6);
    assert.strictEqual(context.sessionDeleting['codex:session-1'], false);
    assert.strictEqual(removed, true);
    assert.strictEqual(requestedAction, 'trash-session');
    assert.deepStrictEqual(messages, [{ message: '已移入回收站', tone: 'success' }]);
});
