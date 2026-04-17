import assert from 'assert';
import {
    captureCurrentBundledAppOptions,
    withGlobalOverrides
} from './helpers/web-ui-app-options.mjs';

const currentAppOptions = await captureCurrentBundledAppOptions();
const currentMethods = currentAppOptions.methods;
const currentComputed = currentAppOptions.computed;

function createProviderSwitchContext() {
    const calls = [];
    const messages = [];

    return {
        currentProvider: 'alpha',
        currentModel: 'alpha-model',
        models: ['alpha-model'],
        modelsSource: 'remote',
        modelsHasCurrent: true,
        providerSwitchInProgress: false,
        pendingProviderSwitch: '',
        providerSwitchDisplayTarget: '',
        codexApplying: false,
        configMode: 'codex',
        calls,
        messages,
        showMessage(text, type) {
            messages.push({
                text: String(text),
                type: type || 'info'
            });
        },
        async loadModelsForProvider(name) {
            calls.push(['loadModelsForProvider', name]);
            if (name === 'beta') {
                this.models = ['beta-model', 'beta-fallback'];
                this.modelsSource = 'remote';
                this.modelsHasCurrent = false;
                return;
            }
            if (name === 'gamma') {
                this.models = ['gamma-model', 'gamma-fallback'];
                this.modelsSource = 'remote';
                this.modelsHasCurrent = false;
                return;
            }
            this.models = ['alpha-model'];
            this.modelsSource = 'remote';
            this.modelsHasCurrent = true;
        },
        async applyCodexConfigDirect(options) {
            calls.push(['applyCodexConfigDirect', options]);
        }
    };
}

function createProviderUpdateContext() {
    const messages = [];
    return {
        editingProvider: {
            name: 'alpha',
            url: ' https://api.example.com/v1 ',
            key: '',
            readOnly: false,
            nonEditable: false
        },
        showEditModal: true,
        messages,
        loadAllCalls: 0,
        showMessage(text, type) {
            messages.push({
                text: String(text),
                type: type || 'info'
            });
        },
        async loadAll() {
            this.loadAllCalls += 1;
        },
        closeEditModal: currentMethods.closeEditModal
    };
}

function createJsonResponse(result = {}) {
    return {
        ok: true,
        status: 200,
        headers: {
            get(name) {
                return String(name || '').toLowerCase() === 'content-type'
                    ? 'application/json'
                    : '';
            }
        },
        async json() {
            return result;
        },
        async text() {
            return JSON.stringify(result);
        }
    };
}

test('switchProvider keeps list-backed model state after auto-selecting the first remote model', async () => {
    const context = createProviderSwitchContext();
    context.waitForCodexApplyIdle = currentMethods.waitForCodexApplyIdle;
    context.performProviderSwitch = currentMethods.performProviderSwitch;
    context.switchProvider = currentMethods.switchProvider;

    await currentMethods.switchProvider.call(context, 'beta');

    assert.strictEqual(context.currentProvider, 'beta');
    assert.strictEqual(context.currentModel, 'beta-model');
    assert.strictEqual(context.modelsSource, 'remote');
    assert.strictEqual(context.modelsHasCurrent, true);
    assert.deepStrictEqual(context.messages, []);
    assert.deepStrictEqual(context.calls, [
        ['loadModelsForProvider', 'beta'],
        ['applyCodexConfigDirect', { silent: true }]
    ]);
    assert.strictEqual(context.providerSwitchDisplayTarget, '');
});

test('quick successive provider switches keep the final provider in list-backed mode', async () => {
    const context = createProviderSwitchContext();
    let releaseFirstLoad = null;
    const firstLoadDone = new Promise((resolve) => {
        releaseFirstLoad = resolve;
    });
    context.loadModelsForProvider = async function loadModelsForProvider(name) {
        context.calls.push(['loadModelsForProvider', name]);
        if (name === 'beta') {
            await firstLoadDone;
            this.models = ['beta-model', 'beta-fallback'];
            this.modelsSource = 'remote';
            this.modelsHasCurrent = false;
            return;
        }
        if (name === 'gamma') {
            this.models = ['gamma-model', 'gamma-fallback'];
            this.modelsSource = 'remote';
            this.modelsHasCurrent = false;
            return;
        }
        this.models = ['alpha-model'];
        this.modelsSource = 'remote';
        this.modelsHasCurrent = true;
    };
    context.waitForCodexApplyIdle = currentMethods.waitForCodexApplyIdle;
    context.performProviderSwitch = currentMethods.performProviderSwitch;
    context.switchProvider = currentMethods.switchProvider;
    context.quickSwitchProvider = currentMethods.quickSwitchProvider;

    const firstSwitch = currentMethods.quickSwitchProvider.call(context, 'beta');
    await Promise.resolve();
    const queuedSwitch = currentMethods.quickSwitchProvider.call(context, 'gamma');
    await Promise.resolve();

    assert.strictEqual(currentComputed.displayCurrentProvider.call(context), 'gamma');
    assert.strictEqual(context.providerSwitchDisplayTarget, 'gamma');

    releaseFirstLoad();
    await Promise.all([firstSwitch, queuedSwitch]);

    assert.strictEqual(context.currentProvider, 'gamma');
    assert.strictEqual(context.currentModel, 'gamma-model');
    assert.strictEqual(context.modelsSource, 'remote');
    assert.strictEqual(context.modelsHasCurrent, true);
    assert.deepStrictEqual(context.messages, []);
    assert.deepStrictEqual(context.calls, [
        ['loadModelsForProvider', 'beta'],
        ['applyCodexConfigDirect', { silent: true }],
        ['loadModelsForProvider', 'gamma'],
        ['applyCodexConfigDirect', { silent: true }]
    ]);
    assert.strictEqual(context.providerSwitchDisplayTarget, '');
});

test('switchProvider reflects the first clicked target immediately while waiting for apply idle', async () => {
    const context = createProviderSwitchContext();
    let releaseIdle = null;
    const idleGate = new Promise((resolve) => {
        releaseIdle = resolve;
    });
    let waitCalls = 0;
    context.waitForCodexApplyIdle = async function waitForCodexApplyIdle() {
        waitCalls += 1;
        await idleGate;
    };
    context.performProviderSwitch = currentMethods.performProviderSwitch;
    context.switchProvider = currentMethods.switchProvider;

    const switchPromise = currentMethods.switchProvider.call(context, 'beta');
    await Promise.resolve();

    assert.strictEqual(currentComputed.displayCurrentProvider.call(context), 'beta');
    assert.strictEqual(context.providerSwitchDisplayTarget, 'beta');
    assert.strictEqual(context.currentProvider, 'alpha');
    assert.strictEqual(waitCalls, 1);

    releaseIdle();
    await switchPromise;

    assert.strictEqual(context.currentProvider, 'beta');
    assert.strictEqual(currentComputed.displayCurrentProvider.call(context), 'beta');
    assert.strictEqual(context.providerSwitchDisplayTarget, '');
});

test('performProviderSwitch keeps provider when provider models fail to load', async () => {
    const context = createProviderSwitchContext();
    context.loadModelsForProvider = async function loadModelsForProvider(name) {
        context.calls.push(['loadModelsForProvider', name]);
        this.models = [];
        this.modelsSource = 'error';
        this.modelsHasCurrent = true;
    };
    context.waitForCodexApplyIdle = currentMethods.waitForCodexApplyIdle;

    await currentMethods.performProviderSwitch.call(context, 'beta');

    assert.strictEqual(context.currentProvider, 'beta');
    assert.strictEqual(context.currentModel, 'alpha-model');
    assert.deepStrictEqual(context.models, []);
    assert.strictEqual(context.modelsSource, 'error');
    assert.strictEqual(context.modelsHasCurrent, true);
    assert.deepStrictEqual(context.calls, [
        ['loadModelsForProvider', 'beta'],
        ['applyCodexConfigDirect', { silent: true }]
    ]);
    assert.deepStrictEqual(context.messages, [{
        text: '模型列表获取失败，但已切换提供商；请检查 URL/密钥或手动设置模型',
        type: 'error'
    }]);
});

test('updateProvider keeps existing key when edit key input is blank', async () => {
    const context = createProviderUpdateContext();
    const payloads = [];
    const fetch = async (_url, init = {}) => {
        payloads.push(JSON.parse(init.body));
        return createJsonResponse({});
    };

    await withGlobalOverrides({ fetch }, async () => {
        await currentMethods.updateProvider.call(context);
    });

    assert.deepStrictEqual(payloads, [{
        action: 'update-provider',
        params: {
            name: 'alpha',
            url: 'https://api.example.com/v1'
        }
    }]);
    assert.strictEqual(context.showEditModal, false);
    assert.deepStrictEqual(context.editingProvider, { name: '', url: '', key: '', readOnly: false, nonEditable: false, useTransform: false });
    assert.strictEqual(context.loadAllCalls, 1);
    assert.deepStrictEqual(context.messages, [{
        text: '操作成功',
        type: 'success'
    }]);
});

test('updateProvider sends explicit key when user enters a new key', async () => {
    const context = createProviderUpdateContext();
    context.editingProvider.key = 'sk-new';
    const payloads = [];
    const fetch = async (_url, init = {}) => {
        payloads.push(JSON.parse(init.body));
        return createJsonResponse({});
    };

    await withGlobalOverrides({ fetch }, async () => {
        await currentMethods.updateProvider.call(context);
    });

    assert.deepStrictEqual(payloads, [{
        action: 'update-provider',
        params: {
            name: 'alpha',
            url: 'https://api.example.com/v1',
            key: 'sk-new'
        }
    }]);
    assert.strictEqual(context.showEditModal, false);
    assert.strictEqual(context.loadAllCalls, 1);
    assert.deepStrictEqual(context.messages, [{
        text: '操作成功',
        type: 'success'
    }]);
});

test('updateProvider keeps edit modal open when request throws', async () => {
    const context = createProviderUpdateContext();
    const fetch = async () => {
        throw new Error('network down');
    };

    await withGlobalOverrides({ fetch }, async () => {
        await currentMethods.updateProvider.call(context);
    });

    assert.strictEqual(context.showEditModal, true);
    assert.deepStrictEqual(context.editingProvider, {
        name: 'alpha',
        url: 'https://api.example.com/v1',
        key: '',
        readOnly: false,
        nonEditable: false
    });
    assert.strictEqual(context.loadAllCalls, 0);
    assert.deepStrictEqual(context.messages, [{
        text: '更新失败',
        type: 'error'
    }]);
});
