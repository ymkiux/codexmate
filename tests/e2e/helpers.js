const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawnSync, spawn } = require('child_process');
const { writeJsonAtomic } = require('../../lib/cli-file-utils');
const {
    normalizeWireApi,
    buildModelProbeSpec,
    extractModelResponseText
} = require('../../lib/cli-models-utils');

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
        let child;
        try {
            child = spawn(node, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (err) {
            return resolve({
                status: 1,
                stdout: '',
                stderr: err && err.message ? err.message : String(err)
            });
        }
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => stdout += chunk.toString());
        child.stderr.on('data', chunk => stderr += chunk.toString());
        child.on('error', (err) => {
            resolve({
                status: 1,
                stdout,
                stderr: stderr || (err && err.message ? err.message : String(err))
            });
        });
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
    const responseBody = options.responseBody || { ok: true };
    const responsePaths = Array.isArray(options.responsePaths)
        ? options.responsePaths.map(item => String(item || ''))
        : null;
    const requests = [];
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const requestPath = String(req.url || '').split('?')[0];
            requests.push(requestPath);
            if (requestPath && requestPath.startsWith(modelsPath)) {
                if (mode === 'none') {
                    const errorBody = JSON.stringify({ error: 'not found' });
                    res.writeHead(404, {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Content-Length': Buffer.byteLength(errorBody, 'utf-8')
                    });
                    res.end(errorBody, 'utf-8');
                    return;
                }
                if (mode === 'html') {
                    const htmlBody = '<!doctype html><html><body>ok</body></html>';
                    res.writeHead(status, {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Content-Length': Buffer.byteLength(htmlBody, 'utf-8')
                    });
                    res.end(htmlBody, 'utf-8');
                    return;
                }
                const jsonBody = JSON.stringify({
                    data: [
                        { id: 'e2e2-model' },
                        { id: 'e2e2-model-2' }
                    ]
                });
                res.writeHead(status, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': Buffer.byteLength(jsonBody, 'utf-8')
                });
                res.end(jsonBody, 'utf-8');
                return;
            }
            if (responsePaths && !responsePaths.includes(requestPath)) {
                const errorBody = JSON.stringify({ error: 'not found' });
                res.writeHead(404, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': Buffer.byteLength(errorBody, 'utf-8')
                });
                res.end(errorBody, 'utf-8');
                return;
            }
            const okBody = JSON.stringify(responseBody);
            res.writeHead(status, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(okBody, 'utf-8')
            });
            res.end(okBody, 'utf-8');
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({ server, port: address.port, requests });
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

module.exports = {
    fs,
    path,
    os,
    debug,
    assert,
    fileMode,
    captureFileState,
    assertFileUnchanged,
    runSync,
    runWithInput,
    postJson,
    waitForServer,
    startLocalServer,
    closeServer,
    writeJsonAtomic,
    normalizeWireApi,
    buildModelProbeSpec,
    extractModelResponseText
};
