const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync, spawn } = require('child_process');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function runSync(node, args, options = {}) {
    const result = spawnSync(node, args, {
        encoding: 'utf-8',
        ...options
    });
    return result;
}

function postJson(port, payload, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: '/api',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            let body = '';
            res.setEncoding('utf-8');
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body || '{}'));
                } catch (e) {
                    reject(new Error('Invalid JSON response'));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('Request timeout'));
        });
        req.write(data);
        req.end();
    });
}

async function waitForServer(port, retries = 20, delayMs = 200) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            await postJson(port, { action: 'status' }, 1000);
            return;
        } catch (e) {
            lastError = e;
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    throw lastError || new Error('Server not ready');
}

function startLocalServer() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({ server, port: address.port });
        });
    });
}

function closeServer(server) {
    return new Promise((resolve) => {
        if (!server) return resolve();
        try {
            server.close(() => resolve());
        } catch (e) {
            resolve();
        }
    });
}

async function main() {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-e2e-'));
    const env = {
        ...process.env,
        HOME: tmpHome,
        USERPROFILE: tmpHome,
        CODEXMATE_FORCE_RESET_EXISTING_CONFIG: '1'
    };
    const cliPath = path.resolve(__dirname, '../../cli.js');
    const node = process.execPath;

    const setupInput = [
        '2',
        'e2e',
        'https://api.example.com/v1',
        'sk-test',
        'e2e-model',
        ''
    ].join('\n');

    const setupResult = runSync(node, [cliPath, 'setup'], {
        env,
        input: setupInput
    });

    assert(setupResult.status === 0, `setup failed: ${setupResult.stderr || setupResult.stdout}`);

    const configPath = path.join(tmpHome, '.codex', 'config.toml');
    assert(fs.existsSync(configPath), 'config.toml missing');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    assert(/model_provider\s*=\s*"e2e"/.test(configContent), 'model_provider not set');
    assert(/model\s*=\s*"e2e-model"/.test(configContent), 'model not set');
    assert(/\[model_providers\.e2e\]/.test(configContent), 'provider block missing');
    assert(/base_url\s*=\s*"https:\/\/api\.example\.com\/v1"/.test(configContent), 'base_url missing');

    const authPath = path.join(tmpHome, '.codex', 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    assert(auth.OPENAI_API_KEY === 'sk-test', 'auth api_key mismatch');

    const modelsPath = path.join(tmpHome, '.codex', 'models.json');
    const models = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
    assert(models.includes('e2e-model'), 'custom model not added');

    const statusResult = runSync(node, [cliPath, 'status'], { env });
    assert(statusResult.status === 0, 'status failed');
    assert(statusResult.stdout.includes('提供商: e2e'), 'status provider not shown');
    assert(statusResult.stdout.includes('模型: e2e-model'), 'status model not shown');

    const listResult = runSync(node, [cliPath, 'list'], { env });
    assert(listResult.status === 0, 'list failed');
    assert(listResult.stdout.includes('e2e'), 'list missing provider');

    const speedTarget = await startLocalServer();
    const speedUrl = `http://127.0.0.1:${speedTarget.port}`;

    const port = 18000 + Math.floor(Math.random() * 1000);
    const webServer = spawn(node, [cliPath, 'start'], {
        env: { ...env, CODEXMATE_PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    webServer.stdout.on('data', () => {});
    webServer.stderr.on('data', () => {});

    try {
        await waitForServer(port);
        const apiStatus = await postJson(port, { action: 'status' });
        assert(apiStatus.provider === 'e2e', 'api status provider mismatch');

        const apiList = await postJson(port, { action: 'list' });
        assert(Array.isArray(apiList.providers), 'api list missing providers');
        assert(apiList.providers.some(p => p.name === 'e2e'), 'api list missing provider');

        const exportResult = await postJson(port, { action: 'export-config', params: { includeKeys: true } });
        assert(exportResult.data, 'export-config missing data');
        assert(exportResult.data.providers && exportResult.data.providers.e2e, 'export-config missing provider');
        assert(exportResult.data.providers.e2e.apiKey === 'sk-test', 'export-config apiKey mismatch');

        const importPayload = JSON.parse(JSON.stringify(exportResult.data));
        importPayload.providers = {
            ...importPayload.providers,
            e2e2: { baseUrl: speedUrl, apiKey: 'sk-e2e2' }
        };
        importPayload.models = Array.from(new Set([...(importPayload.models || []), 'e2e2-model']));
        importPayload.currentProvider = 'e2e2';
        importPayload.currentModel = 'e2e2-model';
        importPayload.currentModels = { ...(importPayload.currentModels || {}), e2e2: 'e2e2-model' };

        const importResult = await postJson(port, {
            action: 'import-config',
            params: {
                payload: importPayload,
                options: { overwriteProviders: true, applyCurrent: true, applyCurrentModels: true }
            }
        });
        assert(importResult.success === true, 'import-config failed');

        const apiStatusAfter = await postJson(port, { action: 'status' });
        assert(apiStatusAfter.provider === 'e2e2', 'api status provider after import mismatch');
        assert(apiStatusAfter.model === 'e2e2-model', 'api status model after import mismatch');

        const apiModels = await postJson(port, { action: 'models' });
        assert(Array.isArray(apiModels.models) && apiModels.models.includes('e2e2-model'), 'api models missing imported model');

        const speedResult = await postJson(port, { action: 'speed-test', params: { name: 'e2e2' } }, 4000);
        assert(speedResult.ok === true, 'speed-test failed');
    } finally {
        webServer.kill('SIGINT');
        await new Promise(resolve => webServer.on('exit', resolve));
        await closeServer(speedTarget.server);
    }

    try {
        if (fs.rmSync) {
            fs.rmSync(tmpHome, { recursive: true, force: true });
        } else {
            fs.rmdirSync(tmpHome, { recursive: true });
        }
    } catch (e) {}
}

main().catch((err) => {
    console.error('E2E failed:', err.message || err);
    process.exit(1);
});
