import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { withGlobalOverrides } = await import(
    pathToFileURL(path.join(__dirname, 'helpers', 'web-ui-app-options.mjs'))
);
const { createNavigationMethods } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.navigation.mjs'))
);
const { createRuntimeMethods } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.runtime.mjs'))
);

function createTimerHarness() {
    let nextId = 1;
    const timeouts = new Map();
    const intervals = new Map();

    return {
        setTimeout(callback, delay) {
            const id = nextId++;
            timeouts.set(id, { callback, delay });
            return id;
        },
        clearTimeout(id) {
            timeouts.delete(id);
        },
        setInterval(callback, delay) {
            const id = nextId++;
            intervals.set(id, { callback, delay });
            return id;
        },
        clearInterval(id) {
            intervals.delete(id);
        },
        getTimeoutIds() {
            return [...timeouts.keys()];
        },
        hasTimeout(id) {
            return timeouts.has(id);
        },
        runTimeout(id) {
            const entry = timeouts.get(id);
            if (!entry) {
                throw new Error(`Timeout ${id} not found`);
            }
            timeouts.delete(id);
            entry.callback();
        }
    };
}

function createNavigationContext(methods, overrides = {}) {
    return {
        ...methods,
        mainTab: 'sessions',
        configMode: 'codex',
        fastHidden: false,
        setSessionPanelFastHidden(hidden) {
            this.fastHidden = !!hidden;
        },
        ...overrides
    };
}

function createDownloadDocument() {
    return {
        body: {
            appendChild() {},
            removeChild() {}
        },
        createElement() {
            return {
                href: '',
                download: '',
                click() {}
            };
        }
    };
}

async function verifyDownloadProgressResetCleanup({
    methodName,
    action,
    progressKey,
    loadingKey,
    intervalKey,
    resetKey,
    fileName
}) {
    const timers = createTimerHarness();
    const apiCalls = [];
    const methods = createRuntimeMethods({
        api: async (actionName) => {
            apiCalls.push(actionName);
            return {
                success: true,
                fileName
            };
        }
    });
    const context = {
        ...methods,
        [loadingKey]: false,
        [progressKey]: 0,
        [intervalKey]: null,
        showMessage() {}
    };

    await withGlobalOverrides({
        document: createDownloadDocument(),
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval
    }, async () => {
        await context[methodName]();
        const [firstResetId] = timers.getTimeoutIds();
        assert.ok(firstResetId, `${methodName} should schedule a delayed reset`);
        assert.strictEqual(context[progressKey], 100);
        assert.strictEqual(context[intervalKey], null);
        assert.strictEqual(context[resetKey], firstResetId);

        await context[methodName]();
        assert.strictEqual(timers.hasTimeout(firstResetId), false, `${methodName} should clear the previous reset timer`);

        const [secondResetId] = timers.getTimeoutIds();
        assert.ok(secondResetId && secondResetId !== firstResetId, `${methodName} should schedule a fresh reset timer`);
        assert.strictEqual(context[resetKey], secondResetId);

        timers.runTimeout(secondResetId);
        assert.strictEqual(context[progressKey], 0);
        assert.strictEqual(context[resetKey], null);
    });

    assert.deepStrictEqual(apiCalls, [action, action]);
}

test('touch main-tab preselection clears stale nav intent when click never lands', async () => {
    const timers = createTimerHarness();
    const methods = createNavigationMethods({
        configModeSet: new Set(['codex', 'claude', 'openclaw']),
        switchMainTabHelper(tab) {
            this.mainTab = tab;
        },
        loadMoreSessionMessagesHelper() {}
    });
    const context = createNavigationContext(methods);

    await withGlobalOverrides({
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout
    }, async () => {
        context.onMainTabPointerDown('market', {
            button: 0,
            pointerType: 'touch'
        });
    });

    const state = context.ensureMainTabSwitchState();
    const [resetTimerId] = timers.getTimeoutIds();
    assert.strictEqual(state.intent, 'market');
    assert.strictEqual(context.fastHidden, true);
    assert.ok(resetTimerId);

    timers.runTimeout(resetTimerId);

    assert.strictEqual(state.intent, '');
    assert.strictEqual(context.fastHidden, false);
});

test('newer touch nav preselection replaces the previous stale reset timer', async () => {
    const timers = createTimerHarness();
    const methods = createNavigationMethods({
        configModeSet: new Set(['codex', 'claude', 'openclaw']),
        switchMainTabHelper(tab) {
            this.mainTab = tab;
        },
        loadMoreSessionMessagesHelper() {}
    });
    const context = createNavigationContext(methods);

    await withGlobalOverrides({
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout
    }, async () => {
        context.onConfigTabPointerDown('codex', {
            button: 0,
            pointerType: 'touch'
        });
        const [firstResetId] = timers.getTimeoutIds();
        assert.ok(firstResetId);

        context.onConfigTabPointerDown('claude', {
            button: 0,
            pointerType: 'touch'
        });

        assert.strictEqual(timers.hasTimeout(firstResetId), false);
        const [secondResetId] = timers.getTimeoutIds();
        assert.ok(secondResetId && secondResetId !== firstResetId);
        assert.strictEqual(context.ensureMainTabSwitchState().intent, 'config');

        timers.runTimeout(secondResetId);
    });

    assert.strictEqual(context.ensureMainTabSwitchState().intent, '');
    assert.strictEqual(context.fastHidden, false);
});

test('touch config-tab preselection updates the active item before the committed switch lands', async () => {
    const timers = createTimerHarness();
    const methods = createNavigationMethods({
        configModeSet: new Set(['codex', 'claude', 'openclaw']),
        switchMainTabHelper(tab) {
            this.mainTab = tab;
        },
        loadMoreSessionMessagesHelper() {}
    });
    const context = createNavigationContext(methods);

    await withGlobalOverrides({
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout
    }, async () => {
        context.onConfigTabPointerDown('claude', {
            button: 0,
            pointerType: 'touch'
        });
    });

    assert.strictEqual(context.isMainTabNavActive('config'), true);
    assert.strictEqual(context.isConfigModeNavActive('claude'), true);
    assert.strictEqual(context.isConfigModeNavActive('codex'), false);
});

test('onMainTabClick keeps navigation responsive while the sessions tab is still loading', async () => {
    let resolveSessionsLoad = null;
    const methods = createNavigationMethods({
        configModeSet: new Set(['codex', 'claude', 'openclaw']),
        switchMainTabHelper(tab) {
            this._switchCalls = (this._switchCalls || []);
            this._switchCalls.push(tab);
            this.mainTab = tab;
            if (tab !== 'sessions') {
                return undefined;
            }
            this.sessionsLoading = true;
            this._sessionsLoadPromise = new Promise((resolve) => {
                resolveSessionsLoad = () => {
                    this.sessionsLoading = false;
                    this.sessionsLoadedOnce = true;
                    resolve();
                };
            });
            return this._sessionsLoadPromise;
        },
        loadMoreSessionMessagesHelper() {}
    });
    const context = createNavigationContext(methods, {
        mainTab: 'config',
        sessionsLoading: false,
        sessionsLoadedOnce: false,
        sessionListRenderEnabled: false,
        sessionPreviewRenderEnabled: false,
        scheduleAfterFrame(callback) {
            callback();
        },
        cancelScheduledSessionTabDeferredTeardown() {}
    });

    context.onMainTabClick('sessions');

    assert.strictEqual(context.mainTab, 'sessions');
    assert.strictEqual(context.sessionsLoading, true);

    context.onMainTabClick('usage');
    assert.strictEqual(context.mainTab, 'usage');

    resolveSessionsLoad();
    await context._sessionsLoadPromise;

    assert.strictEqual(context.sessionsLoading, false);
    assert.strictEqual(context.sessionsLoadedOnce, true);
    assert.deepStrictEqual(context._switchCalls, ['sessions', 'usage']);
});

test('primeSessionListRender limits initial session list work to the configured batch size', () => {
    const methods = createNavigationMethods({
        configModeSet: new Set(['codex', 'claude', 'openclaw']),
        switchMainTabHelper(tab) {
            this.mainTab = tab;
        },
        loadMoreSessionMessagesHelper() {}
    });
    const context = createNavigationContext(methods, {
        mainTab: 'sessions',
        sessionListRenderEnabled: true,
        sessionListVisibleCount: 999,
        sessionListInitialBatchSize: 120,
        sortedSessionsList: Array.from({ length: 1000 }, (_, index) => ({ sessionId: `s${index}` })),
        cancelScheduledSessionListViewportFill() {},
        scheduleSessionListViewportFill() {
            this._viewportFillScheduled = (this._viewportFillScheduled || 0) + 1;
        },
        $nextTick(callback) {
            callback();
        }
    });

    context.primeSessionListRender();

    assert.strictEqual(context.sessionListVisibleCount, 120);
    assert.strictEqual(context._viewportFillScheduled, 1);
});

test('onSessionListScroll grows the rendered session batch near the list bottom', () => {
    const methods = createNavigationMethods({
        configModeSet: new Set(['codex', 'claude', 'openclaw']),
        switchMainTabHelper(tab) {
            this.mainTab = tab;
        },
        loadMoreSessionMessagesHelper() {}
    });
    const context = createNavigationContext(methods, {
        mainTab: 'sessions',
        sessionListRenderEnabled: true,
        sessionListVisibleCount: 120,
        sessionListLoadStep: 160,
        sessionListRemainingCount: 880,
        sessionListEl: {
            scrollHeight: 2000,
            scrollTop: 1700,
            clientHeight: 120
        },
        expandVisibleSessionList() {
            this.sessionListVisibleCount += 160;
        },
        scheduleSessionListViewportFill() {
            this._viewportFillScheduled = (this._viewportFillScheduled || 0) + 1;
        }
    });

    context.onSessionListScroll();

    assert.strictEqual(context.sessionListVisibleCount, 280);
    assert.strictEqual(context._viewportFillScheduled, 1);
});

test('onSessionListScroll requests more session data after the rendered list is exhausted', async () => {
    const methods = createNavigationMethods({
        configModeSet: new Set(['codex', 'claude', 'openclaw']),
        switchMainTabHelper(tab) {
            this.mainTab = tab;
        },
        loadMoreSessionMessagesHelper() {}
    });
    const context = createNavigationContext(methods, {
        mainTab: 'sessions',
        sessionListRenderEnabled: true,
        sessionListVisibleCount: 50,
        sessionListRemainingCount: 0,
        sessionListHasMoreData: true,
        sessionsLoading: false,
        sessionListLoadingMore: false,
        sessionListEl: {
            scrollHeight: 1200,
            scrollTop: 920,
            clientHeight: 120
        },
        async loadMoreSessions() {
            this._loadMoreSessionsCalls = (this._loadMoreSessionsCalls || 0) + 1;
        }
    });

    context.onSessionListScroll();
    await Promise.resolve();

    assert.strictEqual(context._loadMoreSessionsCalls, 1);
});

test('download directory actions clear stale delayed progress resets before scheduling a new one', async () => {
    await verifyDownloadProgressResetCleanup({
        methodName: 'downloadClaudeDirectory',
        action: 'download-claude-dir',
        progressKey: 'claudeDownloadProgress',
        loadingKey: 'claudeDownloadLoading',
        intervalKey: 'claudeDownloadTimer',
        resetKey: '__claudeDownloadResetTimer',
        fileName: 'claude-backup.zip'
    });

    await verifyDownloadProgressResetCleanup({
        methodName: 'downloadCodexDirectory',
        action: 'download-codex-dir',
        progressKey: 'codexDownloadProgress',
        loadingKey: 'codexDownloadLoading',
        intervalKey: 'codexDownloadTimer',
        resetKey: '__codexDownloadResetTimer',
        fileName: 'codex-backup.zip'
    });
});

test('importBackupFile keeps a successful import result when only the refresh fails', async () => {
    const methods = createRuntimeMethods({
        api: async () => ({
            success: true,
            backupPath: '/tmp/codex-backup.toml'
        })
    });
    const messages = [];
    const resets = [];
    const context = {
        ...methods,
        codexImportLoading: false,
        showMessage(message, type) {
            messages.push({ message, type });
        },
        async readFileAsBase64() {
            return 'ZmFrZS1iYXNlNjQ=';
        },
        async loadAll() {
            throw new Error('refresh failed');
        },
        resetImportInput(type) {
            resets.push(type);
        }
    };

    await methods.importBackupFile.call(context, 'codex', {
        size: 1024,
        name: 'codex.zip'
    });

    assert.strictEqual(context.codexImportLoading, false);
    assert.deepStrictEqual(resets, ['codex']);
    assert.deepStrictEqual(messages, [{
        message: '导入成功，原配置已备份到临时文件：/tmp/codex-backup.toml',
        type: 'success'
    }, {
        message: '导入已完成，但界面刷新失败，请手动刷新',
        type: 'error'
    }]);
});
