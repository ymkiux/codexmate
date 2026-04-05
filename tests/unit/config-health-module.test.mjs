import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const {
    runRemoteHealthCheck,
    buildConfigHealthReport
} = require(path.join(__dirname, '..', '..', 'cli', 'config-health.js'));
const {
    buildModelProbeSpec,
    buildModelProbeSpecs
} = require(path.join(__dirname, '..', '..', 'lib', 'cli-models-utils.js'));

test('runRemoteHealthCheck returns ai-healthcheck style success summary on 200', async () => {
    const result = await runRemoteHealthCheck('openai', {
        base_url: 'https://api.openai.com/v1',
        preferred_auth_method: 'sk-demo',
        wire_api: 'responses'
    }, 'gpt-5-mini', {
        probeJsonPost: async () => ({
            ok: true,
            status: 200,
            durationMs: 12,
            body: '{"id":"resp_1"}'
        })
    });

    assert.deepStrictEqual(result.issues, []);
    assert.strictEqual(result.remote.type, 'remote-health-check');
    assert.strictEqual(result.remote.provider, 'openai');
    assert.strictEqual(result.remote.endpoint, 'https://api.openai.com/v1');
    assert.strictEqual(result.remote.ok, true);
    assert.strictEqual(result.remote.statusCode, 200);
    assert.match(result.remote.message, /远程模型探测通过/);
    assert.strictEqual(result.remote.checks.modelProbe.url, 'https://api.openai.com/v1/responses');
});

test('runRemoteHealthCheck reports auth failure with stable summary fields', async () => {
    const result = await runRemoteHealthCheck('openai', {
        base_url: 'https://api.openai.com',
        preferred_auth_method: 'sk-demo',
        wire_api: 'chat/completions'
    }, 'gpt-5-mini', {
        probeJsonPost: async () => ({
            ok: true,
            status: 401,
            durationMs: 8,
            body: '{"error":{"message":"Unauthorized"}}'
        })
    });

    assert.strictEqual(result.remote.ok, false);
    assert.strictEqual(result.remote.statusCode, 401);
    assert.match(result.remote.message, /401\/403/);
    assert(
        result.issues.some((issue) => issue.code === 'remote-model-probe-auth-failed'),
        'expected auth failure issue code'
    );
});

test('runRemoteHealthCheck falls back to a direct responses path when base_url already contains a provider route', async () => {
    const seenUrls = [];
    const result = await runRemoteHealthCheck('maxx', {
        base_url: 'https://maxx-direct.cloverstd.com/project/ym',
        preferred_auth_method: 'maxx-demo',
        wire_api: 'responses'
    }, 'gpt-5.4', {
        probeJsonPost: async (url) => {
            seenUrls.push(url);
            if (url.endsWith('/project/ym/responses')) {
                return {
                    ok: true,
                    status: 200,
                    durationMs: 6,
                    body: '{"id":"resp_ok"}'
                };
            }
            return {
                ok: false,
                error: 'timeout',
                durationMs: 12,
                body: ''
            };
        }
    });

    assert.deepStrictEqual(seenUrls, ['https://maxx-direct.cloverstd.com/project/ym/responses']);
    assert.strictEqual(result.remote.ok, true);
    assert.strictEqual(result.remote.statusCode, 200);
    assert.strictEqual(result.remote.checks.modelProbe.url, 'https://maxx-direct.cloverstd.com/project/ym/responses');
    assert.deepStrictEqual(result.issues, []);
});

test('buildModelProbeSpecs keeps direct provider routes ahead of injected /v1 fallback', () => {
    const specs = buildModelProbeSpecs(
        { wire_api: 'responses' },
        'gpt-5.4',
        'https://maxx-direct.cloverstd.com/project/ym'
    );
    assert.deepStrictEqual(
        specs.map((item) => item.url),
        [
            'https://maxx-direct.cloverstd.com/project/ym/responses',
            'https://maxx-direct.cloverstd.com/project/ym/v1/responses'
        ]
    );
    assert.strictEqual(
        buildModelProbeSpec(
            { wire_api: 'responses' },
            'gpt-5.4',
            'https://maxx-direct.cloverstd.com/project/ym'
        ).url,
        'https://maxx-direct.cloverstd.com/project/ym/responses'
    );
});

test('buildConfigHealthReport includes remote-health-check result when remote mode is enabled', async () => {
    const report = await buildConfigHealthReport({ remote: true }, {
        readConfigOrVirtualDefault() {
            return {
                isVirtual: false,
                config: {
                    model_provider: 'alpha',
                    model: 'alpha-model',
                    model_providers: {
                        alpha: {
                            base_url: 'https://example.com',
                            preferred_auth_method: 'sk-alpha',
                            wire_api: 'responses'
                        }
                    }
                }
            };
        },
        readModels() {
            return ['alpha-model'];
        },
        probeJsonPost: async () => ({
            ok: true,
            status: 200,
            durationMs: 5,
            body: '{"ok":true}'
        })
    });

    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.remote.type, 'remote-health-check');
    assert.strictEqual(report.remote.statusCode, 200);
    assert.deepStrictEqual(report.issues, []);
});
