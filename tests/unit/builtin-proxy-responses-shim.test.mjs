import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const { createBuiltinProxyRuntimeController } = require('../../cli/builtin-proxy.js');

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

test('builtin-proxy /v1/responses falls back to chat-only upstream and returns Responses JSON', async () => {
    const upstream = http.createServer((req, res) => {
        if (req.url === '/v1/responses' && req.method === 'POST') {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
            return;
        }
        if (req.url === '/v1/chat/completions' && req.method === 'POST') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: 'chatcmpl_test',
                model: 'gpt-test',
                choices: [{ message: { role: 'assistant', content: 'hello-from-chat' } }],
                usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
            }));
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
    });
    const { port: upstreamPort } = await listen(upstream);

    const controller = createBuiltinProxyRuntimeController({
        fs,
        https,
        CONFIG_FILE: '/tmp/codexmate-test-config.toml',
        BUILTIN_PROXY_SETTINGS_FILE: '/tmp/codexmate-test-proxy.json',
        DEFAULT_BUILTIN_PROXY_SETTINGS: {},
        BUILTIN_PROXY_PROVIDER_NAME: 'codexmate-proxy',
        CODEXMATE_MANAGED_MARKER: 'codexmate-managed',
        HTTP_KEEP_ALIVE_AGENT: new http.Agent({ keepAlive: true }),
        HTTPS_KEEP_ALIVE_AGENT: new https.Agent({ keepAlive: true })
    });

    const proxy = controller.createBuiltinProxyServer(
        { timeoutMs: 2000 },
        { providerName: 'test', baseUrl: `http://127.0.0.1:${upstreamPort}/v1`, authHeader: '' }
    );
    const { port: proxyPort } = await listen(proxy);

    const resp = await requestText(`http://127.0.0.1:${proxyPort}/v1/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { model: 'gpt-test', input: 'ping', stream: false }
    });
    assert.equal(resp.status, 200);
    const parsed = JSON.parse(resp.text);
    assert.equal(parsed.object, 'response');
    assert.equal(parsed.model, 'gpt-test');
    assert.ok(Array.isArray(parsed.output));
    assert.equal(parsed.output[0].type, 'message');
    assert.equal(parsed.output[0].content[0].type, 'output_text');
    assert.equal(parsed.output[0].content[0].text, 'hello-from-chat');

    await proxy.close();
    await upstream.close();
});

test('builtin-proxy /v1/responses stream=true returns SSE wrapper with done sentinel', async () => {
    const upstream = http.createServer((req, res) => {
        if (req.url === '/v1/responses' && req.method === 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            return;
        }
        if (req.url === '/v1/chat/completions' && req.method === 'POST') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: 'chatcmpl_test',
                model: 'gpt-test',
                choices: [{ message: { role: 'assistant', content: 'hello-from-chat' } }]
            }));
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
    });
    const { port: upstreamPort } = await listen(upstream);

    const controller = createBuiltinProxyRuntimeController({
        fs,
        https,
        CONFIG_FILE: '/tmp/codexmate-test-config.toml',
        BUILTIN_PROXY_SETTINGS_FILE: '/tmp/codexmate-test-proxy.json',
        DEFAULT_BUILTIN_PROXY_SETTINGS: {},
        BUILTIN_PROXY_PROVIDER_NAME: 'codexmate-proxy',
        CODEXMATE_MANAGED_MARKER: 'codexmate-managed',
        HTTP_KEEP_ALIVE_AGENT: new http.Agent({ keepAlive: true }),
        HTTPS_KEEP_ALIVE_AGENT: new https.Agent({ keepAlive: true })
    });

    const proxy = controller.createBuiltinProxyServer(
        { timeoutMs: 2000 },
        { providerName: 'test', baseUrl: `http://127.0.0.1:${upstreamPort}/v1`, authHeader: '' }
    );
    const { port: proxyPort } = await listen(proxy);

    const sse = await requestText(`http://127.0.0.1:${proxyPort}/v1/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { model: 'gpt-test', input: 'ping', stream: true }
    });
    assert.equal(sse.status, 200);
    assert.match(sse.headers['content-type'], /text\/event-stream/i);
    assert.match(sse.text, /event: response\.output_text\.delta/);
    assert.match(sse.text, /event: response\.completed/);
    assert.match(sse.text, /data: \[DONE\]/);

    await proxy.close();
    await upstream.close();
});

