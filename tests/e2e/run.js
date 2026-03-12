const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const {
    os,
    debug,
    captureFileState,
    assertFileUnchanged,
    startLocalServer,
    closeServer,
    waitForServer,
    postJson
} = require('./helpers');

const testSetup = require('./test-setup');
const testConfig = require('./test-config');
const testClaude = require('./test-claude');
const testSessions = require('./test-sessions');
const testOpenclaw = require('./test-openclaw');
const testHealthSpeed = require('./test-health-speed');

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
    let webServer;
    try {
        mockProvider = await startLocalServer({ mode: 'list', modelsPath: '/v1/models' });
        noModelsProvider = await startLocalServer({ mode: 'none', modelsPath: '/v1/models' });
        htmlModelsProvider = await startLocalServer({ mode: 'html', modelsPath: '/v1/models' });
        authFailProvider = await startLocalServer({ mode: 'list', modelsPath: '/v1/models', status: 401 });

        const mockProviderUrl = `http://127.0.0.1:${mockProvider.port}`;
        const noModelsUrl = `http://127.0.0.1:${noModelsProvider.port}`;
        const htmlModelsUrl = `http://127.0.0.1:${htmlModelsProvider.port}`;
        const authFailUrl = `http://127.0.0.1:${authFailProvider.port}`;

        const ctx = {
            env,
            node,
            cliPath,
            tmpHome,
            mockProviderUrl,
            noModelsUrl,
            htmlModelsUrl,
            authFailUrl
        };

        await testSetup(ctx);

        const port = 18000 + Math.floor(Math.random() * 1000);
        debug('start web server');
        webServer = spawn(node, [cliPath, 'run'], {
            env: { ...env, CODEXMATE_PORT: String(port) },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        webServer.stdout.on('data', () => {});
        webServer.stderr.on('data', () => {});

        await waitForServer(port);
        debug('server ready');

        const api = (action, params, timeoutMs) => postJson(port, { action, params }, timeoutMs);
        Object.assign(ctx, { port, api });

        await testConfig(ctx);
        await testClaude(ctx);
        await testSessions(ctx);
        await testOpenclaw(ctx);
        await testHealthSpeed(ctx);

    } finally {
        const waitForExit = new Promise((resolve) => {
            if (!webServer || webServer.exitCode !== null || webServer.signalCode) {
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
            if (webServer) {
                webServer.kill('SIGINT');
            }
        } catch (e) {}
        await waitForExit;

        await closeServer(mockProvider && mockProvider.server);
        await closeServer(noModelsProvider && noModelsProvider.server);
        await closeServer(htmlModelsProvider && htmlModelsProvider.server);
        await closeServer(authFailProvider && authFailProvider.server);

        for (const state of realFileStates) {
            const label = state && state.path ? path.basename(state.path) : 'real file';
            assertFileUnchanged(state, `real ${label}`);
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
