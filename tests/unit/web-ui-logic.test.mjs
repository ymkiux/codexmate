import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logic = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'logic.mjs')));
const { createSessionComputed } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.computed.session.mjs'))
);
const {
    DEFAULT_SESSION_LIST_FAST_LIMIT,
    DEFAULT_SESSION_LIST_LIMIT,
    normalizeClaudeValue,
    normalizeClaudeConfig,
    normalizeClaudeSettingsEnv,
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
