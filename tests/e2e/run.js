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

    const port = 18000 + Math.floor(Math.random() * 1000);
    const server = spawn(node, [cliPath, 'start'], {
        env: { ...env, CODEXMATE_PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stdout.on('data', () => {});
    server.stderr.on('data', () => {});

    try {
        await waitForServer(port);
        const apiStatus = await postJson(port, { action: 'status' });
        assert(apiStatus.provider === 'e2e', 'api status provider mismatch');

        const apiList = await postJson(port, { action: 'list' });
        assert(Array.isArray(apiList.providers), 'api list missing providers');
        assert(apiList.providers.some(p => p.name === 'e2e'), 'api list missing provider');
    } finally {
        server.kill('SIGINT');
        await new Promise(resolve => server.on('exit', resolve));
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
