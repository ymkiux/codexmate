import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appPath = path.join(__dirname, '..', '..', 'web-ui', 'app.js');
const appSource = fs.readFileSync(appPath, 'utf-8');

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatchingBraceRespectingSyntax(source, braceStart) {
    let depth = 0;
    const contexts = [];
    const topContext = () => contexts[contexts.length - 1];

    for (let i = braceStart; i < source.length; i += 1) {
        const ch = source[i];
        const next = source[i + 1];
        const ctx = topContext();

        if (!ctx) {
            if (ch === '\'') {
                contexts.push({ type: 'single', escape: false });
                continue;
            }
            if (ch === '"') {
                contexts.push({ type: 'double', escape: false });
                continue;
            }
            if (ch === '`') {
                contexts.push({ type: 'templateString', escape: false });
                continue;
            }
            if (ch === '/' && next === '/') {
                contexts.push({ type: 'lineComment' });
                i += 1;
                continue;
            }
            if (ch === '/' && next === '*') {
                contexts.push({ type: 'blockComment' });
                i += 1;
                continue;
            }
            if (ch === '{') {
                depth += 1;
                continue;
            }
            if (ch === '}') {
                depth -= 1;
                if (depth === 0) {
                    return i;
                }
            }
            continue;
        }

        if (ctx.type === 'single' || ctx.type === 'double') {
            if (ctx.escape) {
                ctx.escape = false;
                continue;
            }
            if (ch === '\\') {
                ctx.escape = true;
                continue;
            }
            const target = ctx.type === 'single' ? '\'' : '"';
            if (ch === target) {
                contexts.pop();
            }
            continue;
        }

        if (ctx.type === 'lineComment') {
            if (ch === '\n') {
                contexts.pop();
            }
            continue;
        }

        if (ctx.type === 'blockComment') {
            if (ch === '*' && next === '/') {
                contexts.pop();
                i += 1;
            }
            continue;
        }

        if (ctx.type === 'templateString') {
            if (ctx.escape) {
                ctx.escape = false;
                continue;
            }
            if (ch === '\\') {
                ctx.escape = true;
                continue;
            }
            if (ch === '`') {
                contexts.pop();
                continue;
            }
            if (ch === '$' && next === '{') {
                contexts.push({ type: 'templateExpr', depth: 1 });
                i += 1;
            }
            continue;
        }

        if (ctx.type === 'templateExpr') {
            if (ch === '\'') {
                contexts.push({ type: 'single', escape: false });
                continue;
            }
            if (ch === '"') {
                contexts.push({ type: 'double', escape: false });
                continue;
            }
            if (ch === '`') {
                contexts.push({ type: 'templateString', escape: false });
                continue;
            }
            if (ch === '/' && next === '/') {
                contexts.push({ type: 'lineComment' });
                i += 1;
                continue;
            }
            if (ch === '/' && next === '*') {
                contexts.push({ type: 'blockComment' });
                i += 1;
                continue;
            }
            if (ch === '{') {
                ctx.depth += 1;
                continue;
            }
            if (ch === '}') {
                ctx.depth -= 1;
                if (ctx.depth === 0) {
                    contexts.pop();
                }
            }
        }
    }

    throw new Error('Closing brace not found for method block');
}

function extractBlockByMethodName(source, methodName) {
    const name = String(methodName || '').trim();
    if (!name) {
        throw new Error('Method name is required');
    }

    const pattern = new RegExp(
        `(?:^|\\n)([\\t ]*(?:async\\s+)?${escapeRegExp(name)}\\s*\\([^)]*\\)\\s*\\{)`,
        'm'
    );
    const match = pattern.exec(source);
    if (!match) {
        throw new Error(`Method signature not found: ${name}`);
    }
    const signatureText = match[1];
    const startIndex = match.index + match[0].lastIndexOf(signatureText);
    const braceStart = startIndex + signatureText.lastIndexOf('{');
    if (braceStart < 0) {
        throw new Error(`Opening brace not found for: ${name}`);
    }

    const endIndex = findMatchingBraceRespectingSyntax(source, braceStart);
    return source.slice(startIndex, endIndex + 1);
}

function extractMethodAsFunction(source, methodName) {
    const methodBlock = extractBlockByMethodName(source, methodName).trim();
    if (!methodBlock.startsWith(`${methodName}(`) && !methodBlock.startsWith(`async ${methodName}(`)) {
        throw new Error(`Method mismatch for ${methodName}`);
    }
    if (methodBlock.startsWith(`async ${methodName}(`)) {
        return `async function ${methodBlock.slice('async '.length)}`;
    }
    return `function ${methodBlock}`;
}

function instantiateFunction(funcSource, funcName, bindings = {}) {
    const bindingNames = Object.keys(bindings);
    const bindingValues = Object.values(bindings);
    return Function(...bindingNames, `${funcSource}\nreturn ${funcName};`)(...bindingValues);
}

test('buildClaudeImportedConfigName derives host-based fallback name', () => {
    const source = extractMethodAsFunction(appSource, 'buildClaudeImportedConfigName');
    const buildClaudeImportedConfigName = instantiateFunction(source, 'buildClaudeImportedConfigName', { URL });
    const name = buildClaudeImportedConfigName('https://maxx-direct.cloverstd.com/project/ym/111');
    assert.strictEqual(name, '导入-maxx-direct.cloverstd.com');
});

test('ensureClaudeConfigFromSettings creates imported config for unmatched Claude settings', () => {
    const source = extractMethodAsFunction(appSource, 'ensureClaudeConfigFromSettings');
    const ensureClaudeConfigFromSettings = instantiateFunction(source, 'ensureClaudeConfigFromSettings');

    let saveCount = 0;
    const context = {
        claudeConfigs: {
            '智谱GLM': {
                apiKey: '',
                baseUrl: 'https://open.bigmodel.cn/api/anthropic',
                model: 'glm-4.7',
                hasKey: false
            }
        },
        normalizeClaudeSettingsEnv: (env = {}) => ({
            apiKey: typeof env.ANTHROPIC_API_KEY === 'string' ? env.ANTHROPIC_API_KEY.trim() : '',
            baseUrl: typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL.trim() : '',
            model: typeof env.ANTHROPIC_MODEL === 'string' ? env.ANTHROPIC_MODEL.trim() : ''
        }),
        findDuplicateClaudeConfigName: () => '',
        buildClaudeImportedConfigName: () => '导入-maxx-direct.cloverstd.com',
        saveClaudeConfigs: () => {
            saveCount += 1;
        }
    };

    const result = ensureClaudeConfigFromSettings.call(context, {
        ANTHROPIC_API_KEY: 'maxx-key',
        ANTHROPIC_BASE_URL: 'https://maxx-direct.cloverstd.com/project/ym/111',
        ANTHROPIC_MODEL: 'claude-opus-4-6'
    });

    assert.strictEqual(result, '导入-maxx-direct.cloverstd.com');
    assert.strictEqual(saveCount, 1);
    assert.deepStrictEqual(context.claudeConfigs[result], {
        apiKey: 'maxx-key',
        baseUrl: 'https://maxx-direct.cloverstd.com/project/ym/111',
        model: 'claude-opus-4-6',
        hasKey: true,
        externalCredentialType: ''
    });
});

test('refreshClaudeSelectionFromSettings selects imported config when settings mismatch existing list', async () => {
    const source = extractMethodAsFunction(appSource, 'refreshClaudeSelectionFromSettings');
    const refreshClaudeSelectionFromSettings = instantiateFunction(source, 'refreshClaudeSelectionFromSettings', {
        api: async () => ({
            exists: true,
            env: {
                ANTHROPIC_API_KEY: 'maxx-key',
                ANTHROPIC_BASE_URL: 'https://maxx-direct.cloverstd.com/project/ym/111',
                ANTHROPIC_MODEL: 'claude-opus-4-6'
            }
        })
    });

    let refreshCount = 0;
    const messages = [];
    const context = {
        claudeConfigs: {
            '智谱GLM': {
                apiKey: '',
                baseUrl: 'https://open.bigmodel.cn/api/anthropic',
                model: 'glm-4.7',
                hasKey: false
            }
        },
        currentClaudeConfig: '',
        currentClaudeModel: '',
        matchClaudeConfigFromSettings: () => '',
        ensureClaudeConfigFromSettings: function () {
            this.claudeConfigs['导入-maxx-direct.cloverstd.com'] = {
                apiKey: 'maxx-key',
                baseUrl: 'https://maxx-direct.cloverstd.com/project/ym/111',
                model: 'claude-opus-4-6',
                hasKey: true
            };
            return '导入-maxx-direct.cloverstd.com';
        },
        refreshClaudeModelContext: () => {
            refreshCount += 1;
        },
        resetClaudeModelsState: () => {
            throw new Error('should not reset when import succeeds');
        },
        showMessage: (msg, type) => messages.push({ msg, type })
    };

    await refreshClaudeSelectionFromSettings.call(context, { silent: true });
    assert.strictEqual(context.currentClaudeConfig, '导入-maxx-direct.cloverstd.com');
    assert.strictEqual(refreshCount, 1);
    assert.deepStrictEqual(messages, []);
});

test('ensureClaudeConfigFromSettings imports external auth-token backed Claude settings', () => {
    const source = extractMethodAsFunction(appSource, 'ensureClaudeConfigFromSettings');
    const ensureClaudeConfigFromSettings = instantiateFunction(source, 'ensureClaudeConfigFromSettings');

    let saveCount = 0;
    const context = {
        claudeConfigs: {},
        normalizeClaudeSettingsEnv: (env = {}) => ({
            apiKey: typeof env.ANTHROPIC_API_KEY === 'string' ? env.ANTHROPIC_API_KEY.trim() : '',
            baseUrl: typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL.trim() : '',
            model: typeof env.ANTHROPIC_MODEL === 'string' ? env.ANTHROPIC_MODEL.trim() : '',
            authToken: typeof env.ANTHROPIC_AUTH_TOKEN === 'string' ? env.ANTHROPIC_AUTH_TOKEN.trim() : '',
            useKey: typeof env.CLAUDE_CODE_USE_KEY === 'string' ? env.CLAUDE_CODE_USE_KEY.trim() : ''
        }),
        findDuplicateClaudeConfigName: () => '',
        buildClaudeImportedConfigName: () => '导入-api.anthropic.com',
        saveClaudeConfigs: () => {
            saveCount += 1;
        }
    };

    const result = ensureClaudeConfigFromSettings.call(context, {
        ANTHROPIC_AUTH_TOKEN: 'anth-token',
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        ANTHROPIC_MODEL: 'claude-3-7-sonnet'
    });

    assert.strictEqual(result, '导入-api.anthropic.com');
    assert.strictEqual(saveCount, 1);
    assert.deepStrictEqual(context.claudeConfigs[result], {
        apiKey: '',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-3-7-sonnet',
        hasKey: true,
        externalCredentialType: 'auth-token'
    });
});

test('applyClaudeConfig reports informative message for external credential only config', async () => {
    const source = extractMethodAsFunction(appSource, 'applyClaudeConfig');
    const applyClaudeConfig = instantiateFunction(source, 'applyClaudeConfig', {
        api: async () => {
            throw new Error('should not call apply api without apiKey');
        }
    });

    const messages = [];
    let refreshCount = 0;
    const context = {
        claudeConfigs: {
            imported: {
                apiKey: '',
                baseUrl: 'https://api.anthropic.com',
                model: 'claude-3-7-sonnet',
                hasKey: true,
                externalCredentialType: 'auth-token'
            }
        },
        currentClaudeConfig: '',
        refreshClaudeModelContext: () => {
            refreshCount += 1;
        },
        showMessage: (msg, type) => {
            messages.push({ msg, type });
            return { msg, type };
        }
    };

    const result = await applyClaudeConfig.call(context, 'imported');
    assert.strictEqual(context.currentClaudeConfig, 'imported');
    assert.strictEqual(refreshCount, 1);
    assert.deepStrictEqual(messages, [{ msg: '检测到外部 Claude 认证状态；当前仅支持展示，若需由 codexmate 接管请补充 API Key', type: 'info' }]);
    assert.deepStrictEqual(result, messages[0]);
});
