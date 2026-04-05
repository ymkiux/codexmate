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
