import assert from 'assert';
import {
    captureCurrentBundledAppOptions,
    withGlobalOverrides
} from './helpers/web-ui-app-options.mjs';

test('mounted defers initial loadAll until after window load and a short timer', async () => {
    const appOptions = await captureCurrentBundledAppOptions();
    const registeredListeners = [];
    const removedListeners = [];
    const rafCallbacks = [];
    const timeoutCallbacks = [];
    let refreshClaudeSelectionCalls = 0;
    let syncDefaultOpenclawCalls = 0;
    const context = {
        sessionResumeWithYolo: true,
        claudeConfigs: {},
        openclawConfigs: {
            '默认配置': {
                content: ''
            }
        },
        currentOpenclawConfig: '',
        initSessionStandalone() {},
        updateCompactLayoutMode() {},
        restoreSessionFilterCache() {},
        restoreSessionPinnedMap() {},
        normalizeShareCommandPrefix(value) {
            return value || 'npm start';
        },
        normalizeSessionTrashEnabled(value) {
            return value !== '0' && value !== 'false';
        },
        onWindowResize() {},
        handleGlobalKeydown() {},
        handleBeforeUnload() {},
        refreshClaudeSelectionFromSettings() {
            refreshClaudeSelectionCalls += 1;
            return Promise.resolve();
        },
        syncDefaultOpenclawConfigEntry() {
            syncDefaultOpenclawCalls += 1;
            return Promise.resolve();
        },
        loadAllCalls: 0,
        loadAll() {
            this.loadAllCalls += 1;
            return Promise.resolve(true);
        }
    };

    await withGlobalOverrides({
        document: {
            readyState: 'interactive'
        },
        localStorage: {
            getItem() {
                return null;
            },
            setItem() {},
            removeItem() {}
        },
        window: {
            addEventListener(name, handler, options) {
                registeredListeners.push({ name, handler, options });
            },
            removeEventListener(name, handler) {
                removedListeners.push({ name, handler });
            }
        },
        requestAnimationFrame(callback) {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        },
        cancelAnimationFrame() {},
        setTimeout(callback, ms) {
            timeoutCallbacks.push({ callback, ms });
            return timeoutCallbacks.length;
        },
        clearTimeout() {}
    }, async () => {
        appOptions.mounted.call(context);
        assert.strictEqual(context.loadAllCalls, 0);
        assert.strictEqual(refreshClaudeSelectionCalls, 0);
        assert.strictEqual(syncDefaultOpenclawCalls, 0);
        const loadListener = registeredListeners.find((entry) => entry.name === 'load');
        assert.ok(loadListener, 'mounted should wait for window load before first loadAll');

        loadListener.handler();
        assert.strictEqual(context.loadAllCalls, 0);
        assert.strictEqual(rafCallbacks.length, 1);

        rafCallbacks[0]();
        assert.strictEqual(context.loadAllCalls, 0);
        assert.strictEqual(timeoutCallbacks.length, 1);
        assert.strictEqual(timeoutCallbacks[0].ms, 120);

        await timeoutCallbacks[0].callback();
        assert.strictEqual(context.loadAllCalls, 1);
        assert.strictEqual(refreshClaudeSelectionCalls, 1);
        assert.strictEqual(syncDefaultOpenclawCalls, 1);
        assert.ok(
            removedListeners.some((entry) => entry.name === 'load' && entry.handler === loadListener.handler),
            'mounted should clean up the one-shot load listener after scheduling the initial refresh'
        );
    });
});

test('mounted skips auxiliary startup requests when loadAll fails', async () => {
    const appOptions = await captureCurrentBundledAppOptions();
    const registeredListeners = [];
    const rafCallbacks = [];
    const timeoutCallbacks = [];
    let refreshClaudeSelectionCalls = 0;
    let syncDefaultOpenclawCalls = 0;
    const context = {
        sessionResumeWithYolo: true,
        claudeConfigs: {},
        openclawConfigs: {
            '默认配置': {
                content: ''
            }
        },
        currentOpenclawConfig: '',
        initSessionStandalone() {},
        updateCompactLayoutMode() {},
        restoreSessionFilterCache() {},
        restoreSessionPinnedMap() {},
        normalizeShareCommandPrefix(value) {
            return value || 'npm start';
        },
        normalizeSessionTrashEnabled(value) {
            return value !== '0' && value !== 'false';
        },
        onWindowResize() {},
        handleGlobalKeydown() {},
        handleBeforeUnload() {},
        refreshClaudeSelectionFromSettings() {
            refreshClaudeSelectionCalls += 1;
            return Promise.resolve();
        },
        syncDefaultOpenclawConfigEntry() {
            syncDefaultOpenclawCalls += 1;
            return Promise.resolve();
        },
        loadAllCalls: 0,
        loadAll() {
            this.loadAllCalls += 1;
            return Promise.resolve(false);
        }
    };

    await withGlobalOverrides({
        document: {
            readyState: 'interactive'
        },
        localStorage: {
            getItem() {
                return null;
            },
            setItem() {},
            removeItem() {}
        },
        window: {
            addEventListener(name, handler, options) {
                registeredListeners.push({ name, handler, options });
            },
            removeEventListener() {}
        },
        requestAnimationFrame(callback) {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        },
        cancelAnimationFrame() {},
        setTimeout(callback, ms) {
            timeoutCallbacks.push({ callback, ms });
            return timeoutCallbacks.length;
        },
        clearTimeout() {}
    }, async () => {
        appOptions.mounted.call(context);
        const loadListener = registeredListeners.find((entry) => entry.name === 'load');
        assert.ok(loadListener, 'mounted should wait for window load before first loadAll');

        loadListener.handler();
        assert.strictEqual(rafCallbacks.length, 1);
        rafCallbacks[0]();
        assert.strictEqual(timeoutCallbacks.length, 1);
        await timeoutCallbacks[0].callback();

        assert.strictEqual(context.loadAllCalls, 1);
        assert.strictEqual(refreshClaudeSelectionCalls, 0);
        assert.strictEqual(syncDefaultOpenclawCalls, 0);
    });
});
