const http = require('http');
const { assert, fs, path, runSync } = require('./helpers');

function requestJson(url, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            let body = '';
            res.setEncoding('utf-8');
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                let parsed = {};
                try {
                    parsed = body ? JSON.parse(body) : {};
                } catch (e) {
                    return reject(new Error(`invalid json response: ${body.slice(0, 160)}`));
                }
                resolve({
                    statusCode: res.statusCode || 0,
                    headers: res.headers || {},
                    body: parsed
                });
            });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('request timeout'));
        });
    });
}

async function waitForProxyRunning(api, retries = 20, delayMs = 150) {
    let lastStatus = null;
    for (let i = 0; i < retries; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const status = await api('proxy-status');
        lastStatus = status;
        if (status && status.running) {
            return status;
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return lastStatus;
}

module.exports = async function testAuthProxy(ctx) {
    const { api, node, cliPath, env, tmpHome, mockProviderUrl } = ctx;

    const initialProxyStatus = await waitForProxyRunning(api);
    assert(initialProxyStatus && typeof initialProxyStatus.running === 'boolean', 'proxy-status should return running flag');

    const userProvidedFixture = 'C:\\Users\\Ymkiux\\Downloads\\fb5eefedbd149f08aeb3fe6c5a212efabb76d8df\\wbqm928lf@jienigui.me.json';
    const fixturePath = fs.existsSync(userProvidedFixture)
        ? userProvidedFixture
        : path.join(tmpHome, 'codex-auth.fixture.json');

    if (!fs.existsSync(fixturePath)) {
        const fallbackPayload = {
            type: 'codex',
            email: 'e2e-primary@example.com',
            account_id: 'acc-e2e-primary',
            access_token: 'token-primary-access',
            refresh_token: 'token-primary-refresh',
            id_token: 'token-primary-id',
            expired: '2099-01-01T00:00:00Z',
            last_refresh: '2026-03-18T00:00:00Z'
        };
        fs.writeFileSync(fixturePath, JSON.stringify(fallbackPayload, null, 2), 'utf-8');
    }

    const importResult = runSync(node, [cliPath, 'auth', 'import', fixturePath], { env });
    assert(importResult.status === 0, `auth import failed: ${importResult.stderr || importResult.stdout}`);

    const listResult = runSync(node, [cliPath, 'auth', 'list'], { env });
    assert(listResult.status === 0, 'auth list should succeed');

    const authPath = path.join(tmpHome, '.codex', 'auth.json');
    assert(fs.existsSync(authPath), 'auth.json should exist after auth import');
    const currentAuth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    assert(
        typeof currentAuth.access_token === 'string' || typeof currentAuth.OPENAI_API_KEY === 'string',
        'auth.json should contain credential field'
    );

    const backupPayload = {
        type: 'codex',
        email: 'e2e-backup@example.com',
        account_id: 'acc-e2e-backup',
        access_token: 'token-backup-access',
        refresh_token: 'token-backup-refresh',
        id_token: 'token-backup-id',
        expired: '2099-02-01T00:00:00Z',
        last_refresh: '2026-03-18T00:00:00Z'
    };
    const backupBase64 = Buffer.from(JSON.stringify(backupPayload), 'utf-8').toString('base64');

    const importBackupRes = await api('import-auth-profile', {
        fileName: 'backup-auth.json',
        name: 'backup-auth',
        fileBase64: backupBase64,
        activate: false
    });
    assert(importBackupRes.success === true, 'api import-auth-profile should succeed');

    const authProfilesDir = path.join(tmpHome, '.codex', 'auth-profiles');
    const backupAuthProfilePath = path.join(authProfilesDir, 'backup-auth.json');
    const authRegistryPath = path.join(authProfilesDir, 'registry.json');
    assert(fs.existsSync(backupAuthProfilePath), 'uploaded auth profile should be stored under ~/.codex/auth-profiles');
    assert(fs.existsSync(authRegistryPath), 'auth profile registry should be stored under ~/.codex/auth-profiles');
    assert(
        !fs.existsSync(path.join(tmpHome, '.codexmate', 'codex', 'auth-profiles', 'backup-auth.json')),
        'uploaded auth profile should not be written into ~/.codexmate/codex/auth-profiles'
    );

    const authProfiles = await api('list-auth-profiles');
    assert(Array.isArray(authProfiles.profiles), 'list-auth-profiles should return array');
    assert(authProfiles.profiles.some(item => item.name === 'backup-auth'), 'backup-auth profile missing');

    const switchBackupRes = await api('switch-auth-profile', { name: 'backup-auth' });
    assert(switchBackupRes.success === true, 'switch-auth-profile should succeed');

    const switchedAuth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    assert(switchedAuth.email === 'e2e-backup@example.com', 'switch-auth-profile should update auth.json');

    const upstreamCandidate = {
        name: 'proxy-e2e-upstream',
        url: mockProviderUrl
    };
    const addProxyProviderRes = await api('add-provider', {
        name: upstreamCandidate.name,
        url: upstreamCandidate.url,
        key: 'sk-proxy-e2e'
    });
    if (addProxyProviderRes.error) {
        const updateProxyProviderRes = await api('update-provider', {
            name: upstreamCandidate.name,
            url: upstreamCandidate.url,
            key: 'sk-proxy-e2e'
        });
        assert(updateProxyProviderRes.success === true, 'failed to prepare proxy upstream provider');
    }

    const proxyPort = 19000 + Math.floor(Math.random() * 1000);
    const proxySaveRes = await api('proxy-save-config', {
        enabled: true,
        host: '127.0.0.1',
        port: proxyPort,
        provider: upstreamCandidate.name,
        authSource: 'provider',
        timeoutMs: 5000
    });
    assert(proxySaveRes.success === true, 'proxy-save-config should succeed');

    const configTomlPath = path.join(tmpHome, '.codex', 'config.toml');
    fs.appendFileSync(configTomlPath, [
        '',
        '[model_providers.codexmate-proxy]',
        'name = "codexmate-proxy"',
        `base_url = "http://127.0.0.1:${proxyPort}/v1"`,
        'wire_api = "responses"',
        'requires_openai_auth = false',
        'preferred_auth_method = ""',
        'request_max_retries = 4',
        'stream_max_retries = 10',
        'stream_idle_timeout_ms = 300000',
        ''
    ].join('\n'), 'utf-8');

    const proxyStartRes = await api('proxy-start', {
        enabled: true,
        host: '127.0.0.1',
        port: proxyPort,
        provider: upstreamCandidate.name,
        authSource: 'provider',
        timeoutMs: 5000
    });
    assert(proxyStartRes.success === true, `proxy-start failed: ${proxyStartRes.error || ''}`);
    assert(proxyStartRes.listenUrl && proxyStartRes.listenUrl.includes(String(proxyPort)), 'proxy start listen url mismatch');

    const providerList = await api('list');
    assert(
        providerList && Array.isArray(providerList.providers),
        `list should return providers: ${providerList && providerList.error ? providerList.error : JSON.stringify(providerList)}`
    );
    assert(
        !providerList.providers.some((item) => item && item.name === 'codexmate-proxy'),
        'provider list should not expose removed builtin proxy provider'
    );
    const configTomlAfterList = fs.readFileSync(configTomlPath, 'utf-8');
    assert(
        !/^\s*\[\s*model_providers\s*\.\s*(?:"codexmate-proxy"|'codexmate-proxy'|codexmate-proxy)\s*\]\s*$/m.test(configTomlAfterList),
        'provider list read should physically remove legacy codexmate-proxy block from config.toml'
    );

    const enableRes = await api('proxy-enable-codex-default', {
        enabled: true,
        host: '127.0.0.1',
        port: proxyPort,
        provider: upstreamCandidate.name
    });
    assert(
        typeof enableRes.error === 'string' && enableRes.error.includes('已移除'),
        'proxy-enable-codex-default should report removed builtin proxy provider'
    );

    const healthViaProxy = await requestJson(`http://127.0.0.1:${proxyPort}/health`);
    assert(healthViaProxy.statusCode === 200, `proxy /health should return 200, got ${healthViaProxy.statusCode}`);

    const modelsViaProxy = await requestJson(`http://127.0.0.1:${proxyPort}/v1/models`);
    assert(modelsViaProxy.statusCode === 200, `proxy /v1/models should return 200, got ${modelsViaProxy.statusCode}`);
    assert(Array.isArray(modelsViaProxy.body.data), 'proxy /v1/models should return model list');
    assert(modelsViaProxy.body.data.some(item => item.id === 'e2e2-model'), 'proxy /v1/models missing expected model id');

    const proxyStatus = await api('proxy-status');
    assert(proxyStatus.running === true, 'proxy should be running before stop');
    assert(proxyStatus.runtime && proxyStatus.runtime.upstreamProvider === upstreamCandidate.name, 'proxy upstream provider mismatch');

    const proxyStopRes = await api('proxy-stop');
    assert(proxyStopRes.success === true, 'proxy-stop should succeed');

    const proxyStatusAfterStop = await api('proxy-status');
    assert(proxyStatusAfterStop.running === false, 'proxy should stop after proxy-stop');

    await api('delete-provider', { name: upstreamCandidate.name });
};
