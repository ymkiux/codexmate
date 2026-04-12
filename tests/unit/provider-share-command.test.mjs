import assert from 'assert';
import { createRequire } from 'module';
import {
    readBundledWebUiScript,
    readProjectFile
} from './helpers/web-ui-source.mjs';

const require = createRequire(import.meta.url);
const cliSource = readProjectFile('cli.js');
const appSource = readBundledWebUiScript();

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

function createProviderShareCommandBuilder(appSourceText, shareCommandPrefix = 'npm start') {
    const quoteShellArgSource = extractMethodAsFunction(appSourceText, 'quoteShellArg(value) {', 'quoteShellArg');
    const normalizeShareCommandPrefixSource = extractMethodAsFunction(appSourceText, 'normalizeShareCommandPrefix(value) {', 'normalizeShareCommandPrefix');
    const getShareCommandPrefixInvocationSource = extractMethodAsFunction(appSourceText, 'getShareCommandPrefixInvocation() {', 'getShareCommandPrefixInvocation');
    const buildProviderShareCommandSource = extractMethodAsFunction(
        appSourceText,
        'buildProviderShareCommand(payload) {',
        'buildProviderShareCommand'
    );
    const quoteShellArg = instantiateFunction(quoteShellArgSource, 'quoteShellArg');
    const normalizeShareCommandPrefix = instantiateFunction(normalizeShareCommandPrefixSource, 'normalizeShareCommandPrefix');
    const getShareCommandPrefixInvocation = instantiateFunction(getShareCommandPrefixInvocationSource, 'getShareCommandPrefixInvocation');
    const buildProviderShareCommand = instantiateFunction(buildProviderShareCommandSource, 'buildProviderShareCommand');
    return (payload) => buildProviderShareCommand.call({
        quoteShellArg,
        normalizeShareCommandPrefix,
        getShareCommandPrefixInvocation,
        shareCommandPrefix
    }, payload);
}

function createClaudeShareCommandBuilder(appSourceText, shareCommandPrefix = 'npm start') {
    const quoteShellArgSource = extractMethodAsFunction(appSourceText, 'quoteShellArg(value) {', 'quoteShellArg');
    const normalizeShareCommandPrefixSource = extractMethodAsFunction(appSourceText, 'normalizeShareCommandPrefix(value) {', 'normalizeShareCommandPrefix');
    const getShareCommandPrefixInvocationSource = extractMethodAsFunction(appSourceText, 'getShareCommandPrefixInvocation() {', 'getShareCommandPrefixInvocation');
    const buildClaudeShareCommandSource = extractMethodAsFunction(
        appSourceText,
        'buildClaudeShareCommand(payload) {',
        'buildClaudeShareCommand'
    );
    const quoteShellArg = instantiateFunction(quoteShellArgSource, 'quoteShellArg');
    const normalizeShareCommandPrefix = instantiateFunction(normalizeShareCommandPrefixSource, 'normalizeShareCommandPrefix');
    const getShareCommandPrefixInvocation = instantiateFunction(getShareCommandPrefixInvocationSource, 'getShareCommandPrefixInvocation');
    const buildClaudeShareCommand = instantiateFunction(buildClaudeShareCommandSource, 'buildClaudeShareCommand');
    return (payload) => buildClaudeShareCommand.call({
        quoteShellArg,
        normalizeShareCommandPrefix,
        getShareCommandPrefixInvocation,
        shareCommandPrefix
    }, payload);
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
        "npm start add alpha 'https://api.example.com/v1' sk-alpha && npm start switch alpha && npm start use alpha-share-model"
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

    assert.strictEqual(command, "npm start add alpha 'https://api.example.com/v1' sk-alpha && npm start switch alpha");
});

test('buildProviderShareCommand supports codexmate prefix', () => {
    const buildProviderShareCommand = createProviderShareCommandBuilder(appSource, 'codexmate');
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

test('buildClaudeShareCommand respects the configured share prefix', () => {
    const buildClaudeShareCommand = createClaudeShareCommandBuilder(appSource);
    const command = buildClaudeShareCommand({
        baseUrl: 'https://claude.example.com',
        apiKey: 'sk-claude',
        model: 'claude-3-7-sonnet'
    });

    assert.strictEqual(
        command,
        "npm start claude 'https://claude.example.com' sk-claude claude-3-7-sonnet"
    );
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
    let updateAuthJsonCalls = 0;
    let writeModelsCalls = 0;
    let writeCurrentModelsCalls = 0;
    let recordRecentConfigCalls = 0;
    const applyConfigTemplate = instantiateFunction(applyConfigTemplateSource, 'applyConfigTemplate', {
        toml: require('@iarna/toml'),
        normalizePositiveIntegerParam,
        writeConfig() {
            writeConfigCalls += 1;
        },
        updateAuthJson() {
            updateAuthJsonCalls += 1;
        },
        readModels() {
            return [];
        },
        writeModels() {
            writeModelsCalls += 1;
        },
        readCurrentModels() {
            return {};
        },
        writeCurrentModels() {
            writeCurrentModelsCalls += 1;
        },
        recordRecentConfig() {
            recordRecentConfigCalls += 1;
        }
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
    assert.strictEqual(updateAuthJsonCalls, 0);
    assert.strictEqual(writeModelsCalls, 0);
    assert.strictEqual(writeCurrentModelsCalls, 0);
    assert.strictEqual(recordRecentConfigCalls, 0);
});

test('getConfigTemplate restores missing context budget defaults for upgraded configs', () => {
    const normalizePositiveIntegerParamSource = extractBlockBySignature(
        cliSource,
        'function normalizePositiveIntegerParam(value) {'
    );
    const normalizePositiveIntegerParam = instantiateFunction(
        normalizePositiveIntegerParamSource,
        'normalizePositiveIntegerParam'
    );
    const applyPositiveIntegerConfigToTemplateSource = extractBlockBySignature(
        cliSource,
        'function applyPositiveIntegerConfigToTemplate(template, key, value) {'
    );
    const applyPositiveIntegerConfigToTemplate = instantiateFunction(
        applyPositiveIntegerConfigToTemplateSource,
        'applyPositiveIntegerConfigToTemplate',
        { normalizePositiveIntegerParam }
    );
    const getConfigTemplateSource = extractBlockBySignature(cliSource, 'function getConfigTemplate(params = {}) {');
    const getConfigTemplate = instantiateFunction(getConfigTemplateSource, 'getConfigTemplate', {
        fs: {
            existsSync() {
                return true;
            },
            readFileSync() {
                return `model_provider = "alpha"\nmodel = "alpha-model"\n`;
            }
        },
        CONFIG_FILE: '/tmp/config.toml',
        EMPTY_CONFIG_FALLBACK_TEMPLATE: '',
        normalizeTopLevelConfigWithTemplate(content) {
            return content;
        },
        applyServiceTierToTemplate(template) {
            return template;
        },
        applyReasoningEffortToTemplate(template) {
            return template;
        },
        applyPositiveIntegerConfigToTemplate,
        DEFAULT_MODEL_CONTEXT_WINDOW: 190000,
        DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT: 185000
    });

    const result = getConfigTemplate({});

    assert.match(result.template, /^\s*model_context_window\s*=\s*190000\s*$/m);
    assert.match(result.template, /^\s*model_auto_compact_token_limit\s*=\s*185000\s*$/m);
});

test('getConfigTemplate rejects explicit invalid context budget params', () => {
    const normalizePositiveIntegerParamSource = extractBlockBySignature(
        cliSource,
        'function normalizePositiveIntegerParam(value) {'
    );
    const normalizePositiveIntegerParam = instantiateFunction(
        normalizePositiveIntegerParamSource,
        'normalizePositiveIntegerParam'
    );
    const applyPositiveIntegerConfigToTemplateSource = extractBlockBySignature(
        cliSource,
        'function applyPositiveIntegerConfigToTemplate(template, key, value) {'
    );
    const applyPositiveIntegerConfigToTemplate = instantiateFunction(
        applyPositiveIntegerConfigToTemplateSource,
        'applyPositiveIntegerConfigToTemplate',
        { normalizePositiveIntegerParam }
    );
    const getConfigTemplateSource = extractBlockBySignature(cliSource, 'function getConfigTemplate(params = {}) {');
    const getConfigTemplate = instantiateFunction(getConfigTemplateSource, 'getConfigTemplate', {
        fs: {
            existsSync() {
                return false;
            },
            readFileSync() {
                return '';
            }
        },
        CONFIG_FILE: '/tmp/config.toml',
        EMPTY_CONFIG_FALLBACK_TEMPLATE: 'model_provider = "alpha"\nmodel = "alpha-model"\n',
        normalizeTopLevelConfigWithTemplate(content) {
            return content;
        },
        applyServiceTierToTemplate(template) {
            return template;
        },
        applyReasoningEffortToTemplate(template) {
            return template;
        },
        applyPositiveIntegerConfigToTemplate,
        normalizePositiveIntegerParam,
        DEFAULT_MODEL_CONTEXT_WINDOW: 190000,
        DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT: 185000
    });

    assert.deepStrictEqual(
        getConfigTemplate({ modelContextWindow: 0 }),
        { error: 'modelContextWindow must be a positive integer' }
    );
    assert.deepStrictEqual(
        getConfigTemplate({ modelAutoCompactTokenLimit: 'abc' }),
        { error: 'modelAutoCompactTokenLimit must be a positive integer' }
    );
});

test('getConfigTemplate preserves BOM and CRLF when restoring missing context budget defaults', () => {
    const normalizePositiveIntegerParamSource = extractBlockBySignature(
        cliSource,
        'function normalizePositiveIntegerParam(value) {'
    );
    const normalizePositiveIntegerParam = instantiateFunction(
        normalizePositiveIntegerParamSource,
        'normalizePositiveIntegerParam'
    );
    const applyPositiveIntegerConfigToTemplateSource = extractBlockBySignature(
        cliSource,
        'function applyPositiveIntegerConfigToTemplate(template, key, value) {'
    );
    const applyPositiveIntegerConfigToTemplate = instantiateFunction(
        applyPositiveIntegerConfigToTemplateSource,
        'applyPositiveIntegerConfigToTemplate',
        { normalizePositiveIntegerParam }
    );
    const getConfigTemplateSource = extractBlockBySignature(cliSource, 'function getConfigTemplate(params = {}) {');
    const getConfigTemplate = instantiateFunction(getConfigTemplateSource, 'getConfigTemplate', {
        fs: {
            existsSync() {
                return true;
            },
            readFileSync() {
                return '\uFEFFmodel_provider = "alpha"\r\nmodel = "alpha-model"\r\n';
            }
        },
        CONFIG_FILE: '/tmp/config.toml',
        EMPTY_CONFIG_FALLBACK_TEMPLATE: '',
        normalizeTopLevelConfigWithTemplate(content) {
            return content;
        },
        applyServiceTierToTemplate(template) {
            return template;
        },
        applyReasoningEffortToTemplate(template) {
            return template;
        },
        applyPositiveIntegerConfigToTemplate,
        DEFAULT_MODEL_CONTEXT_WINDOW: 190000,
        DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT: 185000
    });

    const result = getConfigTemplate({});

    assert.strictEqual(result.template.charCodeAt(0), 0xFEFF);
    assert(result.template.includes('model_auto_compact_token_limit = 185000\r\n'));
    assert(result.template.includes('model_context_window = 190000\r\n'));
    assert(!/(?<!\r)\n/.test(result.template), 'template should preserve CRLF line endings');
});

test('readPositiveIntegerConfigValue falls back to defaults only when budget keys are missing', () => {
    const normalizePositiveIntegerParamSource = extractBlockBySignature(
        cliSource,
        'function normalizePositiveIntegerParam(value) {'
    );
    const normalizePositiveIntegerParam = instantiateFunction(
        normalizePositiveIntegerParamSource,
        'normalizePositiveIntegerParam'
    );
    const readPositiveIntegerConfigValueSource = extractBlockBySignature(
        cliSource,
        'function readPositiveIntegerConfigValue(config, key) {'
    );
    const readPositiveIntegerConfigValue = instantiateFunction(
        readPositiveIntegerConfigValueSource,
        'readPositiveIntegerConfigValue',
        {
            normalizePositiveIntegerParam,
            DEFAULT_MODEL_CONTEXT_WINDOW: 190000,
            DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT: 185000
        }
    );

    assert.strictEqual(readPositiveIntegerConfigValue({}, 'model_context_window'), 190000);
    assert.strictEqual(readPositiveIntegerConfigValue({}, 'model_auto_compact_token_limit'), 185000);
    assert.strictEqual(readPositiveIntegerConfigValue({}, 'other_key'), '');
    assert.strictEqual(readPositiveIntegerConfigValue({ model_context_window: 0 }, 'model_context_window'), '');
});

test('buildMcpStatusPayload does not synthesize budget defaults after config load errors', () => {
    const normalizePositiveIntegerParamSource = extractBlockBySignature(
        cliSource,
        'function normalizePositiveIntegerParam(value) {'
    );
    const normalizePositiveIntegerParam = instantiateFunction(
        normalizePositiveIntegerParamSource,
        'normalizePositiveIntegerParam'
    );
    const readPositiveIntegerConfigValueSource = extractBlockBySignature(
        cliSource,
        'function readPositiveIntegerConfigValue(config, key) {'
    );
    const readPositiveIntegerConfigValue = instantiateFunction(
        readPositiveIntegerConfigValueSource,
        'readPositiveIntegerConfigValue',
        {
            normalizePositiveIntegerParam,
            DEFAULT_MODEL_CONTEXT_WINDOW: 190000,
            DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT: 185000
        }
    );
    const buildMcpStatusPayloadSource = extractBlockBySignature(
        cliSource,
        'function buildMcpStatusPayload() {'
    );
    const hasConfigLoadErrorSource = extractBlockBySignature(
        cliSource,
        'function hasConfigLoadError(result) {'
    );
    const hasConfigLoadError = instantiateFunction(
        hasConfigLoadErrorSource,
        'hasConfigLoadError'
    );
    const buildMcpStatusPayload = instantiateFunction(
        buildMcpStatusPayloadSource,
        'buildMcpStatusPayload',
        {
            readConfigOrVirtualDefault: () => ({
                config: {},
                isVirtual: true,
                errorType: 'parse',
                reason: 'config.toml 解析失败'
            }),
            hasConfigLoadError,
            readPositiveIntegerConfigValue,
            consumeInitNotice: () => ''
        }
    );

    const result = buildMcpStatusPayload();

    assert.strictEqual(result.modelContextWindow, '');
    assert.strictEqual(result.modelAutoCompactTokenLimit, '');
    assert.strictEqual(result.configErrorType, 'parse');
    assert.strictEqual(result.configNotice, 'config.toml 解析失败');
});

test('status api case does not synthesize budget defaults after config load errors', () => {
    const normalizePositiveIntegerParamSource = extractBlockBySignature(
        cliSource,
        'function normalizePositiveIntegerParam(value) {'
    );
    const normalizePositiveIntegerParam = instantiateFunction(
        normalizePositiveIntegerParamSource,
        'normalizePositiveIntegerParam'
    );
    const readPositiveIntegerConfigValueSource = extractBlockBySignature(
        cliSource,
        'function readPositiveIntegerConfigValue(config, key) {'
    );
    const readPositiveIntegerConfigValue = instantiateFunction(
        readPositiveIntegerConfigValueSource,
        'readPositiveIntegerConfigValue',
        {
            normalizePositiveIntegerParam,
            DEFAULT_MODEL_CONTEXT_WINDOW: 190000,
            DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT: 185000
        }
    );
    const hasConfigLoadErrorSource = extractBlockBySignature(
        cliSource,
        'function hasConfigLoadError(result) {'
    );
    const hasConfigLoadError = instantiateFunction(
        hasConfigLoadErrorSource,
        'hasConfigLoadError'
    );
    const statusCaseBlock = extractBlockBySignature(
        cliSource,
        "case 'status': {"
    )
        .replace(/^case\s+['"]status['"]:\s*/, '')
        .replace(/\bbreak;\s*(?=\}\s*$)/, '');
    const runStatusCase = instantiateFunction(
        `function runStatusCase() {
            let result;
            ${statusCaseBlock}
            return result;
        }`,
        'runStatusCase',
        {
            readConfigOrVirtualDefault: () => ({
                config: {},
                isVirtual: true,
                errorType: 'parse',
                reason: 'config.toml 解析失败'
            }),
            hasConfigLoadError,
            readPositiveIntegerConfigValue,
            consumeInitNotice: () => ''
        }
    );

    const result = runStatusCase();

    assert.strictEqual(result.modelContextWindow, '');
    assert.strictEqual(result.modelAutoCompactTokenLimit, '');
    assert.strictEqual(result.configErrorType, 'parse');
    assert.strictEqual(result.configNotice, 'config.toml 解析失败');
});

test('status api case keeps lexical declarations scoped to the switch branch', () => {
    assert.match(cliSource, /^\s*case\s+['"]status['"]:\s*\{/m);
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
        defaultModelContextWindow: 190000,
        defaultModelAutoCompactTokenLimit: 185000,
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
    const loadAllCalls = [];
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
        async loadAll(refreshOptions = {}) {
            loadAllCalls.push(refreshOptions);
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
    assert.strictEqual(appliedTemplates[0].template, 'template-1');
    assert.strictEqual(appliedTemplates[1].template, 'template-2');
    assert.deepStrictEqual(loadAllCalls, [
        { preserveLoading: true },
        { preserveLoading: true }
    ]);
    assert.strictEqual(context._pendingCodexApplyOptions, null);
    assert.strictEqual(context.codexApplying, false);
    assert.deepStrictEqual(messages, []);
});

test('loadAll preserves an unsaved codex budget draft while refreshing the sibling value', async () => {
    const loadAllSource = extractBlockBySignature(
        appSource,
        'async loadAll(options = {}) {'
    ).replace(/^async loadAll/, 'async function loadAll');
    const loadAll = instantiateFunction(loadAllSource, 'loadAll', {
        defaultModelContextWindow: 190000,
        defaultModelAutoCompactTokenLimit: 185000,
        api: async (action) => {
            if (action === 'status') {
                return {
                    provider: 'alpha',
                    model: 'alpha-model',
                    serviceTier: 'fast',
                    modelReasoningEffort: 'high',
                    modelContextWindow: 200000,
                    modelAutoCompactTokenLimit: 185000,
                    configReady: true,
                    initNotice: ''
                };
            }
            if (action === 'list') {
                return {
                    providers: [{ name: 'alpha', url: 'https://api.example.com/v1', hasKey: true }]
                };
            }
            throw new Error(`Unexpected api action: ${action}`);
        }
    });

    const context = {
        loading: false,
        initError: '',
        currentProvider: 'alpha',
        currentModel: 'alpha-model',
        serviceTier: 'fast',
        modelReasoningEffort: 'high',
        modelContextWindowInput: '190000',
        modelAutoCompactTokenLimitInput: '180000',
        editingCodexBudgetField: 'modelAutoCompactTokenLimitInput',
        providersList: [],
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
        showMessage() {},
        maybeShowStarPrompt() {},
        async loadModelsForProvider() {},
        async loadCodexAuthProfiles() {}
    };

    await loadAll.call(context);

    assert.strictEqual(context.modelContextWindowInput, '200000');
    assert.strictEqual(context.modelAutoCompactTokenLimitInput, '180000');
});

test('loadAll can refresh in background without flipping the global loading state', async () => {
    const loadAllSource = extractBlockBySignature(
        appSource,
        'async loadAll(options = {}) {'
    ).replace(/^async loadAll/, 'async function loadAll');
    const loadAll = instantiateFunction(loadAllSource, 'loadAll', {
        defaultModelContextWindow: 190000,
        defaultModelAutoCompactTokenLimit: 185000,
        api: async (action) => {
            if (action === 'status') {
                return {
                    provider: 'alpha',
                    model: 'alpha-model',
                    serviceTier: 'fast',
                    modelReasoningEffort: 'high',
                    modelContextWindow: 200000,
                    modelAutoCompactTokenLimit: 180000,
                    configReady: true,
                    initNotice: ''
                };
            }
            if (action === 'list') {
                return {
                    providers: [{ name: 'alpha', url: 'https://api.example.com/v1', hasKey: true }]
                };
            }
            throw new Error(`Unexpected api action: ${action}`);
        }
    });

    let loadingState = false;
    const loadingTransitions = [];
    const context = {
        get loading() {
            return loadingState;
        },
        set loading(value) {
            loadingTransitions.push(value);
            loadingState = value;
        },
        initError: 'stale',
        currentProvider: 'stale-provider',
        currentModel: 'stale-model',
        serviceTier: 'fast',
        modelReasoningEffort: 'high',
        modelContextWindowInput: '190000',
        modelAutoCompactTokenLimitInput: '185000',
        editingCodexBudgetField: '',
        providersList: [],
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
        showMessage() {},
        maybeShowStarPrompt() {},
        async loadModelsForProvider() {},
        async loadCodexAuthProfiles() {}
    };

    await loadAll.call(context, { preserveLoading: true });

    assert.deepStrictEqual(loadingTransitions, []);
    assert.strictEqual(loadingState, false);
    assert.strictEqual(context.currentProvider, 'alpha');
    assert.strictEqual(context.currentModel, 'alpha-model');
    assert.strictEqual(context.modelContextWindowInput, '200000');
    assert.strictEqual(context.modelAutoCompactTokenLimitInput, '180000');
    assert.strictEqual(context.initError, '');
});

test('loadAll falls back to medium for unsupported reasoning effort values while preserving xhigh', async () => {
    const loadAllSource = extractBlockBySignature(
        appSource,
        'async loadAll(options = {}) {'
    ).replace(/^async loadAll/, 'async function loadAll');
    const responses = [
        {
            provider: 'alpha',
            model: 'alpha-model',
            serviceTier: 'fast',
            modelReasoningEffort: 'bogus',
            modelContextWindow: 200000,
            modelAutoCompactTokenLimit: 180000,
            configReady: true,
            initNotice: ''
        },
        {
            provider: 'alpha',
            model: 'alpha-model',
            serviceTier: 'fast',
            modelReasoningEffort: 'xhigh',
            modelContextWindow: 200000,
            modelAutoCompactTokenLimit: 180000,
            configReady: true,
            initNotice: ''
        }
    ];
    let statusIndex = 0;
    const loadAll = instantiateFunction(loadAllSource, 'loadAll', {
        defaultModelContextWindow: 190000,
        defaultModelAutoCompactTokenLimit: 185000,
        api: async (action) => {
            if (action === 'status') {
                return responses[statusIndex++] || responses[responses.length - 1];
            }
            if (action === 'list') {
                return {
                    providers: [{ name: 'alpha', url: 'https://api.example.com/v1', hasKey: true }]
                };
            }
            throw new Error(`Unexpected api action: ${action}`);
        }
    });

    const createContext = () => ({
        loading: false,
        initError: '',
        currentProvider: 'stale-provider',
        currentModel: 'stale-model',
        serviceTier: 'fast',
        modelReasoningEffort: 'high',
        modelContextWindowInput: '190000',
        modelAutoCompactTokenLimitInput: '185000',
        editingCodexBudgetField: '',
        providersList: [],
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
        showMessage() {},
        maybeShowStarPrompt() {},
        async loadModelsForProvider() {},
        async loadCodexAuthProfiles() {}
    });

    const invalidContext = createContext();
    await loadAll.call(invalidContext);
    assert.strictEqual(invalidContext.modelReasoningEffort, 'medium');

    const xhighContext = createContext();
    await loadAll.call(xhighContext);
    assert.strictEqual(xhighContext.modelReasoningEffort, 'xhigh');
});

test('loadAll treats provider list fetch failures as startup errors and skips model refresh', async () => {
    const loadAllSource = extractBlockBySignature(
        appSource,
        'async loadAll(options = {}) {'
    ).replace(/^async loadAll/, 'async function loadAll');
    const loadAll = instantiateFunction(loadAllSource, 'loadAll', {
        defaultModelContextWindow: 190000,
        defaultModelAutoCompactTokenLimit: 185000,
        api: async (action) => {
            if (action === 'status') {
                return {
                    provider: 'alpha',
                    model: 'alpha-model',
                    serviceTier: 'fast',
                    modelReasoningEffort: 'high',
                    modelContextWindow: 200000,
                    modelAutoCompactTokenLimit: 180000
                };
            }
            if (action === 'list') {
                return { error: 'list failed' };
            }
            throw new Error(`Unexpected api action: ${action}`);
        }
    });

    const calls = [];
    const context = {
        loading: false,
        initError: '',
        currentProvider: 'stale-provider',
        currentModel: 'stale-model',
        serviceTier: 'fast',
        modelReasoningEffort: 'high',
        modelContextWindowInput: '190000',
        modelAutoCompactTokenLimitInput: '185000',
        editingCodexBudgetField: '',
        providersList: ['stale-provider'],
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
        showMessage() {},
        maybeShowStarPrompt() {
            calls.push('star');
        },
        async loadModelsForProvider() {
            calls.push('models');
        },
        async loadCodexAuthProfiles() {
            calls.push('auth');
        }
    };

    await loadAll.call(context);

    assert.strictEqual(context.initError, 'list failed');
    assert.deepStrictEqual(context.providersList, ['stale-provider']);
    assert.deepStrictEqual(calls, ['auth']);
});

test('applyCodexConfigDirect preserves a focused sibling budget draft across the loadAll refresh', async () => {
    const loadAllSource = extractBlockBySignature(
        appSource,
        'async loadAll(options = {}) {'
    ).replace(/^async loadAll/, 'async function loadAll');
    const loadAll = instantiateFunction(loadAllSource, 'loadAll', {
        defaultModelContextWindow: 190000,
        defaultModelAutoCompactTokenLimit: 185000,
        api: async (action) => {
            if (action === 'status') {
                return {
                    provider: 'alpha',
                    model: 'alpha-model',
                    serviceTier: 'fast',
                    modelReasoningEffort: 'high',
                    modelContextWindow: 200000,
                    modelAutoCompactTokenLimit: 185000,
                    configReady: true,
                    initNotice: ''
                };
            }
            if (action === 'list') {
                return {
                    providers: [{ name: 'alpha', url: 'https://api.example.com/v1', hasKey: true }]
                };
            }
            throw new Error(`Unexpected loadAll api action: ${action}`);
        }
    });
    const applyCodexConfigDirectSource = extractBlockBySignature(
        appSource,
        'async applyCodexConfigDirect(options = {}) {'
    ).replace(/^async applyCodexConfigDirect/, 'async function applyCodexConfigDirect');
    let firstTemplateResolve = null;
    const applyCodexConfigDirect = instantiateFunction(
        applyCodexConfigDirectSource,
        'applyCodexConfigDirect',
        {
            defaultModelContextWindow: 190000,
            defaultModelAutoCompactTokenLimit: 185000,
            api: async (action, params) => {
                if (action === 'get-config-template') {
                    return await new Promise((resolve) => {
                        firstTemplateResolve = resolve;
                    });
                }
                if (action === 'apply-config-template') {
                    assert.deepStrictEqual(params, { template: 'template-1' });
                    return { success: true };
                }
                throw new Error(`Unexpected apply api action: ${action}`);
            }
        }
    );

    const context = {
        loading: false,
        initError: '',
        codexApplying: false,
        _pendingCodexApplyOptions: null,
        currentProvider: 'alpha',
        currentModel: 'alpha-model',
        serviceTier: 'fast',
        modelReasoningEffort: 'high',
        modelContextWindowInput: '190000',
        modelAutoCompactTokenLimitInput: '185000',
        editingCodexBudgetField: '',
        providersList: [],
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
        showMessage() {},
        maybeShowStarPrompt() {},
        async loadModelsForProvider() {},
        async loadCodexAuthProfiles() {}
    };
    context.loadAll = loadAll;
    context.applyCodexConfigDirect = applyCodexConfigDirect;

    const firstApply = applyCodexConfigDirect.call(context, {
        silent: true,
        modelContextWindow: 200000
    });
    await Promise.resolve();

    context.editingCodexBudgetField = 'modelAutoCompactTokenLimitInput';
    context.modelAutoCompactTokenLimitInput = '180000';

    firstTemplateResolve({ template: 'template-1' });
    await firstApply;

    assert.strictEqual(context.modelContextWindowInput, '200000');
    assert.strictEqual(context.modelAutoCompactTokenLimitInput, '180000');
    assert.strictEqual(context.editingCodexBudgetField, 'modelAutoCompactTokenLimitInput');
});

test('applyCodexConfigDirect surfaces backend validation details from direct apply failures', async () => {
    const applyCodexConfigDirectSource = extractBlockBySignature(
        appSource,
        'async applyCodexConfigDirect(options = {}) {'
    ).replace(/^async applyCodexConfigDirect/, 'async function applyCodexConfigDirect');
    const messages = [];
    const applyCodexConfigDirect = instantiateFunction(applyCodexConfigDirectSource, 'applyCodexConfigDirect', {
        defaultModelContextWindow: 190000,
        defaultModelAutoCompactTokenLimit: 185000,
        api: async (action) => {
            if (action === 'get-config-template') {
                return { error: '模板中的 model_context_window 必须是正整数' };
            }
            throw new Error(`Unexpected api action: ${action}`);
        }
    });

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
            throw new Error('loadAll should not be called when template generation fails');
        }
    };

    await applyCodexConfigDirect.call(context, { silent: true });

    assert.deepStrictEqual(messages, [{
        message: '模板中的 model_context_window 必须是正整数',
        type: 'error'
    }]);
    assert.strictEqual(context.codexApplying, false);
    assert.strictEqual(context._pendingCodexApplyOptions, null);
});

test('applyConfigTemplate rejects missing provider blocks instead of synthesizing local', () => {
    const normalizePositiveIntegerParamSource = extractBlockBySignature(
        cliSource,
        'function normalizePositiveIntegerParam(value) {'
    );
    const applyConfigTemplateSource = extractBlockBySignature(cliSource, 'function applyConfigTemplate(params = {}) {');
    const applyConfigTemplate = instantiateFunction(applyConfigTemplateSource, 'applyConfigTemplate', {
        toml: require('@iarna/toml'),
        normalizePositiveIntegerParam: instantiateFunction(normalizePositiveIntegerParamSource, 'normalizePositiveIntegerParam'),
        writeConfig() {
            throw new Error('should not write config');
        },
        updateAuthJson() {
            throw new Error('should not update auth');
        },
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

    const result = applyConfigTemplate({
        template: [
            'model_provider = "local"',
            'model = "gpt-5"',
            '',
            '[model_providers.openai]',
            'base_url = "https://api.openai.com/v1"',
            'preferred_auth_method = ""'
        ].join('\n')
    });

    assert.deepStrictEqual(result, { error: '模板中找不到当前 provider: local' });
});

test('buildMcpProviderListPayload keeps regular providers editable', () => {
    const buildMcpProviderListPayloadSource = extractBlockBySignature(
        cliSource,
        'function buildMcpProviderListPayload() {'
    );
    const buildMcpProviderListPayload = instantiateFunction(
        buildMcpProviderListPayloadSource,
        'buildMcpProviderListPayload',
        {
            readConfigOrVirtualDefault: () => ({
                isVirtual: false,
                errorType: '',
                reason: '',
                config: {
                    model_provider: 'openai',
                    model_providers: {
                        openai: {
                            base_url: 'https://api.openai.com/v1',
                            preferred_auth_method: 'sk-live',
                            models: [
                                {
                                    id: 'gpt-5.3-codex',
                                    name: 'GPT-5.3 Codex',
                                    cost: {
                                        input: 2,
                                        output: 8,
                                        cacheRead: 0.5,
                                        cacheWrite: 0
                                    },
                                    contextWindow: 256000,
                                    maxTokens: 8192
                                }
                            ]
                        }
                    }
                }
            }),
            maskKey: (value) => value ? '***' : '',
            isBuiltinManagedProvider: () => false,
            isNonDeletableProvider: () => false,
            isNonEditableProvider: () => false
        }
    );

    const payload = buildMcpProviderListPayload();
    const openai = payload.providers.find((item) => item.name === 'openai');

    assert.ok(openai, 'regular provider should remain present');
    assert.strictEqual(openai.readOnly, false);
    assert.strictEqual(openai.nonEditable, false);
    assert.strictEqual(openai.nonDeletable, false);
    assert.strictEqual(openai.current, true);
    assert.deepStrictEqual(openai.models, [
        {
            id: 'gpt-5.3-codex',
            name: 'GPT-5.3 Codex',
            cost: {
                input: 2,
                output: 8,
                cacheRead: 0.5,
                cacheWrite: 0
            },
            contextWindow: 256000,
            maxTokens: 8192
        }
    ]);
});

test('applyCodexConfigDirect applies provider config without local proxy indirection', async () => {
    const applyCodexConfigDirectSource = extractBlockBySignature(
        appSource,
        'async applyCodexConfigDirect(options = {}) {'
    ).replace(/^async applyCodexConfigDirect/, 'async function applyCodexConfigDirect');
    const apiCalls = [];
    const applyCodexConfigDirect = instantiateFunction(applyCodexConfigDirectSource, 'applyCodexConfigDirect', {
        defaultModelContextWindow: 190000,
        defaultModelAutoCompactTokenLimit: 185000,
        hasResponseError: (response) => !!(response && response.error),
        getResponseMessage: (response, fallback) => (response && response.error) || fallback,
        api: async (action, params) => {
            apiCalls.push({ action, params });
            if (action === 'get-config-template') return { template: 'template-local' };
            if (action === 'apply-config-template') return { success: true };
            throw new Error(`Unexpected api action: ${action}`);
        }
    });

    const context = {
        codexApplying: false,
        _pendingCodexApplyOptions: null,
        currentProvider: 'openai',
        currentModel: 'gpt-5',
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
        showMessage() {},
        async loadAll() {}
    };

    await applyCodexConfigDirect.call(context, { silent: true });

    assert.deepStrictEqual(apiCalls.map((item) => item.action), [
        'get-config-template',
        'apply-config-template'
    ]);
});
