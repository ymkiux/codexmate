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

const defaultHostMatch = cliContent.match(/const\s+DEFAULT_WEB_HOST\s*=\s*['"]([^'"]+)['"]\s*;?/);
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

test('resolveWebHost defaults to LAN host', () => {
    assert.strictEqual(resolveWebHost({}), '0.0.0.0');
    assert.strictEqual(resolveWebHost(), '0.0.0.0');
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

const getCodexSkillsDirSource = extractFunctionBySignature(
    cliContent,
    'function getCodexSkillsDir() {',
    'getCodexSkillsDir'
);
const getClaudeSkillsDirSource = extractFunctionBySignature(
    cliContent,
    'function getClaudeSkillsDir() {',
    'getClaudeSkillsDir'
);

test('getCodexSkillsDir honors CODEX_HOME before legacy defaults', () => {
    const getCodexSkillsDir = instantiateFunction(getCodexSkillsDirSource, 'getCodexSkillsDir', {
        path,
        os: { homedir: () => '/home/demo' },
        process: { env: { CODEX_HOME: '/tmp/custom-codex-home' } },
        resolveExistingDir: () => '/home/demo/.codex',
        CONFIG_DIR: '/home/demo/.codex',
        CODEX_SKILLS_DIR: '/home/demo/.codex/skills'
    });

    assert.strictEqual(getCodexSkillsDir(), '/tmp/custom-codex-home/skills');
});

test('getClaudeSkillsDir honors CLAUDE_CONFIG_DIR before legacy defaults', () => {
    const getClaudeSkillsDir = instantiateFunction(getClaudeSkillsDirSource, 'getClaudeSkillsDir', {
        path,
        os: { homedir: () => '/home/demo' },
        process: { env: { CLAUDE_CONFIG_DIR: '/tmp/custom-claude-home' } },
        resolveExistingDir: () => '/home/demo/.claude',
        CLAUDE_DIR: '/home/demo/.claude',
        CLAUDE_SKILLS_DIR: '/home/demo/.claude/skills'
    });

    assert.strictEqual(getClaudeSkillsDir(), '/tmp/custom-claude-home/skills');
});

test('skills target tables use env-aware skills dir resolvers', () => {
    assert.match(cliContent, /dir:\s*getCodexSkillsDir\(\)/);
    assert.match(cliContent, /dir:\s*getClaudeSkillsDir\(\)/);
    assert.match(cliContent, /Object\.freeze\(\{\s*app:\s*'agents',\s*label:\s*'Agents',\s*dir:\s*AGENTS_SKILLS_DIR\s*\}\)/s);
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
const handleImportSkillsZipUploadSource = extractFunctionBySignature(
    cliContent,
    'async function handleImportSkillsZipUpload(req, res, options = {}) {',
    'handleImportSkillsZipUpload'
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

test('handleImportSkillsZipUpload keeps forced target app on the codex-only route', async () => {
    let resolverCalls = 0;
    let importedOptions = null;
    const handleImportSkillsZipUpload = instantiateFunction(
        handleImportSkillsZipUploadSource,
        'handleImportSkillsZipUpload',
        {
            normalizeSkillTargetApp(app) {
                const value = typeof app === 'string' ? app.trim().toLowerCase() : '';
                return value === 'codex' || value === 'claude' ? value : '';
            },
            resolveSkillTargetAppFromRequest() {
                resolverCalls += 1;
                return 'claude';
            },
            resolveUploadFileNameFromRequest() {
                return 'codex-skills.zip';
            },
            writeUploadZipStream: async () => ({ zipPath: '/tmp/codex.zip', tempDir: '/tmp/codex-upload' }),
            importSkillsFromZipFile: async (_zipPath, options) => {
                importedOptions = options;
                return { imported: [] };
            },
            writeJsonResponse(res, statusCode, payload) {
                res.statusCode = statusCode;
                res.payload = payload;
            },
            MAX_SKILLS_ZIP_UPLOAD_SIZE: 20 * 1024 * 1024
        }
    );

    const res = {};
    await handleImportSkillsZipUpload({
        method: 'POST',
        url: '/api/import-codex-skills-zip?targetApp=claude',
        headers: {}
    }, res, { targetApp: 'codex' });

    assert.strictEqual(resolverCalls, 0);
    assert(importedOptions, 'importSkillsFromZipFile should receive options');
    assert.strictEqual(importedOptions.targetApp, 'codex');
    assert.strictEqual(res.statusCode, 200);
});

test('handleImportSkillsZipUpload derives fallback zip name from the resolved target app', async () => {
    let fallbackName = '';
    let importedOptions = null;
    const handleImportSkillsZipUpload = instantiateFunction(
        handleImportSkillsZipUploadSource,
        'handleImportSkillsZipUpload',
        {
            normalizeSkillTargetApp(app) {
                const value = typeof app === 'string' ? app.trim().toLowerCase() : '';
                return value === 'codex' || value === 'claude' ? value : '';
            },
            resolveSkillTargetAppFromRequest() {
                return 'claude';
            },
            resolveUploadFileNameFromRequest(_req, nextFallbackName) {
                fallbackName = nextFallbackName;
                return nextFallbackName;
            },
            writeUploadZipStream: async () => ({ zipPath: '/tmp/claude.zip', tempDir: '/tmp/claude-upload' }),
            importSkillsFromZipFile: async (_zipPath, options) => {
                importedOptions = options;
                return { imported: [] };
            },
            writeJsonResponse(res, statusCode, payload) {
                res.statusCode = statusCode;
                res.payload = payload;
            },
            MAX_SKILLS_ZIP_UPLOAD_SIZE: 20 * 1024 * 1024
        }
    );

    const res = {};
    await handleImportSkillsZipUpload({
        method: 'POST',
        url: '/api/import-skills-zip?targetApp=claude',
        headers: {}
    }, res);

    assert.strictEqual(fallbackName, 'claude-skills.zip');
    assert(importedOptions, 'importSkillsFromZipFile should receive options');
    assert.strictEqual(importedOptions.targetApp, 'claude');
    assert.strictEqual(importedOptions.fallbackName, 'claude-skills.zip');
    assert.strictEqual(res.statusCode, 200);
});

test('codex-only zip upload route pins target app before request fallback resolution', () => {
    assert.match(
        cliContent,
        /const forcedTargetApp = normalizeSkillTargetApp\(options && options\.targetApp \? options\.targetApp : ''\);/
    );
    assert.match(
        cliContent,
        /const targetApp = forcedTargetApp \|\| resolveSkillTargetAppFromRequest\(req, 'codex'\);/
    );
});
