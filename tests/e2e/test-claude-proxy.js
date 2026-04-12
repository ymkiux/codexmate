const http = require('http');
const { assert, closeServer } = require('./helpers');

function requestRaw(port, pathname, options = {}) {
    return new Promise((resolve, reject) => {
        const body = options.body !== undefined ? JSON.stringify(options.body) : '';
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: pathname,
            method: options.method || (body ? 'POST' : 'GET'),
            headers: {
                ...(options.headers || {}),
                ...(body ? {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                } : {})
            }
        }, (res) => {
            let responseBody = '';
            res.setEncoding('utf-8');
            res.on('data', chunk => responseBody += chunk);
            res.on('end', () => resolve({
                statusCode: res.statusCode || 0,
                headers: res.headers,
                body: responseBody
            }));
        });
        req.on('error', reject);
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

function startClaudeProxyUpstreamServer() {
    const requests = [];
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            let body = '';
            req.setEncoding('utf-8');
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                let parsedBody = null;
                if (body.trim()) {
                    try {
                        parsedBody = JSON.parse(body);
                    } catch (e) {
                        parsedBody = null;
                    }
                }
                requests.push({
                    method: req.method,
                    path: String(req.url || '').split('?')[0],
                    headers: req.headers,
                    body: parsedBody
                });

                const requestPath = String(req.url || '').split('?')[0];
                if (req.method === 'GET' && requestPath === '/v1/models') {
                    const payload = JSON.stringify({
                        data: [{ id: 'gpt-4.1' }, { id: 'gpt-4o-mini' }]
                    });
                    res.writeHead(200, {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Content-Length': Buffer.byteLength(payload, 'utf-8')
                    });
                    res.end(payload, 'utf-8');
                    return;
                }

                if (req.method === 'POST' && requestPath === '/v1/responses') {
                    const isToolResponse = parsedBody
                        && Array.isArray(parsedBody.tools)
                        && parsedBody.tools.length > 0;
                    const payload = JSON.stringify({
                        id: 'resp_e2e_1',
                        model: parsedBody && parsedBody.model ? parsedBody.model : 'unknown-model',
                        output: isToolResponse
                            ? [
                                { type: 'message', content: [{ type: 'output_text', text: 'tool ready' }] },
                                { type: 'function_call', call_id: 'toolu_lookup', name: 'lookup', arguments: '{"city":"tokyo"}' }
                            ]
                            : [
                                { type: 'message', content: [{ type: 'output_text', text: 'proxy ok' }] }
                            ],
                        usage: {
                            input_tokens: 23,
                            output_tokens: 11
                        }
                    });
                    res.writeHead(200, {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Content-Length': Buffer.byteLength(payload, 'utf-8')
                    });
                    res.end(payload, 'utf-8');
                    return;
                }

                const notFound = JSON.stringify({ error: { message: 'not found' } });
                res.writeHead(404, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': Buffer.byteLength(notFound, 'utf-8')
                });
                res.end(notFound, 'utf-8');
            });
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({ server, port: address.port, requests });
        });
    });
}

module.exports = async function testClaudeProxy(ctx) {
    const { api } = ctx;
    const upstream = await startClaudeProxyUpstreamServer();
    const proxyPort = 19000 + Math.floor(Math.random() * 1000);
    try {
        const upstreamUrl = `http://127.0.0.1:${upstream.port}`;
        const addProvider = await api('add-provider', {
            name: 'claude-proxy-e2e',
            url: upstreamUrl,
            key: 'sk-claude-upstream'
        });
        assert(addProvider.success === true, 'add-provider(claude-proxy-e2e) failed');

        const startResult = await api('claude-proxy-start', {
            host: '127.0.0.1',
            port: proxyPort,
            provider: 'claude-proxy-e2e',
            authSource: 'provider',
            timeoutMs: 5000
        });
        assert(startResult.success === true, 'claude-proxy-start failed');
        assert(startResult.listenUrl === `http://127.0.0.1:${proxyPort}`, 'claude-proxy-start listenUrl mismatch');
        assert(startResult.mode === 'anthropic-to-responses', 'claude-proxy-start mode mismatch');

        const statusResult = await api('claude-proxy-status');
        assert(statusResult.running === true, 'claude-proxy-status should show running');
        assert(statusResult.runtime && statusResult.runtime.upstreamProvider === 'claude-proxy-e2e', 'claude-proxy-status upstream provider mismatch');

        const modelsResponse = await requestRaw(proxyPort, '/v1/models', {
            headers: {
                'x-api-key': 'sk-anthropic-client',
                'anthropic-version': '2023-06-01'
            }
        });
        assert(modelsResponse.statusCode === 200, 'claude proxy /v1/models should succeed');
        const modelsPayload = JSON.parse(modelsResponse.body);
        assert(Array.isArray(modelsPayload.data) && modelsPayload.data.length === 2, 'claude proxy /v1/models should return anthropic model list');
        assert(modelsPayload.data[0].id === 'gpt-4.1', 'claude proxy /v1/models first model mismatch');

        const messageResponse = await requestRaw(proxyPort, '/v1/messages', {
            headers: {
                'x-api-key': 'sk-anthropic-client',
                'anthropic-version': '2023-06-01'
            },
            body: {
                model: 'gpt-4.1',
                max_tokens: 128,
                system: 'system prompt',
                messages: [
                    { role: 'user', content: 'hello proxy' }
                ]
            }
        });
        assert(messageResponse.statusCode === 200, 'claude proxy /v1/messages should succeed');
        const messagePayload = JSON.parse(messageResponse.body);
        assert(messagePayload.type === 'message', 'claude proxy should return anthropic message payload');
        assert(messagePayload.content[0].text === 'proxy ok', 'claude proxy message text mismatch');
        assert(messagePayload.usage.input_tokens === 23, 'claude proxy message usage input mismatch');
        assert(messagePayload.usage.output_tokens === 11, 'claude proxy message usage output mismatch');

        const streamResponse = await requestRaw(proxyPort, '/v1/messages', {
            headers: {
                'x-api-key': 'sk-anthropic-client',
                'anthropic-version': '2023-06-01'
            },
            body: {
                model: 'gpt-4.1',
                max_tokens: 128,
                stream: true,
                messages: [
                    { role: 'user', content: 'call tool please' }
                ],
                tools: [
                    {
                        name: 'lookup',
                        description: 'Lookup city',
                        input_schema: { type: 'object', properties: { city: { type: 'string' } } }
                    }
                ],
                tool_choice: { type: 'tool', name: 'lookup' }
            }
        });
        assert(streamResponse.statusCode === 200, 'claude proxy streamed /v1/messages should succeed');
        assert(String(streamResponse.headers['content-type'] || '').includes('text/event-stream'), 'claude proxy stream should return SSE content type');
        assert(streamResponse.body.includes('event: content_block_delta'), 'claude proxy stream should emit content_block_delta');
        assert(streamResponse.body.includes('tool ready'), 'claude proxy stream should include assistant text delta');
        assert(streamResponse.body.includes('input_json_delta'), 'claude proxy stream should include tool json delta');

        const upstreamMessages = upstream.requests.filter((item) => item.path === '/v1/responses');
        assert(upstreamMessages.length >= 2, 'claude proxy should hit upstream /v1/responses');
        assert(upstreamMessages[0].headers.authorization === 'Bearer sk-claude-upstream', 'claude proxy should use provider auth for upstream');
        assert(upstreamMessages[0].body.instructions === 'system prompt', 'claude proxy should map system prompt to responses instructions');
        assert(upstreamMessages[0].body.max_output_tokens === 128, 'claude proxy should map max_tokens to max_output_tokens');
        assert(Array.isArray(upstreamMessages[0].body.input), 'claude proxy should map anthropic messages into responses input array');
        assert(upstreamMessages[1].body.tool_choice && upstreamMessages[1].body.tool_choice.name === 'lookup', 'claude proxy should map tool_choice to responses tool_choice');
        assert(Array.isArray(upstreamMessages[1].body.tools) && upstreamMessages[1].body.tools[0].type === 'function', 'claude proxy should map anthropic tools into responses tools');

        const stopResult = await api('claude-proxy-stop');
        assert(stopResult.success === true, 'claude-proxy-stop failed');
    } finally {
        try {
            await api('claude-proxy-stop');
        } catch (_) {}
        try {
            await api('delete-provider', { name: 'claude-proxy-e2e' });
        } catch (_) {}
        await closeServer(upstream.server);
    }
};
