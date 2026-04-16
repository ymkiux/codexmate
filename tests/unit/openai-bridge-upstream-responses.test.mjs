import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createOpenaiBridgeHttpHandler } = require('../../cli/openai-bridge.js');

function listen(server) {
    server.listen(0, '127.0.0.1');
    return once(server, 'listening').then(() => {
        const addr = server.address();
        return { port: addr.port, host: addr.address };
    });
}

async function requestText(url, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = http.request({
            hostname: u.hostname,
            port: u.port,
            path: `${u.pathname}${u.search}`,
            method,
            headers
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({
                status: res.statusCode || 0,
                headers: res.headers || {},
                text: Buffer.concat(chunks).toString('utf-8')
            }));
        });
        req.on('error', reject);
        if (body !== undefined) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

test('openai-bridge prefers upstream /responses and rewraps SSE when stream requested', async () => {
    const upstream = http.createServer((req, res) => {
        if (req.url === '/v1/responses' && req.method === 'POST') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: 'resp_upstream',
                model: 'gpt-test',
                output: [{
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'hello-from-upstream' }]
                }]
            }));
            return;
        }
        if (req.url === '/v1/models' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ object: 'list', data: [] }));
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
    });
    const { port: upstreamPort } = await listen(upstream);

    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'codexmate-bridge-test-'));
    const settingsFile = path.join(tmpDir, 'bridge.json');
    await writeFile(settingsFile, JSON.stringify({
        version: 1,
        providers: {
            test: { baseUrl: `http://127.0.0.1:${upstreamPort}/v1`, apiKey: 'sk-upstream' }
        }
    }), 'utf-8');

    const handler = createOpenaiBridgeHttpHandler({ settingsFile, expectedToken: 'codexmate' });
    const bridge = http.createServer((req, res) => {
        if (!handler(req, res)) {
            res.statusCode = 404;
            res.end('not handled');
        }
    });
    const { port: bridgePort } = await listen(bridge);

    const base = `http://127.0.0.1:${bridgePort}/bridge/openai/test/v1/responses`;
    const sse = await requestText(base, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer codexmate'
        },
        body: {
            model: 'gpt-test',
            input: 'ping',
            stream: true
        }
    });
    assert.equal(sse.status, 200);
    assert.match(sse.headers['content-type'], /text\/event-stream/i);
    assert.match(sse.text, /event: response\.completed/);
    assert.match(sse.text, /data: \[DONE\]/);

    await bridge.close();
    await upstream.close();
    await rm(tmpDir, { recursive: true, force: true });
});

test('openai-bridge falls back to upstream /chat/completions when /responses is not supported', async () => {
    const upstream = http.createServer((req, res) => {
        if (req.url === '/v1/responses') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            return;
        }
        if (req.url === '/v1/chat/completions' && req.method === 'POST') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: 'chatcmpl_x',
                model: 'gpt-test',
                choices: [{ message: { role: 'assistant', content: 'hello-from-chat' } }]
            }));
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
    });
    const { port: upstreamPort } = await listen(upstream);

    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'codexmate-bridge-test-'));
    const settingsFile = path.join(tmpDir, 'bridge.json');
    await writeFile(settingsFile, JSON.stringify({
        version: 1,
        providers: {
            test: { baseUrl: `http://127.0.0.1:${upstreamPort}/v1`, apiKey: 'sk-upstream' }
        }
    }), 'utf-8');

    const handler = createOpenaiBridgeHttpHandler({ settingsFile, expectedToken: 'codexmate' });
    const bridge = http.createServer((req, res) => {
        if (!handler(req, res)) {
            res.statusCode = 404;
            res.end('not handled');
        }
    });
    const { port: bridgePort } = await listen(bridge);

    const url = `http://127.0.0.1:${bridgePort}/bridge/openai/test/v1/responses`;
    const resp = await requestText(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer codexmate'
        },
        body: {
            model: 'gpt-test',
            input: 'ping',
            stream: false
        }
    });
    assert.equal(resp.status, 200);
    const parsed = JSON.parse(resp.text);
    assert.equal(parsed.object, 'response');
    assert.equal(parsed.model, 'gpt-test');
    assert.ok(Array.isArray(parsed.output));

    await bridge.close();
    await upstream.close();
    await rm(tmpDir, { recursive: true, force: true });
});

