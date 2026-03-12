const path = require('path');
const {
    assert,
    normalizeWireApi,
    buildModelProbeSpec,
    fileMode,
    writeJsonAtomic
} = require('./helpers');

module.exports = async function testHealthAndSpeed(ctx) {
    const { api, mockProviderUrl, authFailUrl, tmpHome } = ctx;

    const speedResult = await api('speed-test', { name: 'e2e2' });
    assert(speedResult.ok === true, 'speed-test failed');

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

        const healthRemote = await api('config-health-check', { remote: true });
        assert(healthRemote.ok === false, 'health-check(remote) should fail');
        assert(
            Array.isArray(healthRemote.issues) &&
            healthRemote.issues.some(issue => issue.code === 'remote-skip-base-url'),
            'health-check(remote) should report remote-skip-base-url'
        );
    } finally {
        require('fs').writeFileSync(configPath, originalConfig, 'utf-8');
    }

    const speedInvalid = await api('speed-test', { url: 'not-a-url' });
    assert(speedInvalid.ok === false || speedInvalid.error, 'speed-test invalid url should fail');

    const speedAuthFail = await api('speed-test', { url: authFailUrl });
    assert(
        speedAuthFail.status === 401 || (speedAuthFail.error && /401/.test(speedAuthFail.error)),
        'speed-test auth fail should expose 401'
    );

    const speedUnreachable = await api('speed-test', { url: 'http://127.0.0.1:1' });
    assert(speedUnreachable.ok === false, 'speed-test unreachable should fail');

    assert(normalizeWireApi('chat/completions') === 'chat_completions', 'normalizeWireApi should replace "/" with "_"');
    const probeSpec = buildModelProbeSpec({ wire_api: 'chat/completions' }, 'e2e-chat', mockProviderUrl);
    assert(probeSpec && probeSpec.url.endsWith('/chat/completions'), 'buildModelProbeSpec should use chat/completions endpoint for slash wire_api');

    const permDir = require('fs').mkdtempSync(path.join(tmpHome, 'perm-'));
    const existingPath = path.join(permDir, 'secret.json');
    require('fs').writeFileSync(existingPath, JSON.stringify({ a: 1 }), { mode: 0o640 });
    const origMode = fileMode(existingPath);
    writeJsonAtomic(existingPath, { a: 2 });
    assert(fileMode(existingPath) === origMode, 'writeJsonAtomic should preserve mode of existing file');

    const newPath = path.join(permDir, 'new.json');
    writeJsonAtomic(newPath, { b: 1 });
    assert(fileMode(newPath) === 0o600, 'writeJsonAtomic should default to 600 for new file');
};
