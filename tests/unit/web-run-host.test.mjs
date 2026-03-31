import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const fs = require('fs');

const cliPath = path.join(__dirname, '..', '..', 'cli.js');
const cliContent = fs.readFileSync(cliPath, 'utf-8');

function findMatchingBrace(source, startIndex) {
    let depth = 0;
    let quote = '';
    let escape = false;
    let inLineComment = false;
    let inBlockComment = false;
    let templateDepth = 0;

    for (let index = startIndex; index < source.length; index += 1) {
        const char = source[index];
        const next = source[index + 1];
        const prev = source[index - 1];

        if (inLineComment) {
            if (char === '\n') inLineComment = false;
            continue;
        }
        if (inBlockComment) {
            if (prev === '*' && char === '/') inBlockComment = false;
            continue;
        }
        if (quote) {
            if (escape) {
                escape = false;
                continue;
            }
            if (char === '\\') {
                escape = true;
                continue;
            }
            if (quote === '`') {
                if (char === '$' && next === '{') {
                    templateDepth += 1;
                    depth += 1;
                    index += 1;
                    continue;
                }
                if (char === '}' && templateDepth > 0) {
                    templateDepth -= 1;
                    depth -= 1;
                    continue;
                }
            }
            if (char === quote && templateDepth === 0) {
                quote = '';
            }
            continue;
        }

        if (char === '/' && next === '/') {
            inLineComment = true;
            index += 1;
            continue;
        }
        if (char === '/' && next === '*') {
            inBlockComment = true;
            index += 1;
            continue;
        }
        if (char === '\'' || char === '"' || char === '`') {
            quote = char;
            continue;
        }
        if (char === '{') {
            depth += 1;
            continue;
        }
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }

    throw new Error('Matching brace not found');
}

function extractFunctionBySignature(source, signature, funcName) {
    const startIndex = source.indexOf(signature);
    if (startIndex === -1) {
        throw new Error(`Signature not found: ${signature}`);
    }
    const signatureBraceOffset = signature.lastIndexOf('{');
    const braceStart = signatureBraceOffset >= 0
        ? (startIndex + signatureBraceOffset)
        : source.indexOf('{', startIndex + signature.length);
    const endIndex = findMatchingBrace(source, braceStart);
    const block = source.slice(startIndex, endIndex + 1).trim();
    return `${block}\nreturn ${funcName};`;
}

function instantiateFunction(funcSource, funcName, bindings = {}) {
    const bindingNames = Object.keys(bindings);
    const bindingValues = Object.values(bindings);
    return Function(...bindingNames, `${funcSource}\nreturn ${funcName};`)(...bindingValues);
}

const defaultHostMatch = cliContent.match(/const DEFAULT_WEB_HOST = '([^']+)';/);
if (!defaultHostMatch) {
    throw new Error('DEFAULT_WEB_HOST not found');
}
const resolveWebHostSource = extractFunctionBySignature(
    cliContent,
    'function resolveWebHost(options = {}) {',
    'resolveWebHost'
);
const resolveWebHost = instantiateFunction(resolveWebHostSource, 'resolveWebHost', {
    DEFAULT_WEB_HOST: defaultHostMatch[1],
    process: { env: {} }
});

test('resolveWebHost defaults to loopback host', () => {
    assert.strictEqual(resolveWebHost({}), '127.0.0.1');
    assert.strictEqual(resolveWebHost(), '127.0.0.1');
});

test('resolveWebHost still prefers CLI host over environment and default host', () => {
    const withEnv = instantiateFunction(resolveWebHostSource, 'resolveWebHost', {
        DEFAULT_WEB_HOST: defaultHostMatch[1],
        process: { env: { CODEXMATE_HOST: '192.168.1.10' } }
    });

    assert.strictEqual(withEnv({ host: '10.0.0.8' }), '10.0.0.8');
});

test('resolveWebHost still prefers environment host over default host', () => {
    const withEnv = instantiateFunction(resolveWebHostSource, 'resolveWebHost', {
        DEFAULT_WEB_HOST: defaultHostMatch[1],
        process: { env: { CODEXMATE_HOST: '192.168.1.10' } }
    });

    assert.strictEqual(withEnv({}), '192.168.1.10');
});

const SKILL_TARGETS = [
    { app: 'codex', label: 'Codex', dir: '/tmp/codex-skills' },
    { app: 'claude', label: 'Claude', dir: '/tmp/claude-skills' }
];
const normalizeSkillTargetAppSource = extractFunctionBySignature(
    cliContent,
    'function normalizeSkillTargetApp(app) {',
    'normalizeSkillTargetApp'
);
const normalizeSkillTargetApp = instantiateFunction(normalizeSkillTargetAppSource, 'normalizeSkillTargetApp', {
    SKILL_TARGETS
});
const getSkillTargetByAppSource = extractFunctionBySignature(
    cliContent,
    'function getSkillTargetByApp(app) {',
    'getSkillTargetByApp'
);
const getSkillTargetByApp = instantiateFunction(getSkillTargetByAppSource, 'getSkillTargetByApp', {
    SKILL_TARGETS,
    normalizeSkillTargetApp
});
const resolveSkillTargetSource = extractFunctionBySignature(
    cliContent,
    'function resolveSkillTarget(params = {}, defaultApp = \'codex\') {',
    'resolveSkillTarget'
);
const resolveSkillTarget = instantiateFunction(resolveSkillTargetSource, 'resolveSkillTarget', {
    SKILL_TARGETS,
    getSkillTargetByApp,
    Object
});
const resolveSkillTargetAppFromRequestSource = extractFunctionBySignature(
    cliContent,
    'function resolveSkillTargetAppFromRequest(req, fallbackApp = \'codex\') {',
    'resolveSkillTargetAppFromRequest'
);
const resolveSkillTargetAppFromRequest = instantiateFunction(
    resolveSkillTargetAppFromRequestSource,
    'resolveSkillTargetAppFromRequest',
    {
        URL,
        normalizeSkillTargetApp
    }
);

test('resolveSkillTarget still falls back to default target when target is omitted', () => {
    assert.deepStrictEqual(resolveSkillTarget({}), SKILL_TARGETS[0]);
    assert.deepStrictEqual(resolveSkillTarget({ items: [] }), SKILL_TARGETS[0]);
});

test('resolveSkillTarget rejects explicit unsupported targets instead of falling back', () => {
    assert.strictEqual(resolveSkillTarget({ targetApp: 'claud' }), null);
    assert.strictEqual(resolveSkillTarget({ target: 'unknown' }, 'codex'), null);
});

test('resolveSkillTargetAppFromRequest rejects explicit unsupported query target', () => {
    assert.strictEqual(
        resolveSkillTargetAppFromRequest({ url: '/api/import-skills-zip?targetApp=claud' }, 'codex'),
        null
    );
    assert.strictEqual(
        resolveSkillTargetAppFromRequest({ url: '/api/import-skills-zip' }, 'claude'),
        'claude'
    );
});
