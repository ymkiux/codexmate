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

function runWithInput(node, args, input, options = {}) {
    return new Promise((resolve) => {
        const child = spawn(node, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => stdout += chunk.toString());
        child.stderr.on('data', chunk => stderr += chunk.toString());
        child.on('close', (code) => resolve({ status: code, stdout, stderr }));
        if (input) {
            child.stdin.write(input);
        }
        child.stdin.end();
    });
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

function startLocalServer(options = {}) {
    const mode = options.mode || 'list';
    const modelsPath = options.modelsPath || '/models';
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            if (req.url && req.url.startsWith(modelsPath)) {
                if (mode === 'none') {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'not found' }));
                    return;
                }
                if (mode === 'html') {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<!doctype html><html><body>ok</body></html>');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    data: [
                        { id: 'e2e2-model' },
                        { id: 'e2e2-model-2' }
                    ]
                }));
                return;
            }
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

    let mockProvider;
    let noModelsProvider;
    let htmlModelsProvider;
    try {
        mockProvider = await startLocalServer({ mode: 'list', modelsPath: '/v1/models' });
        noModelsProvider = await startLocalServer({ mode: 'none', modelsPath: '/v1/models' });
        htmlModelsProvider = await startLocalServer({ mode: 'html', modelsPath: '/v1/models' });
        const mockProviderUrl = `http://127.0.0.1:${mockProvider.port}`;
        const noModelsUrl = `http://127.0.0.1:${noModelsProvider.port}`;
        const htmlModelsUrl = `http://127.0.0.1:${htmlModelsProvider.port}`;

        const setupInput = [
            '2',
            'e2e',
            mockProviderUrl,
            'sk-test',
            'e2e-model',
            ''
        ].join('\n');

        const setupResult = await runWithInput(node, [cliPath, 'setup'], setupInput, { env });

        assert(setupResult.status === 0, `setup failed: ${setupResult.stderr || setupResult.stdout}`);

        const configPath = path.join(tmpHome, '.codex', 'config.toml');
        assert(fs.existsSync(configPath), 'config.toml missing');
        const configContent = fs.readFileSync(configPath, 'utf-8');
        assert(/model_provider\s*=\s*"e2e"/.test(configContent), 'model_provider not set');
        assert(/model\s*=\s*"e2e-model"/.test(configContent), 'model not set');
        assert(/\[model_providers\.e2e\]/.test(configContent), 'provider block missing');
        assert(/base_url\s*=\s*"http:\/\/127\.0\.0\.1:\d+"/.test(configContent), 'base_url missing');

        const authPath = path.join(tmpHome, '.codex', 'auth.json');
        const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
        assert(auth.OPENAI_API_KEY === 'sk-test', 'auth api_key mismatch');

        const modelsPath = path.join(tmpHome, '.codex', 'models.json');
        const models = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
        assert(models.includes('e2e-model'), 'custom model not added');

        const sessionsDir = path.join(tmpHome, '.codex', 'sessions');
        fs.mkdirSync(sessionsDir, { recursive: true });
        const sessionId = 'e2e-session';
        const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);
        const sessionRecords = [
            {
                type: 'session_meta',
                payload: { id: sessionId, cwd: '/tmp/e2e' },
                timestamp: '2025-01-01T00:00:00.000Z'
            },
            {
                type: 'response_item',
                payload: { type: 'message', role: 'user', content: 'hello' },
                timestamp: '2025-01-01T00:00:01.000Z'
            },
            {
                type: 'response_item',
                payload: { type: 'message', role: 'assistant', content: 'world' },
                timestamp: '2025-01-01T00:00:02.000Z'
            }
        ];
        fs.writeFileSync(sessionPath, sessionRecords.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf-8');

        const statusResult = runSync(node, [cliPath, 'status'], { env });
        assert(statusResult.status === 0, 'status failed');
        assert(statusResult.stdout.includes('提供商: e2e'), 'status provider not shown');
        assert(statusResult.stdout.includes('模型: e2e-model'), 'status model not shown');

        const listResult = runSync(node, [cliPath, 'list'], { env });
        assert(listResult.status === 0, 'list failed');
        assert(listResult.stdout.includes('e2e'), 'list missing provider');

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
                e2e2: { baseUrl: mockProviderUrl, apiKey: 'sk-e2e2' },
                e2e3: { baseUrl: noModelsUrl, apiKey: 'sk-e2e3' },
                e2e4: { baseUrl: htmlModelsUrl, apiKey: 'sk-e2e4' }
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

            const apiModels = await postJson(port, { action: 'models', params: { provider: 'e2e2' } });
            assert(Array.isArray(apiModels.models) && apiModels.models.includes('e2e2-model-2'), 'api models missing remote entry');

            const apiModelsUnlimited = await postJson(port, { action: 'models', params: { provider: 'e2e3' } });
            assert(apiModelsUnlimited.unlimited === true, 'api models unlimited missing');

            const apiModelsHtml = await postJson(port, { action: 'models', params: { provider: 'e2e4' } });
            assert(apiModelsHtml.unlimited === true, 'api models html unlimited missing');

            const apiModelsByUrl = await postJson(port, {
                action: 'models-by-url',
                params: { baseUrl: mockProviderUrl, apiKey: 'sk-e2e2' }
            });
            assert(Array.isArray(apiModelsByUrl.models) && apiModelsByUrl.models.includes('e2e2-model'), 'api models-by-url missing remote entry');

            const apiModelsByUrlUnlimited = await postJson(port, {
                action: 'models-by-url',
                params: { baseUrl: noModelsUrl }
            });
            assert(apiModelsByUrlUnlimited.unlimited === true, 'api models-by-url unlimited missing');

            const apiSessions = await postJson(port, {
                action: 'list-sessions',
                params: { source: 'codex', limit: 50, forceRefresh: true }
            });
            assert(Array.isArray(apiSessions.sessions), 'api sessions missing');
            assert(apiSessions.sessions.some(item => item.sessionId === sessionId), 'api sessions missing codex entry');

            const cloneResult = await postJson(port, {
                action: 'clone-session',
                params: { source: 'codex', sessionId }
            });
            assert(cloneResult.success === true, 'clone-session failed');
            assert(cloneResult.sessionId && cloneResult.sessionId !== sessionId, 'clone-session id invalid');
            assert(fs.existsSync(cloneResult.filePath), 'clone-session file missing');

            const deleteResult = await postJson(port, {
                action: 'delete-session',
                params: { source: 'codex', sessionId }
            });
            assert(deleteResult.success === true, 'delete-session failed');
            assert(!fs.existsSync(sessionPath), 'delete-session file still exists');

            const apiSessionsAfterDelete = await postJson(port, {
                action: 'list-sessions',
                params: { source: 'codex', limit: 50, forceRefresh: true }
            });
            assert(!apiSessionsAfterDelete.sessions.some(item => item.sessionId === sessionId), 'deleted session still listed');
            assert(apiSessionsAfterDelete.sessions.some(item => item.sessionId === cloneResult.sessionId), 'clone session missing after delete');

            const speedResult = await postJson(port, { action: 'speed-test', params: { name: 'e2e2' } }, 4000);
            assert(speedResult.ok === true, 'speed-test failed');

            const switchResult = runSync(node, [cliPath, 'switch', 'e2e4'], { env });
            assert(switchResult.status === 0, 'cli switch failed');

            const cliModels = await runWithInput(node, [cliPath, 'models'], '', { env });
            assert(cliModels.status === 0, 'cli models failed');
            assert(cliModels.stdout.includes('视为不限'), 'cli models missing unlimited hint');
        } finally {
            webServer.kill('SIGINT');
            await new Promise(resolve => webServer.on('exit', resolve));
        }
    } finally {
        if (mockProvider) {
            await closeServer(mockProvider.server);
        }
        if (noModelsProvider) {
            await closeServer(noModelsProvider.server);
        }
        if (htmlModelsProvider) {
            await closeServer(htmlModelsProvider.server);
        }
        try {
            if (fs.rmSync) {
                fs.rmSync(tmpHome, { recursive: true, force: true });
            } else {
                fs.rmdirSync(tmpHome, { recursive: true });
            }
        } catch (e) {}
    }
}

main().catch((err) => {
    console.error('E2E failed:', err.message || err);
    process.exit(1);
});
