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
    buildSpeedTestIssue
} = logic;

test('normalizeClaudeValue trims strings and ignores non-string', () => {
    assert.strictEqual(normalizeClaudeValue('  abc  '), 'abc');
    assert.strictEqual(normalizeClaudeValue(123), '');
});

test('normalizeClaudeConfig trims all fields', () => {
    const cfg = normalizeClaudeConfig({ apiKey: ' key ', baseUrl: ' url ', model: ' model ' });
    assert.deepStrictEqual(cfg, { apiKey: 'key', baseUrl: 'url', model: 'model' });
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

test('findDuplicateClaudeConfigName detects duplicates', () => {
    const configs = {
        first: { apiKey: 'k1', baseUrl: 'u1', model: 'm1' },
        second: { apiKey: 'k2', baseUrl: 'u2', model: 'm2' }
    };
    const duplicate = { apiKey: 'k2', baseUrl: 'u2', model: 'm2' };
    assert.strictEqual(findDuplicateClaudeConfigName(configs, duplicate), 'second');
});

test('formatLatency formats success and errors', () => {
    assert.strictEqual(formatLatency({ ok: true, durationMs: 120 }), '120ms');
    assert.strictEqual(formatLatency({ ok: false, status: 404 }), 'ERR 404');
    assert.strictEqual(formatLatency({ ok: false }), 'ERR');
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
});
