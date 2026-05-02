import assert from 'assert';
import path from 'path';
import {
    readBundledWebUiCss,
    readBundledWebUiHtml,
    readBundledWebUiScript,
    readProjectFile
} from './helpers/web-ui-source.mjs';

const appSource = readBundledWebUiScript();
const cliSource = readProjectFile('cli.js');
const indexHtmlSource = readBundledWebUiHtml();
const stylesSource = readBundledWebUiCss();

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

test('buildClaudeSessionIndexEntry prefers normalized metadata when stored index entry is missing or stale', () => {
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
        updatedAt: '2025-03-01T00:00:07.000Z',
        claudeIndexEntry: {
            messageCount: 2,
            capabilities: {},
            keywords: []
        }
    }, '/tmp/claude-project/claude-missing-index.jsonl');

    assert.strictEqual(result.messageCount, 8);
    assert.deepStrictEqual(result.capabilities, { code: true });
    assert.deepStrictEqual(result.keywords, ['claude_code']);
});

test('resolveClaudeSessionRestoreIndexPath ignores untrusted stored index path', () => {
    const posixPath = path.posix;
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
                return posixPath.join(posixPath.dirname(targetFilePath), 'sessions-index.json');
            },
            getClaudeProjectsDir() {
                return '/tmp/claude-projects';
            },
            isPathInside(targetPath, rootPath) {
                const resolvedTarget = posixPath.resolve(targetPath);
                const resolvedRoot = posixPath.resolve(rootPath);
                return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${posixPath.sep}`);
            },
            path: posixPath
        }
    );

    const fallbackPath = posixPath.join('/tmp/claude-projects/project-a', 'sessions-index.json');
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

test('removeClaudeSessionIndexEntry keeps differently cased paths distinct on case-sensitive platforms', () => {
    let writePayload = null;
    const removeClaudeSessionIndexEntrySource = extractFunctionBySignature(
        cliSource,
        'function removeClaudeSessionIndexEntry(indexPath, sessionFilePath, sessionId) {',
        'removeClaudeSessionIndexEntry'
    );
    const removeClaudeSessionIndexEntry = instantiateFunction(
        removeClaudeSessionIndexEntrySource,
        'removeClaudeSessionIndexEntry',
        {
            fs: {
                existsSync: () => true
            },
            readJsonFile() {
                return {
                    entries: [{
                        sessionId: 'case-sensitive-entry',
                        fullPath: '/tmp/Session.jsonl'
                    }]
                };
            },
            writeJsonAtomic(indexPath, payload) {
                writePayload = { indexPath, payload };
            },
            expandHomePath(value) {
                return value;
            },
            normalizePathForCompare(targetPath, options = {}) {
                const resolved = path.resolve(targetPath);
                return options.ignoreCase ? resolved.toLowerCase() : resolved;
            },
            path,
            process: { platform: 'linux' },
            JSON
        }
    );

    const result = removeClaudeSessionIndexEntry('/tmp/sessions-index.json', '/tmp/session.jsonl', 'missing');

    assert.deepStrictEqual(result, { removed: false, entry: null });
    assert.strictEqual(writePayload, null);
});

test('removeClaudeSessionIndexEntry prefers normalized fullPath over stale sessionId when file path is known', () => {
    let writePayload = null;
    const removeClaudeSessionIndexEntrySource = extractFunctionBySignature(
        cliSource,
        'function removeClaudeSessionIndexEntry(indexPath, sessionFilePath, sessionId) {',
        'removeClaudeSessionIndexEntry'
    );
    const removeClaudeSessionIndexEntry = instantiateFunction(
        removeClaudeSessionIndexEntrySource,
        'removeClaudeSessionIndexEntry',
        {
            fs: {
                existsSync: () => true
            },
            readJsonFile() {
                return {
                    entries: [
                        {
                            sessionId: 'stale-id',
                            fullPath: '/tmp/other.jsonl',
                            note: 'keep-by-path'
                        },
                        {
                            sessionId: 'fresh-id',
                            fullPath: '/tmp/session.jsonl',
                            note: 'remove-by-path'
                        }
                    ]
                };
            },
            writeJsonAtomic(indexPath, payload) {
                writePayload = { indexPath, payload };
            },
            expandHomePath(value) {
                return value;
            },
            normalizePathForCompare(targetPath, options = {}) {
                const resolved = path.resolve(targetPath);
                return options.ignoreCase ? resolved.toLowerCase() : resolved;
            },
            path,
            process: { platform: 'linux' },
            JSON
        }
    );

    const result = removeClaudeSessionIndexEntry('/tmp/sessions-index.json', '/tmp/session.jsonl', 'stale-id');

    assert.deepStrictEqual(result, {
        removed: true,
        entry: {
            sessionId: 'fresh-id',
            fullPath: '/tmp/session.jsonl',
            note: 'remove-by-path'
        }
    });
    assert.deepStrictEqual(writePayload, {
        indexPath: '/tmp/sessions-index.json',
        payload: {
            entries: [{
                sessionId: 'stale-id',
                fullPath: '/tmp/other.jsonl',
                note: 'keep-by-path'
            }]
        }
    });
});

test('upsertClaudeSessionIndexEntry keeps differently cased paths distinct on case-sensitive platforms', () => {
    let writtenIndex = null;
    const upsertClaudeSessionIndexEntrySource = extractFunctionBySignature(
        cliSource,
        'function upsertClaudeSessionIndexEntry(indexPath, sessionFilePath, entry) {',
        'upsertClaudeSessionIndexEntry'
    );
    const upsertClaudeSessionIndexEntry = instantiateFunction(
        upsertClaudeSessionIndexEntrySource,
        'upsertClaudeSessionIndexEntry',
        {
            readJsonFile() {
                return {
                    entries: [{
                        sessionId: 'case-sensitive-entry',
                        fullPath: '/tmp/Session.jsonl'
                    }]
                };
            },
            normalizePathForCompare(targetPath, options = {}) {
                const resolved = path.resolve(targetPath);
                return options.ignoreCase ? resolved.toLowerCase() : resolved;
            },
            normalizeSessionTrashEntry(entry) {
                return entry;
            },
            buildClaudeSessionIndexEntry(entry, sessionFilePath) {
                return {
                    sessionId: entry.sessionId,
                    fullPath: sessionFilePath
                };
            },
            expandHomePath(value) {
                return value;
            },
            writeJsonAtomic(indexPath, payload) {
                writtenIndex = { indexPath, payload };
            },
            path,
            process: { platform: 'linux' }
        }
    );

    upsertClaudeSessionIndexEntry('/tmp/sessions-index.json', '/tmp/session.jsonl', { sessionId: 'new-entry' });

    assert(writtenIndex, 'index should be written');
    assert.strictEqual(writtenIndex.payload.entries.length, 2);
    assert.strictEqual(writtenIndex.payload.entries[0].sessionId, 'new-entry');
    assert.strictEqual(writtenIndex.payload.entries[1].sessionId, 'case-sensitive-entry');
});

test('upsertClaudeSessionIndexEntry prefers normalized fullPath over stale sessionId when file path is known', () => {
    let writtenIndex = null;
    const upsertClaudeSessionIndexEntrySource = extractFunctionBySignature(
        cliSource,
        'function upsertClaudeSessionIndexEntry(indexPath, sessionFilePath, entry) {',
        'upsertClaudeSessionIndexEntry'
    );
    const upsertClaudeSessionIndexEntry = instantiateFunction(
        upsertClaudeSessionIndexEntrySource,
        'upsertClaudeSessionIndexEntry',
        {
            readJsonFile() {
                return {
                    entries: [
                        {
                            sessionId: 'stale-id',
                            fullPath: '/tmp/other.jsonl',
                            note: 'keep-by-path'
                        },
                        {
                            sessionId: 'fresh-id',
                            fullPath: '/tmp/session.jsonl',
                            note: 'replace-by-path'
                        }
                    ]
                };
            },
            normalizePathForCompare(targetPath, options = {}) {
                const resolved = path.resolve(targetPath);
                return options.ignoreCase ? resolved.toLowerCase() : resolved;
            },
            normalizeSessionTrashEntry(entry) {
                return entry;
            },
            buildClaudeSessionIndexEntry(entry, sessionFilePath) {
                return {
                    sessionId: entry.sessionId,
                    fullPath: sessionFilePath,
                    note: 'new-entry'
                };
            },
            expandHomePath(value) {
                return value;
            },
            writeJsonAtomic(indexPath, payload) {
                writtenIndex = { indexPath, payload };
            },
            path,
            process: { platform: 'linux' }
        }
    );

    upsertClaudeSessionIndexEntry('/tmp/sessions-index.json', '/tmp/session.jsonl', { sessionId: 'stale-id' });

    assert.deepStrictEqual(writtenIndex, {
        indexPath: '/tmp/sessions-index.json',
        payload: {
            entries: [
                {
                    sessionId: 'stale-id',
                    fullPath: '/tmp/session.jsonl',
                    note: 'new-entry'
                },
                {
                    sessionId: 'stale-id',
                    fullPath: '/tmp/other.jsonl',
                    note: 'keep-by-path'
                }
            ],
            originalPath: '/tmp'
        }
    });
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
        sessionTrashCountRequestToken: 0,
        sessionTrashListRequestToken: 0,
        sessionTrashTotalCount: 3,
        sessionTrashCountLoadedOnce: false,
        sessionTrashItems: [],
        issueSessionTrashCountRequestToken() {
            this.sessionTrashCountRequestToken += 1;
            return this.sessionTrashCountRequestToken;
        },
        invalidateSessionTrashRequests() {
            this.sessionTrashCountRequestToken += 1;
            this.sessionTrashListRequestToken += 1;
            return this.sessionTrashListRequestToken;
        },
        isLatestSessionTrashCountRequestToken(token) {
            return Number(token) === Number(this.sessionTrashCountRequestToken);
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

test('loadSessionTrashCount trusts a lower authoritative backend totalCount during count-only refresh', async () => {
    const normalizeSessionTrashTotalCountSource = extractMethodAsFunction(appSource, 'normalizeSessionTrashTotalCount');
    const normalizeSessionTrashTotalCount = instantiateFunction(
        normalizeSessionTrashTotalCountSource,
        'normalizeSessionTrashTotalCount'
    );
    const loadSessionTrashCountSource = extractMethodAsFunction(appSource, 'loadSessionTrashCount');
    const loadSessionTrashCount = instantiateFunction(loadSessionTrashCountSource, 'loadSessionTrashCount', {
        api: async () => ({
            totalCount: 0,
            items: []
        })
    });

    const context = {
        sessionTrashCountLoading: false,
        sessionTrashCountPendingOptions: null,
        sessionTrashCountRequestToken: 0,
        sessionTrashTotalCount: 10,
        sessionTrashCountLoadedOnce: false,
        sessionTrashItems: [
            { trashId: 'trash-1' },
            { trashId: 'trash-2' }
        ],
        issueSessionTrashCountRequestToken() {
            this.sessionTrashCountRequestToken += 1;
            return this.sessionTrashCountRequestToken;
        },
        isLatestSessionTrashCountRequestToken(token) {
            return Number(token) === Number(this.sessionTrashCountRequestToken);
        },
        normalizeSessionTrashTotalCount,
        showMessage() {
            throw new Error('successful count-only refresh should not surface a toast');
        }
    };

    await loadSessionTrashCount.call(context, { silent: true });

    assert.strictEqual(context.sessionTrashTotalCount, 0);
    assert.strictEqual(context.sessionTrashCountLoadedOnce, true);
    assert.strictEqual(context.sessionTrashCountLoading, false);
});

test('session trash template keeps source badges neutral and shares the busy guard between actions', () => {
    const trashMeta = indexHtmlSource.match(
        /<div class="trash-item-meta session-item-meta">[\s\S]*?<span class="session-source">{{ item\.sourceLabel }}<\/span>[\s\S]*?<\/div>/
    );
    assert(trashMeta, 'trash item source badge should exist');
    assert.doesNotMatch(trashMeta[0], /item\.source === 'claude' \? 'configured' : 'empty'/);

    const busyBindings = indexHtmlSource.match(/:disabled="sessionTrashLoading \|\| sessionTrashClearing \|\| isSessionTrashActionBusy\(item\)"/g);
    assert.strictEqual(busyBindings && busyBindings.length, 2);
});

test('session trash desktop actions keep the action block right-aligned', () => {
    const actionsRule = stylesSource.match(/\.trash-item-actions\s*\{[\s\S]*?\}/);
    assert(actionsRule, 'trash item actions rule should exist');
    assert.match(actionsRule[0], /align-self:\s*flex-end;/);
    assert.match(actionsRule[0], /justify-content:\s*flex-end;/);
    assert.doesNotMatch(actionsRule[0], /align-self:\s*flex-start;/);
});

test('loadSessionTrash and loadSessionTrashCount keep independent stale-response tokens', async () => {
    let resolveCount = null;
    let resolveList = null;
    const api = async (action, params = {}) => await new Promise((resolve) => {
        if (action !== 'list-session-trash') {
            throw new Error(`unexpected action: ${action}`);
        }
        if (params.countOnly === true) {
            resolveCount = resolve;
            return;
        }
        resolveList = resolve;
    });
    const loadSessionTrashCount = instantiateFunction(
        extractMethodAsFunction(appSource, 'loadSessionTrashCount'),
        'loadSessionTrashCount',
        { api }
    );
    const loadSessionTrash = instantiateFunction(
        extractMethodAsFunction(appSource, 'loadSessionTrash'),
        'loadSessionTrash',
        {
            sessionTrashListLimit: 50,
            api
        }
    );

    const context = {
        sessionTrashItems: [],
        sessionTrashTotalCount: 0,
        sessionTrashCountLoadedOnce: false,
        sessionTrashLoadedOnce: false,
        sessionTrashLastLoadFailed: false,
        sessionTrashCountRequestToken: 0,
        sessionTrashListRequestToken: 0,
        sessionTrashCountLoading: false,
        sessionTrashLoading: false,
        sessionTrashCountPendingOptions: null,
        sessionTrashPendingOptions: null,
        issueSessionTrashCountRequestToken() {
            this.sessionTrashCountRequestToken += 1;
            return this.sessionTrashCountRequestToken;
        },
        issueSessionTrashListRequestToken() {
            this.sessionTrashListRequestToken += 1;
            return this.sessionTrashListRequestToken;
        },
        isLatestSessionTrashCountRequestToken(token) {
            return token === this.sessionTrashCountRequestToken;
        },
        isLatestSessionTrashListRequestToken(token) {
            return token === this.sessionTrashListRequestToken;
        },
        normalizeSessionTrashTotalCount(totalCount, fallbackItems = this.sessionTrashItems) {
            const fallbackCount = Array.isArray(fallbackItems) ? fallbackItems.length : 0;
            const numericTotal = Number(totalCount);
            if (!Number.isFinite(numericTotal) || numericTotal < 0) {
                return fallbackCount;
            }
            return Math.max(fallbackCount, Math.floor(numericTotal));
        },
        resetSessionTrashVisibleCount() {
            this.sessionTrashVisibleCount = 50;
        },
        showMessage() {
            throw new Error('independent requests should not surface a toast');
        }
    };

    const listPromise = loadSessionTrash.call(context, { forceRefresh: true });
    const countPromise = loadSessionTrashCount.call(context, { silent: true });

    resolveList({
        totalCount: 2,
        items: [{ trashId: 'trash-1', sessionId: 'session-1' }]
    });
    resolveCount({
        totalCount: 2,
        items: []
    });

    await Promise.all([listPromise, countPromise]);

    assert.strictEqual(context.sessionTrashLoadedOnce, true);
    assert.strictEqual(context.sessionTrashCountLoadedOnce, true);
    assert.strictEqual(context.sessionTrashTotalCount, 2);
    assert.deepStrictEqual(context.sessionTrashItems, [{ trashId: 'trash-1', sessionId: 'session-1' }]);
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
        sessionTrashListLimit: 50,
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
        sessionTrashListRequestToken: 0,
        sessionTrashLoading: false,
        issueSessionTrashListRequestToken() {
            this.sessionTrashListRequestToken += 1;
            return this.sessionTrashListRequestToken;
        },
        isLatestSessionTrashListRequestToken(requestToken) {
            return requestToken === this.sessionTrashListRequestToken;
        },
        normalizeSessionTrashTotalCount(totalCount, fallbackItems = this.sessionTrashItems) {
            const fallbackCount = Array.isArray(fallbackItems) ? fallbackItems.length : 0;
            const numericTotal = Number(totalCount);
            if (!Number.isFinite(numericTotal) || numericTotal < 0) {
                return fallbackCount;
            }
            return Math.max(fallbackCount, Math.floor(numericTotal));
        },
        resetSessionTrashVisibleCount() {},
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

test('listSessionTrashItems rewrites repaired entries onto the latest trash index snapshot', async () => {
    const listSessionTrashItemsSource = extractFunctionBySignature(
        cliSource,
        'async function listSessionTrashItems(params = {}) {',
        'listSessionTrashItems'
    );
    let readCount = 0;
    let writtenEntries = null;
    const listSessionTrashItems = instantiateFunction(listSessionTrashItemsSource, 'listSessionTrashItems', {
        MAX_SESSION_TRASH_LIST_SIZE: 500,
        readSessionTrashEntries(options = {}) {
            readCount += 1;
            if (readCount === 1) {
                assert.strictEqual(options.cleanup, undefined);
                return [
                    { trashId: 'trash-1', source: 'codex', deletedAt: '2025-03-02T00:00:00.000Z', messageCount: 1, messageCountMtimeMs: 1 },
                    { trashId: 'trash-2', source: 'codex', deletedAt: '2025-03-01T00:00:00.000Z', messageCount: 2, messageCountMtimeMs: 2 }
                ];
            }
            assert.strictEqual(options.cleanup, false);
            return [
                { trashId: 'trash-3', source: 'codex', deletedAt: '2025-03-03T00:00:00.000Z', messageCount: 3, messageCountMtimeMs: 3 },
                { trashId: 'trash-1', source: 'codex', deletedAt: '2025-03-02T00:00:00.000Z', messageCount: 1, messageCountMtimeMs: 1 },
                { trashId: 'trash-2', source: 'codex', deletedAt: '2025-03-01T00:00:00.000Z', messageCount: 2, messageCountMtimeMs: 2 }
            ];
        },
        hydrateSessionTrashEntries: async (entries) => entries.map((entry) => (
            entry.trashId === 'trash-1'
                ? { ...entry, messageCount: 10, messageCountMtimeMs: 99 }
                : entry
        )),
        writeSessionTrashEntries(entries) {
            writtenEntries = entries;
        },
        resolveSessionTrashFilePath(entry) {
            return `/tmp/${entry.trashId}.jsonl`;
        }
    });

    const result = await listSessionTrashItems();

    assert.strictEqual(result.totalCount, 2);
    assert(writtenEntries, 'updated trash index should be written');
    assert.deepStrictEqual(writtenEntries.map((entry) => entry.trashId), ['trash-3', 'trash-1', 'trash-2']);
    assert.strictEqual(writtenEntries[1].messageCount, 10);
    assert.strictEqual(writtenEntries[1].messageCountMtimeMs, 99);
});

test('restoreSessionTrashItem removes the restored entry from the latest trash index snapshot', async () => {
    const restoreSessionTrashItemSource = extractFunctionBySignature(
        cliSource,
        'async function restoreSessionTrashItem(params = {}) {',
        'restoreSessionTrashItem'
    );
    let readCount = 0;
    let writtenEntries = null;
    const restoreSessionTrashItem = instantiateFunction(restoreSessionTrashItemSource, 'restoreSessionTrashItem', {
        readSessionTrashEntries(options = {}) {
            readCount += 1;
            if (readCount === 1) {
                assert.strictEqual(options.cleanup, undefined);
                return [
                    { trashId: 'trash-1', source: 'codex', sessionId: 'session-1', originalFilePath: '/tmp/session-1.jsonl' }
                ];
            }
            assert.strictEqual(options.cleanup, false);
            return [
                { trashId: 'trash-2', source: 'codex', sessionId: 'session-2', originalFilePath: '/tmp/session-2.jsonl' },
                { trashId: 'trash-1', source: 'codex', sessionId: 'session-1', originalFilePath: '/tmp/session-1.jsonl' }
            ];
        },
        resolveSessionTrashEntryExactMessageCount: async (entry) => ({
            ...entry,
            source: 'codex',
            originalFilePath: '/tmp/session-1.jsonl'
        }),
        resolveSessionTrashFilePath: () => '/tmp/trash-1.jsonl',
        resolveSessionRestoreTarget: () => '/tmp/session-1.jsonl',
        moveFileSync() {},
        resolveClaudeSessionRestoreIndexPath() {
            throw new Error('claude index restore should not run for codex entry');
        },
        upsertClaudeSessionIndexEntry() {
            throw new Error('claude index restore should not run for codex entry');
        },
        writeSessionTrashEntries(entries) {
            writtenEntries = entries;
        },
        invalidateSessionListCache() {},
        fs: {
            existsSync(targetPath) {
                return targetPath === '/tmp/trash-1.jsonl';
            }
        }
    });

    const result = await restoreSessionTrashItem({ trashId: 'trash-1' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.restored, true);
    assert.strictEqual(result.trashId, 'trash-1');
    assert.strictEqual(result.filePath, '/tmp/session-1.jsonl');
    assert.deepStrictEqual(writtenEntries, [
        { trashId: 'trash-2', source: 'codex', sessionId: 'session-2', originalFilePath: '/tmp/session-2.jsonl' }
    ]);
});

test('restoreSessionTrashItem rolls back a Claude restore before removing the index entry on persistence failure', async () => {
    const restoreSessionTrashItemSource = extractFunctionBySignature(
        cliSource,
        'async function restoreSessionTrashItem(params = {}) {',
        'restoreSessionTrashItem'
    );
    let readCount = 0;
    let fileInTrash = true;
    let fileInTarget = false;
    const calls = [];
    const persistError = new Error('persist failed');
    const restoreSessionTrashItem = instantiateFunction(restoreSessionTrashItemSource, 'restoreSessionTrashItem', {
        readSessionTrashEntries(options = {}) {
            readCount += 1;
            if (readCount === 1) {
                assert.strictEqual(options.cleanup, undefined);
                return [
                    { trashId: 'trash-1', source: 'claude', sessionId: 'session-1', originalFilePath: '/tmp/session-1.jsonl' }
                ];
            }
            assert.strictEqual(options.cleanup, false);
            return [
                { trashId: 'trash-2', source: 'codex', sessionId: 'session-2', originalFilePath: '/tmp/session-2.jsonl' },
                { trashId: 'trash-1', source: 'claude', sessionId: 'session-1', originalFilePath: '/tmp/session-1.jsonl' }
            ];
        },
        resolveSessionTrashEntryExactMessageCount: async (entry) => ({
            ...entry,
            source: 'claude',
            originalFilePath: '/tmp/session-1.jsonl'
        }),
        resolveSessionTrashFilePath: () => '/tmp/trash-1.jsonl',
        resolveSessionRestoreTarget: () => '/tmp/session-1.jsonl',
        moveFileSync(sourcePath, targetPath) {
            calls.push(['moveFileSync', sourcePath, targetPath]);
            if (sourcePath === '/tmp/trash-1.jsonl' && targetPath === '/tmp/session-1.jsonl') {
                fileInTrash = false;
                fileInTarget = true;
                return;
            }
            if (sourcePath === '/tmp/session-1.jsonl' && targetPath === '/tmp/trash-1.jsonl') {
                fileInTarget = false;
                fileInTrash = true;
            }
        },
        resolveClaudeSessionRestoreIndexPath() {
            return '/tmp/sessions-index.json';
        },
        upsertClaudeSessionIndexEntry(indexPath, targetPath, restoredEntry) {
            calls.push(['upsertClaudeSessionIndexEntry', indexPath, targetPath, restoredEntry.sessionId]);
        },
        removeClaudeSessionIndexEntry(indexPath, targetPath, sessionId) {
            calls.push(['removeClaudeSessionIndexEntry', indexPath, targetPath, sessionId]);
        },
        writeSessionTrashEntries() {
            throw persistError;
        },
        invalidateSessionListCache() {
            throw new Error('cache invalidation should not run on failed restore');
        },
        fs: {
            existsSync(targetPath) {
                if (targetPath === '/tmp/trash-1.jsonl') {
                    return fileInTrash;
                }
                if (targetPath === '/tmp/session-1.jsonl') {
                    return fileInTarget;
                }
                return targetPath === '/tmp/sessions-index.json';
            }
        }
    });

    const result = await restoreSessionTrashItem({ trashId: 'trash-1' });

    assert.deepStrictEqual(calls, [
        ['moveFileSync', '/tmp/trash-1.jsonl', '/tmp/session-1.jsonl'],
        ['upsertClaudeSessionIndexEntry', '/tmp/sessions-index.json', '/tmp/session-1.jsonl', 'session-1'],
        ['moveFileSync', '/tmp/session-1.jsonl', '/tmp/trash-1.jsonl'],
        ['removeClaudeSessionIndexEntry', '/tmp/sessions-index.json', '/tmp/session-1.jsonl', 'session-1']
    ]);
    assert.deepStrictEqual(result, { error: `恢复会话失败: ${persistError.message}` });
});

test('restoreSessionTrashItem keeps the Claude index entry when rollback move fails', async () => {
    const restoreSessionTrashItemSource = extractFunctionBySignature(
        cliSource,
        'async function restoreSessionTrashItem(params = {}) {',
        'restoreSessionTrashItem'
    );
    let readCount = 0;
    let fileInTrash = true;
    let fileInTarget = false;
    let removeCalls = 0;
    const calls = [];
    const persistError = new Error('persist failed');
    const rollbackError = new Error('rollback failed');
    const restoreSessionTrashItem = instantiateFunction(restoreSessionTrashItemSource, 'restoreSessionTrashItem', {
        readSessionTrashEntries(options = {}) {
            readCount += 1;
            if (readCount === 1) {
                assert.strictEqual(options.cleanup, undefined);
                return [
                    { trashId: 'trash-1', source: 'claude', sessionId: 'session-1', originalFilePath: '/tmp/session-1.jsonl' }
                ];
            }
            assert.strictEqual(options.cleanup, false);
            return [
                { trashId: 'trash-1', source: 'claude', sessionId: 'session-1', originalFilePath: '/tmp/session-1.jsonl' }
            ];
        },
        resolveSessionTrashEntryExactMessageCount: async (entry) => ({
            ...entry,
            source: 'claude',
            originalFilePath: '/tmp/session-1.jsonl'
        }),
        resolveSessionTrashFilePath: () => '/tmp/trash-1.jsonl',
        resolveSessionRestoreTarget: () => '/tmp/session-1.jsonl',
        moveFileSync(sourcePath, targetPath) {
            calls.push(['moveFileSync', sourcePath, targetPath]);
            if (sourcePath === '/tmp/trash-1.jsonl' && targetPath === '/tmp/session-1.jsonl') {
                fileInTrash = false;
                fileInTarget = true;
                return;
            }
            if (sourcePath === '/tmp/session-1.jsonl' && targetPath === '/tmp/trash-1.jsonl') {
                throw rollbackError;
            }
        },
        resolveClaudeSessionRestoreIndexPath() {
            return '/tmp/sessions-index.json';
        },
        upsertClaudeSessionIndexEntry(indexPath, targetPath, restoredEntry) {
            calls.push(['upsertClaudeSessionIndexEntry', indexPath, targetPath, restoredEntry.sessionId]);
        },
        removeClaudeSessionIndexEntry() {
            removeCalls += 1;
        },
        writeSessionTrashEntries() {
            throw persistError;
        },
        invalidateSessionListCache() {
            throw new Error('cache invalidation should not run on failed restore');
        },
        fs: {
            existsSync(targetPath) {
                if (targetPath === '/tmp/trash-1.jsonl') {
                    return fileInTrash;
                }
                if (targetPath === '/tmp/session-1.jsonl') {
                    return fileInTarget;
                }
                return targetPath === '/tmp/sessions-index.json';
            }
        }
    });

    const result = await restoreSessionTrashItem({ trashId: 'trash-1' });

    assert.deepStrictEqual(calls, [
        ['moveFileSync', '/tmp/trash-1.jsonl', '/tmp/session-1.jsonl'],
        ['upsertClaudeSessionIndexEntry', '/tmp/sessions-index.json', '/tmp/session-1.jsonl', 'session-1'],
        ['moveFileSync', '/tmp/session-1.jsonl', '/tmp/trash-1.jsonl']
    ]);
    assert.strictEqual(removeCalls, 0);
    assert.deepStrictEqual(result, { error: `恢复会话失败: ${persistError.message}` });
});

test('trashSessionData rolls back a Claude file before restoring the index entry on persistence failure', async () => {
    const trashSessionDataSource = extractFunctionBySignature(
        cliSource,
        'async function trashSessionData(params = {}) {',
        'trashSessionData'
    );
    let fileInSource = true;
    let fileInTrash = false;
    const calls = [];
    const persistError = new Error('persist failed');
    const removedClaudeIndexEntry = { sessionId: 'session-1', messageCount: 7 };
    const trashSessionData = instantiateFunction(trashSessionDataSource, 'trashSessionData', {
        MAX_SESSION_TRASH_LIST_SIZE: 500,
        resolveSessionFilePath() {
            return '/tmp/session-1.jsonl';
        },
        getSessionFileArg() {
            return '';
        },
        parseClaudeSessionSummary() {
            return {
                sessionId: 'session-1',
                title: 'Claude session',
                messageCount: 7,
                capabilities: { code: true },
                keywords: ['claude_code'],
                updatedAt: '2025-03-30T00:00:00.000Z',
                createdAt: '2025-03-29T00:00:00.000Z'
            };
        },
        parseCodexSessionSummary() {
            throw new Error('codex summary should not run for Claude entry');
        },
        buildSessionSummaryFallback() {
            throw new Error('fallback summary should not run for Claude entry');
        },
        async countConversationMessagesInFile() {
            return 7;
        },
        allocateSessionTrashTarget() {
            return {
                trashId: 'trash-1',
                trashFileName: 'trash-1.jsonl',
                trashFilePath: '/tmp/trash-1.jsonl'
            };
        },
        findClaudeSessionIndexPath() {
            return '/tmp/sessions-index.json';
        },
        moveFileSync(sourcePath, targetPath) {
            calls.push(['moveFileSync', sourcePath, targetPath]);
            if (sourcePath === '/tmp/session-1.jsonl' && targetPath === '/tmp/trash-1.jsonl') {
                fileInSource = false;
                fileInTrash = true;
                return;
            }
            if (sourcePath === '/tmp/trash-1.jsonl' && targetPath === '/tmp/session-1.jsonl') {
                fileInSource = true;
                fileInTrash = false;
            }
        },
        removeClaudeSessionIndexEntry(indexPath, filePath, sessionId) {
            calls.push(['removeClaudeSessionIndexEntry', indexPath, filePath, sessionId]);
            return { entry: removedClaudeIndexEntry };
        },
        buildSessionTrashEntry(summary, options) {
            return {
                trashId: options.trashId,
                trashFileName: options.trashFileName,
                source: options.source,
                sessionId: options.sessionId,
                title: summary.title
            };
        },
        readSessionTrashEntries(options = {}) {
            assert.strictEqual(options.cleanup, false);
            return [];
        },
        writeSessionTrashEntries() {
            throw persistError;
        },
        upsertClaudeSessionIndexEntry(indexPath, filePath, entry) {
            calls.push(['upsertClaudeSessionIndexEntry', indexPath, filePath, entry.sessionId]);
        },
        invalidateSessionListCache() {
            throw new Error('cache invalidation should not run on failed trash operation');
        },
        fs: {
            existsSync(targetPath) {
                if (targetPath === '/tmp/session-1.jsonl') {
                    return fileInSource;
                }
                if (targetPath === '/tmp/trash-1.jsonl') {
                    return fileInTrash;
                }
                return false;
            }
        },
        path: {
            basename() {
                return 'session-1';
            }
        }
    });

    const result = await trashSessionData({ source: 'claude', sessionId: 'session-1' });

    assert.deepStrictEqual(calls, [
        ['moveFileSync', '/tmp/session-1.jsonl', '/tmp/trash-1.jsonl'],
        ['removeClaudeSessionIndexEntry', '/tmp/sessions-index.json', '/tmp/session-1.jsonl', 'session-1'],
        ['moveFileSync', '/tmp/trash-1.jsonl', '/tmp/session-1.jsonl'],
        ['upsertClaudeSessionIndexEntry', '/tmp/sessions-index.json', '/tmp/session-1.jsonl', 'session-1']
    ]);
    assert.deepStrictEqual(result, { error: `移入回收站失败: ${persistError.message}` });
});

test('trashSessionData keeps the Claude index removed when rollback move fails', async () => {
    const trashSessionDataSource = extractFunctionBySignature(
        cliSource,
        'async function trashSessionData(params = {}) {',
        'trashSessionData'
    );
    let fileInSource = true;
    let fileInTrash = false;
    const calls = [];
    let upsertCalls = 0;
    const persistError = new Error('persist failed');
    const rollbackError = new Error('rollback failed');
    const trashSessionData = instantiateFunction(trashSessionDataSource, 'trashSessionData', {
        MAX_SESSION_TRASH_LIST_SIZE: 500,
        resolveSessionFilePath() {
            return '/tmp/session-1.jsonl';
        },
        getSessionFileArg() {
            return '';
        },
        parseClaudeSessionSummary() {
            return {
                sessionId: 'session-1',
                title: 'Claude session',
                messageCount: 7,
                capabilities: {},
                keywords: [],
                updatedAt: '2025-03-30T00:00:00.000Z',
                createdAt: '2025-03-29T00:00:00.000Z'
            };
        },
        parseCodexSessionSummary() {
            throw new Error('codex summary should not run for Claude entry');
        },
        buildSessionSummaryFallback() {
            throw new Error('fallback summary should not run for Claude entry');
        },
        async countConversationMessagesInFile() {
            return 7;
        },
        allocateSessionTrashTarget() {
            return {
                trashId: 'trash-1',
                trashFileName: 'trash-1.jsonl',
                trashFilePath: '/tmp/trash-1.jsonl'
            };
        },
        findClaudeSessionIndexPath() {
            return '/tmp/sessions-index.json';
        },
        moveFileSync(sourcePath, targetPath) {
            calls.push(['moveFileSync', sourcePath, targetPath]);
            if (sourcePath === '/tmp/session-1.jsonl' && targetPath === '/tmp/trash-1.jsonl') {
                fileInSource = false;
                fileInTrash = true;
                return;
            }
            if (sourcePath === '/tmp/trash-1.jsonl' && targetPath === '/tmp/session-1.jsonl') {
                throw rollbackError;
            }
        },
        removeClaudeSessionIndexEntry(indexPath, filePath, sessionId) {
            calls.push(['removeClaudeSessionIndexEntry', indexPath, filePath, sessionId]);
            return { entry: { sessionId } };
        },
        buildSessionTrashEntry(summary, options) {
            return {
                trashId: options.trashId,
                trashFileName: options.trashFileName,
                source: options.source,
                sessionId: options.sessionId,
                title: summary.title
            };
        },
        readSessionTrashEntries(options = {}) {
            assert.strictEqual(options.cleanup, false);
            return [];
        },
        writeSessionTrashEntries() {
            throw persistError;
        },
        upsertClaudeSessionIndexEntry() {
            upsertCalls += 1;
        },
        invalidateSessionListCache() {
            throw new Error('cache invalidation should not run on failed trash operation');
        },
        fs: {
            existsSync(targetPath) {
                if (targetPath === '/tmp/session-1.jsonl') {
                    return fileInSource;
                }
                if (targetPath === '/tmp/trash-1.jsonl') {
                    return fileInTrash;
                }
                return false;
            }
        },
        path: {
            basename() {
                return 'session-1';
            }
        }
    });

    const result = await trashSessionData({ source: 'claude', sessionId: 'session-1' });

    assert.deepStrictEqual(calls, [
        ['moveFileSync', '/tmp/session-1.jsonl', '/tmp/trash-1.jsonl'],
        ['removeClaudeSessionIndexEntry', '/tmp/sessions-index.json', '/tmp/session-1.jsonl', 'session-1'],
        ['moveFileSync', '/tmp/trash-1.jsonl', '/tmp/session-1.jsonl']
    ]);
    assert.strictEqual(upsertCalls, 0);
    assert.deepStrictEqual(result, { error: `移入回收站失败: ${persistError.message}` });
});

test('moveFileSync rolls back the copied target when cross-device unlink fails', () => {
    const moveFileSyncSource = extractFunctionBySignature(
        cliSource,
        'function moveFileSync(sourcePath, targetPath) {',
        'moveFileSync'
    );
    const calls = [];
    const unlinkError = new Error('source unlink failed');
    const moveFileSync = instantiateFunction(moveFileSyncSource, 'moveFileSync', {
        ensureDir(targetDir) {
            calls.push(['ensureDir', targetDir]);
        },
        path: {
            dirname() {
                return '/tmp/target-dir';
            }
        },
        fs: {
            renameSync() {
                const error = new Error('cross-device rename');
                error.code = 'EXDEV';
                throw error;
            },
            copyFileSync(sourcePath, targetPath) {
                calls.push(['copyFileSync', sourcePath, targetPath]);
            },
            unlinkSync(targetPath) {
                calls.push(['unlinkSync', targetPath]);
                if (targetPath === '/tmp/source.jsonl') {
                    throw unlinkError;
                }
            }
        }
    });

    assert.throws(
        () => moveFileSync('/tmp/source.jsonl', '/tmp/target.jsonl'),
        (error) => error === unlinkError
    );
    assert.deepStrictEqual(calls, [
        ['ensureDir', '/tmp/target-dir'],
        ['copyFileSync', '/tmp/source.jsonl', '/tmp/target.jsonl'],
        ['unlinkSync', '/tmp/source.jsonl'],
        ['unlinkSync', '/tmp/target.jsonl']
    ]);
});

test('purgeSessionTrashItems persists remaining entries before returning an unlink error', async () => {
    const purgeSessionTrashItemsSource = extractFunctionBySignature(
        cliSource,
        'async function purgeSessionTrashItems(params = {}) {',
        'purgeSessionTrashItems'
    );
    const entries = [
        { trashId: 'trash-1', source: 'codex', sessionId: 'session-1' },
        { trashId: 'trash-2', source: 'codex', sessionId: 'session-2' },
        { trashId: 'trash-3', source: 'claude', sessionId: 'session-3' }
    ];
    let writtenEntries = null;
    const purgeError = new Error('trash file busy');
    const purgeSessionTrashItems = instantiateFunction(purgeSessionTrashItemsSource, 'purgeSessionTrashItems', {
        readSessionTrashEntries() {
            return entries;
        },
        resolveSessionTrashFilePath(entry) {
            return `/tmp/${entry.trashId}.jsonl`;
        },
        writeSessionTrashEntries(nextEntries) {
            writtenEntries = nextEntries;
        },
        fs: {
            existsSync() {
                return true;
            },
            unlinkSync(targetPath) {
                if (targetPath === '/tmp/trash-2.jsonl') {
                    throw purgeError;
                }
            }
        }
    });

    const result = await purgeSessionTrashItems({ trashIds: ['trash-1', 'trash-2'] });

    assert.deepStrictEqual(writtenEntries, [entries[1], entries[2]]);
    assert.deepStrictEqual(result, { error: `彻底删除失败: ${purgeError.message}` });
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

test('readSessionDetail resolves file aliases through getSessionFileArg', async () => {
    const readSessionDetailSource = extractFunctionBySignature(
        cliSource,
        'async function readSessionDetail(params = {}) {',
        'readSessionDetail'
    );
    const getSessionFileArgSource = extractFunctionBySignature(
        cliSource,
        'function getSessionFileArg(params = {}) {',
        'getSessionFileArg'
    );
    const getSessionFileArg = Function(getSessionFileArgSource)();
    let resolvedArgs = null;
    const readSessionDetail = instantiateFunction(readSessionDetailSource, 'readSessionDetail', {
        resolveSessionFilePath(source, fileArg, sessionId) {
            resolvedArgs = { source, fileArg, sessionId };
            return '/tmp/detail.jsonl';
        },
        getSessionFileArg,
        async extractSessionDetailPreviewFromFile() {
            return {
                sessionId: 'detail-1',
                cwd: '/tmp/workspace',
                updatedAt: '2025-03-30T00:00:00.000Z',
                totalMessages: 1,
                messages: [{ role: 'user', text: 'hello' }]
            };
        },
        MAX_SESSION_DETAIL_MESSAGES: 200,
        DEFAULT_SESSION_DETAIL_MESSAGES: 80
    });

    const result = await readSessionDetail({ source: 'codex', file: ' /tmp/detail.jsonl ', sessionId: 'detail-1' });

    assert.deepStrictEqual(resolvedArgs, {
        source: 'codex',
        fileArg: '/tmp/detail.jsonl',
        sessionId: 'detail-1'
    });
    assert.strictEqual(result.filePath, '/tmp/detail.jsonl');
});

test('readSessionPlain resolves file aliases through getSessionFileArg', async () => {
    const readSessionPlainSource = extractFunctionBySignature(
        cliSource,
        'async function readSessionPlain(params = {}) {',
        'readSessionPlain'
    );
    const getSessionFileArgSource = extractFunctionBySignature(
        cliSource,
        'function getSessionFileArg(params = {}) {',
        'getSessionFileArg'
    );
    const getSessionFileArg = Function(getSessionFileArgSource)();
    let resolvedArgs = null;
    const readSessionPlain = instantiateFunction(readSessionPlainSource, 'readSessionPlain', {
        resolveSessionFilePath(source, fileArg, sessionId) {
            resolvedArgs = { source, fileArg, sessionId };
            return '/tmp/plain.jsonl';
        },
        getSessionFileArg,
        async extractMessagesFromFile() {
            return {
                sessionId: 'plain-1',
                messages: [{ role: 'assistant', content: 'plain text' }]
            };
        },
        readJsonlRecords() {
            throw new Error('fallback records should not run when extraction succeeds');
        },
        extractMessagesFromRecords() {
            throw new Error('fallback extraction should not run when extraction succeeds');
        },
        removeLeadingSystemMessage(messages) {
            return messages;
        },
        buildSessionPlainText(messages) {
            return `messages:${messages.length}`;
        }
    });

    const result = await readSessionPlain({ source: 'claude', file: ' /tmp/plain.jsonl ', sessionId: 'plain-1' });

    assert.deepStrictEqual(resolvedArgs, {
        source: 'claude',
        fileArg: '/tmp/plain.jsonl',
        sessionId: 'plain-1'
    });
    assert.strictEqual(result.filePath, '/tmp/plain.jsonl');
    assert.strictEqual(result.text, 'messages:1');
});

test('exportSessionData resolves file aliases through getSessionFileArg', async () => {
    const exportSessionDataSource = extractFunctionBySignature(
        cliSource,
        'async function exportSessionData(params = {}) {',
        'exportSessionData'
    );
    const getSessionFileArgSource = extractFunctionBySignature(
        cliSource,
        'function getSessionFileArg(params = {}) {',
        'getSessionFileArg'
    );
    const getSessionFileArg = Function(getSessionFileArgSource)();
    let resolvedArgs = null;
    const exportSessionData = instantiateFunction(exportSessionDataSource, 'exportSessionData', {
        resolveMaxMessagesValue() {
            return 12;
        },
        MAX_EXPORT_MESSAGES: 200,
        resolveSessionFilePath(source, fileArg, sessionId) {
            resolvedArgs = { source, fileArg, sessionId };
            return '/tmp/export.jsonl';
        },
        getSessionFileArg,
        async extractMessagesFromFile() {
            return {
                sessionId: 'export-1',
                updatedAt: '2025-03-30T00:00:00.000Z',
                cwd: '/tmp/workspace',
                messages: [{ role: 'assistant', content: 'markdown' }],
                truncated: false
            };
        },
        readJsonlRecords() {
            throw new Error('fallback records should not run when extraction succeeds');
        },
        extractMessagesFromRecords() {
            throw new Error('fallback extraction should not run when extraction succeeds');
        },
        removeLeadingSystemMessage(messages) {
            return messages;
        },
        fs: {
            existsSync() {
                return true;
            },
            statSync() {
                return { size: 1 };
            }
        },
        path: {
            basename() {
                return 'export-1';
            }
        },
        buildSessionMarkdown({ sourceLabel, sessionId, filePath, messages }) {
            return `${sourceLabel}:${sessionId}:${filePath}:${messages.length}`;
        }
    });

    const result = await exportSessionData({ source: 'codex', file: ' /tmp/export.jsonl ', sessionId: 'export-1', maxMessages: '12' });

    assert.deepStrictEqual(resolvedArgs, {
        source: 'codex',
        fileArg: '/tmp/export.jsonl',
        sessionId: 'export-1'
    });
    assert.strictEqual(result.content, 'Codex:export-1:/tmp/export.jsonl:1');
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
        sessionTrashCountRequestToken: 0,
        sessionTrashListRequestToken: 0,
        isDeleteAvailable: () => true,
        getSessionExportKey(session) {
            return `${session.source}:${session.sessionId}:${session.filePath}`;
        },
        invalidateSessionTrashRequests() {
            this.sessionTrashCountRequestToken += 1;
            this.sessionTrashListRequestToken += 1;
            return this.sessionTrashListRequestToken;
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
        removeSessionPinCalls: [],
        removeSessionPin(session) {
            this.removeSessionPinCalls.push(session);
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
    assert.strictEqual(context.sessionDeleting['codex:session-1:/tmp/session-1.jsonl'], false);
    assert.strictEqual(removed, true);
    assert.deepStrictEqual(context.removeSessionPinCalls, [{
        source: 'codex',
        sessionId: 'session-1',
        filePath: '/tmp/session-1.jsonl'
    }]);
    assert.strictEqual(requestedAction, 'trash-session');
    assert.deepStrictEqual(messages, [{ message: '已移入回收站', tone: 'success' }]);
});

test('deleteSession prefers authoritative trash totalCount from the backend response', async () => {
    const deleteSessionSource = extractMethodAsFunction(appSource, 'deleteSession');
    const deleteSession = instantiateFunction(deleteSessionSource, 'deleteSession', {
        api: async () => ({
            trashId: 'trash-1',
            deletedAt: '2025-03-30T00:00:00.000Z',
            messageCount: 2,
            totalCount: 500
        })
    });

    const context = {
        sessionDeleting: {},
        sessionTrashLoadedOnce: false,
        sessionTrashCountLoadedOnce: true,
        sessionTrashTotalCount: 5,
        sessionTrashItems: [],
        sessionTrashCountRequestToken: 0,
        sessionTrashListRequestToken: 0,
        isDeleteAvailable: () => true,
        getSessionExportKey(session) {
            return `${session.source}:${session.sessionId}:${session.filePath}`;
        },
        invalidateSessionTrashRequests() {
            this.sessionTrashCountRequestToken += 1;
            this.sessionTrashListRequestToken += 1;
            return this.sessionTrashListRequestToken;
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
            throw new Error('loaded-list branch should not run in count-only test');
        },
        buildSessionTrashItemFromSession() {
            throw new Error('loaded-list branch should not run in count-only test');
        },
        removeSessionPinCalls: [],
        removeSessionPin(session) {
            this.removeSessionPinCalls.push(session);
        },
        async removeSessionFromCurrentList() {},
        showMessage() {}
    };

    await deleteSession.call(context, {
        source: 'codex',
        sessionId: 'session-1',
        filePath: '/tmp/session-1.jsonl'
    });

    assert.strictEqual(context.sessionTrashTotalCount, 500);
    assert.deepStrictEqual(context.removeSessionPinCalls, [{
        source: 'codex',
        sessionId: 'session-1',
        filePath: '/tmp/session-1.jsonl'
    }]);
});

test('deleteSession keeps success message when list cleanup fails after trash succeeds', async () => {
    const deleteSessionSource = extractMethodAsFunction(appSource, 'deleteSession');
    const deleteSession = instantiateFunction(deleteSessionSource, 'deleteSession', {
        api: async () => ({
            trashId: 'trash-1',
            deletedAt: '2025-03-30T00:00:00.000Z',
            messageCount: 2
        })
    });

    const messages = [];
    const context = {
        sessionDeleting: {},
        sessionTrashLoadedOnce: false,
        sessionTrashCountLoadedOnce: true,
        sessionTrashTotalCount: 5,
        sessionTrashItems: [],
        sessionTrashCountRequestToken: 0,
        sessionTrashListRequestToken: 0,
        removeSessionPinCalls: [],
        isDeleteAvailable: () => true,
        getSessionExportKey(session) {
            return `${session.source}:${session.sessionId}:${session.filePath}`;
        },
        invalidateSessionTrashRequests() {
            this.sessionTrashCountRequestToken += 1;
            this.sessionTrashListRequestToken += 1;
            return this.sessionTrashListRequestToken;
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
        removeSessionPin(session) {
            this.removeSessionPinCalls.push(session);
        },
        async removeSessionFromCurrentList() {
            throw new Error('selection refresh failed');
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
    assert.strictEqual(context.sessionDeleting['codex:session-1:/tmp/session-1.jsonl'], false);
    assert.deepStrictEqual(context.removeSessionPinCalls, [{
        source: 'codex',
        sessionId: 'session-1',
        filePath: '/tmp/session-1.jsonl'
    }]);
    assert.deepStrictEqual(messages, [{ message: '已移入回收站', tone: 'success' }]);
});

test('deleteSession permanently deletes when session trash is disabled', async () => {
    let requestedAction = '';
    let confirmCalls = 0;
    const deleteSessionSource = extractMethodAsFunction(appSource, 'deleteSession');
    const deleteSession = instantiateFunction(deleteSessionSource, 'deleteSession', {
        api: async (action) => {
            requestedAction = action;
            return {
                success: true,
                deleted: true,
                sessionId: 'session-1'
            };
        }
    });

    const messages = [];
    const context = {
        sessionDeleting: {},
        sessionTrashEnabled: false,
        sessionTrashLoadedOnce: false,
        sessionTrashCountLoadedOnce: true,
        sessionTrashTotalCount: 5,
        sessionTrashItems: [],
        sessionTrashCountRequestToken: 0,
        sessionTrashListRequestToken: 0,
        removeSessionPinCalls: [],
        invalidateUsageCalls: [],
        isDeleteAvailable: () => true,
        requestConfirmDialog: async () => {
            confirmCalls += 1;
            return true;
        },
        getSessionExportKey(session) {
            return `${session.source}:${session.sessionId}:${session.filePath}`;
        },
        invalidateSessionTrashRequests() {
            throw new Error('hard delete should not invalidate trash requests');
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
            throw new Error('hard delete should not prepend trash items');
        },
        buildSessionTrashItemFromSession() {
            throw new Error('hard delete should not build trash items');
        },
        removeSessionPin(session) {
            this.removeSessionPinCalls.push(session);
        },
        invalidateSessionsUsageData(payload) {
            this.invalidateUsageCalls.push(payload);
        },
        async removeSessionFromCurrentList() {
            this.removed = true;
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

    assert.strictEqual(confirmCalls, 1);
    assert.strictEqual(requestedAction, 'delete-session');
    assert.strictEqual(context.sessionTrashTotalCount, 5);
    assert.strictEqual(context.sessionDeleting['codex:session-1:/tmp/session-1.jsonl'], false);
    assert.strictEqual(context.removed, true);
    assert.deepStrictEqual(context.removeSessionPinCalls, [{
        source: 'codex',
        sessionId: 'session-1',
        filePath: '/tmp/session-1.jsonl'
    }]);
    assert.deepStrictEqual(context.invalidateUsageCalls, [{ preserveList: true }]);
    assert.deepStrictEqual(messages, [{ message: '已删除', tone: 'success' }]);
});

test('cloneSession keeps success message when refresh fails after clone succeeds', async () => {
    const cloneSessionSource = extractMethodAsFunction(appSource, 'cloneSession');
    const cloneSession = instantiateFunction(cloneSessionSource, 'cloneSession', {
        api: async () => ({
            sessionId: 'clone-1'
        })
    });

    const messages = [];
    const context = {
        sessionCloning: {},
        sessionsList: [],
        isCloneAvailable: () => true,
        getSessionExportKey(session) {
            return `${session.source}:${session.sessionId}:${session.filePath}`;
        },
        async loadSessions() {
            throw new Error('refresh failed');
        },
        async selectSession() {
            throw new Error('select should not run when refresh fails');
        },
        showMessage(message, tone) {
            messages.push({ message, tone });
        }
    };

    await cloneSession.call(context, {
        source: 'codex',
        sessionId: 'session-1',
        filePath: '/tmp/session-1.jsonl'
    });

    assert.strictEqual(context.sessionCloning['codex:session-1:/tmp/session-1.jsonl'], false);
    assert.deepStrictEqual(messages, [{ message: '已生成派生会话', tone: 'success' }]);
});

test('cloneSession keeps success message when selecting the cloned session fails', async () => {
    const cloneSessionSource = extractMethodAsFunction(appSource, 'cloneSession');
    const cloneSession = instantiateFunction(cloneSessionSource, 'cloneSession', {
        api: async () => ({
            sessionId: 'clone-1'
        })
    });

    const messages = [];
    const context = {
        sessionCloning: {},
        sessionsList: [],
        isCloneAvailable: () => true,
        getSessionExportKey(session) {
            return `${session.source}:${session.sessionId}:${session.filePath}`;
        },
        async loadSessions() {
            this.sessionsList = [{
                source: 'codex',
                sessionId: 'clone-1',
                filePath: '/tmp/clone-1.jsonl'
            }];
        },
        async selectSession() {
            throw new Error('selection failed');
        },
        showMessage(message, tone) {
            messages.push({ message, tone });
        }
    };

    await cloneSession.call(context, {
        source: 'codex',
        sessionId: 'session-1',
        filePath: '/tmp/session-1.jsonl'
    });

    assert.strictEqual(context.sessionCloning['codex:session-1:/tmp/session-1.jsonl'], false);
    assert.deepStrictEqual(messages, [{ message: '已生成派生会话', tone: 'success' }]);
});

test('prependSessionTrashItem prefers authoritative trash totalCount when provided', () => {
    const prependSessionTrashItemSource = extractMethodAsFunction(appSource, 'prependSessionTrashItem');
    const prependSessionTrashItem = instantiateFunction(prependSessionTrashItemSource, 'prependSessionTrashItem', {
        sessionTrashListLimit: 500,
        sessionTrashPageSize: 200
    });

    const context = {
        sessionTrashItems: [{
            trashId: 'trash-older'
        }],
        sessionTrashTotalCount: 499,
        normalizeSessionTrashTotalCount(totalCount, fallbackItems = this.sessionTrashItems) {
            const fallbackCount = Array.isArray(fallbackItems) ? fallbackItems.length : 0;
            const numericTotal = Number(totalCount);
            if (!Number.isFinite(numericTotal) || numericTotal < 0) {
                return fallbackCount;
            }
            return Math.max(fallbackCount, Math.floor(numericTotal));
        },
        getSessionTrashActionKey(item) {
            return item && item.trashId;
        }
    };

    prependSessionTrashItem.call(context, { trashId: 'trash-new' }, { totalCount: 500 });

    assert.deepStrictEqual(context.sessionTrashItems.map((item) => item.trashId), ['trash-new', 'trash-older']);
    assert.strictEqual(context.sessionTrashTotalCount, 500);
});

test('pruneSessionPinnedMap removes stale pinned session keys after an unfiltered full session load', () => {
    const pruneSessionPinnedMap = instantiateFunction(
        extractMethodAsFunction(appSource, 'pruneSessionPinnedMap'),
        'pruneSessionPinnedMap',
        { isSessionQueryEnabled: () => true }
    );

    let persisted = 0;
    const context = {
        sessionPinnedMap: {
            'codex:keep': 111,
            'codex:stale': 222
        },
        sessionsList: [
            { key: 'codex:keep' }
        ],
        sessionFilterSource: 'all',
        sessionPathFilter: '',
        sessionQuery: '',
        sessionRoleFilter: 'all',
        sessionTimePreset: 'all',
        getSessionExportKey(session) {
            return session && session.key;
        },
        persistSessionPinnedMap() {
            persisted += 1;
        },
        shouldPruneSessionPinnedMap: instantiateFunction(
            extractMethodAsFunction(appSource, 'shouldPruneSessionPinnedMap'),
            'shouldPruneSessionPinnedMap',
            { isSessionQueryEnabled: () => true }
        )
    };

    pruneSessionPinnedMap.call(context);

    assert.deepStrictEqual(context.sessionPinnedMap, { 'codex:keep': 111 });
    assert.strictEqual(persisted, 1);
});

test('pruneSessionPinnedMap skips pruning when the visible session list is filtered', () => {
    const pruneSessionPinnedMap = instantiateFunction(
        extractMethodAsFunction(appSource, 'pruneSessionPinnedMap'),
        'pruneSessionPinnedMap',
        { isSessionQueryEnabled: () => true }
    );

    let persisted = 0;
    const context = {
        sessionPinnedMap: {
            'codex:keep': 111,
            'codex:hidden': 222
        },
        sessionsList: [
            { key: 'codex:keep' }
        ],
        sessionFilterSource: 'codex',
        sessionPathFilter: '',
        sessionQuery: '',
        sessionRoleFilter: 'all',
        sessionTimePreset: 'all',
        getSessionExportKey(session) {
            return session && session.key;
        },
        persistSessionPinnedMap() {
            persisted += 1;
        },
        shouldPruneSessionPinnedMap: instantiateFunction(
            extractMethodAsFunction(appSource, 'shouldPruneSessionPinnedMap'),
            'shouldPruneSessionPinnedMap',
            { isSessionQueryEnabled: () => true }
        )
    };

    pruneSessionPinnedMap.call(context);

    assert.deepStrictEqual(context.sessionPinnedMap, {
        'codex:keep': 111,
        'codex:hidden': 222
    });
    assert.strictEqual(persisted, 0);
});

test('restoreSessionPinnedMap normalizes cache without pruning stale entries before sessions load', () => {
    const restoreSessionPinnedMap = instantiateFunction(
        extractMethodAsFunction(appSource, 'restoreSessionPinnedMap'),
        'restoreSessionPinnedMap',
        {
            localStorage: {
                getItem(key) {
                    assert.strictEqual(key, 'codexmateSessionPinnedMap');
                    return JSON.stringify({
                        'codex:keep': 123,
                        'codex:stale': 456,
                        'codex:bad': -1
                    });
                },
                removeItem() {
                    throw new Error('removeItem should not be called for valid cached JSON');
                }
            }
        }
    );

    const context = {
        sessionPinnedMap: {},
        sessionsList: [{ key: 'codex:keep' }],
        normalizeSessionPinnedMap(raw) {
            const next = {};
            for (const [key, value] of Object.entries(raw || {})) {
                const numeric = Number(value);
                if (key && Number.isFinite(numeric) && numeric > 0) {
                    next[key] = Math.floor(numeric);
                }
            }
            return next;
        },
        getSessionExportKey(session) {
            return session && session.key;
        },
        persistSessionPinnedMap() {
            this.persistedSnapshot = { ...this.sessionPinnedMap };
        }
    };

    restoreSessionPinnedMap.call(context);

    assert.deepStrictEqual(context.sessionPinnedMap, {
        'codex:keep': 123,
        'codex:stale': 456
    });
    assert.strictEqual(context.persistedSnapshot, undefined);
});

test('loadSessionTrash replays the latest queued refresh after an in-flight request is invalidated', async () => {
    const loadSessionTrashSource = extractMethodAsFunction(appSource, 'loadSessionTrash');
    const pendingResponses = [];
    const apiCalls = [];
    const loadSessionTrash = instantiateFunction(loadSessionTrashSource, 'loadSessionTrash', {
        sessionTrashListLimit: 500,
        api: async (action, params) => await new Promise((resolve) => {
            apiCalls.push({ action, params });
            pendingResponses.push(resolve);
        })
    });

    const context = {
        sessionTrashItems: [],
        sessionTrashTotalCount: 0,
        sessionTrashCountLoadedOnce: false,
        sessionTrashLoadedOnce: false,
        sessionTrashLastLoadFailed: false,
        sessionTrashCountRequestToken: 0,
        sessionTrashListRequestToken: 0,
        sessionTrashLoading: false,
        sessionTrashPendingOptions: null,
        issueSessionTrashListRequestToken() {
            this.sessionTrashListRequestToken += 1;
            return this.sessionTrashListRequestToken;
        },
        invalidateSessionTrashRequests() {
            this.sessionTrashCountRequestToken += 1;
            this.sessionTrashListRequestToken += 1;
            return this.sessionTrashListRequestToken;
        },
        isLatestSessionTrashListRequestToken(requestToken) {
            return requestToken === this.sessionTrashListRequestToken;
        },
        normalizeSessionTrashTotalCount(totalCount, fallbackItems = this.sessionTrashItems) {
            const fallbackCount = Array.isArray(fallbackItems) ? fallbackItems.length : 0;
            const numericTotal = Number(totalCount);
            if (!Number.isFinite(numericTotal) || numericTotal < 0) {
                return fallbackCount;
            }
            return Math.max(fallbackCount, Math.floor(numericTotal));
        },
        resetSessionTrashVisibleCount() {
            this.sessionTrashVisibleCount = 200;
        },
        showMessage() {
            throw new Error('queued refresh should not surface a stale toast');
        }
    };
    context.loadSessionTrash = loadSessionTrash;

    const firstLoad = loadSessionTrash.call(context, { forceRefresh: false });
    context.invalidateSessionTrashRequests();
    await loadSessionTrash.call(context, { forceRefresh: true });

    pendingResponses[0]({
        totalCount: 1,
        items: [{ trashId: 'stale-trash' }]
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(apiCalls.length, 2);
    assert.deepStrictEqual(apiCalls[1], {
        action: 'list-session-trash',
        params: { limit: 500, forceRefresh: true }
    });

    pendingResponses[1]({
        totalCount: 2,
        items: [{ trashId: 'fresh-trash' }]
    });
    await firstLoad;

    assert.strictEqual(context.sessionTrashLoadedOnce, true);
    assert.strictEqual(context.sessionTrashCountLoadedOnce, true);
    assert.strictEqual(context.sessionTrashTotalCount, 2);
    assert.deepStrictEqual(context.sessionTrashItems, [{ trashId: 'fresh-trash' }]);
});

test('session trash restore and purge share the same per-item busy guard', async () => {
    const apiCalls = [];
    const restoreSessionTrash = instantiateFunction(
        extractMethodAsFunction(appSource, 'restoreSessionTrash'),
        'restoreSessionTrash',
        {
            api: async (action) => {
                apiCalls.push(action);
                return { success: true };
            }
        }
    );
    const purgeSessionTrash = instantiateFunction(
        extractMethodAsFunction(appSource, 'purgeSessionTrash'),
        'purgeSessionTrash',
        {
            api: async (action) => {
                apiCalls.push(action);
                return { success: true };
            }
        }
    );

    let confirmCalls = 0;
    const context = {
        sessionTrashClearing: false,
        sessionTrashLoading: false,
        sessionTrashRestoring: { 'trash-1': true },
        sessionTrashPurging: {},
        getSessionTrashActionKey(item) {
            return item && item.trashId;
        },
        isSessionTrashActionBusy(item) {
            const key = typeof item === 'string' ? item : this.getSessionTrashActionKey(item);
            return !!(key && (this.sessionTrashRestoring[key] || this.sessionTrashPurging[key]));
        },
        async requestConfirmDialog() {
            confirmCalls += 1;
            return true;
        },
        showMessage() {
            throw new Error('busy-guard short-circuit should not toast');
        },
        async loadSessionTrash() {
            throw new Error('busy-guard short-circuit should not reload');
        },
        sessionsLoadedOnce: false
    };

    await restoreSessionTrash.call(context, { trashId: 'trash-1' });
    await purgeSessionTrash.call(context, { trashId: 'trash-1' });

    assert.deepStrictEqual(apiCalls, []);
    assert.strictEqual(confirmCalls, 0);
});
