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

test('web auto-open uses IPv6 loopback when binding to IPv6 any address', () => {
    assert.match(
        cliContent,
        /const openHost = host === '::'\s*\?\s*'::1'\s*:\s*\(host === '0\.0\.0\.0' \? DEFAULT_WEB_OPEN_HOST : host\);/
    );
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
    let received = null;
    const getCodexSkillsDir = instantiateFunction(getCodexSkillsDirSource, 'getCodexSkillsDir', {
        path,
        os: { homedir: () => '/home/demo' },
        process: { env: { CODEX_HOME: '/tmp/custom-codex-home' } },
        resolveExistingDir: (candidates, fallback) => {
            received = { candidates, fallback };
            return fallback;
        },
        CODEX_SKILLS_DIR: '/home/demo/.codex/skills'
    });

    assert.strictEqual(getCodexSkillsDir(), '/tmp/custom-codex-home/skills');
    assert.deepStrictEqual(received, {
        candidates: ['/tmp/custom-codex-home/skills'],
        fallback: '/tmp/custom-codex-home/skills'
    });
});

test('getClaudeSkillsDir honors CLAUDE_CONFIG_DIR before legacy defaults', () => {
    let received = null;
    const getClaudeSkillsDir = instantiateFunction(getClaudeSkillsDirSource, 'getClaudeSkillsDir', {
        path,
        os: { homedir: () => '/home/demo' },
        process: { env: { CLAUDE_CONFIG_DIR: '/tmp/custom-claude-home' } },
        resolveExistingDir: (candidates, fallback) => {
            received = { candidates, fallback };
            return fallback;
        },
        CLAUDE_SKILLS_DIR: '/home/demo/.claude/skills'
    });

    assert.strictEqual(getClaudeSkillsDir(), '/tmp/custom-claude-home/skills');
    assert.deepStrictEqual(received, {
        candidates: ['/tmp/custom-claude-home/skills'],
        fallback: '/tmp/custom-claude-home/skills'
    });
});

test('getCodexSkillsDir resolves concrete skills directories instead of parent config dirs', () => {
    let received = null;
    const getCodexSkillsDir = instantiateFunction(getCodexSkillsDirSource, 'getCodexSkillsDir', {
        path,
        os: { homedir: () => '/home/demo' },
        process: { env: { XDG_CONFIG_HOME: '/tmp/xdg-home' } },
        resolveExistingDir: (candidates, fallback) => {
            received = { candidates, fallback };
            return '/resolved/codex-skills';
        },
        CODEX_SKILLS_DIR: '/home/demo/.codex/skills'
    });

    assert.strictEqual(getCodexSkillsDir(), '/resolved/codex-skills');
    assert.deepStrictEqual(received, {
        candidates: ['/tmp/xdg-home/codex/skills'],
        fallback: '/tmp/xdg-home/codex/skills'
    });
});

test('getClaudeSkillsDir resolves concrete skills directories instead of parent config dirs', () => {
    let received = null;
    const getClaudeSkillsDir = instantiateFunction(getClaudeSkillsDirSource, 'getClaudeSkillsDir', {
        path,
        os: { homedir: () => '/home/demo' },
        process: { env: { XDG_CONFIG_HOME: '/tmp/xdg-home' } },
        resolveExistingDir: (candidates, fallback) => {
            received = { candidates, fallback };
            return '/resolved/claude-skills';
        },
        CLAUDE_SKILLS_DIR: '/home/demo/.claude/skills'
    });

    assert.strictEqual(getClaudeSkillsDir(), '/resolved/claude-skills');
    assert.deepStrictEqual(received, {
        candidates: ['/tmp/xdg-home/claude/skills'],
        fallback: '/tmp/xdg-home/claude/skills'
    });
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
        resolveSkillTarget
    }
);
const resolveCopyTargetRootSource = extractFunctionBySignature(
    cliContent,
    'function resolveCopyTargetRoot(targetDir) {',
    'resolveCopyTargetRoot'
);
const importSkillsSource = extractFunctionBySignature(
    cliContent,
    'function importSkills(params = {}) {',
    'importSkills'
);
const importSkillsFromZipFileSource = extractFunctionBySignature(
    cliContent,
    'async function importSkillsFromZipFile(zipPath, options = {}) {',
    'importSkillsFromZipFile'
);
const scanUnmanagedSkillsSource = extractFunctionBySignature(
    cliContent,
    'function scanUnmanagedSkills(params = {}) {',
    'scanUnmanagedSkills'
);
const importSkillsFromZipSource = extractFunctionBySignature(
    cliContent,
    'async function importSkillsFromZip(payload = {}) {',
    'importSkillsFromZip'
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
    assert.strictEqual(resolveSkillTarget({ targetApp: 'claud', target: 'claude' }), null);
    assert.strictEqual(resolveSkillTarget({ target: 'unknown' }, 'codex'), null);
    assert.strictEqual(resolveSkillTarget({ targetApp: '' }, 'codex'), null);
    assert.strictEqual(resolveSkillTarget({ target: '' }, 'codex'), null);
});

test('resolveSkillTarget keeps targetApp precedence over target', () => {
    assert.deepStrictEqual(
        resolveSkillTarget({ targetApp: 'claude', target: 'codex' }, 'codex'),
        SKILL_TARGETS[1]
    );
    assert.deepStrictEqual(
        resolveSkillTarget({ targetApp: 'codex', target: 'claude' }, 'claude'),
        SKILL_TARGETS[0]
    );
});

test('scanUnmanagedSkills skips entries when the resolved target path is already occupied', () => {
    const scanUnmanagedSkills = instantiateFunction(scanUnmanagedSkillsSource, 'scanUnmanagedSkills', {
        resolveSkillTarget() {
            return { app: 'codex', label: 'Codex', dir: '/tmp/codex-skills' };
        },
        resolveCopyTargetRoot() {
            return '/tmp/codex-skills';
        },
        listSkills() {
            return {
                targetApp: 'codex',
                targetLabel: 'Codex',
                root: '/tmp/codex-skills',
                exists: true,
                items: []
            };
        },
        SKILL_IMPORT_SOURCES: [
            { app: 'codex', label: 'Codex', dir: '/tmp/codex-skills' },
            { app: 'claude', label: 'Claude', dir: '/tmp/claude-skills' }
        ],
        listSkillEntriesByRoot() {
            return [
                { name: 'alpha', path: '/tmp/claude-skills/alpha', sourceType: 'directory' },
                { name: 'beta', path: '/tmp/claude-skills/beta', sourceType: 'directory' }
            ];
        },
        readCodexSkillMetadata(skillPath) {
            return {
                displayName: path.basename(skillPath),
                description: '',
                hasSkillFile: true
            };
        },
        path,
        fs: {
            existsSync(targetPath) {
                return targetPath === '/tmp/codex-skills/alpha';
            }
        }
    });

    const result = scanUnmanagedSkills({ targetApp: 'codex' });

    assert.deepStrictEqual(result.items, [{
        key: 'claude:beta',
        name: 'beta',
        displayName: 'beta',
        description: '',
        sourceApp: 'claude',
        sourceLabel: 'Claude',
        sourcePath: '/tmp/claude-skills/beta',
        sourceType: 'directory',
        hasSkillFile: true
    }]);
});

test('resolveSkillTargetAppFromRequest rejects explicit unsupported query target', () => {
    assert.strictEqual(
        resolveSkillTargetAppFromRequest({ url: '/api/import-skills-zip?targetApp=claud' }, 'codex'),
        null
    );
    assert.strictEqual(
        resolveSkillTargetAppFromRequest({ url: '/api/import-skills-zip?target=' }, 'codex'),
        null
    );
    assert.strictEqual(
        resolveSkillTargetAppFromRequest({ url: '/api/import-skills-zip?target=claude' }, 'codex'),
        'claude'
    );
    assert.strictEqual(
        resolveSkillTargetAppFromRequest({ url: '/api/import-skills-zip' }, 'claude'),
        'claude'
    );
});

test('resolveSkillTargetAppFromRequest keeps targetApp precedence over target', () => {
    assert.strictEqual(
        resolveSkillTargetAppFromRequest({ url: '/api/import-skills-zip?target=claude&targetApp=codex' }, 'claude'),
        'codex'
    );
    assert.strictEqual(
        resolveSkillTargetAppFromRequest({ url: '/api/import-skills-zip?target=claude&targetApp=claud' }, 'codex'),
        null
    );
});

test('resolveCopyTargetRoot resolves through the nearest existing parent path', () => {
    const resolveCopyTargetRoot = instantiateFunction(resolveCopyTargetRootSource, 'resolveCopyTargetRoot', {
        path,
        fs: {
            existsSync(targetPath) {
                return targetPath === '/link-target' || targetPath === '/';
            }
        },
        normalizePathForCompare(targetPath) {
            return targetPath === '/link-target' ? '/real/source' : targetPath;
        }
    });

    assert.strictEqual(resolveCopyTargetRoot('/link-target/nested/skills'), '/real/source/nested/skills');
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

test('handleImportSkillsZipUpload drains request body before method errors', async () => {
    let resumeCalls = 0;
    const handleImportSkillsZipUpload = instantiateFunction(
        handleImportSkillsZipUploadSource,
        'handleImportSkillsZipUpload',
        {
            normalizeSkillTargetApp() {
                return '';
            },
            resolveSkillTargetAppFromRequest() {
                return 'codex';
            },
            resolveUploadFileNameFromRequest() {
                throw new Error('resolveUploadFileNameFromRequest should not run');
            },
            writeUploadZipStream: async () => {
                throw new Error('writeUploadZipStream should not run');
            },
            importSkillsFromZipFile: async () => {
                throw new Error('importSkillsFromZipFile should not run');
            },
            writeJsonResponse(res, statusCode, payload) {
                res.statusCode = statusCode;
                res.payload = payload;
            },
            MAX_SKILLS_ZIP_UPLOAD_SIZE: 20 * 1024 * 1024
        }
    );

    const req = {
        method: 'GET',
        url: '/api/import-skills-zip',
        headers: {},
        resume() {
            resumeCalls += 1;
        }
    };
    const res = {};
    await handleImportSkillsZipUpload(req, res);

    assert.strictEqual(resumeCalls, 1);
    assert.strictEqual(res.statusCode, 405);
    assert.deepStrictEqual(res.payload, { error: 'Method Not Allowed' });
});

test('handleImportSkillsZipUpload drains request body before unsupported target errors', async () => {
    let resumeCalls = 0;
    const handleImportSkillsZipUpload = instantiateFunction(
        handleImportSkillsZipUploadSource,
        'handleImportSkillsZipUpload',
        {
            normalizeSkillTargetApp() {
                return '';
            },
            resolveSkillTargetAppFromRequest() {
                return null;
            },
            resolveUploadFileNameFromRequest() {
                throw new Error('resolveUploadFileNameFromRequest should not run');
            },
            writeUploadZipStream: async () => {
                throw new Error('writeUploadZipStream should not run');
            },
            importSkillsFromZipFile: async () => {
                throw new Error('importSkillsFromZipFile should not run');
            },
            writeJsonResponse(res, statusCode, payload) {
                res.statusCode = statusCode;
                res.payload = payload;
            },
            MAX_SKILLS_ZIP_UPLOAD_SIZE: 20 * 1024 * 1024
        }
    );

    const req = {
        method: 'POST',
        url: '/api/import-skills-zip?target=',
        headers: {},
        resume() {
            resumeCalls += 1;
        }
    };
    const res = {};
    await handleImportSkillsZipUpload(req, res);

    assert.strictEqual(resumeCalls, 1);
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.payload, { error: '目标宿主不支持' });
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

test('importSkills rejects target roots nested inside the source skill before ensuring the destination root', () => {
    let copyCalls = 0;
    const ensureDirCalls = [];
    let resolvedTargetDir = '';
    const importSkills = instantiateFunction(importSkillsSource, 'importSkills', {
        resolveSkillTarget() {
            return { app: 'codex', label: 'Codex', dir: '/tmp/source/nested' };
        },
        resolveCopyTargetRoot(targetDir) {
            resolvedTargetDir = targetDir;
            return '/tmp/source/nested';
        },
        normalizeCodexSkillName(name) {
            return { name: String(name || '') };
        },
        getSkillImportSourceByApp() {
            return { app: 'claude', label: 'Claude', dir: '/tmp' };
        },
        ensureDir(dir) {
            ensureDirCalls.push(dir);
        },
        path,
        fs: {
            existsSync(targetPath) {
                return targetPath === '/tmp/source';
            },
            lstatSync() {
                return {
                    isDirectory: () => true,
                    isSymbolicLink: () => false
                };
            },
            statSync() {
                return {
                    isDirectory: () => true
                };
            }
        },
        copyDirRecursive() {
            copyCalls += 1;
        },
        removeDirectoryRecursive() {},
        isPathInside(targetPath, rootPath) {
            return targetPath === '/tmp/source/nested' && rootPath === '/tmp/source';
        }
    });

    const result = importSkills({
        targetApp: 'codex',
        items: [{ name: 'source', sourceApp: 'claude' }]
    });

    assert.strictEqual(copyCalls, 0);
    assert.strictEqual(resolvedTargetDir, '/tmp/source/nested');
    assert.deepStrictEqual(ensureDirCalls, []);
    assert.deepStrictEqual(result.imported, []);
    assert.strictEqual(result.failed.length, 1);
    assert.strictEqual(result.failed[0].error, '目标路径不能位于来源 skill 目录内');
});

test('importSkillsFromZipFile rejects target roots nested inside extracted skills before ensuring the destination root', async () => {
    let copyCalls = 0;
    const ensureDirCalls = [];
    const cleanupCalls = [];
    let resolvedTargetDir = '';
    const importSkillsFromZipFile = instantiateFunction(importSkillsFromZipFileSource, 'importSkillsFromZipFile', {
        resolveSkillTarget() {
            return { app: 'codex', label: 'Codex', dir: '/tmp/upload/extract/source/nested' };
        },
        resolveCopyTargetRoot(targetDir) {
            resolvedTargetDir = targetDir;
            return '/tmp/upload/extract/source/nested';
        },
        path,
        fs: {
            realpathSync(targetPath) {
                return targetPath;
            },
            statSync() {
                return {
                    isDirectory: () => true
                };
            },
            existsSync() {
                return false;
            },
            rmSync(targetPath, options) {
                cleanupCalls.push({ targetPath, options });
            }
        },
        inspectZipArchiveLimits: async () => {},
        extractUploadZip: async () => {},
        collectSkillDirectoriesFromRoot() {
            return {
                results: ['/tmp/upload/extract/source'],
                truncated: false
            };
        },
        resolveSkillNameFromImportedDirectory() {
            return { name: 'source' };
        },
        ensureDir(dir) {
            ensureDirCalls.push(dir);
        },
        copyDirRecursive() {
            copyCalls += 1;
        },
        removeDirectoryRecursive() {},
        isPathInside(targetPath, rootPath) {
            return targetPath === '/tmp/upload/extract/source/nested' && rootPath === '/tmp/upload/extract/source';
        },
        MAX_SKILLS_ZIP_ENTRY_COUNT: 100,
        MAX_SKILLS_ZIP_UNCOMPRESSED_BYTES: 1024
    });

    const result = await importSkillsFromZipFile('/tmp/upload/archive.zip', {
        tempDir: '/tmp/upload',
        targetApp: 'codex'
    });

    assert.strictEqual(copyCalls, 0);
    assert.strictEqual(resolvedTargetDir, '/tmp/upload/extract/source/nested');
    assert.deepStrictEqual(ensureDirCalls, []);
    assert.deepStrictEqual(result.imported, []);
    assert.strictEqual(result.failed.length, 1);
    assert.strictEqual(result.failed[0].error, '目标路径不能位于来源 skill 目录内');
    assert.deepStrictEqual(cleanupCalls, [{
        targetPath: '/tmp/upload',
        options: { recursive: true, force: true }
    }]);
});

test('importSkillsFromZipFile still cleans tempDir when target app is unsupported', async () => {
    const cleanupCalls = [];
    const importSkillsFromZipFile = instantiateFunction(importSkillsFromZipFileSource, 'importSkillsFromZipFile', {
        resolveSkillTarget() {
            return null;
        },
        resolveCopyTargetRoot(targetDir) {
            return targetDir;
        },
        path,
        fs: {
            existsSync() {
                return false;
            },
            rmSync(targetPath, options) {
                cleanupCalls.push({ targetPath, options });
            }
        },
        inspectZipArchiveLimits: async () => {
            throw new Error('inspectZipArchiveLimits should not run');
        },
        extractUploadZip: async () => {
            throw new Error('extractUploadZip should not run');
        },
        collectSkillDirectoriesFromRoot() {
            return { results: [], truncated: false };
        },
        resolveSkillNameFromImportedDirectory() {
            return { name: 'demo' };
        },
        ensureDir() {},
        copyDirRecursive() {},
        removeDirectoryRecursive() {},
        isPathInside() {
            return false;
        },
        MAX_SKILLS_ZIP_ENTRY_COUNT: 100,
        MAX_SKILLS_ZIP_UNCOMPRESSED_BYTES: 1024
    });

    const result = await importSkillsFromZipFile('/tmp/upload/archive.zip', {
        tempDir: '/tmp/upload',
        targetApp: 'invalid'
    });

    assert.deepStrictEqual(result, { error: '目标宿主不支持' });
    assert.deepStrictEqual(cleanupCalls, [{
        targetPath: '/tmp/upload',
        options: { recursive: true, force: true }
    }]);
});

test('importSkillsFromZip reuses a target-specific fallback zip name for base64 imports', async () => {
    let uploadArgs = null;
    let importedOptions = null;
    const importSkillsFromZip = instantiateFunction(importSkillsFromZipSource, 'importSkillsFromZip', {
        resolveSkillTarget,
        writeUploadZip(fileBase64, prefix, fileName) {
            uploadArgs = { fileBase64, prefix, fileName };
            return { zipPath: '/tmp/claude.zip', tempDir: '/tmp/claude-upload' };
        },
        importSkillsFromZipFile: async (_zipPath, options) => {
            importedOptions = options;
            return { imported: [] };
        }
    });

    const result = await importSkillsFromZip({
        fileBase64: 'QUJD',
        target: 'claude'
    });

    assert.deepStrictEqual(uploadArgs, {
        fileBase64: 'QUJD',
        prefix: 'codex-skills-import',
        fileName: 'claude-skills.zip'
    });
    assert.deepStrictEqual(importedOptions, {
        tempDir: '/tmp/claude-upload',
        fallbackName: 'claude-skills.zip',
        target: 'claude'
    });
    assert.deepStrictEqual(result, { imported: [] });
});

test('importSkillsFromZip keeps the raw explicit target for downstream validation', async () => {
    let uploadArgs = null;
    let importedOptions = null;
    const importSkillsFromZip = instantiateFunction(importSkillsFromZipSource, 'importSkillsFromZip', {
        resolveSkillTarget,
        writeUploadZip(fileBase64, prefix, fileName) {
            uploadArgs = { fileBase64, prefix, fileName };
            return { zipPath: '/tmp/upload.zip', tempDir: '/tmp/upload-dir' };
        },
        importSkillsFromZipFile: async (_zipPath, options) => {
            importedOptions = options;
            return { error: '目标宿主不支持' };
        }
    });

    const result = await importSkillsFromZip({
        fileBase64: 'QUJD',
        target: 'claud'
    });

    assert.deepStrictEqual(uploadArgs, {
        fileBase64: 'QUJD',
        prefix: 'codex-skills-import',
        fileName: 'codex-skills.zip'
    });
    assert.deepStrictEqual(importedOptions, {
        tempDir: '/tmp/upload-dir',
        fallbackName: 'codex-skills.zip',
        target: 'claud'
    });
    assert.deepStrictEqual(result, { error: '目标宿主不支持' });
});

test('importSkillsFromZip keeps targetApp precedence over target', async () => {
    let uploadArgs = null;
    let importedOptions = null;
    const importSkillsFromZip = instantiateFunction(importSkillsFromZipSource, 'importSkillsFromZip', {
        resolveSkillTarget,
        writeUploadZip(fileBase64, prefix, fileName) {
            uploadArgs = { fileBase64, prefix, fileName };
            return { zipPath: '/tmp/claude.zip', tempDir: '/tmp/claude-upload' };
        },
        importSkillsFromZipFile: async (_zipPath, options) => {
            importedOptions = options;
            return { imported: [] };
        }
    });

    const result = await importSkillsFromZip({
        fileBase64: 'QUJD',
        targetApp: 'claude',
        target: 'codex'
    });

    assert.deepStrictEqual(uploadArgs, {
        fileBase64: 'QUJD',
        prefix: 'codex-skills-import',
        fileName: 'claude-skills.zip'
    });
    assert.deepStrictEqual(importedOptions, {
        tempDir: '/tmp/claude-upload',
        fallbackName: 'claude-skills.zip',
        targetApp: 'claude',
        target: 'codex'
    });
    assert.deepStrictEqual(result, { imported: [] });
});

test('importSkillsFromZip preserves conflicting explicit target keys for downstream rejection', async () => {
    let uploadArgs = null;
    let importedOptions = null;
    const importSkillsFromZip = instantiateFunction(importSkillsFromZipSource, 'importSkillsFromZip', {
        resolveSkillTarget,
        writeUploadZip(fileBase64, prefix, fileName) {
            uploadArgs = { fileBase64, prefix, fileName };
            return { zipPath: '/tmp/upload.zip', tempDir: '/tmp/upload-dir' };
        },
        importSkillsFromZipFile: async (_zipPath, options) => {
            importedOptions = options;
            return { error: '目标宿主不支持' };
        }
    });

    const result = await importSkillsFromZip({
        fileBase64: 'QUJD',
        targetApp: 'claud',
        target: 'claude'
    });

    assert.deepStrictEqual(uploadArgs, {
        fileBase64: 'QUJD',
        prefix: 'codex-skills-import',
        fileName: 'codex-skills.zip'
    });
    assert.deepStrictEqual(importedOptions, {
        tempDir: '/tmp/upload-dir',
        fallbackName: 'codex-skills.zip',
        targetApp: 'claud',
        target: 'claude'
    });
    assert.deepStrictEqual(result, { error: '目标宿主不支持' });
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
