const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync, spawn } = require('child_process');
const { writeJsonAtomic } = require('../../lib/cli-file-utils');
const { normalizeWireApi, buildModelProbeSpec } = require('../../lib/cli-models-utils');

const debug = (...args) => {
    if (process.env.E2E_DEBUG) {
        console.error('[e2e]', ...args);
    }
};

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function fileMode(filePath) {
    return fs.existsSync(filePath) ? (fs.statSync(filePath).mode & 0o777) : 0;
}

function captureFileState(filePath) {
    const state = {
        path: filePath,
        exists: false,
        readable: true,
        content: '',
        error: ''
    };

    state.exists = fs.existsSync(filePath);
    if (!state.exists) {
        return state;
    }

    try {
        state.content = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
        state.readable = false;
        state.error = e && e.message ? e.message : String(e);
    }
    return state;
}

function assertFileUnchanged(state, label) {
    if (!state || !state.readable) return;
    const name = label || state.path;
    if (state.exists) {
        assert(fs.existsSync(state.path), `${name} disappeared during e2e`);
        const current = fs.readFileSync(state.path, 'utf-8');
        assert(current === state.content, `${name} changed during e2e`);
        return;
    }
    assert(!fs.existsSync(state.path), `${name} should not be created during e2e`);
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
            debug(`wait retry ${i + 1}/${retries}: ${e && e.message ? e.message : e}`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    throw lastError || new Error('Server not ready');
}

function startLocalServer(options = {}) {
    const mode = options.mode || 'list';
    const modelsPath = options.modelsPath || '/models';
    const status = options.status || 200;
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            if (req.url && req.url.startsWith(modelsPath)) {
                if (mode === 'none') {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'not found' }));
                    return;
                }
                if (mode === 'html') {
                    res.writeHead(status, { 'Content-Type': 'text/html' });
                    res.end('<!doctype html><html><body>ok</body></html>');
                    return;
                }
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    data: [
                        { id: 'e2e2-model' },
                        { id: 'e2e2-model-2' }
                    ]
                }));
                return;
            }
            res.writeHead(status, { 'Content-Type': 'application/json' });
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
    const realHome = os.homedir();
    const realCodexDir = path.join(realHome, '.codex');
    const realFileStates = [
        captureFileState(path.join(realCodexDir, 'config.toml')),
        captureFileState(path.join(realCodexDir, 'auth.json')),
        captureFileState(path.join(realCodexDir, 'models.json')),
        captureFileState(path.join(realCodexDir, 'provider-current-models.json'))
    ];

    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-e2e-'));
    const env = {
        ...process.env,
        HOME: tmpHome,
        USERPROFILE: tmpHome,
        CODEXMATE_FORCE_RESET_EXISTING_CONFIG: '1'
    };
    const cliPath = path.resolve(__dirname, '../../cli.js');
    const node = process.execPath;

    debug('setup start');
    let mockProvider;
    let noModelsProvider;
    let htmlModelsProvider;
    let authFailProvider;
    try {
        mockProvider = await startLocalServer({ mode: 'list', modelsPath: '/v1/models' });
        noModelsProvider = await startLocalServer({ mode: 'none', modelsPath: '/v1/models' });
        htmlModelsProvider = await startLocalServer({ mode: 'html', modelsPath: '/v1/models' });
        authFailProvider = await startLocalServer({
            mode: 'list',
            modelsPath: '/v1/models',
            status: 401
        });
        const mockProviderUrl = `http://127.0.0.1:${mockProvider.port}`;
        const noModelsUrl = `http://127.0.0.1:${noModelsProvider.port}`;
        const htmlModelsUrl = `http://127.0.0.1:${htmlModelsProvider.port}`;
        const authFailUrl = `http://127.0.0.1:${authFailProvider.port}`;

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
        debug('setup ok');

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
        debug('start web server');
        const webServer = spawn(node, [cliPath, 'run'], {
            env: { ...env, CODEXMATE_PORT: String(port) },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        webServer.stdout.on('data', () => {});
        webServer.stderr.on('data', () => {});

        try {
            await waitForServer(port);
            debug('server ready');
            const apiStatus = await postJson(port, { action: 'status' });
            assert(apiStatus.provider === 'e2e', 'api status provider mismatch');

            const apiList = await postJson(port, { action: 'list' });
            assert(Array.isArray(apiList.providers), 'api list missing providers');
            assert(apiList.providers.some(p => p.name === 'e2e'), 'api list missing provider');

            const templateOverride = await postJson(port, {
                action: 'get-config-template',
                params: { provider: 'shadow', model: 'shadow-model', serviceTier: 'fast' }
            });
            assert(typeof templateOverride.template === 'string', 'get-config-template missing template');
            assert(templateOverride.template.split('\n')[0].trim() === 'service_tier = "fast"', 'get-config-template missing service_tier');
            assert(templateOverride.template.includes('model_provider = "shadow"'), 'get-config-template missing provider override');
            assert(templateOverride.template.includes('model = "shadow-model"'), 'get-config-template missing model override');

            const templateStandard = await postJson(port, {
                action: 'get-config-template',
                params: { provider: 'shadow', model: 'shadow-model', serviceTier: 'standard' }
            });
            assert(typeof templateStandard.template === 'string', 'get-config-template(standard) missing template');
            assert(!/^\s*service_tier\s*=/m.test(templateStandard.template), 'get-config-template(standard) should not include service_tier');
            debug('template checks ok');

            const exportResult = await postJson(port, { action: 'export-config', params: { includeKeys: true } });
            assert(exportResult.data, 'export-config missing data');
            assert(exportResult.data.providers && exportResult.data.providers.e2e, 'export-config missing provider');
            assert(exportResult.data.providers.e2e.apiKey === 'sk-test', 'export-config apiKey mismatch');

            const exportNoKeys = await postJson(port, { action: 'export-config', params: { includeKeys: false } });
            assert(exportNoKeys.data, 'export-config(no keys) missing data');
            assert(exportNoKeys.data.providers && exportNoKeys.data.providers.e2e, 'export-config(no keys) missing provider');
            assert(exportNoKeys.data.providers.e2e.apiKey === null, 'export-config(no keys) apiKey should be null');

            const importInvalid = await postJson(port, { action: 'import-config', params: { payload: null } });
            assert(importInvalid.error && importInvalid.error.includes('Invalid import payload'), 'import-config should reject invalid payload');

            const modelsMissing = await postJson(port, { action: 'models', params: { provider: 'missing' } });
            assert(modelsMissing.error, 'models should fail for missing provider');

            const modelsByUrlInvalid = await postJson(port, {
                action: 'models-by-url',
                params: { baseUrl: 'not-a-url' }
            });
            assert(modelsByUrlInvalid.error, 'models-by-url should fail for invalid url');

            const applyEmpty = await postJson(port, { action: 'apply-config-template', params: { template: '' } });
            assert(applyEmpty.error, 'apply-config-template should reject empty template');

            const applyNoProvider = await postJson(port, {
                action: 'apply-config-template',
                params: {
                    template: 'model = "x"\\n[model_providers.x]\\nbase_url = "http://example.com"\\n'
                }
            });
            assert(applyNoProvider.error, 'apply-config-template should require model_provider');

            const applyNoModel = await postJson(port, {
                action: 'apply-config-template',
                params: {
                    template: 'model_provider = "x"\\n[model_providers.x]\\nbase_url = "http://example.com"\\n'
                }
            });
            assert(applyNoModel.error, 'apply-config-template should require model');

            const applyNoProviders = await postJson(port, {
                action: 'apply-config-template',
                params: { template: 'model_provider = "x"\\nmodel = "y"\\n' }
            });
            assert(applyNoProviders.error, 'apply-config-template should require model_providers');

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

            const exportProviderMissing = await postJson(port, {
                action: 'export-provider',
                params: { name: 'ghost' }
            });
            assert(exportProviderMissing.error, 'export-provider should fail for missing provider');

            const exportProvider = await postJson(port, {
                action: 'export-provider',
                params: { name: 'e2e2' }
            });
            assert(exportProvider.payload, 'export-provider missing payload');
            assert(exportProvider.payload.baseUrl === mockProviderUrl, 'export-provider baseUrl mismatch');
            assert(exportProvider.payload.apiKey === 'sk-e2e2', 'export-provider apiKey mismatch');
            debug('export/import ok');

            const apiStatusAfter = await postJson(port, { action: 'status' });
            assert(apiStatusAfter.provider === 'e2e2', 'api status provider after import mismatch');
            assert(apiStatusAfter.model === 'e2e2-model', 'api status model after import mismatch');

            const apiModels = await postJson(port, { action: 'models', params: { provider: 'e2e2' } });
            assert(Array.isArray(apiModels.models) && apiModels.models.includes('e2e2-model-2'), 'api models missing remote entry');

            const apiModelsUnlimited = await postJson(port, { action: 'models', params: { provider: 'e2e3' } });
            assert(apiModelsUnlimited.unlimited === true, 'api models unlimited missing');

            const apiModelsHtml = await postJson(port, { action: 'models', params: { provider: 'e2e4' } });
            assert(apiModelsHtml.unlimited === true, 'api models html unlimited missing');
            debug('models endpoints ok');

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

            const apiPaths = await postJson(port, {
                action: 'list-session-paths',
                params: { source: 'codex', limit: 10, forceRefresh: true }
            });
            assert(Array.isArray(apiPaths.paths), 'api session paths missing');
            assert(apiPaths.paths.includes('/tmp/e2e'), 'api session paths missing cwd');
            debug('session paths ok');

            const agentsRead = await postJson(port, { action: 'get-agents-file' });
            assert(agentsRead.path, 'get-agents-file missing path');
            const agentsApply = await postJson(port, {
                action: 'apply-agents-file',
                params: { content: 'agents-test', lineEnding: '\n' }
            });
            assert(agentsApply.success === true, 'apply-agents-file failed');
            const agentsReadAfter = await postJson(port, { action: 'get-agents-file' });
            assert(agentsReadAfter.exists === true, 'get-agents-file should exist after apply');
            assert(agentsReadAfter.content.includes('agents-test'), 'get-agents-file content mismatch');

            const openclawReadEmpty = await postJson(port, { action: 'get-openclaw-config' });
            assert(openclawReadEmpty.exists === false, 'openclaw config should not exist initially');
            const openclawInvalid = await postJson(port, {
                action: 'apply-openclaw-config',
                params: { content: '', lineEnding: '\n' }
            });
            assert(openclawInvalid.success === false, 'apply-openclaw-config should reject empty content');

            const openclawContent = [
                '{',
                '  "agent": { "model": "gpt-4.1" },',
                '  "agents": { "defaults": { "workspace": "~/.openclaw/workspace" } }',
                '}'
            ].join('\n');
            const openclawApply = await postJson(port, {
                action: 'apply-openclaw-config',
                params: { content: openclawContent, lineEnding: '\n' }
            });
            if (!openclawApply.success) {
                console.error('openclawApply', openclawApply);
            }
            assert(openclawApply.success === true, `apply-openclaw-config failed${openclawApply && openclawApply.error ? `: ${openclawApply.error}` : ''}`);
            const openclawReadAfter = await postJson(port, { action: 'get-openclaw-config' });
            assert(openclawReadAfter.exists === true, 'openclaw config should exist after apply');

            const openclawAgentsBefore = await postJson(port, { action: 'get-openclaw-agents-file' });
            assert(openclawAgentsBefore.path, 'get-openclaw-agents-file missing path');
            const openclawAgentsApply = await postJson(port, {
                action: 'apply-openclaw-agents-file',
                params: { content: 'openclaw-agents', lineEnding: '\n' }
            });
            assert(openclawAgentsApply.success === true, 'apply-openclaw-agents-file failed');
            const openclawAgentsAfter = await postJson(port, { action: 'get-openclaw-agents-file' });
            assert(openclawAgentsAfter.exists === true, 'openclaw agents should exist after apply');
            assert(openclawAgentsAfter.content.includes('openclaw-agents'), 'openclaw agents content mismatch');

            const openclawWorkspaceInvalid = await postJson(port, {
                action: 'apply-openclaw-workspace-file',
                params: { fileName: 'bad.txt', content: 'x', lineEnding: '\n' }
            });
            assert(openclawWorkspaceInvalid.error, 'apply-openclaw-workspace-file should reject invalid name');
            const openclawWorkspaceApply = await postJson(port, {
                action: 'apply-openclaw-workspace-file',
                params: { fileName: 'SOUL.md', content: 'workspace-content', lineEnding: '\n' }
            });
            assert(openclawWorkspaceApply.success === true, 'apply-openclaw-workspace-file failed');
            const openclawWorkspaceRead = await postJson(port, {
                action: 'get-openclaw-workspace-file',
                params: { fileName: 'SOUL.md' }
            });
            assert(openclawWorkspaceRead.exists === true, 'get-openclaw-workspace-file missing after apply');
            assert(openclawWorkspaceRead.content.includes('workspace-content'), 'openclaw workspace content mismatch');

            const apiSessions = await postJson(port, {
                action: 'list-sessions',
                params: { source: 'codex', limit: 50, forceRefresh: true }
            });
            assert(Array.isArray(apiSessions.sessions), 'api sessions missing');
            assert(apiSessions.sessions.some(item => item.sessionId === sessionId), 'api sessions missing codex entry');

            const apiSessionsAll = await postJson(port, {
                action: 'list-sessions',
                params: { source: 'all', limit: 50, forceRefresh: true }
            });
            assert(Array.isArray(apiSessionsAll.sessions), 'api sessions(all) missing');
            assert(apiSessionsAll.sessions.some(item => item.sessionId === sessionId), 'api sessions(all) missing codex entry');

            const sessionDetail = await postJson(port, {
                action: 'session-detail',
                params: { source: 'codex', sessionId }
            });
            assert(Array.isArray(sessionDetail.messages), 'session-detail missing messages');

            const sessionPlain = await postJson(port, {
                action: 'session-plain',
                params: { source: 'codex', sessionId }
            });
            assert(sessionPlain.text && sessionPlain.text.includes('world'), 'session-plain missing content');

            const sessionPlainMissing = await postJson(port, {
                action: 'session-plain',
                params: { source: 'codex', sessionId: 'missing-session' }
            });
            assert(sessionPlainMissing.error, 'session-plain should fail for missing session');

            const exportSession = await postJson(port, {
                action: 'export-session',
                params: { source: 'codex', sessionId, maxMessages: 1 }
            });
            assert(exportSession.content, 'export-session missing content');
            assert(exportSession.truncated === true, 'export-session should be truncated with maxMessages');

            const cloneResult = await postJson(port, {
                action: 'clone-session',
                params: { source: 'codex', sessionId }
            });
            assert(cloneResult.success === true, 'clone-session failed');
            assert(cloneResult.sessionId && cloneResult.sessionId !== sessionId, 'clone-session id invalid');
            assert(fs.existsSync(cloneResult.filePath), 'clone-session file missing');

            const cloneInvalid = await postJson(port, {
                action: 'clone-session',
                params: { source: 'claude', sessionId }
            });
            assert(cloneInvalid.error, 'clone-session should reject non-codex source');

            const apiSessionsAfterClone = await postJson(port, {
                action: 'list-sessions',
                params: { source: 'codex', limit: 50, forceRefresh: true }
            });
            assert(Array.isArray(apiSessionsAfterClone.sessions), 'api sessions after clone missing');
            assert(
                apiSessionsAfterClone.sessions[0]
                    && apiSessionsAfterClone.sessions[0].sessionId === cloneResult.sessionId,
                'clone session not latest'
            );

            const deleteResult = await postJson(port, {
                action: 'delete-session',
                params: { source: 'codex', sessionId }
            });
            assert(deleteResult.success === true, 'delete-session failed');
            assert(!fs.existsSync(sessionPath), 'delete-session file still exists');

            const deleteMissing = await postJson(port, {
                action: 'delete-session',
                params: { source: 'codex', sessionId }
            });
            assert(deleteMissing.error, 'delete-session should fail for missing session');

            const detailMissing = await postJson(port, {
                action: 'session-detail',
                params: { source: 'codex', sessionId }
            });
            assert(detailMissing.error, 'session-detail should fail after delete');

            const apiSessionsAfterDelete = await postJson(port, {
                action: 'list-sessions',
                params: { source: 'codex', limit: 50, forceRefresh: true }
            });
            assert(!apiSessionsAfterDelete.sessions.some(item => item.sessionId === sessionId), 'deleted session still listed');
            assert(apiSessionsAfterDelete.sessions.some(item => item.sessionId === cloneResult.sessionId), 'clone session missing after delete');
            debug('session ops ok');

            debug('pre-config-health');
            const speedResult = await postJson(port, { action: 'speed-test', params: { name: 'e2e2' } }, 4000);
            assert(speedResult.ok === true, 'speed-test failed');

            const switchResult = runSync(node, [cliPath, 'switch', 'e2e4'], { env });
            assert(switchResult.status === 0, 'cli switch failed');

            const cliModels = await runWithInput(node, [cliPath, 'models'], '', { env });
            assert(cliModels.status === 0, 'cli models failed');
            assert(cliModels.stdout.includes('视为不限'), 'cli models missing unlimited hint');

            // config-health-check: baseline ok
            const healthOk = await postJson(port, { action: 'config-health-check', params: { remote: false } });
            assert(healthOk.ok === true, 'health-check should be ok');
            assert(Array.isArray(healthOk.issues) && healthOk.issues.length === 0, 'health-check issues should be empty');
            assert(healthOk.summary && healthOk.summary.currentProvider === 'e2e4', 'health-check summary provider mismatch');

            // config-health-check: invalid base_url (local-only)
            const configPath = path.join(tmpHome, '.codex', 'config.toml');
            const originalConfig = fs.readFileSync(configPath, 'utf-8');
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
                fs.writeFileSync(configPath, invalidConfig, 'utf-8');

                const healthInvalid = await postJson(port, { action: 'config-health-check', params: { remote: false } });
                assert(healthInvalid.ok === false, 'health-check should fail for invalid base_url');
                assert(
                    Array.isArray(healthInvalid.issues) &&
                    healthInvalid.issues.some(issue => issue.code === 'base-url-invalid'),
                    'health-check should report base-url-invalid'
                );

                const healthRemote = await postJson(port, { action: 'config-health-check', params: { remote: true } });
                assert(healthRemote.ok === false, 'health-check(remote) should fail');
                assert(
                    Array.isArray(healthRemote.issues) &&
                    healthRemote.issues.some(issue => issue.code === 'remote-skip-base-url'),
                    'health-check(remote) should report remote-skip-base-url'
                );
            } finally {
                fs.writeFileSync(configPath, originalConfig, 'utf-8');
            }

            // speed-test error cases
            const speedInvalid = await postJson(port, {
                action: 'speed-test',
                params: { url: 'not-a-url' }
            }, 4000);
            assert(speedInvalid.ok === false || speedInvalid.error, 'speed-test invalid url should fail');

            const speedAuthFail = await postJson(port, {
                action: 'speed-test',
                params: { url: authFailUrl }
            }, 4000);
            assert(
                speedAuthFail.status === 401 || (speedAuthFail.error && /401/.test(speedAuthFail.error)),
                'speed-test auth fail should expose 401'
            );

            const speedUnreachable = await postJson(port, {
                action: 'speed-test',
                params: { url: 'http://127.0.0.1:1' }
            }, 4000);
            assert(speedUnreachable.ok === false, 'speed-test unreachable should fail');

            // normalizeWireApi should handle slash-delimited values
            assert(normalizeWireApi('chat/completions') === 'chat_completions', 'normalizeWireApi should replace "/" with "_"');
            const probeSpec = buildModelProbeSpec({ wire_api: 'chat/completions' }, 'e2e-chat', mockProviderUrl);
            assert(probeSpec && probeSpec.url.endsWith('/chat/completions'), 'buildModelProbeSpec should use chat/completions endpoint for slash wire_api');

            // writeJsonAtomic should preserve or set secure permissions
            const permDir = fs.mkdtempSync(path.join(tmpHome, 'perm-'));
            const existingPath = path.join(permDir, 'secret.json');
            fs.writeFileSync(existingPath, JSON.stringify({ a: 1 }), { mode: 0o640 });
            const origMode = fileMode(existingPath);
            writeJsonAtomic(existingPath, { a: 2 });
            assert(fileMode(existingPath) === origMode, 'writeJsonAtomic should preserve mode of existing file');

            const newPath = path.join(permDir, 'new.json');
            writeJsonAtomic(newPath, { b: 1 });
            assert(fileMode(newPath) === 0o600, 'writeJsonAtomic should default to 600 for new file');

            debug('tests done');
        } finally {
            const waitForExit = new Promise((resolve) => {
                if (webServer.exitCode !== null || webServer.signalCode) {
                    return resolve();
                }
                const forceKill = setTimeout(() => {
                    try {
                        webServer.kill('SIGKILL');
                    } catch (e) {}
                }, 2000);
                webServer.on('exit', () => {
                    clearTimeout(forceKill);
                    resolve();
                });
            });
            try {
                webServer.kill('SIGINT');
            } catch (e) {}
            await waitForExit;
        }
    } finally {
        for (const state of realFileStates) {
            const label = state && state.path ? path.basename(state.path) : 'real file';
            assertFileUnchanged(state, `real ${label}`);
        }
        if (mockProvider) {
            await closeServer(mockProvider.server);
        }
        if (noModelsProvider) {
            await closeServer(noModelsProvider.server);
        }
        if (htmlModelsProvider) {
            await closeServer(htmlModelsProvider.server);
        }
        if (authFailProvider) {
            await closeServer(authFailProvider.server);
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
