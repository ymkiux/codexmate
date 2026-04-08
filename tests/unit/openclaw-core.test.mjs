import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { createOpenclawCoreMethods } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.openclaw-core.mjs'))
);

const methods = createOpenclawCoreMethods();

test('parseOptionalNumber preserves numeric zero values', () => {
    assert.deepStrictEqual(methods.parseOptionalNumber(0, 'Timeout'), { ok: true, value: 0 });
    assert.deepStrictEqual(methods.parseOptionalNumber('0', 'Timeout'), { ok: true, value: 0 });
});

test('getOpenclawParser falls back to JSON helpers when window is unavailable', () => {
    const previousWindow = globalThis.window;
    try {
        delete globalThis.window;
        const parser = methods.getOpenclawParser();
        assert.strictEqual(parser.parse, JSON.parse);
        assert.strictEqual(parser.stringify, JSON.stringify);
    } finally {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
    }
});

test('fillOpenclawQuickFromConfig reads provider base url and key from root providers with legacy field names', () => {
    const context = {
        ...methods,
        openclawQuick: methods.getOpenclawQuickDefaults()
    };

    methods.fillOpenclawQuickFromConfig.call(context, {
        agents: {
            defaults: {
                model: {
                    primary: 'maxx/gpt-4.1'
                }
            }
        },
        models: {
            providers: {
                maxx: {
                    models: [
                        {
                            id: 'gpt-4.1',
                            name: 'GPT 4.1',
                            context_window: 128000,
                            max_tokens: 8192
                        }
                    ]
                }
            }
        },
        providers: {
            maxx: {
                base_url: 'https://provider.example.com/v1',
                api_key: 'sk-live',
                api_type: 'openai-chat'
            }
        }
    });

    assert.deepStrictEqual(context.openclawQuick, {
        ...methods.getOpenclawQuickDefaults(),
        providerName: 'maxx',
        baseUrl: 'https://provider.example.com/v1',
        baseUrlDisplayKind: 'string',
        apiKey: 'sk-live',
        apiKeyDisplayKind: 'string',
        apiType: 'openai-chat',
        modelId: 'gpt-4.1',
        modelName: 'GPT 4.1',
        contextWindow: '128000',
        maxTokens: '8192'
    });
});

test('fillOpenclawQuickFromConfig falls back to the sole provider across provider maps', () => {
    const context = {
        ...methods,
        openclawQuick: methods.getOpenclawQuickDefaults()
    };

    methods.fillOpenclawQuickFromConfig.call(context, {
        providers: {
            alpha: {
                url: 'https://alpha.example.com/v1',
                apiKey: 'alpha-key',
                api: 'openai-responses'
            }
        }
    });

    assert.strictEqual(context.openclawQuick.providerName, 'alpha');
    assert.strictEqual(context.openclawQuick.baseUrl, 'https://alpha.example.com/v1');
    assert.strictEqual(context.openclawQuick.apiKey, 'alpha-key');
    assert.strictEqual(context.openclawQuick.apiType, 'openai-responses');
});

test('fillOpenclawQuickFromConfig falls back to the sole configured provider when primary provider is missing', () => {
    const context = {
        ...methods,
        openclawQuick: methods.getOpenclawQuickDefaults()
    };

    methods.fillOpenclawQuickFromConfig.call(context, {
        agents: {
            defaults: {
                model: {
                    primary: 'openai-codex/gpt-5.4'
                }
            }
        },
        models: {
            providers: {
                maxx: {
                    base_url: 'https://maxx.example.com/v1',
                    api_key: 'maxx-key',
                    api_type: 'openai-responses'
                }
            }
        }
    });

    assert.strictEqual(context.openclawQuick.providerName, 'maxx');
    assert.strictEqual(context.openclawQuick.baseUrl, 'https://maxx.example.com/v1');
    assert.strictEqual(context.openclawQuick.apiKey, 'maxx-key');
    assert.strictEqual(context.openclawQuick.apiType, 'openai-responses');
    assert.strictEqual(context.openclawQuick.modelId, 'gpt-5.4');
});

test('fillOpenclawQuickFromConfig resolves provider aliases with normalized lookup', () => {
    const context = {
        ...methods,
        openclawQuick: methods.getOpenclawQuickDefaults()
    };

    methods.fillOpenclawQuickFromConfig.call(context, {
        agents: {
            defaults: {
                model: {
                    primary: 'z.ai/glm-4.5'
                }
            }
        },
        models: {
            providers: {
                zai: {
                    baseUrl: 'https://zai.example.com/v1',
                    apiKey: 'zai-key',
                    api: 'openai-responses',
                    models: [
                        {
                            id: 'glm-4.5',
                            name: 'GLM 4.5'
                        }
                    ]
                }
            }
        }
    });

    assert.strictEqual(context.openclawQuick.providerName, 'zai');
    assert.strictEqual(context.openclawQuick.baseUrl, 'https://zai.example.com/v1');
    assert.strictEqual(context.openclawQuick.apiKey, 'zai-key');
    assert.strictEqual(context.openclawQuick.modelId, 'glm-4.5');
    assert.strictEqual(context.openclawQuick.modelName, 'GLM 4.5');
});

test('fillOpenclawQuickFromConfig treats alias-split provider maps as one configured provider', () => {
    const context = {
        ...methods,
        openclawQuick: methods.getOpenclawQuickDefaults()
    };

    methods.fillOpenclawQuickFromConfig.call(context, {
        models: {
            providers: {
                zai: {
                    models: [
                        {
                            id: 'glm-4.5',
                            name: 'GLM 4.5'
                        }
                    ]
                }
            }
        },
        providers: {
            'z.ai': {
                base_url: 'https://zai.example.com/v1',
                api_key: 'zai-key',
                api_type: 'openai-responses'
            }
        }
    });

    assert.strictEqual(context.openclawQuick.providerName, 'zai');
    assert.strictEqual(context.openclawQuick.baseUrl, 'https://zai.example.com/v1');
    assert.strictEqual(context.openclawQuick.apiKey, 'zai-key');
    assert.strictEqual(context.openclawQuick.modelId, 'glm-4.5');
    assert.strictEqual(context.openclawQuick.modelName, 'GLM 4.5');
});

test('fillOpenclawQuickFromConfig falls back to auth profile summary when provider config has no direct key', () => {
    const context = {
        ...methods,
        openclawQuick: methods.getOpenclawQuickDefaults(),
        openclawAuthProfilesByProvider: {
            'openai-codex': {
                provider: 'openai-codex',
                profileId: 'openai-codex:default',
                type: 'oauth',
                display: 'AuthProfile(oauth:openai-codex:default) · work@example.com'
            }
        }
    };

    methods.fillOpenclawQuickFromConfig.call(context, {
        agents: {
            defaults: {
                model: {
                    primary: 'openai-codex/gpt-5.4'
                }
            }
        },
        models: {
            providers: {
                'openai-codex': {
                    baseUrl: 'https://api.openai.com/v1',
                    api: 'openai-responses'
                }
            }
        }
    });

    assert.strictEqual(context.openclawQuick.providerName, 'openai-codex');
    assert.strictEqual(context.openclawQuick.baseUrl, 'https://api.openai.com/v1');
    assert.strictEqual(context.openclawQuick.apiKey, 'AuthProfile(oauth:openai-codex:default) · work@example.com');
    assert.strictEqual(context.openclawQuick.apiKeyReadOnly, true);
    assert.strictEqual(context.openclawQuick.apiKeyDisplayKind, 'auth-profile');
});

test('fillOpenclawQuickFromConfig resolves auth profile summaries through normalized provider aliases', () => {
    const context = {
        ...methods,
        openclawQuick: methods.getOpenclawQuickDefaults(),
        openclawAuthProfilesByProvider: {
            zai: {
                provider: 'zai',
                profileId: 'zai:default',
                type: 'api_key',
                display: 'AuthProfile(api_key:zai:default)'
            }
        }
    };

    methods.fillOpenclawQuickFromConfig.call(context, {
        agents: {
            defaults: {
                model: {
                    primary: 'z.ai/glm-4.5'
                }
            }
        },
        models: {
            providers: {
                zai: {
                    baseUrl: 'https://zai.example.com/v1',
                    api: 'openai-responses'
                }
            }
        }
    });

    assert.strictEqual(context.openclawQuick.providerName, 'zai');
    assert.strictEqual(context.openclawQuick.apiKey, 'AuthProfile(api_key:zai:default)');
    assert.strictEqual(context.openclawQuick.apiKeyReadOnly, true);
    assert.strictEqual(context.openclawQuick.apiKeyDisplayKind, 'auth-profile');
});

test('fillOpenclawQuickFromConfig renders structured SecretRef values as read-only labels', () => {
    const context = {
        ...methods,
        openclawQuick: methods.getOpenclawQuickDefaults()
    };

    methods.fillOpenclawQuickFromConfig.call(context, {
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
                    api: 'openai-responses'
                }
            }
        }
    });

    assert.strictEqual(context.openclawQuick.baseUrl, 'SecretRef(env:default:OPENAI_BASE_URL)');
    assert.strictEqual(context.openclawQuick.baseUrlReadOnly, true);
    assert.strictEqual(context.openclawQuick.apiKey, 'SecretRef(env:default:OPENAI_API_KEY)');
    assert.strictEqual(context.openclawQuick.apiKeyReadOnly, true);
});

test('fillOpenclawQuickFromConfig supports legacy SecretRef objects without provider and explicit keyRef fields', () => {
    const context = {
        ...methods,
        openclawQuick: methods.getOpenclawQuickDefaults()
    };

    methods.fillOpenclawQuickFromConfig.call(context, {
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
                    api: 'openai-responses'
                }
            }
        }
    });

    assert.strictEqual(context.openclawQuick.baseUrl, 'https://api.openai.com/v1');
    assert.strictEqual(context.openclawQuick.apiKey, 'SecretRef(env:default:OPENAI_API_KEY)');
    assert.strictEqual(context.openclawQuick.apiKeyReadOnly, true);
});

test('fillOpenclawQuickFromConfig does not mistake auth mode fields for api keys', () => {
    const context = {
        ...methods,
        openclawQuick: methods.getOpenclawQuickDefaults()
    };

    methods.fillOpenclawQuickFromConfig.call(context, {
        models: {
            providers: {
                openai: {
                    baseUrl: 'https://api.openai.com/v1',
                    auth: 'oauth',
                    preferred_auth_method: 'oauth',
                    api: 'openai-responses'
                }
            }
        }
    });

    assert.strictEqual(context.openclawQuick.providerName, 'openai');
    assert.strictEqual(context.openclawQuick.baseUrl, 'https://api.openai.com/v1');
    assert.strictEqual(context.openclawQuick.apiKey, '');
    assert.strictEqual(context.openclawQuick.apiKeyReadOnly, false);
});

test('formatProviderValue shows readable labels for env template and SecretRef inputs', () => {
    const context = { ...methods };

    assert.strictEqual(
        methods.formatProviderValue.call(context, 'apiKey', { source: 'env', provider: 'default', id: 'OPENAI_API_KEY' }),
        'SecretRef(env:default:OPENAI_API_KEY)'
    );
    assert.strictEqual(
        methods.formatProviderValue.call(context, 'apiKey', '${OPENAI_API_KEY}'),
        'EnvRef(OPENAI_API_KEY)'
    );
    assert.strictEqual(
        methods.formatProviderValue.call(context, 'keyRef', { source: 'env', id: 'OPENAI_API_KEY' }),
        'SecretRef(env:default:OPENAI_API_KEY)'
    );
});
