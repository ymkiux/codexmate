import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { createOpenclawCoreMethods } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.openclaw-core.mjs'))
);
const { createOpenclawEditingMethods } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.openclaw-editing.mjs'))
);

const coreMethods = createOpenclawCoreMethods();
const editingMethods = createOpenclawEditingMethods();

function createContext(overrides = {}) {
    return {
        ...coreMethods,
        ...editingMethods,
        openclawEditing: {
            content: '',
            name: '测试配置',
            lockName: false
        },
        openclawQuick: coreMethods.getOpenclawQuickDefaults(),
        openclawStructured: {
            agentPrimary: '',
            agentFallbacks: [''],
            workspace: '',
            timeout: '',
            contextTokens: '',
            maxConcurrent: '',
            envItems: [{ key: '', value: '', show: false }],
            toolsProfile: 'default',
            toolsAllow: [''],
            toolsDeny: ['']
        },
        openclawAgentsList: [],
        openclawProviders: [],
        openclawMissingProviders: [],
        openclawAuthProfilesByProvider: {},
        openclawPendingAuthProfileUpdates: {},
        messages: [],
        showMessage(message, type) {
            this.messages.push({ message, type });
        },
        ...overrides
    };
}

test('applyOpenclawQuickToText preserves structured provider refs instead of stringifying them', () => {
    const context = createContext();
    const config = {
        agents: {
            defaults: {
                model: {
                    primary: 'openai/gpt-5'
                }
            }
        },
        models: {
            providers: {
                openai: {
                    baseUrl: {
                        source: 'env',
                        provider: 'default',
                        id: 'OPENAI_BASE_URL'
                    },
                    apiKey: {
                        source: 'env',
                        provider: 'default',
                        id: 'OPENAI_API_KEY'
                    },
                    api: 'openai-responses',
                    models: [
                        {
                            id: 'gpt-5',
                            name: 'GPT-5'
                        }
                    ]
                }
            }
        }
    };

    context.openclawEditing.content = context.stringifyOpenclawConfig(config);
    context.fillOpenclawQuickFromConfig(config);
    context.openclawQuick.modelName = 'GPT-5 Updated';
    context.openclawQuick.overrideModels = true;
    context.openclawQuick.overrideProvider = true;

    editingMethods.applyOpenclawQuickToText.call(context);

    const parsed = context.parseOpenclawContent(context.openclawEditing.content, { allowEmpty: true });
    assert.strictEqual(parsed.ok, true);
    assert.deepStrictEqual(parsed.data.models.providers.openai.baseUrl, {
        source: 'env',
        provider: 'default',
        id: 'OPENAI_BASE_URL'
    });
    assert.deepStrictEqual(parsed.data.models.providers.openai.apiKey, {
        source: 'env',
        provider: 'default',
        id: 'OPENAI_API_KEY'
    });
    assert.strictEqual(parsed.data.models.providers.openai.models[0].name, 'GPT-5 Updated');
});

test('applyOpenclawQuickToText preserves keyRef-backed provider auth without rewriting it as apiKey text', () => {
    const context = createContext();
    const config = {
        agents: {
            defaults: {
                model: {
                    primary: 'openai/gpt-5'
                }
            }
        },
        models: {
            providers: {
                openai: {
                    baseUrl: 'https://api.openai.com/v1',
                    keyRef: {
                        source: 'env',
                        id: 'OPENAI_API_KEY'
                    },
                    api: 'openai-responses',
                    models: [
                        {
                            id: 'gpt-5',
                            name: 'GPT-5'
                        }
                    ]
                }
            }
        }
    };

    context.openclawEditing.content = context.stringifyOpenclawConfig(config);
    context.fillOpenclawQuickFromConfig(config);
    context.openclawQuick.modelName = 'GPT-5 Stable';
    context.openclawQuick.overrideModels = true;
    context.openclawQuick.overrideProvider = true;

    editingMethods.applyOpenclawQuickToText.call(context);

    const parsed = context.parseOpenclawContent(context.openclawEditing.content, { allowEmpty: true });
    assert.strictEqual(parsed.ok, true);
    assert.deepStrictEqual(parsed.data.models.providers.openai.keyRef, {
        source: 'env',
        id: 'OPENAI_API_KEY'
    });
    assert.strictEqual(parsed.data.models.providers.openai.apiKey, undefined);
    assert.strictEqual(parsed.data.models.providers.openai.models[0].name, 'GPT-5 Stable');
});

test('applyOpenclawQuickToText queues auth profile updates instead of inlining edited auth profile tokens', () => {
    const context = createContext({
        openclawAuthProfilesByProvider: {
            'openai-codex': {
                provider: 'openai-codex',
                profileId: 'openai-codex:default',
                type: 'oauth',
                display: 'AuthProfile(oauth:openai-codex:default)',
                resolvedValue: 'old-access-token',
                resolvedField: 'access',
                editable: true,
                valueKind: 'oauth-access'
            }
        }
    });
    const config = {
        agents: {
            defaults: {
                model: {
                    primary: 'openai-codex/gpt-5.4'
                }
            }
        },
        auth: {
            profiles: {
                'openai-codex:default': {
                    provider: 'openai-codex',
                    mode: 'oauth'
                }
            }
        }
    };

    context.openclawEditing.content = context.stringifyOpenclawConfig(config);
    context.fillOpenclawQuickFromConfig(config, {
        authProfilesByProvider: context.openclawAuthProfilesByProvider
    });
    context.openclawQuick.apiKey = 'new-access-token';
    context.openclawQuick.overrideProvider = true;

    editingMethods.applyOpenclawQuickToText.call(context);

    const parsed = context.parseOpenclawContent(context.openclawEditing.content, { allowEmpty: true });
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.data.models.providers['openai-codex'].apiKey, undefined);
    assert.strictEqual(parsed.data.models.providers['openai-codex'].baseUrl, 'https://chatgpt.com/backend-api');
    assert.deepStrictEqual(context.openclawPendingAuthProfileUpdates, {
        'openai-codex:default': {
            profileId: 'openai-codex:default',
            provider: 'openai-codex',
            field: 'access',
            value: 'new-access-token'
        }
    });
});
