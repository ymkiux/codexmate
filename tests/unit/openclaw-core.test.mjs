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
                preferred_auth_method: 'sk-live',
                api_type: 'openai-chat'
            }
        }
    });

    assert.deepStrictEqual(context.openclawQuick, {
        ...methods.getOpenclawQuickDefaults(),
        providerName: 'maxx',
        baseUrl: 'https://provider.example.com/v1',
        apiKey: 'sk-live',
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
