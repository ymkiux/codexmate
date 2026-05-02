import assert from 'assert';
import path from 'path';
import { pathToFileURL } from 'url';
import { withGlobalOverrides } from './helpers/web-ui-app-options.mjs';

const startupModule = await import(pathToFileURL(path.join(process.cwd(), 'web-ui', 'modules', 'app.methods.startup-claude.mjs')));

function createDeferred() {
    let resolve = null;
    let reject = null;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

test('loadAll enforces config load timeout deadline', async () => {
    let apiCalls = 0;
    const api = async (action) => {
        apiCalls += 1;
        if (action === 'status') {
            return new Promise(() => {});
        }
        return { error: 'unexpected' };
    };
    const methods = startupModule.createStartupClaudeMethods({ api, configLoadTimeoutMs: 6000 });
    const context = {
        loading: false,
        initError: '',
        editingCodexBudgetField: '',
        providersList: [],
        currentProvider: '',
        currentModel: '',
        normalizePositiveIntegerInput() {
            return { ok: true, text: '1', value: 1 };
        },
        maybeShowStarPrompt() {},
        showMessage() {},
        loadModelsForProvider() {
            throw new Error('should not run');
        },
        loadCodexAuthProfiles() {
            throw new Error('should not run');
        }
    };

    await withGlobalOverrides({
        setTimeout(fn) {
            fn();
            return 1;
        },
        clearTimeout() {}
    }, async () => {
        const ok = await methods.loadAll.call(context);
        assert.strictEqual(ok, false);
        assert.strictEqual(context.loading, false);
        assert.strictEqual(context.initError, '读取配置超时');
        assert.strictEqual(apiCalls, 1);
    });
});

test('refreshClaudeSelectionFromSettings queues the latest call during an inflight request', async () => {
    const first = createDeferred();
    const second = createDeferred();
    const calls = [];
    const api = async (action) => {
        calls.push(action);
        if (calls.length === 1) return first.promise;
        return second.promise;
    };
    const methods = startupModule.createStartupClaudeMethods({ api, configLoadTimeoutMs: 6000 });
    const context = {
        claudeConfigs: {},
        currentClaudeConfig: '',
        currentClaudeModel: '',
        messages: [],
        showMessage(text, type) {
            this.messages.push({ text: String(text), type: type || '' });
        },
        matchClaudeConfigFromSettings() {
            return '';
        },
        ensureClaudeConfigFromSettings() {
            return '';
        },
        resetClaudeModelsState() {},
        refreshClaudeModelContext() {}
    };

    const run1 = methods.refreshClaudeSelectionFromSettings.call(context, { silent: true });
    const run2 = methods.refreshClaudeSelectionFromSettings.call(context, { silent: true });
    await Promise.resolve();
    assert.deepStrictEqual(calls, ['get-claude-settings']);

    first.resolve({ env: {}, exists: false });
    await run1;
    await Promise.resolve();
    assert.deepStrictEqual(calls, ['get-claude-settings', 'get-claude-settings']);

    second.resolve({ env: {}, exists: false });
    await run2;
});

