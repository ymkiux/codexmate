import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { createOpenclawPersistMethods } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.openclaw-persist.mjs'))
);

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function createContext(methods, overrides = {}) {
    return {
        ...methods,
        openclawConfigs: {
            saved: {
                content: 'saved-local'
            }
        },
        openclawEditorTitle: '',
        openclawEditing: {
            name: '',
            content: '',
            lockName: false
        },
        openclawConfigPath: '',
        openclawConfigExists: false,
        openclawLineEnding: '\n',
        openclawSaving: false,
        openclawApplying: false,
        openclawFileLoading: false,
        openclawModalLoadToken: 0,
        openclawFileLoadRequestSeq: 0,
        showOpenclawConfigModal: false,
        shownMessages: [],
        syncOpenclawStructuredFromTextCalls: 0,
        resetOpenclawStructuredCalls: 0,
        resetOpenclawQuickCalls: 0,
        showMessage(message, type) {
            this.shownMessages.push({ message, type });
        },
        syncOpenclawStructuredFromText() {
            this.syncOpenclawStructuredFromTextCalls += 1;
        },
        resetOpenclawStructured() {
            this.resetOpenclawStructuredCalls += 1;
        },
        resetOpenclawQuick() {
            this.resetOpenclawQuickCalls += 1;
        },
        saveOpenclawConfigs() {
            return true;
        },
        openclawHasContent(config) {
            return !!(config && typeof config.content === 'string' && config.content.trim());
        },
        ...overrides
    };
}

test('closeOpenclawConfigModal ignores backdrop close while save/apply is busy', () => {
    const methods = createOpenclawPersistMethods();
    const context = createContext(methods, {
        openclawSaving: true,
        showOpenclawConfigModal: true,
        openclawEditing: {
            name: 'draft',
            content: 'draft-content',
            lockName: false
        },
        openclawModalLoadToken: 4
    });

    methods.closeOpenclawConfigModal.call(context);

    assert.strictEqual(context.showOpenclawConfigModal, true);
    assert.deepStrictEqual(context.openclawEditing, {
        name: 'draft',
        content: 'draft-content',
        lockName: false
    });
    assert.strictEqual(context.openclawModalLoadToken, 4);
    assert.strictEqual(context.resetOpenclawStructuredCalls, 0);
    assert.strictEqual(context.resetOpenclawQuickCalls, 0);
});

test('openOpenclawAddModal does not let a late load clobber typed draft content', async () => {
    const pending = deferred();
    const methods = createOpenclawPersistMethods({
        api: async () => pending.promise,
        defaultOpenclawTemplate: 'template-default'
    });
    const context = createContext(methods);

    methods.openOpenclawAddModal.call(context);
    assert.strictEqual(context.showOpenclawConfigModal, true);

    context.openclawEditing.content = 'typed-draft';
    pending.resolve({
        error: '',
        exists: true,
        path: '/tmp/openclaw.json',
        lineEnding: '\n',
        content: 'remote-content'
    });
    await pending.promise;
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(context.openclawEditing.content, 'typed-draft');
    assert.strictEqual(context.openclawConfigPath, '/tmp/openclaw.json');
    assert.strictEqual(context.openclawFileLoading, false);
});

test('default openclaw config edit always refreshes from the real config file', async () => {
    const methods = createOpenclawPersistMethods({
        api: async () => ({
            error: '',
            exists: true,
            path: '/tmp/openclaw.json',
            lineEnding: '\n',
            content: 'real-default-content'
        }),
        defaultOpenclawTemplate: 'template-default'
    });
    const context = createContext(methods, {
        openclawConfigs: {
            '默认配置': {
                content: 'stale-local-default'
            },
            saved: {
                content: 'saved-local'
            }
        },
        currentOpenclawConfig: 'saved'
    });

    methods.openOpenclawEditModal.call(context, '默认配置');
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(context.openclawEditing.name, '默认配置');
    assert.strictEqual(context.openclawEditing.content, 'real-default-content');
    assert.strictEqual(context.openclawConfigPath, '/tmp/openclaw.json');
    assert.strictEqual(context.openclawConfigExists, true);
    assert.strictEqual(context.openclawConfigs['默认配置'].content, 'real-default-content');
    assert.strictEqual(context.currentOpenclawConfig, 'saved');
});

test('stale openclaw loads from an earlier modal session are ignored after reopening', async () => {
    const first = deferred();
    const second = deferred();
    const responses = [first.promise, second.promise];
    const methods = createOpenclawPersistMethods({
        api: async () => responses.shift()
    });
    const context = createContext(methods);

    methods.openOpenclawAddModal.call(context);
    methods.openOpenclawEditModal.call(context, 'saved');

    second.resolve({
        error: '',
        exists: true,
        path: '/tmp/edited.json',
        lineEnding: '\n',
        content: ''
    });
    await second.promise;
    await new Promise((resolve) => setImmediate(resolve));

    first.resolve({
        error: '',
        exists: true,
        path: '/tmp/stale.json',
        lineEnding: '\n',
        content: 'stale-content'
    });
    await first.promise;
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(context.openclawEditing.name, 'saved');
    assert.strictEqual(context.openclawEditing.content, 'saved-local');
    assert.strictEqual(context.openclawConfigPath, '/tmp/edited.json');
    assert.strictEqual(context.openclawFileLoading, false);
});

test('saveOpenclawConfig does not report success or close modal when local persistence fails', async () => {
    const methods = createOpenclawPersistMethods();
    let closeCalls = 0;
    const context = createContext(methods, {
        currentOpenclawConfig: 'saved',
        showOpenclawConfigModal: true,
        openclawEditing: {
            name: 'draft',
            content: 'draft-content',
            lockName: false
        },
        closeOpenclawConfigModal() {
            closeCalls += 1;
        },
        saveOpenclawConfigs() {
            this.showMessage('保存本地 OpenClaw 配置失败', 'error');
            return false;
        }
    });

    await methods.saveOpenclawConfig.call(context);

    assert.strictEqual(closeCalls, 0);
    assert.strictEqual(context.showOpenclawConfigModal, true);
    assert.strictEqual(context.openclawSaving, false);
    assert.strictEqual(context.currentOpenclawConfig, 'saved');
    assert.deepStrictEqual(context.openclawConfigs, {
        saved: {
            content: 'saved-local'
        }
    });
    assert.deepStrictEqual(context.openclawEditing, {
        name: 'draft',
        content: 'draft-content',
        lockName: false
    });
    assert.deepStrictEqual(context.shownMessages, [{
        message: '保存本地 OpenClaw 配置失败',
        type: 'error'
    }]);
});

test('saveOpenclawConfig closes modal after a successful save while save state is busy', async () => {
    const methods = createOpenclawPersistMethods();
    const context = createContext(methods, {
        showOpenclawConfigModal: true,
        openclawEditing: {
            name: 'draft',
            content: 'draft-content',
            lockName: false
        },
        saveOpenclawConfigs() {
            return true;
        }
    });

    await methods.saveOpenclawConfig.call(context);

    assert.strictEqual(context.showOpenclawConfigModal, false);
    assert.strictEqual(context.openclawSaving, false);
    assert.deepStrictEqual(context.openclawEditing, {
        name: '',
        content: '',
        lockName: false
    });
    assert.strictEqual(context.resetOpenclawStructuredCalls, 1);
    assert.strictEqual(context.resetOpenclawQuickCalls, 1);
    assert.deepStrictEqual(context.shownMessages, [{
        message: '操作成功',
        type: 'success'
    }]);
});

test('saveOpenclawConfig refuses local-only save for the default system config', async () => {
    const methods = createOpenclawPersistMethods();
    const context = createContext(methods, {
        openclawEditing: {
            name: '默认配置',
            content: 'draft-content',
            lockName: true
        }
    });

    await methods.saveOpenclawConfig.call(context);

    assert.strictEqual(context.openclawSaving, false);
    assert.deepStrictEqual(context.shownMessages, [{
        message: '默认配置代表当前系统配置，请使用“保存并应用”',
        type: 'info'
    }]);
});

test('saveOpenclawConfig ignores save requests while apply is already busy', async () => {
    const methods = createOpenclawPersistMethods();
    const context = createContext(methods, {
        openclawApplying: true,
        showOpenclawConfigModal: true,
        openclawEditing: {
            name: 'draft',
            content: 'draft-content',
            lockName: false
        },
        saveOpenclawConfigs() {
            throw new Error('save should not run while apply is busy');
        }
    });

    await methods.saveOpenclawConfig.call(context);

    assert.strictEqual(context.openclawApplying, true);
    assert.strictEqual(context.openclawSaving, false);
    assert.strictEqual(context.showOpenclawConfigModal, true);
    assert.deepStrictEqual(context.shownMessages, []);
});

test('saveAndApplyOpenclawConfig does not call apply api when local persistence fails', async () => {
    let applyCalls = 0;
    const methods = createOpenclawPersistMethods({
        api: async () => {
            applyCalls += 1;
            return { success: true };
        }
    });
    let closeCalls = 0;
    const context = createContext(methods, {
        currentOpenclawConfig: 'saved',
        showOpenclawConfigModal: true,
        openclawEditing: {
            name: 'draft',
            content: 'draft-content',
            lockName: false
        },
        closeOpenclawConfigModal() {
            closeCalls += 1;
        },
        saveOpenclawConfigs() {
            this.showMessage('保存本地 OpenClaw 配置失败', 'error');
            return false;
        }
    });

    await methods.saveAndApplyOpenclawConfig.call(context);

    assert.strictEqual(applyCalls, 0);
    assert.strictEqual(closeCalls, 0);
    assert.strictEqual(context.showOpenclawConfigModal, true);
    assert.strictEqual(context.openclawApplying, false);
    assert.strictEqual(context.currentOpenclawConfig, 'saved');
    assert.deepStrictEqual(context.openclawConfigs, {
        saved: {
            content: 'saved-local'
        }
    });
    assert.deepStrictEqual(context.openclawEditing, {
        name: 'draft',
        content: 'draft-content',
        lockName: false
    });
    assert.deepStrictEqual(context.shownMessages, [{
        message: '保存本地 OpenClaw 配置失败',
        type: 'error'
    }]);
});

test('saveAndApplyOpenclawConfig closes modal after a successful apply while apply state is busy', async () => {
    const methods = createOpenclawPersistMethods({
        api: async () => ({
            success: true,
            targetPath: '/tmp/openclaw.json'
        })
    });
    const context = createContext(methods, {
        showOpenclawConfigModal: true,
        openclawEditing: {
            name: 'draft',
            content: 'draft-content',
            lockName: false
        },
        saveOpenclawConfigs() {
            return true;
        }
    });

    await methods.saveAndApplyOpenclawConfig.call(context);

    assert.strictEqual(context.showOpenclawConfigModal, false);
    assert.strictEqual(context.openclawApplying, false);
    assert.strictEqual(context.openclawConfigExists, true);
    assert.strictEqual(context.openclawConfigPath, '/tmp/openclaw.json');
    assert.deepStrictEqual(context.openclawEditing, {
        name: '',
        content: '',
        lockName: false
    });
    assert.strictEqual(context.resetOpenclawStructuredCalls, 1);
    assert.strictEqual(context.resetOpenclawQuickCalls, 1);
    assert.deepStrictEqual(context.shownMessages, [{
        message: '已保存并应用 OpenClaw 配置（/tmp/openclaw.json）',
        type: 'success'
    }]);
});

test('saveAndApplyOpenclawConfig keeps the default entry synced to the applied system config', async () => {
    const methods = createOpenclawPersistMethods({
        api: async () => ({
            success: true,
            targetPath: '/tmp/openclaw.json'
        })
    });
    const context = createContext(methods, {
        openclawConfigs: {
            '默认配置': {
                content: 'old-default'
            },
            draft: {
                content: 'draft-content'
            }
        },
        currentOpenclawConfig: 'draft',
        openclawEditing: {
            name: 'draft',
            content: 'draft-content',
            lockName: true
        }
    });

    await methods.saveAndApplyOpenclawConfig.call(context);

    assert.strictEqual(context.openclawConfigs['默认配置'].content, 'draft-content');
    assert.strictEqual(context.openclawConfigPath, '/tmp/openclaw.json');
    assert.strictEqual(context.openclawConfigExists, true);
});

test('saveAndApplyOpenclawConfig ignores apply requests while save is already busy', async () => {
    const methods = createOpenclawPersistMethods({
        api: async () => {
            throw new Error('apply api should not run while save is busy');
        }
    });
    const context = createContext(methods, {
        openclawSaving: true,
        showOpenclawConfigModal: true,
        openclawEditing: {
            name: 'draft',
            content: 'draft-content',
            lockName: false
        },
        saveOpenclawConfigs() {
            throw new Error('persist should not run while save is busy');
        }
    });

    await methods.saveAndApplyOpenclawConfig.call(context);

    assert.strictEqual(context.openclawSaving, true);
    assert.strictEqual(context.openclawApplying, false);
    assert.strictEqual(context.showOpenclawConfigModal, true);
    assert.deepStrictEqual(context.shownMessages, []);
});

test('persistOpenclawConfig restores the previous config content when saving an existing item fails', () => {
    const methods = createOpenclawPersistMethods();
    const context = createContext(methods, {
        currentOpenclawConfig: 'saved',
        showOpenclawConfigModal: true,
        openclawEditing: {
            name: 'saved',
            content: 'draft-content',
            lockName: true
        },
        saveOpenclawConfigs() {
            this.showMessage('保存本地 OpenClaw 配置失败', 'error');
            return false;
        }
    });

    const result = methods.persistOpenclawConfig.call(context);

    assert.strictEqual(result, '');
    assert.strictEqual(context.currentOpenclawConfig, 'saved');
    assert.deepStrictEqual(context.openclawConfigs, {
        saved: {
            content: 'saved-local'
        }
    });
    assert.strictEqual(context.showOpenclawConfigModal, true);
    assert.deepStrictEqual(context.shownMessages, [{
        message: '保存本地 OpenClaw 配置失败',
        type: 'error'
    }]);
});
