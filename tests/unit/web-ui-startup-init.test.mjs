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
        onWindowResize() {},
        handleGlobalKeydown() {},
        handleBeforeUnload() {},
        refreshClaudeSelectionFromSettings() {
            return Promise.resolve();
        },
        syncDefaultOpenclawConfigEntry() {
            return Promise.resolve();
        },
        loadAllCalls: 0,
        loadAll() {
            this.loadAllCalls += 1;
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
    });

    assert.strictEqual(context.loadAllCalls, 0);
    const loadListener = registeredListeners.find((entry) => entry.name === 'load');
    assert.ok(loadListener, 'mounted should wait for window load before first loadAll');

    loadListener.handler();
    assert.strictEqual(context.loadAllCalls, 0);
    assert.strictEqual(rafCallbacks.length, 1);

    rafCallbacks[0]();
    assert.strictEqual(context.loadAllCalls, 0);
    assert.strictEqual(timeoutCallbacks.length, 1);
    assert.strictEqual(timeoutCallbacks[0].ms, 120);

    timeoutCallbacks[0].callback();
    assert.strictEqual(context.loadAllCalls, 1);
    assert.ok(
        removedListeners.some((entry) => entry.name === 'load' && entry.handler === loadListener.handler),
        'mounted should clean up the one-shot load listener after scheduling the initial refresh'
    );
});
