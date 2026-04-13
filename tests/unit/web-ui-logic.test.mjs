import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logic = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'logic.mjs')));
const { createSessionComputed } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.computed.session.mjs'))
);
const { createMainTabsComputed } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.computed.main-tabs.mjs'))
);
const { createTaskOrchestrationMethods } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.task-orchestration.mjs'))
);
const {
    DEFAULT_SESSION_LIST_FAST_LIMIT,
    DEFAULT_SESSION_LIST_LIMIT,
    normalizeClaudeValue,
    normalizeClaudeConfig,
    normalizeClaudeSettingsEnv,
    getClaudeModelCatalogForBaseUrl,
    matchClaudeConfigFromSettings,
    findDuplicateClaudeConfigName,
    buildAgentsDiffPreview,
    buildAgentsDiffPreviewRequest,
    isAgentsDiffPreviewPayloadTooLarge,
    shouldApplyAgentsDiffPreviewResponse,
    DEFAULT_API_BODY_LIMIT_BYTES,
    formatLatency,
    buildSpeedTestIssue,
    isSessionQueryEnabled,
    normalizeSessionSource,
    normalizeSessionPathFilter,
    buildSessionFilterCacheState,
    buildSessionListParams,
    buildUsageChartGroups,
    formatSessionTimelineTimestamp,
    buildSessionTimelineNodes,
    runLatestOnlyQueue,
    shouldForceCompactLayoutMode
} = logic;

test('normalizeClaudeValue trims strings and ignores non-string', () => {
    assert.strictEqual(normalizeClaudeValue('  abc  '), 'abc');
    assert.strictEqual(normalizeClaudeValue(123), '');
    assert.strictEqual(normalizeClaudeValue(null), '');
});

test('normalizeClaudeConfig trims all fields', () => {
    const cfg = normalizeClaudeConfig({ apiKey: ' key ', baseUrl: ' url ', model: ' model ', authToken: ' token ', useKey: ' yes ', externalCredentialType: ' auth-token ' });
    assert.deepStrictEqual(cfg, { apiKey: 'key', baseUrl: 'url', model: 'model', authToken: 'token', useKey: 'yes', externalCredentialType: 'auth-token' });
});

test('normalizeClaudeConfig infers external credential type from authToken and useKey', () => {
    assert.deepStrictEqual(
        normalizeClaudeConfig({ apiKey: '', authToken: ' token ', useKey: '' }),
        {
            apiKey: '',
            baseUrl: '',
            model: '',
            authToken: 'token',
            useKey: '',
            externalCredentialType: 'auth-token'
        }
    );
    assert.deepStrictEqual(
        normalizeClaudeConfig({ apiKey: '', authToken: '', useKey: ' 1 ' }),
        {
            apiKey: '',
            baseUrl: '',
            model: '',
            authToken: '',
            useKey: '1',
            externalCredentialType: 'claude-code-use-key'
        }
    );
});

test('normalizeClaudeSettingsEnv trims settings env', () => {
    const env = {
        ANTHROPIC_API_KEY: ' key ',
        ANTHROPIC_BASE_URL: ' url ',
        ANTHROPIC_MODEL: ' model ',
        ANTHROPIC_AUTH_TOKEN: ' token ',
        CLAUDE_CODE_USE_KEY: ' true '
    };
    assert.deepStrictEqual(normalizeClaudeSettingsEnv(env), {
        apiKey: 'key',
        baseUrl: 'url',
        model: 'model',
        authToken: 'token',
        useKey: 'true',
        externalCredentialType: ''
    });
});

test('normalizeClaudeSettingsEnv fills missing fields with empty strings', () => {
    const env = { ANTHROPIC_API_KEY: 'k' };
    assert.deepStrictEqual(normalizeClaudeSettingsEnv(env), {
        apiKey: 'k',
        baseUrl: '',
        model: 'glm-4.7',
        authToken: '',
        useKey: '',
        externalCredentialType: ''
    });
});

test('getClaudeModelCatalogForBaseUrl returns the built-in Anthropic model catalog', () => {
    const models = getClaudeModelCatalogForBaseUrl('https://api.anthropic.com');
    assert(models.includes('claude-opus-4-6'));
    assert(models.includes('claude-sonnet-4-6'));
    assert(models.includes('claude-haiku-4-5'));
    assert(!models.includes('glm-5.1'));
});

test('getClaudeModelCatalogForBaseUrl appends BigModel extras for Claude-compatible endpoints', () => {
    const models = getClaudeModelCatalogForBaseUrl('https://open.bigmodel.cn/api/anthropic');
    assert(models.includes('claude-opus-4-6'));
    assert(models.includes('glm-5.1'));
    assert(models.includes('glm-coding'));
});

test('buildSessionListParams normalizes source and path filter before building request', () => {
    assert.deepStrictEqual(buildSessionListParams({
        source: ' CLAUDE ',
        pathFilter: ' /tmp/demo ',
        query: 'needle'
    }), {
        source: 'claude',
        pathFilter: '/tmp/demo',
        query: 'needle',
        queryMode: 'and',
        queryScope: 'content',
        contentScanLimit: 50,
        roleFilter: 'all',
        timeRangePreset: 'all',
        limit: DEFAULT_SESSION_LIST_LIMIT,
        forceRefresh: false
    });
});

test('buildSessionListParams uses fast limit only for default all-session browsing', () => {
    const fastParams = buildSessionListParams({
        source: 'all'
    });
    assert.strictEqual(fastParams.limit, DEFAULT_SESSION_LIST_FAST_LIMIT);

    const filteredParams = buildSessionListParams({
        source: 'all',
        pathFilter: '/tmp/demo'
    });
    assert.strictEqual(filteredParams.limit, DEFAULT_SESSION_LIST_LIMIT);

    const queryParams = buildSessionListParams({
        source: 'all',
        query: 'needle'
    });
    assert.strictEqual(queryParams.limit, DEFAULT_SESSION_LIST_LIMIT);

    const refreshedParams = buildSessionListParams({
        source: 'all',
        forceRefresh: true
    });
    assert.strictEqual(refreshedParams.limit, DEFAULT_SESSION_LIST_LIMIT);
});

test('matchClaudeConfigFromSettings matches identical config', () => {
    const configs = { default: { apiKey: 'k', baseUrl: 'u', model: 'm' } };
    const env = { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'u', ANTHROPIC_MODEL: 'm' };
    assert.strictEqual(matchClaudeConfigFromSettings(configs, env), 'default');
});

test('matchClaudeConfigFromSettings tolerates trailing slash differences', () => {
    const configs = { default: { apiKey: 'k', baseUrl: 'https://example.com/anthropic/', model: 'm' } };
    const env = { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'https://example.com/anthropic', ANTHROPIC_MODEL: 'm' };
    assert.strictEqual(matchClaudeConfigFromSettings(configs, env), 'default');
});

test('matchClaudeConfigFromSettings matches external token-backed config by baseUrl and model', () => {
    const configs = { imported: { apiKey: '', baseUrl: 'https://example.com/anthropic/', model: 'm', externalCredentialType: 'auth-token' } };
    const env = { ANTHROPIC_AUTH_TOKEN: 'token', ANTHROPIC_BASE_URL: 'https://example.com/anthropic', ANTHROPIC_MODEL: 'm' };
    assert.strictEqual(matchClaudeConfigFromSettings(configs, env), 'imported');
});

test('matchClaudeConfigFromSettings ignores placeholder blank-apiKey configs for external auth', () => {
    const configs = {
        local: { apiKey: '', baseUrl: 'https://example.com/anthropic', model: 'm' },
        imported: { apiKey: '', baseUrl: 'https://example.com/anthropic', model: 'm', externalCredentialType: 'auth-token' }
    };
    const env = { ANTHROPIC_AUTH_TOKEN: 'token', ANTHROPIC_BASE_URL: 'https://example.com/anthropic', ANTHROPIC_MODEL: 'm' };
    assert.strictEqual(matchClaudeConfigFromSettings(configs, env), 'imported');
});

test('matchClaudeConfigFromSettings supports CLAUDE_CODE_USE_KEY external configs', () => {
    const configs = { imported: { apiKey: '', baseUrl: 'https://example.com/anthropic', model: 'm', externalCredentialType: 'claude-code-use-key' } };
    const env = { CLAUDE_CODE_USE_KEY: '1', ANTHROPIC_BASE_URL: 'https://example.com/anthropic', ANTHROPIC_MODEL: 'm' };
    assert.strictEqual(matchClaudeConfigFromSettings(configs, env), 'imported');
});

test('matchClaudeConfigFromSettings returns empty when incomplete', () => {
    const configs = { default: { apiKey: 'k', baseUrl: 'u', model: 'm' } };
    const env = { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: '', ANTHROPIC_MODEL: 'm' };
    assert.strictEqual(matchClaudeConfigFromSettings(configs, env), '');
});

test('findDuplicateClaudeConfigName returns empty on missing fields', () => {
    const configs = { only: { apiKey: 'k', baseUrl: 'u', model: 'm' } };
    const incomplete = { apiKey: 'k', baseUrl: '', model: '' };
    assert.strictEqual(findDuplicateClaudeConfigName(configs, incomplete), '');
});

test('findDuplicateClaudeConfigName detects duplicates', () => {
    const configs = {
        first: { apiKey: 'k1', baseUrl: 'u1', model: 'm1' },
        second: { apiKey: 'k2', baseUrl: 'u2', model: 'm2' }
    };
    const duplicate = { apiKey: 'k2', baseUrl: 'u2', model: 'm2' };
    assert.strictEqual(findDuplicateClaudeConfigName(configs, duplicate), 'second');
});

test('findDuplicateClaudeConfigName detects external credential duplicates', () => {
    const configs = {
        imported: { apiKey: '', baseUrl: 'https://example.com/anthropic/', model: 'm', externalCredentialType: 'auth-token' }
    };
    const duplicate = { apiKey: '', baseUrl: 'https://example.com/anthropic', model: 'm', externalCredentialType: 'auth-token' };
    assert.strictEqual(findDuplicateClaudeConfigName(configs, duplicate), 'imported');
});

test('findDuplicateClaudeConfigName returns empty when no match', () => {
    const configs = { only: { apiKey: 'k', baseUrl: 'u', model: 'm' } };
    const another = { apiKey: 'k', baseUrl: 'u', model: 'm-2' };
    assert.strictEqual(findDuplicateClaudeConfigName(configs, another), '');
});

test('buildAgentsDiffPreviewRequest keeps baseContent when request body fits', () => {
    const result = buildAgentsDiffPreviewRequest({
        context: 'codex',
        content: 'updated',
        baseContent: 'original',
        lineEnding: '\n'
    });

    assert.strictEqual(result.omittedBaseContent, false);
    assert.strictEqual(result.exceedsBodyLimit, false);
    assert.strictEqual(result.params.context, 'codex');
    assert.strictEqual(result.params.content, 'updated');
    assert.strictEqual(result.params.baseContent, 'original');
});

test('buildAgentsDiffPreviewRequest drops baseContent first when request body would exceed limit', () => {
    const largeChunk = 'A'.repeat(Math.floor(DEFAULT_API_BODY_LIMIT_BYTES * 0.75));
    const result = buildAgentsDiffPreviewRequest({
        context: 'openclaw-workspace',
        fileName: 'AGENTS.md',
        content: largeChunk,
        baseContent: largeChunk,
        lineEnding: '\n'
    });

    assert.strictEqual(result.omittedBaseContent, true);
    assert.strictEqual(result.exceedsBodyLimit, false);
    assert.strictEqual(result.params.context, 'openclaw-workspace');
    assert.strictEqual(result.params.fileName, 'AGENTS.md');
    assert.strictEqual(result.params.content, largeChunk);
    assert.ok(!Object.prototype.hasOwnProperty.call(result.params, 'baseContent'));
});

test('buildAgentsDiffPreviewRequest reports when even trimmed preview request exceeds limit', () => {
    const oversized = 'A'.repeat(DEFAULT_API_BODY_LIMIT_BYTES + 1024);
    const result = buildAgentsDiffPreviewRequest({
        context: 'codex',
        content: oversized,
        baseContent: 'ignored'
    });

    assert.strictEqual(result.omittedBaseContent, true);
    assert.strictEqual(result.exceedsBodyLimit, true);
    assert.ok(!Object.prototype.hasOwnProperty.call(result.params, 'baseContent'));
});

test('buildAgentsDiffPreview still returns a diff for oversized preview payloads', () => {
    const largeChunk = 'A'.repeat(Math.floor(DEFAULT_API_BODY_LIMIT_BYTES * 0.75));
    const diff = buildAgentsDiffPreview({
        baseContent: largeChunk,
        content: `${largeChunk}!`
    });

    assert.strictEqual(diff.truncated, false);
    assert.strictEqual(diff.hasChanges, true);
    assert.strictEqual(diff.stats.added, 1);
    assert.strictEqual(diff.stats.removed, 1);
});

test('buildAgentsDiffPreview ignores a leading BOM to match shared diff normalization', () => {
    const diff = buildAgentsDiffPreview({
        baseContent: '\uFEFFalpha\nbeta',
        content: 'alpha\nbeta'
    });

    assert.strictEqual(diff.hasChanges, false);
    assert.strictEqual(diff.stats.added, 0);
    assert.strictEqual(diff.stats.removed, 0);
});

test('buildAgentsDiffPreview preserves newline-only diffs at file end', () => {
    const diff = buildAgentsDiffPreview({
        baseContent: 'alpha',
        content: 'alpha\n'
    });

    assert.strictEqual(diff.hasChanges, true);
    assert.strictEqual(diff.stats.added, 1);
    assert.strictEqual(diff.stats.removed, 0);
});

test('buildAgentsDiffPreview still exposes diff points for large block insertions', () => {
    const beforeLines = Array.from({ length: 3200 }, (_, index) => `section-${index}`);
    const afterLines = beforeLines.slice();
    const insertedBlock = Array.from({ length: 66 }, (_, index) => `section-1500-inserted-${index}`);
    afterLines.splice(1500, 0, ...insertedBlock);
    const diff = buildAgentsDiffPreview({
        baseContent: beforeLines.join('\n'),
        content: afterLines.join('\n')
    });

    assert.strictEqual(diff.truncated, false);
    assert.strictEqual(diff.hasChanges, true);
    assert.strictEqual(diff.stats.added, 66);
    assert.strictEqual(diff.stats.removed, 0);
    assert.ok(diff.lines.some(line => line.type === 'context' && line.value === 'section-1499'));
    assert.ok(diff.lines.some(line => line.type === 'context' && line.value === 'section-1500'));
    assert.ok(diff.lines.some(line => line.type === 'add' && line.value === 'section-1500-inserted-0'));
    assert.ok(diff.lines.some(line => line.type === 'add' && line.value === 'section-1500-inserted-65'));
});

test('isAgentsDiffPreviewPayloadTooLarge keys off transport status instead of localized text', () => {
    assert.strictEqual(isAgentsDiffPreviewPayloadTooLarge({ status: 413 }), true);
    assert.strictEqual(isAgentsDiffPreviewPayloadTooLarge({ status: 500, error: '请求体过大' }), false);
    assert.strictEqual(isAgentsDiffPreviewPayloadTooLarge({ errorCode: 'payload-too-large' }), true);
});

test('shouldApplyAgentsDiffPreviewResponse only accepts the current visible request snapshot', () => {
    assert.strictEqual(shouldApplyAgentsDiffPreviewResponse({
        isVisible: true,
        requestToken: 'req-1',
        activeRequestToken: 'req-1',
        requestFingerprint: 'fp-1',
        currentFingerprint: 'fp-1'
    }), true);
    assert.strictEqual(shouldApplyAgentsDiffPreviewResponse({
        isVisible: false,
        requestToken: 'req-1',
        activeRequestToken: 'req-1',
        requestFingerprint: 'fp-1',
        currentFingerprint: 'fp-1'
    }), false);
    assert.strictEqual(shouldApplyAgentsDiffPreviewResponse({
        isVisible: true,
        requestToken: 'req-1',
        activeRequestToken: 'req-2',
        requestFingerprint: 'fp-1',
        currentFingerprint: 'fp-1'
    }), false);
    assert.strictEqual(shouldApplyAgentsDiffPreviewResponse({
        isVisible: true,
        requestToken: 'req-1',
        activeRequestToken: 'req-1',
        requestFingerprint: 'fp-1',
        currentFingerprint: 'fp-2'
    }), false);
});

test('formatLatency formats success and errors', () => {
    assert.strictEqual(formatLatency({ ok: true, durationMs: 120 }), '120ms');
    assert.strictEqual(formatLatency({ ok: false, status: 404 }), 'ERR 404');
    assert.strictEqual(formatLatency({ ok: false }), 'ERR');
    assert.strictEqual(formatLatency(null), '');
    assert.strictEqual(formatLatency({ ok: true, durationMs: undefined }), '0ms');
    assert.strictEqual(formatLatency({ ok: true, durationMs: '12' }), '0ms');
    assert.strictEqual(formatLatency({ ok: true, durationMs: Number.NaN }), '0ms');
    assert.strictEqual(formatLatency({ ok: true, durationMs: Number.POSITIVE_INFINITY }), '0ms');
});

test('buildSpeedTestIssue maps errors and status codes', () => {
    assert.strictEqual(buildSpeedTestIssue('p1', null), null);
    const missing = buildSpeedTestIssue('p1', { error: 'Provider not found' });
    assert.strictEqual(missing.code, 'remote-speedtest-provider-missing');

    const timeout = buildSpeedTestIssue('p1', { error: 'Request timeout' });
    assert.strictEqual(timeout.code, 'remote-speedtest-timeout');

    const auth = buildSpeedTestIssue('p1', { ok: false, status: 401 });
    assert.strictEqual(auth.code, 'remote-speedtest-auth-failed');

    const httpErr = buildSpeedTestIssue('p1', { ok: false, status: 500 });
    assert.strictEqual(httpErr.code, 'remote-speedtest-http-error');

    const ok = buildSpeedTestIssue('p1', { ok: true, status: 200 });
    assert.strictEqual(ok, null);

    const invalidUrl = buildSpeedTestIssue('p1', { error: 'Invalid URL' });
    assert.strictEqual(invalidUrl.code, 'remote-speedtest-invalid-url');

    const missingUrl = buildSpeedTestIssue('p1', { error: 'Missing name or url' });
    assert.strictEqual(missingUrl.code, 'remote-speedtest-baseurl-missing');

    const timeoutLower = buildSpeedTestIssue('p1', { error: 'timeout while fetching' });
    assert.strictEqual(timeoutLower.code, 'remote-speedtest-timeout');

    const generic = buildSpeedTestIssue('p1', { error: 'network unreachable' });
    assert.strictEqual(generic.code, 'remote-speedtest-unreachable');

    const auth403 = buildSpeedTestIssue('p1', { ok: false, status: 403 });
    assert.strictEqual(auth403.code, 'remote-speedtest-auth-failed');

    const http400 = buildSpeedTestIssue('p1', { ok: false, status: 400 });
    assert.strictEqual(http400.code, 'remote-speedtest-http-error');
});


test('runLatestOnlyQueue drains pending targets in order', async () => {
    let pending = '';
    const visited = [];
    const result = await runLatestOnlyQueue('alpha', {
        perform: async (target) => {
            visited.push(target);
            if (target === 'alpha') pending = 'beta';
            if (target === 'beta') pending = 'gamma';
        },
        consumePending: () => {
            const next = pending;
            pending = '';
            return next;
        }
    });
    assert.deepStrictEqual(visited, ['alpha', 'beta', 'gamma']);
    assert.strictEqual(result.lastTarget, 'gamma');
    assert.strictEqual(result.lastError, '');
});

test('runLatestOnlyQueue clears stale error after a later success', async () => {
    let pending = '';
    const visited = [];
    const result = await runLatestOnlyQueue('alpha', {
        perform: async (target) => {
            visited.push(target);
            if (target === 'alpha') {
                pending = 'beta';
                throw new Error('alpha failed');
            }
        },
        consumePending: () => {
            const next = pending;
            pending = '';
            return next;
        }
    });
    assert.deepStrictEqual(visited, ['alpha', 'beta']);
    assert.strictEqual(result.lastTarget, 'beta');
    assert.strictEqual(result.lastError, '');
});

test('runLatestOnlyQueue keeps error when final target fails', async () => {
    let pending = '';
    const visited = [];
    const result = await runLatestOnlyQueue('alpha', {
        perform: async (target) => {
            visited.push(target);
            if (target === 'alpha') {
                pending = 'beta';
                return;
            }
            if (target === 'beta') {
                throw new Error('beta failed');
            }
        },
        consumePending: () => {
            const next = pending;
            pending = '';
            return next;
        }
    });
    assert.deepStrictEqual(visited, ['alpha', 'beta']);
    assert.strictEqual(result.lastTarget, 'beta');
    assert.strictEqual(result.lastError, 'beta failed');
});

test('shouldForceCompactLayoutMode keeps desktop layout for narrow non-touch windows', () => {
    const enabled = shouldForceCompactLayoutMode({
        viewportWidth: 840,
        screenWidth: 1920,
        screenHeight: 1080,
        maxTouchPoints: 0,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        coarsePointer: false,
        noHover: false
    });
    assert.strictEqual(enabled, false);
});

test('shouldForceCompactLayoutMode enables compact mode for mobile UA on narrow viewport', () => {
    const enabled = shouldForceCompactLayoutMode({
        viewportWidth: 390,
        screenWidth: 390,
        screenHeight: 844,
        maxTouchPoints: 5,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile',
        coarsePointer: true,
        noHover: true
    });
    assert.strictEqual(enabled, true);
});

test('shouldForceCompactLayoutMode enables compact mode for phone-like touch device with desktop UA', () => {
    const enabled = shouldForceCompactLayoutMode({
        viewportWidth: 430,
        screenWidth: 430,
        screenHeight: 932,
        maxTouchPoints: 5,
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        coarsePointer: true,
        noHover: true
    });
    assert.strictEqual(enabled, true);
});

test('shouldForceCompactLayoutMode keeps desktop layout for touch laptop with large screen', () => {
    const enabled = shouldForceCompactLayoutMode({
        viewportWidth: 1366,
        screenWidth: 1366,
        screenHeight: 1024,
        maxTouchPoints: 10,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        coarsePointer: false,
        noHover: false
    });
    assert.strictEqual(enabled, false);
});

test('shouldForceCompactLayoutMode requires touch points for non-mobile UA compact fallback', () => {
    const enabled = shouldForceCompactLayoutMode({
        viewportWidth: 768,
        screenWidth: 768,
        screenHeight: 1024,
        maxTouchPoints: 0,
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        coarsePointer: true,
        noHover: true
    });
    assert.strictEqual(enabled, false);
});

test('isSessionQueryEnabled supports codex/claude/all', () => {
    assert.strictEqual(isSessionQueryEnabled('codex'), true);
    assert.strictEqual(isSessionQueryEnabled('CODEX'), true);
    assert.strictEqual(isSessionQueryEnabled('claude'), true);
    assert.strictEqual(isSessionQueryEnabled('ALL'), true);
    assert.strictEqual(isSessionQueryEnabled('openai'), false);
    assert.strictEqual(isSessionQueryEnabled(''), false);
});

test('normalizeSessionSource returns safe source value for session filters', () => {
    assert.strictEqual(normalizeSessionSource('codex'), 'codex');
    assert.strictEqual(normalizeSessionSource('CLAUDE'), 'claude');
    assert.strictEqual(normalizeSessionSource('all'), 'all');
    assert.strictEqual(normalizeSessionSource('unknown'), 'all');
    assert.strictEqual(normalizeSessionSource(''), 'all');
    assert.strictEqual(normalizeSessionSource(null), 'all');
});

test('normalizeSessionPathFilter trims path and handles non-string', () => {
    assert.strictEqual(normalizeSessionPathFilter('  D:/repo  '), 'D:/repo');
    assert.strictEqual(normalizeSessionPathFilter(''), '');
    assert.strictEqual(normalizeSessionPathFilter(null), '');
    assert.strictEqual(normalizeSessionPathFilter(undefined), '');
});

test('buildSessionFilterCacheState normalizes source/path for local cache', () => {
    const cached = buildSessionFilterCacheState('CLAUDE', '  D:/project/11/8  ');
    assert.deepStrictEqual(cached, {
        source: 'claude',
        pathFilter: 'D:/project/11/8'
    });

    const fallback = buildSessionFilterCacheState('invalid-source', null);
    assert.deepStrictEqual(fallback, {
        source: 'all',
        pathFilter: ''
    });
});

test('buildSessionListParams keeps claude code lexicon query when enabled', () => {
    const paramsClaude = buildSessionListParams({
        source: 'claude',
        query: 'claude code',
        roleFilter: 'all'
    });
    assert.strictEqual(paramsClaude.query, 'claude code');
    assert.strictEqual(paramsClaude.queryMode, 'and');
    assert.strictEqual(paramsClaude.queryScope, 'content');
});

test('buildSessionListParams keeps query for enabled sources', () => {
    const paramsCodex = buildSessionListParams({
        source: 'codex',
        query: 'test',
        pathFilter: ''
    });
    assert.strictEqual(paramsCodex.query, 'test');
    assert.strictEqual(paramsCodex.source, 'codex');
    assert.strictEqual(paramsCodex.limit, DEFAULT_SESSION_LIST_LIMIT);

    const paramsClaude = buildSessionListParams({
        source: 'claude',
        query: 'claude code',
        roleFilter: 'user'
    });
    assert.strictEqual(paramsClaude.query, 'claude code');
    assert.strictEqual(paramsClaude.source, 'claude');
    assert.strictEqual(paramsClaude.roleFilter, 'user');
    assert.strictEqual(paramsClaude.limit, DEFAULT_SESSION_LIST_LIMIT);

    const paramsAll = buildSessionListParams({
        source: 'all',
        query: 'claudecode',
        timeRangePreset: '7d'
    });
    assert.strictEqual(paramsAll.query, 'claudecode');
    assert.strictEqual(paramsAll.source, 'all');
    assert.strictEqual(paramsAll.timeRangePreset, '7d');
    assert.strictEqual(paramsAll.limit, DEFAULT_SESSION_LIST_LIMIT);
});

test('buildSessionListParams normalizes unsupported sources to all and preserves query behavior', () => {
    const params = buildSessionListParams({
        source: 'openai',
        query: 'hello',
        pathFilter: '/tmp',
        roleFilter: 'assistant'
    });
    assert.strictEqual(params.query, 'hello');
    assert.strictEqual(params.source, 'all');
    assert.strictEqual(params.pathFilter, '/tmp');
    assert.strictEqual(params.roleFilter, 'assistant');
    assert.strictEqual(params.limit, DEFAULT_SESSION_LIST_LIMIT);
    assert.strictEqual(params.forceRefresh, false);
    assert.strictEqual(params.queryScope, 'content');
    assert.strictEqual(params.contentScanLimit, 50);
});

test('buildSessionListParams preserves explicit forceRefresh requests', () => {
    const params = buildSessionListParams({
        source: 'codex',
        forceRefresh: true
    });
    assert.strictEqual(params.source, 'codex');
    assert.strictEqual(params.forceRefresh, true);
});

test('sortedSessionsList returns the original list without computing keys when no sessions are pinned', () => {
    const computed = createSessionComputed();
    const sessions = [{ sessionId: 'sess-1' }, { sessionId: 'sess-2' }];
    const result = computed.sortedSessionsList.call({
        sessionsList: sessions,
        sessionPinnedMap: {},
        getSessionExportKey() {
            throw new Error('should not compute session keys when no pins exist');
        }
    });

    assert.strictEqual(result, sessions);
});

test('sortedSessionsList moves pinned sessions to the front and keeps latest pins first', () => {
    const computed = createSessionComputed();
    const sessions = [
        { sessionId: 'sess-1', source: 'codex', filePath: '/tmp/a', messageCount: 1, updatedAt: '2026-04-09', title: 'A', sourceLabel: 'Codex' },
        { sessionId: 'sess-2', source: 'claude', filePath: '/tmp/b', messageCount: 2, updatedAt: '2026-04-08', title: 'B', sourceLabel: 'Claude' },
        { sessionId: 'sess-3', source: 'codex', filePath: '/tmp/c', messageCount: 3, updatedAt: '2026-04-07', title: 'C', sourceLabel: 'Codex' }
    ];
    const now = Date.now();
    const result = computed.sortedSessionsList.call({
        sessionsList: sessions,
        sessionPinnedMap: {
            'claude:sess-2:/tmp/b': now - 1000,
            'codex:sess-3:/tmp/c': now
        },
        getSessionExportKey(session) {
            return `${session.source}:${session.sessionId}:${session.filePath}`;
        }
    });

    assert.deepStrictEqual(result, [sessions[2], sessions[1], sessions[0]]);
});

test('visibleSessionsList keeps the active session inside the rendered window', () => {
    const computed = createSessionComputed();
    const sessions = Array.from({ length: 6 }, (_, index) => ({
        sessionId: `sess-${index + 1}`,
        source: 'codex',
        filePath: `/tmp/${index + 1}.jsonl`
    }));
    const result = computed.visibleSessionsList.call({
        sessionListRenderEnabled: true,
        sessionListVisibleCount: 2,
        sortedSessionsList: sessions,
        activeSession: sessions[4],
        getSessionExportKey(session) {
            return `${session.source}:${session.sessionId}:${session.filePath}`;
        }
    });

    assert.deepStrictEqual(result, sessions.slice(0, 5));
});

test('sessionUsageSummaryCards uses compact units for long token and context totals while preserving full values in titles', () => {
    const computed = createSessionComputed();
    const cards = computed.sessionUsageSummaryCards.call({
        sessionUsageCharts: {
            summary: {
                totalSessions: 12,
                totalMessages: 3456,
                totalTokens: 1234567,
                totalContextWindow: 256000,
                activeDurationMs: (2 * 24 * 60 * 60 * 1000) + (3 * 60 * 60 * 1000),
                totalDurationMs: (7 * 24 * 60 * 60 * 1000) + (5 * 60 * 60 * 1000),
                activeDays: 7,
                avgMessagesPerSession: 288,
                busiestDay: null,
                busiestHour: null
            }
        },
        sessionsUsageList: [],
        providersList: [],
        currentProvider: ''
    });

    const tokensCard = cards.find((card) => card.key === 'tokens');
    const contextCard = cards.find((card) => card.key === 'context-window');
    const costCard = cards.find((card) => card.key === 'estimated-cost');
    const activeDurationCard = cards.find((card) => card.key === 'active-duration');
    const totalDurationCard = cards.find((card) => card.key === 'total-duration');
    assert(tokensCard, 'missing tokens summary card');
    assert(contextCard, 'missing context summary card');
    assert(costCard, 'missing estimated cost summary card');
    assert(activeDurationCard, 'missing active duration summary card');
    assert(totalDurationCard, 'missing total duration summary card');
    assert.strictEqual(tokensCard.value, '1.2M');
    assert.strictEqual(tokensCard.title, '1,234,567');
    assert.strictEqual(contextCard.value, '256K');
    assert.strictEqual(contextCard.title, '256,000');
    assert.strictEqual(costCard.value, '暂无');
    assert.strictEqual(costCard.label, '预估费用 · 近 7 天');
    assert.strictEqual(costCard.note, '当前范围内暂无可估算会话');
    assert.strictEqual(activeDurationCard.value, '2天 3小时');
    assert.strictEqual(totalDurationCard.value, '7天 5小时');
});

test('buildUsageChartGroups keeps all used model names for the selected range and ignores records without concrete models', () => {
    const result = buildUsageChartGroups([
        {
            source: 'codex',
            modelId: 'gpt-5.3-codex',
            createdAt: '2026-04-10T07:30:00.000Z',
            updatedAt: '2026-04-10T08:00:00.000Z',
            messageCount: 4,
            totalTokens: 400000,
            contextWindow: 258400
        },
        {
            source: 'claude',
            modelName: 'claude-sonnet-4',
            createdAt: '2026-04-09T07:30:00.000Z',
            updatedAt: '2026-04-09T08:00:00.000Z',
            messageCount: 6,
            totalTokens: 500000,
            contextWindow: 300000
        },
        {
            source: 'codex',
            model: 'gpt-5.1-codex-max',
            createdAt: '2026-04-08T07:30:00.000Z',
            updatedAt: '2026-04-08T08:00:00.000Z',
            messageCount: 3,
            totalTokens: 200000,
            contextWindow: 128000
        },
        {
            source: 'codex',
            model: 'legacy-old-model',
            createdAt: '2026-03-01T07:30:00.000Z',
            updatedAt: '2026-03-01T08:00:00.000Z',
            messageCount: 1,
            totalTokens: 100000,
            contextWindow: 64000
        },
        {
            source: 'claude',
            createdAt: '2026-04-11T07:30:00.000Z',
            updatedAt: '2026-04-11T08:00:00.000Z',
            messageCount: 2,
            totalTokens: 90000,
            contextWindow: 64000
        },
        {
            source: 'codex',
            model: '<synthetic>',
            createdAt: '2026-04-11T09:30:00.000Z',
            updatedAt: '2026-04-11T10:00:00.000Z',
            messageCount: 8,
            totalTokens: 120000,
            contextWindow: 64000
        }
    ], {
        range: '7d',
        now: Date.UTC(2026, 3, 12, 12, 0, 0)
    });

    assert.deepStrictEqual(
        result.usedModels.map((item) => item.model),
        ['gpt-5.3-codex', 'claude-sonnet-4', 'gpt-5.1-codex-max']
    );
    assert.deepStrictEqual(result.usedModels[0].sourceLabels, ['Codex']);
    assert.deepStrictEqual(result.usedModels[1].sourceLabels, ['Claude Code']);
    assert.strictEqual(result.modelCoverage.totalSessions, 3);
    assert.strictEqual(result.modelCoverage.modeledSessions, 3);
    assert.strictEqual(result.modelCoverage.missingModelSessions, 0);
    assert.strictEqual(result.modelCoverage.providerOnlySessions, 0);
    assert.strictEqual(result.modelCoverage.coveragePercent, 100);
    assert.deepStrictEqual(result.modelCoverage.missingModelSourceTotals, { codex: 0, claude: 0 });
    assert.deepStrictEqual(result.modelCoverage.missingModelProviders, []);
    assert.deepStrictEqual(result.modelCoverage.missingModelSessionsPreview, []);
});

test('buildUsageChartGroups ignores provider-only and <synthetic> records', () => {
    const result = buildUsageChartGroups([
        {
            source: 'codex',
            provider: 'maxx',
            createdAt: '2026-02-28T06:49:25.018Z',
            updatedAt: '2026-02-28T06:49:26.697Z',
            messageCount: 1,
            totalTokens: 0,
            contextWindow: 0
        },
        {
            source: 'claude',
            model: '<synthetic>',
            createdAt: '2026-02-28T06:59:25.018Z',
            updatedAt: '2026-02-28T06:59:26.697Z',
            messageCount: 2,
            totalTokens: 10,
            contextWindow: 20
        }
    ], {
        range: 'all',
        now: Date.UTC(2026, 3, 12, 12, 0, 0)
    });

    assert.deepStrictEqual(result.usedModels, []);
    assert.strictEqual(result.modelCoverage.totalSessions, 0);
    assert.strictEqual(result.modelCoverage.modeledSessions, 0);
    assert.strictEqual(result.modelCoverage.missingModelSessions, 0);
    assert.strictEqual(result.modelCoverage.providerOnlySessions, 0);
    assert.strictEqual(result.modelCoverage.coveragePercent, 0);
    assert.deepStrictEqual(result.modelCoverage.missingModelSourceTotals, { codex: 0, claude: 0 });
    assert.deepStrictEqual(result.modelCoverage.missingModelProviders, []);
    assert.deepStrictEqual(result.modelCoverage.missingModelSessionsPreview, []);
});

test('buildUsageChartGroups collects every model name from session model arrays without double-counting coverage', () => {
    const result = buildUsageChartGroups([
        {
            source: 'codex',
            model: 'gpt-5.3-codex',
            models: ['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.3-codex'],
            createdAt: '2026-04-10T07:30:00.000Z',
            updatedAt: '2026-04-10T08:00:00.000Z',
            messageCount: 4,
            totalTokens: 400000,
            contextWindow: 258400
        },
        {
            source: 'codex',
            model: 'gpt-5.1-codex-max',
            createdAt: '2026-04-08T07:30:00.000Z',
            updatedAt: '2026-04-08T08:00:00.000Z',
            messageCount: 3,
            totalTokens: 200000,
            contextWindow: 128000
        }
    ], {
        range: 'all',
        now: Date.UTC(2026, 3, 12, 12, 0, 0)
    });

    assert.deepStrictEqual(
        result.usedModels.map((item) => item.model),
        ['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max']
    );
    assert.strictEqual(result.modelCoverage.totalSessions, 2);
    assert.strictEqual(result.modelCoverage.modeledSessions, 2);
    assert.strictEqual(result.modelCoverage.missingModelSessions, 0);
    assert.strictEqual(result.modelCoverage.providerOnlySessions, 0);
    assert.strictEqual(result.modelCoverage.coveragePercent, 100);
    assert.deepStrictEqual(result.modelCoverage.missingModelSourceTotals, { codex: 0, claude: 0 });
    assert.deepStrictEqual(result.modelCoverage.missingModelProviders, []);
    assert.deepStrictEqual(result.modelCoverage.missingModelSessionsPreview, []);
});

test('sessionUsageSummaryCards explains why usage cost is unavailable for the selected range', () => {
    const computed = createSessionComputed();
    const cards = computed.sessionUsageSummaryCards.call({
        sessionUsageCharts: {
            summary: {
                totalSessions: 2,
                totalMessages: 5,
                totalTokens: 320000,
                totalContextWindow: 128000,
                activeDurationMs: 20 * 60 * 1000,
                totalDurationMs: 20 * 60 * 1000,
                activeDays: 1,
                avgMessagesPerSession: 2.5,
                busiestDay: null,
                busiestHour: null
            }
        },
        sessionsUsageList: [
            {
                provider: 'maxx',
                model: 'gpt-5.1-codex-max',
                totalTokens: 200000,
                inputTokens: 120000,
                cachedInputTokens: 0,
                outputTokens: 80000,
                reasoningOutputTokens: 0
            },
            {
                provider: 'maxx',
                model: 'gpt-5.3-codex',
                totalTokens: 120000,
                inputTokens: undefined,
                cachedInputTokens: 0,
                outputTokens: undefined,
                reasoningOutputTokens: 0
            }
        ],
        sessionsUsageTimeRange: '7d',
        providersList: [],
        currentProvider: 'maxx'
    });

    const costCard = cards.find((card) => card.key === 'estimated-cost');
    assert(costCard, 'missing estimated cost summary card');
    assert.strictEqual(costCard.value, '暂无');
    assert.strictEqual(costCard.note, '覆盖 0/2 会话，1 个缺少模型单价，1 个缺少 token 拆分');
});

test('sessionUsageSummaryCards estimates usage cost from configured provider pricing', () => {
    const computed = createSessionComputed();
    const cards = computed.sessionUsageSummaryCards.call({
        sessionUsageCharts: {
            summary: {
                totalSessions: 2,
                totalMessages: 10,
                totalTokens: 600000,
                totalContextWindow: 256000,
                activeDurationMs: 90 * 60 * 1000,
                totalDurationMs: 3 * 24 * 60 * 60 * 1000,
                activeDays: 2,
                avgMessagesPerSession: 5,
                busiestDay: null,
                busiestHour: null
            }
        },
        sessionsUsageList: [
            {
                provider: 'maxx',
                model: 'gpt-5.3-codex',
                totalTokens: 400000,
                inputTokens: 300000,
                cachedInputTokens: 100000,
                outputTokens: 50000,
                reasoningOutputTokens: 50000
            },
            {
                provider: 'maxx',
                model: 'unknown-model',
                totalTokens: 200000,
                inputTokens: 100000,
                cachedInputTokens: 0,
                outputTokens: 100000,
                reasoningOutputTokens: 0
            }
        ],
        providersList: [
            {
                name: 'maxx',
                models: [
                    {
                        id: 'gpt-5.3-codex',
                        cost: {
                            input: 2,
                            output: 8,
                            cacheRead: 0.5,
                            cacheWrite: 0
                        }
                    }
                ]
            }
        ],
        currentProvider: 'maxx'
    });

    const costCard = cards.find((card) => card.key === 'estimated-cost');
    const activeDurationCard = cards.find((card) => card.key === 'active-duration');
    const totalDurationCard = cards.find((card) => card.key === 'total-duration');
    assert(costCard, 'missing estimated cost summary card');
    assert(activeDurationCard, 'missing active duration summary card');
    assert(totalDurationCard, 'missing total duration summary card');
    assert.strictEqual(costCard.value, '$1.25');
    assert.strictEqual(costCard.label, '预估费用 · 近 7 天');
    assert.strictEqual(costCard.note, '覆盖 1/2 会话，1 个缺少模型单价');
    assert.match(costCard.title, /覆盖 1\/2 个会话/);
    assert.match(costCard.title, /约 67% token/);
    assert.strictEqual(activeDurationCard.value, '1小时 30分');
    assert.strictEqual(totalDurationCard.value, '3天');
});

test('sessionUsageSummaryCards falls back to public catalog pricing when provider config omits models.cost', () => {
    const computed = createSessionComputed();
    const cards = computed.sessionUsageSummaryCards.call({
        sessionUsageCharts: {
            summary: {
                totalSessions: 1,
                totalMessages: 4,
                totalTokens: 400000,
                totalContextWindow: 258400,
                activeDurationMs: 30 * 60 * 1000,
                totalDurationMs: 30 * 60 * 1000,
                activeDays: 1,
                avgMessagesPerSession: 4,
                busiestDay: null,
                busiestHour: null
            }
        },
        sessionsUsageList: [
            {
                provider: 'maxx',
                model: 'gpt-5.3-codex',
                totalTokens: 400000,
                inputTokens: 300000,
                cachedInputTokens: 100000,
                outputTokens: 100000,
                reasoningOutputTokens: 0
            }
        ],
        providersList: [],
        currentProvider: 'maxx'
    });

    const costCard = cards.find((card) => card.key === 'estimated-cost');
    assert(costCard, 'missing estimated cost summary card');
    assert.strictEqual(costCard.value, '$1.77');
    assert.strictEqual(costCard.label, '预估费用 · 近 7 天');
    assert.strictEqual(costCard.note, '覆盖 1/1 会话');
    assert.match(costCard.title, /按公开模型目录估算/);
    assert.match(costCard.title, /覆盖 1\/1 个会话/);
});

test('sessionUsageSummaryCards excludes Claude sessions from estimated cost coverage', () => {
    const computed = createSessionComputed();
    const cards = computed.sessionUsageSummaryCards.call({
        sessionUsageCharts: {
            summary: {
                totalSessions: 2,
                totalMessages: 8,
                totalTokens: 650000,
                totalContextWindow: 258400,
                activeDurationMs: 50 * 60 * 1000,
                totalDurationMs: 50 * 60 * 1000,
                activeDays: 1,
                avgMessagesPerSession: 4,
                busiestDay: null,
                busiestHour: null
            }
        },
        sessionsUsageList: [
            {
                source: 'codex',
                provider: 'maxx',
                model: 'gpt-5.3-codex',
                totalTokens: 400000,
                inputTokens: 300000,
                cachedInputTokens: 100000,
                outputTokens: 100000,
                reasoningOutputTokens: 0
            },
            {
                source: 'claude',
                provider: 'claude',
                model: 'claude-3-7-sonnet',
                totalTokens: 250000,
                inputTokens: 150000,
                cachedInputTokens: 0,
                outputTokens: 100000,
                reasoningOutputTokens: 0
            }
        ],
        providersList: [],
        currentProvider: 'maxx'
    });

    const costCard = cards.find((card) => card.key === 'estimated-cost');
    assert(costCard, 'missing estimated cost summary card');
    assert.strictEqual(costCard.value, '$1.77');
    assert.strictEqual(costCard.note, '覆盖 1/1 会话，暂不含 Claude');
    assert.match(costCard.title, /暂不含 Claude/);
    assert.match(costCard.title, /覆盖 1\/1 个会话/);
});

test('sessionUsageSummaryCards respects configured zero-cost pricing instead of falling back to catalog rates', () => {
    const computed = createSessionComputed();
    const cards = computed.sessionUsageSummaryCards.call({
        sessionUsageCharts: {
            summary: {
                totalSessions: 1,
                totalMessages: 4,
                totalTokens: 400000,
                totalContextWindow: 258400,
                activeDurationMs: 30 * 60 * 1000,
                totalDurationMs: 30 * 60 * 1000,
                activeDays: 1,
                avgMessagesPerSession: 4,
                busiestDay: null,
                busiestHour: null
            }
        },
        sessionsUsageList: [
            {
                provider: 'maxx',
                model: 'gpt-5.3-codex',
                totalTokens: 400000,
                inputTokens: 300000,
                cachedInputTokens: 100000,
                outputTokens: 100000,
                reasoningOutputTokens: 0
            }
        ],
        providersList: [
            {
                name: 'maxx',
                models: [
                    {
                        id: 'gpt-5.3-codex',
                        cost: {
                            input: 0,
                            output: 0,
                            cacheRead: 0,
                            cacheWrite: 0
                        }
                    }
                ]
            }
        ],
        currentProvider: 'maxx'
    });

    const costCard = cards.find((card) => card.key === 'estimated-cost');
    assert(costCard, 'missing estimated cost summary card');
    assert.strictEqual(costCard.value, '$0.00');
    assert.strictEqual(costCard.note, '覆盖 1/1 会话');
    assert.match(costCard.title, /按已配置单价估算/);
});

test('sessionUsageSummaryCards uses fallback token totals when totalTokens is missing', () => {
    const computed = createSessionComputed();
    const cards = computed.sessionUsageSummaryCards.call({
        sessionUsageCharts: {
            summary: {
                totalSessions: 1,
                totalMessages: 4,
                totalTokens: 0,
                totalContextWindow: 258400,
                activeDurationMs: 30 * 60 * 1000,
                totalDurationMs: 30 * 60 * 1000,
                activeDays: 1,
                avgMessagesPerSession: 4,
                busiestDay: null,
                busiestHour: null
            }
        },
        sessionsUsageList: [
            {
                provider: 'maxx',
                model: 'gpt-5.3-codex',
                inputTokens: 300000,
                cachedInputTokens: 100000,
                outputTokens: 100000,
                reasoningOutputTokens: 0
            }
        ],
        providersList: [],
        currentProvider: 'maxx'
    });

    const costCard = cards.find((card) => card.key === 'estimated-cost');
    assert(costCard, 'missing estimated cost summary card');
    assert.strictEqual(costCard.value, '$1.77');
    assert.strictEqual(costCard.note, '覆盖 1/1 会话');
    assert.match(costCard.title, /约 100% token/);
});

test('sessionUsageSummaryCards recalculates estimated cost from the selected usage range', () => {
    const computed = createSessionComputed();
    const sessions = [
        {
            source: 'codex',
            provider: 'maxx',
            model: 'gpt-5.3-codex',
            createdAt: '2026-04-06T07:30:00.000Z',
            updatedAt: '2026-04-06T08:00:00.000Z',
            messageCount: 4,
            totalTokens: 400000,
            inputTokens: 300000,
            cachedInputTokens: 100000,
            outputTokens: 100000,
            reasoningOutputTokens: 0,
            contextWindow: 258400
        },
        {
            source: 'codex',
            provider: 'maxx',
            model: 'gpt-5.3-codex',
            createdAt: '2026-02-01T07:30:00.000Z',
            updatedAt: '2026-02-01T08:00:00.000Z',
            messageCount: 4,
            totalTokens: 800000,
            inputTokens: 400000,
            cachedInputTokens: 0,
            outputTokens: 400000,
            reasoningOutputTokens: 0,
            contextWindow: 258400
        }
    ];
    const cards = computed.sessionUsageSummaryCards.call({
        sessionUsageCharts: buildUsageChartGroups(sessions, {
            range: '30d',
            now: Date.UTC(2026, 3, 6, 12, 0, 0)
        }),
        sessionsUsageList: sessions,
        sessionsUsageTimeRange: '30d',
        providersList: [],
        currentProvider: 'maxx'
    });

    const costCard = cards.find((card) => card.key === 'estimated-cost');
    assert(costCard, 'missing estimated cost summary card');
    assert.strictEqual(costCard.value, '$1.77');
    assert.strictEqual(costCard.label, '预估费用 · 近 30 天');
    assert.strictEqual(costCard.note, '覆盖 1/1 会话');
    assert.match(costCard.title, /覆盖 1\/1 个会话/);
});

test('sessionUsageSummaryCards shows a distinct all-range estimated cost when older sessions exist', () => {
    const computed = createSessionComputed();
    const sessions = [
        {
            source: 'codex',
            provider: 'maxx',
            model: 'gpt-5.3-codex',
            createdAt: '2026-04-10T07:30:00.000Z',
            updatedAt: '2026-04-10T08:00:00.000Z',
            messageCount: 4,
            totalTokens: 400000,
            inputTokens: 300000,
            cachedInputTokens: 100000,
            outputTokens: 100000,
            reasoningOutputTokens: 0,
            contextWindow: 258400
        },
        {
            source: 'codex',
            provider: 'maxx',
            model: 'gpt-5.3-codex',
            createdAt: '2026-02-01T07:30:00.000Z',
            updatedAt: '2026-02-01T08:00:00.000Z',
            messageCount: 4,
            totalTokens: 800000,
            inputTokens: 400000,
            cachedInputTokens: 0,
            outputTokens: 400000,
            reasoningOutputTokens: 0,
            contextWindow: 258400
        }
    ];
    const cards = computed.sessionUsageSummaryCards.call({
        sessionUsageCharts: buildUsageChartGroups(sessions, {
            range: 'all',
            now: Date.UTC(2026, 3, 12, 12, 0, 0)
        }),
        sessionsUsageList: sessions,
        sessionsUsageTimeRange: 'all',
        providersList: [],
        currentProvider: 'maxx'
    });

    const costCard = cards.find((card) => card.key === 'estimated-cost');
    assert(costCard, 'missing estimated cost summary card');
    assert.strictEqual(costCard.value, '$8.07');
    assert.strictEqual(costCard.label, '预估费用 · 全部');
    assert.strictEqual(costCard.note, '覆盖 2/2 会话');
    assert.match(costCard.title, /估算 \$8\.07/);
    assert.match(costCard.title, /覆盖 2\/2 个会话/);
});

test('activeSessionVisibleMessages falls back to the initial preview batch before priming completes', () => {
    const computed = createSessionComputed();
    const messages = Array.from({ length: 12 }, (_, index) => ({ id: index + 1 }));
    const result = computed.activeSessionVisibleMessages.call({
        mainTab: 'sessions',
        sessionPreviewRenderEnabled: true,
        activeSessionMessages: messages,
        sessionPreviewInitialBatchSize: 5,
        sessionPreviewVisibleCount: 0
    });

    assert.deepStrictEqual(result, messages.slice(0, 5));
});

test('formatSessionTimelineTimestamp normalizes ISO-like strings for timeline labels', () => {
    assert.strictEqual(formatSessionTimelineTimestamp('2026-03-23T09:10:11.000Z'), '03-23 09:10:11');
    assert.strictEqual(formatSessionTimelineTimestamp('2026-03-23 19:20:00'), '03-23 19:20:00');
    assert.strictEqual(formatSessionTimelineTimestamp('not-a-time'), 'not-a-time');
    assert.strictEqual(formatSessionTimelineTimestamp(''), '');
});

test('buildSessionTimelineNodes builds per-message node metadata', () => {
    const nodes = buildSessionTimelineNodes([
        { role: 'user', timestamp: '2026-03-23T09:00:00Z' },
        { role: 'assistant', timestamp: '2026-03-23T09:01:00Z' },
        { role: 'system', timestamp: '' }
    ], {
        getKey(message, idx) {
            return `${message.role}-${idx}`;
        }
    });

    assert.strictEqual(nodes.length, 3);
    assert.strictEqual(nodes[0].key, 'user-0');
    assert.strictEqual(nodes[0].role, 'user');
    assert.strictEqual(nodes[0].roleShort, 'U');
    assert.strictEqual(nodes[0].displayTime, '03-23 09:00:00');
    assert.strictEqual(nodes[0].title, '#1 · User · 03-23 09:00:00');
    assert.strictEqual(nodes[0].percent, 0);
    assert.strictEqual(nodes[0].safePercent, 6);

    assert.strictEqual(nodes[1].key, 'assistant-1');
    assert.strictEqual(nodes[1].roleShort, 'A');
    assert.strictEqual(nodes[1].percent, 50);
    assert.strictEqual(nodes[1].safePercent, 50);

    assert.strictEqual(nodes[2].key, 'system-2');
    assert.strictEqual(nodes[2].roleShort, 'S');
    assert.strictEqual(nodes[2].title, '#3 · System');
    assert.strictEqual(nodes[2].percent, 100);
    assert.strictEqual(nodes[2].safePercent, 94);
});

test('buildSessionTimelineNodes groups dense messages to avoid overlapping markers', () => {
    const messages = Array.from({ length: 90 }, (_, idx) => ({
        role: idx % 3 === 0 ? 'user' : (idx % 3 === 1 ? 'assistant' : 'system'),
        timestamp: `2026-03-23T09:${String(idx % 60).padStart(2, '0')}:00Z`
    }));

    const nodes = buildSessionTimelineNodes(messages, {
        maxMarkers: 30,
        getKey(_message, idx) {
            return `msg-${idx}`;
        }
    });

    assert.strictEqual(nodes.length, 30);
    assert.strictEqual(nodes[0].key, 'msg-1');
    assert.strictEqual(nodes[0].role, 'mixed');
    assert.strictEqual(nodes[0].messageCount, 3);
    assert.strictEqual(nodes[0].startIndex, 0);
    assert.strictEqual(nodes[0].endIndex, 2);

    const last = nodes[nodes.length - 1];
    assert.strictEqual(last.key, 'msg-88');
    assert.strictEqual(last.messageCount, 3);
    assert.strictEqual(last.startIndex, 87);
    assert.strictEqual(last.endIndex, 89);

    assert.ok(nodes.every(node => node.safePercent >= 6 && node.safePercent <= 94));
});

test('buildSessionTimelineNodes keeps near-max marker density when total is just above cap', () => {
    const messages = Array.from({ length: 31 }, (_, idx) => ({
        role: idx % 2 === 0 ? 'user' : 'assistant',
        timestamp: `2026-03-23T09:${String(idx % 60).padStart(2, '0')}:00Z`
    }));
    const nodes = buildSessionTimelineNodes(messages, {
        maxMarkers: 30,
        getKey(_message, idx) {
            return `msg-${idx}`;
        }
    });

    assert.strictEqual(nodes.length, 30);
    assert.strictEqual(nodes[0].startIndex, 0);
    assert.strictEqual(nodes[0].endIndex, 0);
    const last = nodes[nodes.length - 1];
    assert.strictEqual(last.startIndex, 29);
    assert.strictEqual(last.endIndex, 30);
    assert.strictEqual(last.messageCount, 2);
});

test('buildSessionTimelineNodes clamps maxMarkers into 1..80 and falls back on non-numeric values', () => {
    const messages = Array.from({ length: 800 }, (_, idx) => ({
        role: idx % 2 === 0 ? 'user' : 'assistant',
        timestamp: `2026-03-23T09:${String(idx % 60).padStart(2, '0')}:00Z`
    }));

    const scenarios = [
        { maxMarkers: 0, expectedLength: 1 },
        { maxMarkers: -5, expectedLength: 1 },
        { maxMarkers: 'not-a-number', expectedLength: 30 },
        { maxMarkers: 10.7, expectedLength: 10 },
        { maxMarkers: 999, expectedLength: 80 }
    ];

    for (const scenario of scenarios) {
        const nodes = buildSessionTimelineNodes(messages, {
            maxMarkers: scenario.maxMarkers,
            getKey(_message, idx) {
                return `msg-${idx}`;
            }
        });

        assert.strictEqual(nodes.length, scenario.expectedLength);
        assert.ok(nodes.length >= 1);
        assert.ok(nodes[0].key.startsWith('msg-'));
        assert.ok(Number.isInteger(nodes[0].startIndex) && nodes[0].startIndex >= 0);
        assert.ok(Number.isInteger(nodes[0].endIndex) && nodes[0].endIndex >= nodes[0].startIndex);
        assert.ok(Number.isInteger(nodes[0].messageCount) && nodes[0].messageCount > 0);
        assert.ok(nodes[0].safePercent >= 6 && nodes[0].safePercent <= 94);

        const last = nodes[nodes.length - 1];
        assert.ok(last.key.startsWith('msg-'));
        assert.ok(Number.isInteger(last.startIndex) && last.startIndex >= 0);
        assert.ok(Number.isInteger(last.endIndex) && last.endIndex >= last.startIndex);
        assert.ok(Number.isInteger(last.messageCount) && last.messageCount > 0);
        assert.strictEqual(last.endIndex, messages.length - 1);
        assert.ok(last.safePercent >= 6 && last.safePercent <= 94);
    }
});

test('taskOrchestrationDraftReadiness highlights missing workflow ids and preview needs', () => {
    const computed = createMainTabsComputed();
    const context = {
        taskOrchestration: {
            target: '批量检查配置并整理结果',
            notes: '',
            workflowIdsText: '',
            followUpsText: '整理结论',
            selectedEngine: 'workflow',
            allowWrite: true,
            dryRun: false,
            plan: null,
            planIssues: [],
            planWarnings: []
        }
    };
    context.taskOrchestrationDraftMetrics = computed.taskOrchestrationDraftMetrics.call(context);
    context.taskOrchestrationDraftChecklist = computed.taskOrchestrationDraftChecklist.call(context);
    const readiness = computed.taskOrchestrationDraftReadiness.call(context);

    assert.strictEqual(readiness.tone, 'warn');
    assert.strictEqual(readiness.title, '缺少 Workflow');
    assert.match(readiness.summary, /还没指定可复用流程/);
    assert.strictEqual(context.taskOrchestrationDraftChecklist[1].done, false);
    assert.match(context.taskOrchestrationDraftChecklist[2].detail, /建议补说明/);
});

test('taskOrchestrationDraftReadiness marks ready plans as executable', () => {
    const computed = createMainTabsComputed();
    const context = {
        taskOrchestration: {
            target: '修复 review 评论并补回归测试',
            notes: '不要改无关模块',
            workflowIdsText: '',
            followUpsText: '更新 PR 摘要\n继续看新增 review',
            selectedEngine: 'codex',
            allowWrite: true,
            dryRun: false,
            plan: {
                nodes: [{ id: 'node-1' }, { id: 'node-2' }]
            },
            planIssues: [],
            planWarnings: []
        }
    };
    context.taskOrchestrationDraftMetrics = computed.taskOrchestrationDraftMetrics.call(context);
    context.taskOrchestrationDraftChecklist = computed.taskOrchestrationDraftChecklist.call(context);
    const readiness = computed.taskOrchestrationDraftReadiness.call(context);

    assert.strictEqual(readiness.tone, 'success');
    assert.strictEqual(readiness.title, '可以执行');
    assert.strictEqual(context.taskOrchestrationDraftMetrics.followUpCount, 2);
    assert.strictEqual(context.taskOrchestrationDraftChecklist[3].done, true);
});

test('appendTaskWorkflowId deduplicates ids and forces workflow engine', () => {
    const methods = createTaskOrchestrationMethods({ api: async () => ({}) });
    const context = {
        taskOrchestration: {
            workflowIdsText: 'diagnose-config',
            selectedEngine: 'codex'
        },
        ensureTaskOrchestrationState: methods.ensureTaskOrchestrationState
    };

    methods.appendTaskWorkflowId.call(context, 'safe-provider-switch');
    methods.appendTaskWorkflowId.call(context, 'diagnose-config');

    assert.strictEqual(context.taskOrchestration.selectedEngine, 'workflow');
    assert.strictEqual(context.taskOrchestration.workflowIdsText, 'diagnose-config\nsafe-provider-switch');
});

test('ensureTaskOrchestrationState creates workbench defaults including workspaceTab', () => {
    const methods = createTaskOrchestrationMethods({ api: async () => ({}) });
    const context = {};
    const state = methods.ensureTaskOrchestrationState.call(context);

    assert.strictEqual(state.workspaceTab, 'queue');
    assert.strictEqual(state.selectedRunError, '');
    assert.strictEqual(state.detailRequestToken, 0);
    assert.deepStrictEqual(state.overviewWarnings, []);
});

test('ensureTaskOrchestrationState backfills missing workbench fields on existing state', () => {
    const methods = createTaskOrchestrationMethods({ api: async () => ({}) });
    const context = {
        taskOrchestration: {
            target: 'keep-me',
            workspaceTab: 'runs'
        }
    };

    const state = methods.ensureTaskOrchestrationState.call(context);

    assert.strictEqual(state.target, 'keep-me');
    assert.strictEqual(state.workspaceTab, 'runs');
    assert.strictEqual(state.selectedRunError, '');
    assert.strictEqual(state.detailRequestToken, 0);
    assert.deepStrictEqual(state.overviewWarnings, []);
});

test('taskOrchestrationSelectedRunNodes prefers top-level detail nodes when present', () => {
    const computed = createMainTabsComputed();
    const context = {
        taskOrchestrationSelectedRun: {
            run: {
                nodes: [{ id: 'run-node' }]
            },
            nodes: [{ id: 'detail-node' }]
        }
    };

    const nodes = computed.taskOrchestrationSelectedRunNodes.call(context);

    assert.deepStrictEqual(nodes, [{ id: 'detail-node' }]);
});

test('taskOrchestrationQueueStats counts queue statuses in one pass without changing totals', () => {
    const computed = createMainTabsComputed();
    const context = {
        taskOrchestration: {
            queue: [
                { status: 'queued' },
                { status: ' queued ' },
                { status: 'running' },
                { status: 'FAILED' },
                { status: 'ignored' }
            ]
        }
    };

    const stats = computed.taskOrchestrationQueueStats.call(context);

    assert.deepStrictEqual(stats, {
        queued: 2,
        running: 1,
        failed: 1
    });
});

test('startTaskQueueRunner surfaces already-running queue state distinctly', async () => {
    const api = async (name) => {
        if (name === 'task-queue-start') {
            return { started: false, alreadyRunning: true };
        }
        if (name === 'task-overview') {
            return { queue: [], runs: [], workflows: [], warnings: [] };
        }
        return {};
    };
    const methods = createTaskOrchestrationMethods({ api });
    const messages = [];
    const context = {
        ensureTaskOrchestrationState: methods.ensureTaskOrchestrationState,
        loadTaskOrchestrationOverview: methods.loadTaskOrchestrationOverview,
        syncTaskOrchestrationPolling() {},
        showMessage(message, tone) {
            messages.push({ message, tone });
        }
    };
    context.taskOrchestration = methods.ensureTaskOrchestrationState.call(context);

    await methods.startTaskQueueRunner.call(context);

    assert.deepStrictEqual(messages, [
        {
            message: '队列执行器已在运行',
            tone: 'success'
        }
    ]);
});

test('loadTaskOrchestrationOverview keeps selected run detail when overview slice omits it', async () => {
    const methods = createTaskOrchestrationMethods({
        api: async (name) => {
            if (name === 'task-overview') {
                return {
                    runs: [{ runId: 'run-new', status: 'running' }],
                    queue: [],
                    workflows: [],
                    warnings: []
                };
            }
            throw new Error(`unexpected api call: ${name}`);
        }
    });
    const context = {
        ensureTaskOrchestrationState: methods.ensureTaskOrchestrationState,
        loadTaskRunDetail: async () => null,
        isTaskRunActive: () => false,
        showMessage() {},
        syncTaskOrchestrationPolling() {}
    };
    context.taskOrchestration = methods.ensureTaskOrchestrationState.call(context);
    context.taskOrchestration.selectedRunId = 'run-old';
    context.taskOrchestration.selectedRunDetail = { run: { runId: 'run-old', status: 'success' }, nodes: [{ id: 'kept' }] };

    await methods.loadTaskOrchestrationOverview.call(context, { silent: true, includeDetail: false });

    assert.strictEqual(context.taskOrchestration.selectedRunId, 'run-old');
    assert.strictEqual(context.taskOrchestration.selectedRunDetail.run.runId, 'run-old');
});

test('selectTaskRun switches workbench to detail and keeps latest detail response only', async () => {
    const deferred = [];
    const api = async (name, payload) => {
        if (name !== 'task-run-detail') {
            return {};
        }
        let resolve;
        const promise = new Promise((nextResolve) => {
            resolve = nextResolve;
        });
        deferred.push({ payload, resolve });
        return promise;
    };
    const methods = createTaskOrchestrationMethods({ api });
    const context = {
        ensureTaskOrchestrationState: methods.ensureTaskOrchestrationState,
        loadTaskRunDetail: methods.loadTaskRunDetail,
        selectTaskRun: methods.selectTaskRun,
        showMessage() {},
        syncTaskOrchestrationPolling() {}
    };
    context.taskOrchestration = methods.ensureTaskOrchestrationState.call(context);

    const firstRequest = methods.selectTaskRun.call(context, 'run-1');
    const secondRequest = methods.selectTaskRun.call(context, 'run-2');

    assert.strictEqual(context.taskOrchestration.workspaceTab, 'detail');
    assert.strictEqual(context.taskOrchestration.selectedRunId, 'run-2');
    assert.strictEqual(deferred.length, 2);

    deferred[1].resolve({ run: { runId: 'run-2', status: 'running' }, nodes: [] });
    await secondRequest;
    deferred[0].resolve({ run: { runId: 'run-1', status: 'failed' }, nodes: [{ id: 'stale' }] });
    await firstRequest;

    assert.strictEqual(context.taskOrchestration.selectedRunDetail.run.runId, 'run-2');
    assert.strictEqual(context.taskOrchestration.selectedRunError, '');
});
