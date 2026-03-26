import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appPath = path.join(__dirname, '..', '..', 'web-ui', 'app.js');
const appSource = fs.readFileSync(appPath, 'utf-8');

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
    const source = extractMethodAsFunction(appSource, 'buildClaudeImportedConfigName(baseUrl) {', 'buildClaudeImportedConfigName');
    const buildClaudeImportedConfigName = instantiateFunction(source, 'buildClaudeImportedConfigName', { URL });
    const name = buildClaudeImportedConfigName('https://maxx-direct.cloverstd.com/project/ym/111');
    assert.strictEqual(name, '导入-maxx-direct.cloverstd.com');
});

test('ensureClaudeConfigFromSettings creates imported config for unmatched Claude settings', () => {
    const source = extractMethodAsFunction(appSource, 'ensureClaudeConfigFromSettings(env = {}) {', 'ensureClaudeConfigFromSettings');
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
        hasKey: true
    });
});

test('refreshClaudeSelectionFromSettings selects imported config when settings mismatch existing list', async () => {
    const source = extractMethodAsFunction(
        appSource,
        'async refreshClaudeSelectionFromSettings(options = {}) {',
        'refreshClaudeSelectionFromSettings'
    );
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
