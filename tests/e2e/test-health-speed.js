const path = require('path');
const {
    assert,
    normalizeWireApi,
    buildModelProbeSpec,
    buildModelConversationSpecs,
    extractModelResponseText,
    fileMode,
    writeJsonAtomic
} = require('./helpers');

module.exports = async function testHealthAndSpeed(ctx) {
    const { api, mockProviderUrl, authFailUrl, routedProviderUrl, routedProviderRequests, tmpHome } = ctx;

    // ========== Speed Test Tests - Provider ==========
    const speedResult = await api('speed-test', { name: 'e2e2' });
    assert(speedResult.ok === true, 'speed-test failed');
    assert(typeof speedResult.durationMs === 'number', 'speed-test missing durationMs');
    assert(speedResult.durationMs >= 0, 'speed-test durationMs should be non-negative');

    // ========== Speed Test Tests - URL ==========
    const speedByUrl = await api('speed-test', { url: mockProviderUrl });
    assert(speedByUrl.ok === true, 'speed-test(url) failed');
    assert(typeof speedByUrl.durationMs === 'number', 'speed-test(url) missing durationMs');

    // ========== Speed Test Tests - Invalid URL ==========
    const speedInvalid = await api('speed-test', { url: 'not-a-url' });
    assert(speedInvalid.ok === false || speedInvalid.error, 'speed-test invalid url should fail');

    const speedEmptyUrl = await api('speed-test', { url: '' });
    assert(speedEmptyUrl.ok === false || speedEmptyUrl.error, 'speed-test empty url should fail');

    // ========== Speed Test Tests - Auth Fail ==========
    const speedAuthFail = await api('speed-test', { url: authFailUrl });
    assert(
        speedAuthFail.status === 401 || (speedAuthFail.error && /401/.test(speedAuthFail.error)),
        'speed-test auth fail should expose 401'
    );

    // ========== Speed Test Tests - Unreachable ==========
    const speedUnreachable = await api('speed-test', { url: 'http://127.0.0.1:1' });
    assert(speedUnreachable.ok === false || speedUnreachable.error, 'speed-test unreachable should fail');

    // ========== Speed Test Tests - Missing Provider ==========
    const speedMissingProvider = await api('speed-test', { name: 'nonexistent' });
    assert(speedMissingProvider.error, 'speed-test should fail for missing provider');

    // ========== Speed Test Tests - Empty Provider ==========
    const speedEmptyProvider = await api('speed-test', { name: '' });
    assert(speedEmptyProvider.error, 'speed-test should fail for empty provider');

    // ========== Config Health Check Tests - Local ==========
    const healthLocal = await api('config-health-check', { remote: false });
    assert('ok' in healthLocal, 'config-health-check missing ok');
    assert(Array.isArray(healthLocal.issues), 'config-health-check missing issues');

    // ========== Config Health Check Tests - Remote ==========
    const healthRemote = await api('config-health-check', { remote: true });
    assert('ok' in healthRemote, 'config-health-check(remote) missing ok');
    assert('remote' in healthRemote, 'config-health-check(remote) missing remote');
    assert(healthRemote.remote.type === 'remote-health-check', 'config-health-check(remote) should use remote-health-check');

    // ========== Config Health Check Tests - Invalid Config ==========
    const configPath = path.join(tmpHome, '.codex', 'config.toml');
    const originalConfig = require('fs').readFileSync(configPath, 'utf-8');
    try {
        const invalidConfig = [
            'model_provider = "bad"',
            'model = "missing"',
            '',
            '[model_providers.bad]',
            'base_url = "not-a-url"',
            'preferred_auth_method = "sk-bad"',
            ''
        ].join('\n');
        require('fs').writeFileSync(configPath, invalidConfig, 'utf-8');

        const healthInvalid = await api('config-health-check', { remote: false });
        assert(healthInvalid.ok === false, 'health-check should fail for invalid base_url');
        assert(
            Array.isArray(healthInvalid.issues) &&
            healthInvalid.issues.some(issue => issue.code === 'base-url-invalid'),
            'health-check should report base-url-invalid'
        );

        const healthRemoteInvalid = await api('config-health-check', { remote: true });
        assert(healthRemoteInvalid.ok === false, 'health-check(remote) should fail');
        assert(
            Array.isArray(healthRemoteInvalid.issues) &&
            healthRemoteInvalid.issues.some(issue => issue.code === 'remote-skip-base-url'),
            'health-check(remote) should report remote-skip-base-url'
        );
    } finally {
        require('fs').writeFileSync(configPath, originalConfig, 'utf-8');
    }

    // ========== Helper Function Tests ==========
    assert(normalizeWireApi('chat/completions') === 'chat_completions', 'normalizeWireApi should replace "/" with "_"');
    assert(normalizeWireApi('responses') === 'responses', 'normalizeWireApi should keep responses unchanged');
    assert(normalizeWireApi('') === 'responses', 'normalizeWireApi should return responses for empty string');

    const probeSpecSlash = buildModelProbeSpec({ wire_api: 'chat/completions' }, 'e2e-chat', mockProviderUrl);
    assert(probeSpecSlash && probeSpecSlash.url.endsWith('/chat/completions'), 'buildModelProbeSpec should use chat/completions endpoint for slash wire_api');

    const probeSpecResponses = buildModelProbeSpec({ wire_api: 'responses' }, 'e2e-responses', mockProviderUrl);
    assert(probeSpecResponses && probeSpecResponses.url.endsWith('/responses'), 'buildModelProbeSpec should use responses endpoint');

    const probeSpecDefault = buildModelProbeSpec({}, 'e2e-default', mockProviderUrl);
    assert(probeSpecDefault && probeSpecDefault.url.endsWith('/responses'), 'buildModelProbeSpec should default to responses endpoint');

    const probeSpecRouted = buildModelProbeSpec({ wire_api: 'responses' }, 'e2e-routed', routedProviderUrl);
    assert(
        probeSpecRouted && probeSpecRouted.url === `${routedProviderUrl}/responses`,
        'buildModelProbeSpec should keep direct provider routes ahead of /v1 fallback'
    );

    const routedConfig = [
        'model_provider = "routed"',
        'model = "e2e-model"',
        '',
        '[model_providers.routed]',
        `base_url = "${routedProviderUrl}"`,
        'wire_api = "responses"',
        'preferred_auth_method = "sk-routed"',
        ''
    ].join('\n');
    require('fs').writeFileSync(configPath, routedConfig, 'utf-8');
    routedProviderRequests.length = 0;
    const routedHealth = await api('config-health-check', { remote: true, timeoutMs: 3000 });
    assert(routedHealth.ok === true, 'health-check(remote) should pass for direct provider route');
    assert(
        routedHealth.remote &&
        routedHealth.remote.checks &&
        routedHealth.remote.checks.modelProbe &&
        routedHealth.remote.checks.modelProbe.url === `${routedProviderUrl}/responses`,
        'health-check(remote) should probe the direct responses path'
    );
    assert(
        routedProviderRequests.includes('/project/ym/responses'),
        'health-check(remote) should hit the direct routed responses endpoint'
    );
    assert(
        !routedProviderRequests.includes('/project/ym/v1/responses'),
        'health-check(remote) should not inject /v1 before direct routed responses'
    );

    routedProviderRequests.length = 0;
    const routedSpeed = await api('speed-test', { name: 'routed' });
    assert(routedSpeed.ok === true, 'speed-test(provider) should pass for direct provider route');
    assert(
        routedProviderRequests.includes('/project/ym/responses'),
        'speed-test(provider) should hit the direct routed responses endpoint'
    );
    assert(
        !routedProviderRequests.includes('/project/ym/v1/responses'),
        'speed-test(provider) should not inject /v1 before direct routed responses'
    );

    const conversationSpecs = buildModelConversationSpecs({ wire_api: 'responses' }, 'e2e-routed', routedProviderUrl, 'hello');
    assert(Array.isArray(conversationSpecs) && conversationSpecs.length > 0, 'buildModelConversationSpecs should build candidate endpoints');
    assert(
        conversationSpecs[0].url === `${routedProviderUrl}/responses`,
        'buildModelConversationSpecs should keep direct provider routes ahead of /v1 fallback'
    );

    const conversationResult = await api('provider-chat-check', {
        name: 'routed',
        prompt: '请回复连接正常'
    }, 5000);
    assert(conversationResult.ok === true, 'provider-chat-check should succeed');
    assert(conversationResult.reply === 'routed provider is healthy', 'provider-chat-check should parse assistant text');
    assert(
        routedProviderRequests.includes('/project/ym/responses'),
        'provider-chat-check should hit the direct routed responses endpoint'
    );

    const parsedText = extractModelResponseText({
        choices: [{
            message: {
                content: [{ type: 'text', text: 'chat completion ok' }]
            }
        }]
    });
    assert(parsedText === 'chat completion ok', 'extractModelResponseText should parse chat completion content');

    // ========== File Permission Tests ==========
    const permDir = require('fs').mkdtempSync(path.join(tmpHome, 'perm-'));
    const existingPath = path.join(permDir, 'secret.json');
    require('fs').writeFileSync(existingPath, JSON.stringify({ a: 1 }), { mode: 0o640 });
    const origMode = fileMode(existingPath);
    writeJsonAtomic(existingPath, { a: 2 });
    assert(fileMode(existingPath) === origMode, 'writeJsonAtomic should preserve mode of existing file');

    const newPath = path.join(permDir, 'new.json');
    writeJsonAtomic(newPath, { b: 1 });
    const expectedNewMode = process.platform === 'win32' ? 0o666 : 0o600;
    assert(
        fileMode(newPath) === expectedNewMode,
        `writeJsonAtomic should default to ${expectedNewMode.toString(8)} for new file (got ${fileMode(newPath).toString(8)})`
    );

    // ========== File Permission Tests - Different Modes ==========
    const mode644Path = path.join(permDir, 'mode644.json');
    require('fs').writeFileSync(mode644Path, JSON.stringify({ x: 1 }), { mode: 0o644 });
    const origMode644 = fileMode(mode644Path);
    writeJsonAtomic(mode644Path, { x: 2 });
    assert(fileMode(mode644Path) === origMode644, 'writeJsonAtomic should preserve 0o644 mode');

    const mode600Path = path.join(permDir, 'mode600.json');
    require('fs').writeFileSync(mode600Path, JSON.stringify({ y: 1 }), { mode: 0o600 });
    const origMode600 = fileMode(mode600Path);
    writeJsonAtomic(mode600Path, { y: 2 });
    assert(fileMode(mode600Path) === origMode600, 'writeJsonAtomic should preserve 0o600 mode');
};
