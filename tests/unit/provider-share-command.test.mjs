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

test('buildProviderShareCommand appends model switch command when model exists', () => {
    const quoteShellArgSource = extractMethodAsFunction(appSource, 'quoteShellArg(value) {', 'quoteShellArg');
    const buildProviderShareCommandSource = extractMethodAsFunction(
        appSource,
        'buildProviderShareCommand(payload) {',
        'buildProviderShareCommand'
    );
    const quoteShellArg = instantiateFunction(quoteShellArgSource, 'quoteShellArg');
    const buildProviderShareCommand = instantiateFunction(buildProviderShareCommandSource, 'buildProviderShareCommand');

    const command = buildProviderShareCommand.call(
        { quoteShellArg },
        {
            name: 'alpha',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'sk-alpha',
            model: 'alpha-share-model'
        }
    );

    assert.strictEqual(
        command,
        "codexmate add alpha 'https://api.example.com/v1' sk-alpha && codexmate switch alpha && codexmate use alpha-share-model"
    );
});

test('buildProviderShareCommand keeps legacy command when payload model is empty', () => {
    const quoteShellArgSource = extractMethodAsFunction(appSource, 'quoteShellArg(value) {', 'quoteShellArg');
    const buildProviderShareCommandSource = extractMethodAsFunction(
        appSource,
        'buildProviderShareCommand(payload) {',
        'buildProviderShareCommand'
    );
    const quoteShellArg = instantiateFunction(quoteShellArgSource, 'quoteShellArg');
    const buildProviderShareCommand = instantiateFunction(buildProviderShareCommandSource, 'buildProviderShareCommand');

    const command = buildProviderShareCommand.call(
        { quoteShellArg },
        {
            name: 'alpha',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'sk-alpha',
            model: ''
        }
    );

    assert.strictEqual(command, "codexmate add alpha 'https://api.example.com/v1' sk-alpha && codexmate switch alpha");
});
