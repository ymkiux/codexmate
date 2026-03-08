const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 3737;
const API_URL = `http://localhost:${PORT}/api`;

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function request(action, params = {}) {
    const payload = JSON.stringify({ action, params });
    return new Promise((resolve, reject) => {
        const req = http.request(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data || '{}');
                    resolve(json);
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

async function waitForServer(timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            await request('status');
            return;
        } catch (_) {
            await delay(300);
        }
    }
    throw new Error('server not ready');
}

function escapeToml(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildTemplate(provider, model, baseUrl, apiKey) {
    return `model_provider = "${escapeToml(provider)}"
model = "${escapeToml(model)}"

[model_providers.${escapeToml(provider)}]
name = "${escapeToml(provider)}"
base_url = "${escapeToml(baseUrl)}"
wire_api = "responses"
preferred_auth_method = "${escapeToml(apiKey)}"
`;
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

async function run() {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-e2e-'));
    const env = {
        ...process.env,
        USERPROFILE: tempHome,
        HOME: tempHome,
        CODEXMATE_NO_BROWSER: '1'
    };

    const cliPath = path.join(__dirname, '..', '..', 'cli.js');
    const child = spawn(process.execPath, [cliPath, 'start'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    try {
        await waitForServer();

        await request('apply-config-template', { template: buildTemplate('alpha', 'm-alpha', 'https://example.com', 'sk-alpha') });
        await request('apply-config-template', { template: buildTemplate('beta', 'm-beta', 'https://example.com', 'sk-beta') });
        await request('apply-config-template', { template: buildTemplate('gamma', 'm-gamma', 'https://example.com', 'sk-gamma') });
        await request('apply-config-template', { template: buildTemplate('delta', 'm-delta', 'https://example.com', 'sk-delta') });

        const recent = await request('get-recent-configs');
        assert(Array.isArray(recent.items), 'recent list should be array');
        assert(recent.items.length === 3, 'recent list should keep 3 items');
        assert(recent.items[0].provider === 'delta' && recent.items[0].model === 'm-delta', 'recent[0] should be delta');
        assert(recent.items[1].provider === 'gamma' && recent.items[1].model === 'm-gamma', 'recent[1] should be gamma');
        assert(recent.items[2].provider === 'beta' && recent.items[2].model === 'm-beta', 'recent[2] should be beta');

        await request('apply-config-template', { template: buildTemplate('broken', 'm-broken', 'not-a-url', '') });
        await request('delete-model', { model: 'm-broken' });

        const health = await request('config-health-check');
        assert(health && Array.isArray(health.issues), 'health check issues should be array');
        const codes = new Set(health.issues.map(item => item.code));
        assert(codes.has('base-url-invalid'), 'health check should flag invalid URL');
        assert(codes.has('api-key-missing'), 'health check should flag missing key');
        assert(codes.has('model-unavailable'), 'health check should flag missing model');

        await request('apply-config-template', {
            template: buildTemplate('local', 'm-local', `http://127.0.0.1:${PORT}`, 'sk-local')
        });
        const remoteHealth = await request('config-health-check', { remote: true, timeoutMs: 2000 });
        assert(remoteHealth && Array.isArray(remoteHealth.issues), 'remote health issues should be array');
        assert(remoteHealth.ok === true, 'remote health should pass');
        assert(remoteHealth.remote && remoteHealth.remote.type === 'speed-test', 'remote health should include speed-test info');
        assert(typeof remoteHealth.remote.durationMs === 'number', 'remote health should include duration');
    } finally {
        if (child && !child.killed) {
            child.kill('SIGINT');
        }
        await delay(300);
        fs.rmSync(tempHome, { recursive: true, force: true });
    }
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
