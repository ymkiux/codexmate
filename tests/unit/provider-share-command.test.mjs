import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const fs = require('fs');

const cliPath = path.join(__dirname, '..', '..', 'cli.js');
const appPath = path.join(__dirname, '..', '..', 'web-ui', 'app.js');
const cliSource = fs.readFileSync(cliPath, 'utf-8');
const appSource = fs.readFileSync(appPath, 'utf-8');

// NOTE: This extractor uses naive brace counting for speed in unit tests.
// It assumes target snippets do not contain confusing braces in strings,
// template literals, comments, or regex literals. If those patterns appear,
// switch to a tokenizer/AST-based extraction approach.
function extractBlockBySignature(source, signature) {
    const startIndex = source.indexOf(signature);
    if (startIndex === -1) {
        throw new Error(`Signature not found: ${signature}`);
    }
    const signatureBraceOffset = signature.lastIndexOf('{');
    const braceStart = signatureBraceOffset >= 0
        ? (startIndex + signatureBraceOffset)
        : source.indexOf('{', startIndex + signature.length);
    if (braceStart === -1) {
        throw new Error(`Opening brace not found for: ${signature}`);
    }
    let depth = 0;
    for (let i = braceStart; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(startIndex, i + 1);
            }
        }
    }
    throw new Error(`Closing brace not found for: ${signature}`);
}

function extractMethodAsFunction(source, signature, methodName) {
    const methodBlock = extractBlockBySignature(source, signature).trim();
    if (!methodBlock.startsWith(`${methodName}(`)) {
        throw new Error(`Method mismatch for ${methodName}`);
    }
    return `function ${methodBlock}`;
}

function instantiateFunction(funcSource, funcName, bindings = {}) {
    const bindingNames = Object.keys(bindings);
    const bindingValues = Object.values(bindings);
    return Function(...bindingNames, `${funcSource}\nreturn ${funcName};`)(...bindingValues);
}

function createProviderShareCommandBuilder(appSourceText) {
    const quoteShellArgSource = extractMethodAsFunction(appSourceText, 'quoteShellArg(value) {', 'quoteShellArg');
    const buildProviderShareCommandSource = extractMethodAsFunction(
        appSourceText,
        'buildProviderShareCommand(payload) {',
        'buildProviderShareCommand'
    );
    const quoteShellArg = instantiateFunction(quoteShellArgSource, 'quoteShellArg');
    const buildProviderShareCommand = instantiateFunction(buildProviderShareCommandSource, 'buildProviderShareCommand');
    return (payload) => buildProviderShareCommand.call({ quoteShellArg }, payload);
}

test('buildProviderSharePayload includes model for shared provider', () => {
    const source = extractBlockBySignature(cliSource, 'function buildProviderSharePayload(params = {}) {');
    const buildProviderSharePayload = instantiateFunction(source, 'buildProviderSharePayload', {
        readConfigOrVirtualDefault: () => ({
            config: {
                model_provider: 'alpha',
                model: 'alpha-fallback-model',
                model_providers: {
                    alpha: {
                        base_url: 'https://api.example.com/v1',
                        preferred_auth_method: 'sk-alpha'
                    }
                }
            }
        }),
        readCurrentModels: () => ({
            alpha: 'alpha-share-model'
        })
    });

    const result = buildProviderSharePayload({ name: 'alpha' });
    assert(result && result.payload, 'share payload should exist');
    assert.strictEqual(result.payload.model, 'alpha-share-model');
});

test('buildProviderSharePayload falls back to active model when saved model is empty', () => {
    const source = extractBlockBySignature(cliSource, 'function buildProviderSharePayload(params = {}) {');
    const buildProviderSharePayload = instantiateFunction(source, 'buildProviderSharePayload', {
        readConfigOrVirtualDefault: () => ({
            config: {
                model_provider: 'alpha',
                model: 'alpha-fallback-model',
                model_providers: {
                    alpha: {
                        base_url: 'https://api.example.com/v1',
                        preferred_auth_method: 'sk-alpha'
                    }
                }
            }
        }),
        readCurrentModels: () => ({
            alpha: '   '
        })
    });

    const result = buildProviderSharePayload({ name: 'alpha' });
    assert(result && result.payload, 'share payload should exist');
    assert.strictEqual(result.payload.model, 'alpha-fallback-model');
});

test('buildProviderShareCommand appends model switch command when model exists', () => {
    const buildProviderShareCommand = createProviderShareCommandBuilder(appSource);
    const command = buildProviderShareCommand({
        name: 'alpha',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-alpha',
        model: 'alpha-share-model'
    });

    assert.strictEqual(
        command,
        "codexmate add alpha 'https://api.example.com/v1' sk-alpha && codexmate switch alpha && codexmate use alpha-share-model"
    );
});

test('buildProviderShareCommand keeps legacy command when payload model is empty', () => {
    const buildProviderShareCommand = createProviderShareCommandBuilder(appSource);
    const command = buildProviderShareCommand({
        name: 'alpha',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-alpha',
        model: ''
    });

    assert.strictEqual(command, "codexmate add alpha 'https://api.example.com/v1' sk-alpha && codexmate switch alpha");
});

test('applyConfigTemplate rejects invalid positive integer context budget values', () => {
    const normalizePositiveIntegerParamSource = extractBlockBySignature(
        cliSource,
        'function normalizePositiveIntegerParam(value) {'
    );
    const normalizePositiveIntegerParam = instantiateFunction(
        normalizePositiveIntegerParamSource,
        'normalizePositiveIntegerParam'
    );
    const applyConfigTemplateSource = extractBlockBySignature(cliSource, 'function applyConfigTemplate(params = {}) {');
    let writeConfigCalls = 0;
    const applyConfigTemplate = instantiateFunction(applyConfigTemplateSource, 'applyConfigTemplate', {
        toml: require('@iarna/toml'),
        normalizePositiveIntegerParam,
        writeConfig() {
            writeConfigCalls += 1;
        },
        updateAuthJson() {},
        readModels() {
            return [];
        },
        writeModels() {},
        readCurrentModels() {
            return {};
        },
        writeCurrentModels() {},
        recordRecentConfig() {}
    });

    const invalidContextResult = applyConfigTemplate({
        template: `model_provider = "alpha"
model = "alpha-model"
model_context_window = 0

[model_providers.alpha]
preferred_auth_method = "sk-alpha"
`
    });
    const invalidAutoCompactResult = applyConfigTemplate({
        template: `model_provider = "alpha"
model = "alpha-model"
model_auto_compact_token_limit = "abc"

[model_providers.alpha]
preferred_auth_method = "sk-alpha"
`
    });

    assert.deepStrictEqual(invalidContextResult, { error: '模板中的 model_context_window 必须是正整数' });
    assert.deepStrictEqual(invalidAutoCompactResult, { error: '模板中的 model_auto_compact_token_limit 必须是正整数' });
    assert.strictEqual(writeConfigCalls, 0);
});

test('status api case keeps lexical declarations scoped to the switch branch', () => {
    assert.match(cliSource, /case 'status': \{/);
});

test('applyCodexConfigDirect queues the latest pending budget update while an apply is in flight', async () => {
    const applyCodexConfigDirectSource = extractBlockBySignature(
        appSource,
        'async applyCodexConfigDirect(options = {}) {'
    ).replace(/^async applyCodexConfigDirect/, 'async function applyCodexConfigDirect');
    let firstTemplateResolve = null;
    const templateRequests = [];
    const appliedTemplates = [];
    const applyCodexConfigDirect = instantiateFunction(applyCodexConfigDirectSource, 'applyCodexConfigDirect', {
        DEFAULT_MODEL_CONTEXT_WINDOW: 190000,
        DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT: 185000,
        api: async (action, params) => {
            if (action === 'get-config-template') {
                templateRequests.push(params);
                if (templateRequests.length === 1) {
                    return await new Promise((resolve) => {
                        firstTemplateResolve = resolve;
                    });
                }
                return { template: `template-${templateRequests.length}` };
            }
            if (action === 'apply-config-template') {
                appliedTemplates.push(params);
                return { success: true };
            }
            throw new Error(`Unexpected api action: ${action}`);
        }
    });

    const messages = [];
    let loadAllCalls = 0;
    const context = {
        codexApplying: false,
        _pendingCodexApplyOptions: null,
        currentProvider: 'alpha',
        currentModel: 'alpha-model',
        serviceTier: 'fast',
        modelReasoningEffort: 'high',
        modelContextWindowInput: '190000',
        modelAutoCompactTokenLimitInput: '185000',
        normalizePositiveIntegerInput(value, label, fallback = '') {
            const raw = value === undefined || value === null || value === ''
                ? String(fallback || '')
                : String(value);
            const text = raw.trim();
            const numeric = Number.parseInt(text, 10);
            if (!Number.isFinite(numeric) || numeric <= 0) {
                return { ok: false, error: `${label} invalid` };
            }
            return { ok: true, value: numeric, text: String(numeric) };
        },
        showMessage(message, type) {
            messages.push({ message, type });
        },
        async loadAll() {
            loadAllCalls += 1;
        }
    };
    context.applyCodexConfigDirect = applyCodexConfigDirect;

    const firstApply = applyCodexConfigDirect.call(context, {
        silent: true,
        modelContextWindow: 190000
    });
    await Promise.resolve();

    await applyCodexConfigDirect.call(context, {
        silent: true,
        modelAutoCompactTokenLimit: 175000
    });
    assert.deepStrictEqual(context._pendingCodexApplyOptions, {
        silent: true,
        modelAutoCompactTokenLimit: 175000
    });

    firstTemplateResolve({ template: 'template-1' });
    await firstApply;

    assert.strictEqual(templateRequests.length, 2);
    assert.strictEqual(templateRequests[1].modelContextWindow, 190000);
    assert.strictEqual(templateRequests[1].modelAutoCompactTokenLimit, 175000);
    assert.strictEqual(appliedTemplates.length, 2);
    assert.strictEqual(loadAllCalls, 2);
    assert.strictEqual(context._pendingCodexApplyOptions, null);
    assert.strictEqual(context.codexApplying, false);
    assert.deepStrictEqual(messages, []);
});
