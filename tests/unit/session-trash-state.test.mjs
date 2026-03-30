import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appPath = path.join(__dirname, '..', '..', 'web-ui', 'app.js');
const cliPath = path.join(__dirname, '..', '..', 'cli.js');
const indexHtmlPath = path.join(__dirname, '..', '..', 'web-ui', 'index.html');
const appSource = fs.readFileSync(appPath, 'utf-8');
const cliSource = fs.readFileSync(cliPath, 'utf-8');
const indexHtmlSource = fs.readFileSync(indexHtmlPath, 'utf-8');

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
        sessionTrashRequestToken: 0,
        sessionTrashTotalCount: 10,
        sessionTrashCountLoadedOnce: false,
        sessionTrashItems: [
            { trashId: 'trash-1' },
            { trashId: 'trash-2' }
        ],
        issueSessionTrashRequestToken() {
            this.sessionTrashRequestToken += 1;
            return this.sessionTrashRequestToken;
        },
        isLatestSessionTrashRequestToken(token) {
            return Number(token) === Number(this.sessionTrashRequestToken);
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

test('session trash template keeps source badges on neutral session-source styling', () => {
    const trashPanelMatch = indexHtmlSource.match(/id="settings-panel-trash"[\s\S]*?<\/section>/);
    assert(trashPanelMatch, 'trash panel template should exist');

    const trashPanel = trashPanelMatch[0];
    assert.match(trashPanel, /<span class="session-source">{{ item\.sourceLabel }}<\/span>/);
    assert.doesNotMatch(trashPanel, /item\.source === 'claude' \? 'configured' : 'empty'/);
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
            throw new Error('loaded-list branch should not run in count-only test');
        },
        buildSessionTrashItemFromSession() {
            throw new Error('loaded-list branch should not run in count-only test');
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
});

test('prependSessionTrashItem prefers authoritative trash totalCount when provided', () => {
    const prependSessionTrashItemSource = extractMethodAsFunction(appSource, 'prependSessionTrashItem');
    const prependSessionTrashItem = instantiateFunction(prependSessionTrashItemSource, 'prependSessionTrashItem', {
        SESSION_TRASH_LIST_LIMIT: 500
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

test('loadSessionTrash replays the latest queued refresh after an in-flight request is invalidated', async () => {
    const loadSessionTrashSource = extractMethodAsFunction(appSource, 'loadSessionTrash');
    const pendingResponses = [];
    const apiCalls = [];
    const loadSessionTrash = instantiateFunction(loadSessionTrashSource, 'loadSessionTrash', {
        SESSION_TRASH_LIST_LIMIT: 500,
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
        sessionTrashRequestToken: 0,
        sessionTrashLoading: false,
        sessionTrashPendingOptions: null,
        issueSessionTrashRequestToken() {
            this.sessionTrashRequestToken += 1;
            return this.sessionTrashRequestToken;
        },
        invalidateSessionTrashRequests() {
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
