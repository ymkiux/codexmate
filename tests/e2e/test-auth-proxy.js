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
    assert(initialProxyStatus && initialProxyStatus.running === true, 'proxy should auto-start when codex config exists');

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

    const proxyEnableRes = await api('proxy-enable-codex-default', {
        enabled: true,
        host: '127.0.0.1',
        port: proxyPort,
        provider: upstreamCandidate.name,
        authSource: 'provider',
        timeoutMs: 5000
    });
    assert(proxyEnableRes.success === true, `proxy-enable-codex-default failed: ${proxyEnableRes.error || ''}`);
    assert(proxyEnableRes.runtime && proxyEnableRes.runtime.listenUrl && proxyEnableRes.runtime.listenUrl.includes(String(proxyPort)), 'proxy enable listen url mismatch');

    const updateBuiltinRes = await api('update-provider', {
        name: 'codexmate-proxy',
        url: 'http://127.0.0.1:6553',
        key: ''
    });
    assert(
        typeof updateBuiltinRes.error === 'string' && updateBuiltinRes.error.includes('不可编辑'),
        'builtin proxy provider should be read-only for update'
    );
    const deleteBuiltinRes = await api('delete-provider', {
        name: 'codexmate-proxy'
    });
    assert(
        typeof deleteBuiltinRes.error === 'string' && deleteBuiltinRes.error.includes('不可删除'),
        'builtin proxy provider should be read-only for delete'
    );

    const exportConfigRes = await api('export-config', { includeKeys: true });
    assert(exportConfigRes && exportConfigRes.data && exportConfigRes.data.providers, 'export-config should return provider map');
    assert(!exportConfigRes.data.providers['codexmate-proxy'], 'export-config should exclude builtin proxy provider');

    const importConfigRes = await api('import-config', {
        payload: exportConfigRes.data,
        options: {
            overwriteProviders: true,
            applyCurrent: true,
            applyCurrentModels: true
        }
    });
    assert(importConfigRes && importConfigRes.success === true, `import-config should succeed: ${importConfigRes && importConfigRes.error ? importConfigRes.error : ''}`);

    const statusAfterEnable = await api('status');
    assert(statusAfterEnable.provider === 'codexmate-proxy', 'status should switch to codexmate-proxy after proxy-enable-codex-default');

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
