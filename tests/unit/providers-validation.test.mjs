import assert from 'assert';
import { createProvidersMethods } from '../../web-ui/modules/app.methods.providers.mjs';

function createContext(overrides = {}, apiImpl = async () => ({ success: true })) {
    const messages = [];
    const loadAllCalls = [];
    const methods = createProvidersMethods({ api: apiImpl });
    const context = {
        providersList: [],
        codexAuthProfiles: [],
        showAddModal: true,
        showEditModal: false,
        resetConfigLoading: false,
        newProvider: { name: '', url: '', key: '', useTransform: false },
        editingProvider: { name: '', url: '', key: '', readOnly: false, nonEditable: false },
        claudeConfigs: {},
        showMessage(text, type) {
            messages.push({ text: String(text), type: type || 'info' });
        },
        async loadAll() {
            loadAllCalls.push('loadAll');
        },
        ...methods,
        ...overrides
    };
    return { context, messages, loadAllCalls };
}

test('provider validation rejects invalid add-provider fields before submit', async () => {
    const apiCalls = [];
    const { context, messages } = createContext({
        newProvider: {
            name: 'bad name',
            url: 'not-a-url',
            key: 'sk-test'
        }
    }, async (action, params) => {
        apiCalls.push({ action, params });
        return { success: true };
    });

    assert.strictEqual(context.canSubmitProvider('add'), false);
    assert.strictEqual(context.providerFieldError('add', 'name'), '名称仅支持字母/数字/._-');
    assert.strictEqual(context.providerFieldError('add', 'url'), 'URL 仅支持 http/https');

    await context.addProvider();

    assert.deepStrictEqual(apiCalls, []);
    assert.strictEqual(messages.length, 1);
    assert.deepStrictEqual(messages[0], {
        text: '名称仅支持字母/数字/._-',
        type: 'error'
    });
});

test('addProvider normalizes trimmed values and submits sanitized payload', async () => {
    const apiCalls = [];
    const { context, messages, loadAllCalls } = createContext({
        providersList: [{ name: 'alpha', url: 'https://alpha.example.com/v1', hasKey: true }],
        newProvider: {
            name: '  beta.provider  ',
            url: ' https://api.example.com/v1/ ',
            key: ' sk-live '
        }
    }, async (action, params) => {
        apiCalls.push({ action, params });
        return { success: true };
    });

    await context.addProvider();

    assert.deepStrictEqual(apiCalls, [{
        action: 'add-provider',
        params: {
            name: 'beta.provider',
            url: 'https://api.example.com/v1',
            key: ' sk-live '
        }
    }]);
    assert.strictEqual(context.showAddModal, false);
    assert.deepStrictEqual(context.newProvider, { name: '', url: '', key: '', useTransform: false });
    assert.deepStrictEqual(loadAllCalls, ['loadAll']);
    assert.strictEqual(messages.length, 1);
    assert.deepStrictEqual(messages[0], {
        text: '操作成功',
        type: 'success'
    });
});

test('updateProvider blocks invalid edit URL and skips api call', async () => {
    const apiCalls = [];
    const { context, messages } = createContext({
        editingProvider: {
            name: 'alpha',
            url: 'ftp://api.example.com',
            key: '',
            readOnly: false,
            nonEditable: false
        }
    }, async (action, params) => {
        apiCalls.push({ action, params });
        return { success: true };
    });

    assert.strictEqual(context.canSubmitProvider('edit'), false);
    assert.strictEqual(context.providerFieldError('edit', 'url'), 'URL 仅支持 http/https');

    await context.updateProvider();

    assert.deepStrictEqual(apiCalls, []);
    assert.strictEqual(messages.length, 1);
    assert.deepStrictEqual(messages[0], {
        text: 'URL 仅支持 http/https',
        type: 'error'
    });
});

test('provider validation rejects reserved proxy name on add', () => {
    const { context } = createContext({
        newProvider: {
            name: 'codexmate-proxy',
            url: 'https://api.example.com/v1',
            key: ''
        }
    });

    assert.strictEqual(context.providerFieldError('add', 'name'), 'codexmate-proxy 为保留名称，不可手动添加');
    assert.strictEqual(context.canSubmitProvider('add'), false);
});
