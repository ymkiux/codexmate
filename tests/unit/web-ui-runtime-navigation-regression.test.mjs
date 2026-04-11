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

test('switchMainTab suspends session render immediately while deferring a leave from sessions', () => {
    const scheduled = [];
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
        sessionPreviewRenderEnabled: true,
        sessionTabRenderTicket: 7,
        sessionTimelineActiveKey: 'node-1',
        sessionTimelineLastSyncAt: 1,
        sessionTimelineLastScrollTop: 2,
        sessionTimelineLastAnchorY: 3,
        sessionTimelineLastDirection: 4,
        sessionPreviewScrollEl: {},
        sessionPreviewContainerEl: {},
        sessionPreviewHeaderEl: {},
        scheduleAfterFrame(task) {
            scheduled.push(task);
        },
        cancelSessionTimelineSync() {
            this._cancelTimelineSyncCalls = (this._cancelTimelineSyncCalls || 0) + 1;
        },
        invalidateSessionTimelineMeasurementCache() {},
        clearSessionTimelineRefs() {}
    });

    context.switchMainTab('settings');

    assert.strictEqual(context.mainTab, 'sessions');
    assert.strictEqual(context.fastHidden, true);
    assert.strictEqual(context.sessionListRenderEnabled, false);
    assert.strictEqual(context.sessionPreviewRenderEnabled, false);
    assert.strictEqual(context.sessionPreviewScrollEl, null);
    assert.strictEqual(context.sessionPreviewContainerEl, null);
    assert.strictEqual(context.sessionPreviewHeaderEl, null);
    assert.strictEqual(context.sessionTimelineActiveKey, '');
    assert.strictEqual(context.sessionTimelineLastSyncAt, 0);
    assert.strictEqual(context.sessionTimelineLastScrollTop, 0);
    assert.strictEqual(context.sessionTimelineLastAnchorY, 0);
    assert.strictEqual(context.sessionTimelineLastDirection, 0);
    assert.strictEqual(context._cancelTimelineSyncCalls, 1);
    assert.strictEqual(scheduled.length, 1);

    scheduled[0]();
    assert.strictEqual(context.mainTab, 'settings');
    assert.strictEqual(context.fastHidden, false);
});

test('switchMainTab re-primes session render when a deferred leave is canceled by returning to sessions', () => {
    const scheduled = [];
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
        sessionPreviewRenderEnabled: true,
        sessionTabRenderTicket: 3,
        scheduleAfterFrame(task) {
            scheduled.push(task);
        },
        cancelSessionTimelineSync() {},
        invalidateSessionTimelineMeasurementCache() {},
        clearSessionTimelineRefs() {},
        prepareSessionTabRender() {
            this._prepareCalls = (this._prepareCalls || 0) + 1;
            this.sessionListRenderEnabled = true;
            this.sessionPreviewRenderEnabled = true;
        }
    });

    context.switchMainTab('settings');
    assert.strictEqual(context.sessionListRenderEnabled, false);
    assert.strictEqual(context.sessionPreviewRenderEnabled, false);

    context.switchMainTab('sessions');

    assert.strictEqual(context.mainTab, 'sessions');
    assert.strictEqual(context._prepareCalls, 1);
    assert.strictEqual(context.sessionListRenderEnabled, true);
    assert.strictEqual(context.sessionPreviewRenderEnabled, true);
    assert.strictEqual(scheduled.length, 2);

    scheduled[0]();
    scheduled[1]();
    assert.strictEqual(context.mainTab, 'sessions');
    assert.strictEqual(context.fastHidden, false);
});

test('prepareSessionTabRender re-enables list before preview and primes preview rendering', () => {
    const methods = createNavigationMethods({
        configModeSet: new Set(['codex', 'claude', 'openclaw']),
        switchMainTabHelper(tab) {
            this.mainTab = tab;
        },
        loadMoreSessionMessagesHelper() {}
    });
    const scheduled = [];
    const context = createNavigationContext(methods, {
        mainTab: 'sessions',
        sessionListRenderEnabled: true,
        sessionPreviewRenderEnabled: true,
        sessionTimelineEnabled: true,
        sessionTabRenderTicket: 0,
        sessionPreviewVisibleCount: 24,
        scheduleAfterFrame(task) {
            scheduled.push(task);
        },
        resetSessionPreviewMessageRender() {
            this._resetCalls = (this._resetCalls || 0) + 1;
            this.sessionPreviewVisibleCount = 0;
        },
        primeSessionPreviewMessageRender() {
            this._primeCalls = (this._primeCalls || 0) + 1;
        },
        updateSessionTimelineOffset() {
            this._timelineOffsetCalls = (this._timelineOffsetCalls || 0) + 1;
        },
        scheduleSessionTimelineSync() {
            this._timelineSyncCalls = (this._timelineSyncCalls || 0) + 1;
        },
        $nextTick(callback) {
            this._nextTickCalls = (this._nextTickCalls || 0) + 1;
            callback();
        }
    });

    context.prepareSessionTabRender();

    assert.strictEqual(context.sessionListRenderEnabled, false);
    assert.strictEqual(context.sessionPreviewRenderEnabled, false);
    assert.strictEqual(context.sessionPreviewVisibleCount, 0);
    assert.strictEqual(context._resetCalls, 1);
    assert.strictEqual(scheduled.length, 1);

    scheduled.shift()();
    assert.strictEqual(context.sessionListRenderEnabled, true);
    assert.strictEqual(context.sessionPreviewRenderEnabled, false);
    assert.strictEqual(scheduled.length, 1);

    scheduled.shift()();
    assert.strictEqual(context.sessionListRenderEnabled, true);
    assert.strictEqual(context.sessionPreviewRenderEnabled, true);
    assert.strictEqual(context._nextTickCalls, 1);
    assert.strictEqual(context._primeCalls, 1);
    assert.strictEqual(context._timelineOffsetCalls, 1);
    assert.strictEqual(context._timelineSyncCalls || 0, 0);
    assert.strictEqual(scheduled.length, 1);

    scheduled.shift()();
    assert.strictEqual(context._timelineSyncCalls, 1);
});

test('scheduleSessionListViewportFill waits for a measured list element before auto-growing', () => {
    const methods = createNavigationMethods({
        configModeSet: new Set(['codex', 'claude', 'openclaw']),
        switchMainTabHelper(tab) {
            this.mainTab = tab;
        },
        loadMoreSessionMessagesHelper() {}
    });
    const idleTasks = [];
    const context = createNavigationContext(methods, {
        mainTab: 'sessions',
        sessionListRenderEnabled: true,
        sessionListVisibleCount: 0,
        sessionListInitialBatchSize: 20,
        sessionListLoadStep: 40,
        sortedSessionsList: Array.from({ length: 60 }, (_, index) => ({ source: 'codex', sessionId: `sess-${index}`, filePath: `/tmp/sess-${index}.jsonl` })),
        activeSession: null,
        __sessionListRef: null,
        scheduleIdleTask(task) {
            idleTasks.push(task);
            return task;
        },
        cancelIdleTask() {},
        getSessionExportKey(session) {
            return `${session.source}:${session.sessionId}:${session.filePath}`;
        }
    });

    context.primeSessionListRender();

    assert.strictEqual(context.sessionListVisibleCount, 20);
    assert.strictEqual(idleTasks.length, 1);

    idleTasks.shift()();

    assert.strictEqual(context.sessionListVisibleCount, 20);
    assert.strictEqual(idleTasks.length, 0);
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
