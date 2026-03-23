import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logic = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'logic.mjs')));
const {
    normalizeClaudeValue,
    normalizeClaudeConfig,
    normalizeClaudeSettingsEnv,
    matchClaudeConfigFromSettings,
    findDuplicateClaudeConfigName,
    formatLatency,
    buildSpeedTestIssue,
    isSessionQueryEnabled,
    normalizeSessionSource,
    normalizeSessionPathFilter,
    buildSessionFilterCacheState,
    buildSessionListParams,
    formatSessionTimelineTimestamp,
    buildSessionTimelineNodes
} = logic;

test('normalizeClaudeValue trims strings and ignores non-string', () => {
    assert.strictEqual(normalizeClaudeValue('  abc  '), 'abc');
    assert.strictEqual(normalizeClaudeValue(123), '');
    assert.strictEqual(normalizeClaudeValue(null), '');
});

test('normalizeClaudeConfig trims all fields', () => {
    const cfg = normalizeClaudeConfig({ apiKey: ' key ', baseUrl: ' url ', model: ' model ' });
    assert.deepStrictEqual(cfg, { apiKey: 'key', baseUrl: 'url', model: 'model' });
});

test('normalizeClaudeSettingsEnv trims settings env', () => {
    const env = { ANTHROPIC_API_KEY: ' key ', ANTHROPIC_BASE_URL: ' url ', ANTHROPIC_MODEL: ' model ' };
    assert.deepStrictEqual(normalizeClaudeSettingsEnv(env), { apiKey: 'key', baseUrl: 'url', model: 'model' });
});

test('normalizeClaudeSettingsEnv fills missing fields with empty strings', () => {
    const env = { ANTHROPIC_API_KEY: 'k' };
    assert.deepStrictEqual(normalizeClaudeSettingsEnv(env), { apiKey: 'k', baseUrl: '', model: '' });
});

test('matchClaudeConfigFromSettings matches identical config', () => {
    const configs = { default: { apiKey: 'k', baseUrl: 'u', model: 'm' } };
    const env = { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'u', ANTHROPIC_MODEL: 'm' };
    assert.strictEqual(matchClaudeConfigFromSettings(configs, env), 'default');
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

test('findDuplicateClaudeConfigName returns empty when no match', () => {
    const configs = { only: { apiKey: 'k', baseUrl: 'u', model: 'm' } };
    const another = { apiKey: 'k', baseUrl: 'u', model: 'm-2' };
    assert.strictEqual(findDuplicateClaudeConfigName(configs, another), '');
});

test('formatLatency formats success and errors', () => {
    assert.strictEqual(formatLatency({ ok: true, durationMs: 120 }), '120ms');
    assert.strictEqual(formatLatency({ ok: false, status: 404 }), 'ERR 404');
    assert.strictEqual(formatLatency({ ok: false }), 'ERR');
    assert.strictEqual(formatLatency(null), '');
    assert.strictEqual(formatLatency({ ok: true, durationMs: undefined }), '0ms');
    assert.strictEqual(formatLatency({ ok: true, durationMs: '12' }), '0ms');
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
    assert.strictEqual(paramsCodex.limit, 200);

    const paramsClaude = buildSessionListParams({
        source: 'claude',
        query: 'claude code',
        roleFilter: 'user'
    });
    assert.strictEqual(paramsClaude.query, 'claude code');
    assert.strictEqual(paramsClaude.source, 'claude');
    assert.strictEqual(paramsClaude.roleFilter, 'user');
    assert.strictEqual(paramsClaude.limit, 200);

    const paramsAll = buildSessionListParams({
        source: 'all',
        query: 'claudecode',
        timeRangePreset: '7d'
    });
    assert.strictEqual(paramsAll.query, 'claudecode');
    assert.strictEqual(paramsAll.source, 'all');
    assert.strictEqual(paramsAll.timeRangePreset, '7d');
    assert.strictEqual(paramsAll.limit, 200);
});

test('buildSessionListParams clears query for unsupported sources', () => {
    const params = buildSessionListParams({
        source: 'openai',
        query: 'hello',
        pathFilter: '/tmp',
        roleFilter: 'assistant'
    });
    assert.strictEqual(params.query, '');
    assert.strictEqual(params.source, 'openai');
    assert.strictEqual(params.pathFilter, '/tmp');
    assert.strictEqual(params.roleFilter, 'assistant');
    assert.strictEqual(params.limit, 200);
    assert.strictEqual(params.forceRefresh, true);
    assert.strictEqual(params.queryScope, 'content');
    assert.strictEqual(params.contentScanLimit, 50);
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
