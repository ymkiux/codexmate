const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { readJsonFile, writeJsonAtomic } = require('../lib/cli-file-utils');
const { isValidHttpUrl, normalizeBaseUrl, joinApiUrl } = require('../lib/cli-utils');

const DEFAULT_BRIDGE_TOKEN = 'codexmate';
const SETTINGS_VERSION = 1;

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeProviderName(value) {
    // Provider name validation is done elsewhere; keep this conservative.
    return normalizeText(value);
}

function normalizeOpenaiUpstreamBaseUrl(rawValue) {
    const normalized = normalizeBaseUrl(rawValue);
    if (!normalized) return '';
    try {
        const parsed = new URL(normalized);
        let pathname = String(parsed.pathname || '').replace(/\/+$/g, '');

        // If user accidentally pasted a full endpoint, strip it back to the base URL.
        // Keep direct provider routes (e.g. /project/ym) intact.
        pathname = pathname
            .replace(/\/v1\/chat\/completions$/i, '/v1')
            .replace(/\/chat\/completions$/i, '')
            .replace(/\/v1\/responses$/i, '/v1')
            .replace(/\/responses$/i, '')
            .replace(/\/v1\/models$/i, '/v1')
            .replace(/\/models$/i, '');

        // Normalize empty/root path.
        if (pathname === '/') pathname = '';

        const rebuilt = `${parsed.origin}${pathname}`;
        return normalizeBaseUrl(rebuilt);
    } catch (_) {
        return normalized;
    }
}

function normalizeUpstreamEntry(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
    }
    const baseUrl = normalizeOpenaiUpstreamBaseUrl(entry.baseUrl || entry.base_url || '');
    const apiKey = normalizeText(entry.apiKey || entry.api_key || entry.key || '');
    const headersRaw = entry.headers || entry.extraHeaders || entry.extra_headers || null;
    const headers = normalizeHeadersMap(headersRaw);
    if (!baseUrl || !isValidHttpUrl(baseUrl)) {
        return null;
    }
    return { baseUrl, apiKey, headers };
}

function normalizeHeadersMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const forbidden = new Set([
        'authorization',
        'host',
        'content-length',
        'connection',
        'transfer-encoding',
        'keep-alive',
        'proxy-authenticate',
        'proxy-authorization',
        'te',
        'trailer',
        'upgrade'
    ]);
    const result = {};
    for (const [rawKey, rawVal] of Object.entries(value)) {
        const key = typeof rawKey === 'string' ? rawKey.trim() : '';
        if (!key) continue;
        const lower = key.toLowerCase();
        if (forbidden.has(lower)) continue;
        if (typeof rawVal !== 'string') continue;
        result[key] = rawVal;
    }
    return result;
}

function readOpenaiBridgeSettings(filePath) {
    const parsed = readJsonFile(filePath, null);
    const providers = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed.providers
        : null;
    const providerMap = providers && typeof providers === 'object' && !Array.isArray(providers)
        ? providers
        : {};
    return {
        version: SETTINGS_VERSION,
        providers: providerMap
    };
}

function upsertOpenaiBridgeProvider(filePath, providerName, upstreamBaseUrl, apiKey, headers) {
    const name = normalizeProviderName(providerName);
    const baseUrl = normalizeOpenaiUpstreamBaseUrl(upstreamBaseUrl);
    const key = normalizeText(apiKey);
    const nextHeaders = normalizeHeadersMap(headers);

    if (!name) {
        return { error: 'Provider name is required' };
    }
    if (!baseUrl || !isValidHttpUrl(baseUrl)) {
        return { error: 'Upstream base URL is invalid' };
    }

    const settings = readOpenaiBridgeSettings(filePath);
    const existing = settings && settings.providers ? settings.providers[name] : null;
    const existingHeaders = existing && typeof existing === 'object' && !Array.isArray(existing)
        ? normalizeHeadersMap(existing.headers || existing.extraHeaders || existing.extra_headers || null)
        : {};
    const next = {
        version: SETTINGS_VERSION,
        providers: {
            ...(settings.providers || {}),
            [name]: {
                baseUrl,
                apiKey: key,
                headers: Object.keys(nextHeaders).length ? nextHeaders : existingHeaders
            }
        }
    };
    writeJsonAtomic(filePath, next);
    return { success: true };
}

function resolveOpenaiBridgeUpstream(filePath, providerName) {
    const name = normalizeProviderName(providerName);
    if (!name) return { error: 'Provider name is required' };
    const settings = readOpenaiBridgeSettings(filePath);
    const entry = settings.providers ? settings.providers[name] : null;
    const normalized = normalizeUpstreamEntry(entry);
    if (!normalized) {
        return { error: `OpenAI 转换未配置: ${name}` };
    }
    return { provider: name, ...normalized };
}

function extractAuthorizationToken(req) {
    const header = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
    if (!header) return '';
    if (/^bearer\s+/i.test(header)) {
        return header.replace(/^bearer\s+/i, '').trim();
    }
    return header;
}

function readRequestBody(req, maxBytes) {
    return new Promise((resolve) => {
        let body = '';
        let size = 0;
        let aborted = false;
        req.on('data', (chunk) => {
            if (aborted) return;
            size += chunk.length;
            if (Number.isFinite(maxBytes) && maxBytes > 0 && size > maxBytes) {
                aborted = true;
                try { req.destroy(); } catch (_) {}
                resolve({ error: '请求体过大' });
                return;
            }
            body += chunk;
        });
        req.on('end', () => {
            if (aborted) return;
            resolve({ body });
        });
        req.on('error', (err) => resolve({ error: err && err.message ? err.message : 'request failed' }));
    });
}

function parseJsonOrError(text) {
    if (typeof text !== 'string' || !text.trim()) {
        return { value: null, error: 'empty body' };
    }
    try {
        return { value: JSON.parse(text), error: '' };
    } catch (e) {
        return { value: null, error: e && e.message ? e.message : 'invalid json' };
    }
}

function extractChatCompletionResult(payload) {
    if (!payload || typeof payload !== 'object') return { text: '', toolCalls: [] };
    const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
    const message = choice && typeof choice === 'object' ? choice.message : null;
    const toolCalls = message && typeof message === 'object' && Array.isArray(message.tool_calls)
        ? message.tool_calls
        : [];
    const content = message && typeof message === 'object' ? message.content : '';
    let text = '';
    if (typeof content === 'string') {
        text = content;
    } else if (Array.isArray(content)) {
        text = content
            .map((item) => {
                if (!item) return '';
                if (typeof item === 'string') return item;
                if (typeof item === 'object') {
                    if (typeof item.text === 'string') return item.text;
                    if (typeof item.content === 'string') return item.content;
                }
                return '';
            })
            .filter(Boolean)
            .join('');
    }
    return { text, toolCalls };
}

function normalizeResponsesInputToChatMessages(input) {
    if (typeof input === 'string') {
        return [{ role: 'user', content: input }];
    }
    if (!Array.isArray(input)) {
        return [];
    }

    const messages = [];
    for (const item of input) {
        if (!item || typeof item !== 'object') continue;

        // Tool calls (Responses): { type: "function_call", call_id, name, arguments }
        // Chat Completions equivalent: assistant message with tool_calls
        if (typeof item.type === 'string' && item.type === 'function_call') {
            const callId = typeof item.call_id === 'string' ? item.call_id.trim() : '';
            const name = typeof item.name === 'string' ? item.name.trim() : '';
            const args = typeof item.arguments === 'string' ? item.arguments : '';
            if (callId && name) {
                messages.push({
                    role: 'assistant',
                    tool_calls: [{
                        id: callId,
                        type: 'function',
                        function: {
                            name,
                            arguments: args || ''
                        }
                    }]
                });
            }
            continue;
        }

        // Tool results (Responses): { type: "function_call_output", call_id, output }
        // Chat Completions equivalent: { role: "tool", tool_call_id, content }
        if (typeof item.type === 'string' && item.type === 'function_call_output') {
            const toolCallId = typeof item.call_id === 'string' ? item.call_id.trim() : '';
            let content = item.output;
            if (typeof content !== 'string') {
                try {
                    content = JSON.stringify(content);
                } catch (_) {
                    content = String(content ?? '');
                }
            }
            if (toolCallId) {
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCallId,
                    content: String(content || '')
                });
            }
            continue;
        }

        const roleRaw = typeof item.role === 'string' ? item.role.trim().toLowerCase() : '';
        const role = roleRaw === 'assistant' ? 'assistant' : (roleRaw === 'system' ? 'system' : 'user');
        const content = item.content;
        if (typeof content === 'string') {
            if (content.trim()) messages.push({ role, content });
            continue;
        }
        if (Array.isArray(content)) {
            const text = content
                .map((block) => {
                    if (!block) return '';
                    if (typeof block === 'string') return block;
                    if (typeof block === 'object') {
                        if (typeof block.text === 'string') return block.text;
                        if (typeof block.content === 'string') return block.content;
                        if (typeof block.type === 'string' && (block.type === 'input_text' || block.type === 'output_text')
                            && typeof block.text === 'string') {
                            return block.text;
                        }
                    }
                    return '';
                })
                .filter(Boolean)
                .join('');
            if (text.trim()) messages.push({ role, content: text });
        }
    }
    return messages;
}

function convertResponsesRequestToChatCompletions(payload) {
    const body = payload && typeof payload === 'object' ? payload : {};
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model) {
        return { error: 'responses 请求缺少 model' };
    }

    const messages = [];
    // Align with Maxx/CLIProxyAPI style: map "instructions" to a leading system message.
    if (typeof body.instructions === 'string' && body.instructions.trim()) {
        messages.push({ role: 'system', content: body.instructions.trim() });
    }
    messages.push(...normalizeResponsesInputToChatMessages(body.input));
    if (!messages.length) {
        // codex sometimes sends empty input for probes; tolerate.
        messages.push({ role: 'user', content: '' });
    }

    const maxOutputTokens = Number.parseInt(String(body.max_output_tokens), 10);
    const stream = body.stream === true;

    const chat = {
        model,
        messages,
        stream: false,
        temperature: Number.isFinite(body.temperature) ? Number(body.temperature) : undefined,
        top_p: Number.isFinite(body.top_p) ? Number(body.top_p) : undefined,
        max_tokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : undefined
    };
    if (Array.isArray(body.stop) && body.stop.length) {
        chat.stop = body.stop.filter((item) => typeof item === 'string' && item.trim());
    }
    // Best-effort: pass through tool definitions (most OpenAI-compatible providers accept these fields).
    if (Array.isArray(body.tools) && body.tools.length) {
        chat.tools = body.tools;
    }
    if (body.tool_choice !== undefined) {
        chat.tool_choice = body.tool_choice;
    }
    if (body.response_format !== undefined) {
        chat.response_format = body.response_format;
    }
    if (body.metadata !== undefined) {
        chat.metadata = body.metadata;
    }

    // Remove undefined keys
    Object.keys(chat).forEach((key) => chat[key] === undefined && delete chat[key]);

    return { chat, streamRequested: stream };
}

function buildResponsesPayloadFromChatResult(model, text, toolCalls, upstreamPayload) {
    const responseId = `resp_${crypto.randomBytes(10).toString('hex')}`;
    const usage = upstreamPayload && upstreamPayload.usage && typeof upstreamPayload.usage === 'object'
        ? upstreamPayload.usage
        : null;
    const messageItem = {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }]
    };
    if (Array.isArray(toolCalls) && toolCalls.length) {
        messageItem.tool_calls = toolCalls;
    }
    const output = [messageItem];

    const payload = {
        id: responseId,
        object: 'response',
        model,
        output
    };

    if (usage) {
        payload.usage = usage;
    }

    return payload;
}

function extractResponsesOutputText(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const output = Array.isArray(payload.output) ? payload.output : [];
    for (const item of output) {
        if (!item || typeof item !== 'object') continue;
        if (item.type !== 'message') continue;
        const content = Array.isArray(item.content) ? item.content : [];
        for (const block of content) {
            if (!block || typeof block !== 'object') continue;
            if (block.type !== 'output_text') continue;
            if (typeof block.text === 'string') return block.text;
        }
    }
    if (typeof payload.output_text === 'string') return payload.output_text;
    return '';
}

function toUpstreamNonStreamingResponsesPayload(payload) {
    const body = payload && typeof payload === 'object' ? payload : {};
    return { ...body, stream: false };
}

function isLoopbackAddress(address) {
    if (!address) return false;
    const value = String(address);
    return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function writeSse(res, eventName, dataObj) {
    if (eventName) {
        res.write(`event: ${eventName}\n`);
    }
    if (dataObj === '[DONE]') {
        res.write('data: [DONE]\n\n');
        return;
    }
    res.write(`data: ${JSON.stringify(dataObj)}\n\n`);
}

async function proxyRequestJson(targetUrl, options = {}) {
    const parsed = new URL(targetUrl);
    const transport = parsed.protocol === 'https:' ? https : http;
    const bodyText = options.body ? JSON.stringify(options.body) : '';
    const headers = {
        'Accept': 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
    };
    if (options.body) {
        headers['Content-Length'] = Buffer.byteLength(bodyText, 'utf-8');
    }

    const timeoutMs = Number.isFinite(options.timeoutMs)
        ? Math.max(1000, Number(options.timeoutMs))
        : 30000;
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        const req = transport.request({
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            method: options.method || 'GET',
            path: `${parsed.pathname}${parsed.search}`,
            headers,
            agent: parsed.protocol === 'https:' ? options.httpsAgent : options.httpAgent
        }, (upstreamRes) => {
            const chunks = [];
            upstreamRes.on('data', (chunk) => chunk && chunks.push(chunk));
            upstreamRes.on('end', () => {
                const text = chunks.length ? Buffer.concat(chunks).toString('utf-8') : '';
                finish({
                    ok: true,
                    status: upstreamRes.statusCode || 0,
                    headers: upstreamRes.headers || {},
                    bodyText: text
                });
            });
        });
        req.setTimeout(timeoutMs, () => {
            try { req.destroy(new Error('timeout')); } catch (_) {}
            finish({ ok: false, error: 'timeout' });
        });
        req.on('error', (err) => finish({ ok: false, error: err && err.message ? err.message : 'request failed' }));
        if (bodyText) {
            req.write(bodyText);
        }
        req.end();
    });
}

function createOpenaiBridgeHttpHandler(options = {}) {
    const settingsFile = options.settingsFile;
    const expectedToken = typeof options.expectedToken === 'string' && options.expectedToken.trim()
        ? options.expectedToken.trim()
        : DEFAULT_BRIDGE_TOKEN;
    const maxBodySize = Number.isFinite(options.maxBodySize) ? options.maxBodySize : 0;
    const httpAgent = options.httpAgent;
    const httpsAgent = options.httpsAgent;

    if (!settingsFile) {
        throw new Error('createOpenaiBridgeHttpHandler 缺少 settingsFile');
    }

    const matchPath = (requestPath) => {
        const normalized = String(requestPath || '');
        const prefix = '/bridge/openai/';
        if (!normalized.startsWith(prefix)) return null;
        const rest = normalized.slice(prefix.length);
        const [provider, ...tail] = rest.split('/').filter((part) => part.length > 0);
        if (!provider) return null;
        const tailPath = '/' + tail.join('/');
        if (!tailPath.startsWith('/v1')) return null;
        const suffix = tailPath === '/v1' ? '' : tailPath.replace(/^\/v1\/?/, '');
        return { provider, suffix };
    };

    const handler = (req, res) => {
        let parsedUrl;
        try {
            parsedUrl = new URL(req.url || '/', 'http://localhost');
        } catch (_) {
            return false;
        }
        const match = matchPath(parsedUrl.pathname || '/');
        if (!match) return false;

        void (async () => {
            try {
            const token = extractAuthorizationToken(req);
            // 兼容：某些客户端在自定义 base_url 时可能不带 Authorization。
            // 为避免在 LAN 暴露无鉴权的代理，这里仅允许 loopback 连接缺省 token。
            const remoteAddr = req && req.socket ? req.socket.remoteAddress : '';
            if (!token && !isLoopbackAddress(remoteAddr)) {
                res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
            if (token && token !== expectedToken) {
                res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }

            const upstream = resolveOpenaiBridgeUpstream(settingsFile, match.provider);
            if (upstream.error) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: upstream.error }));
                return;
            }

            const suffix = match.suffix || '';
            const normalizedSuffix = suffix.replace(/^\/+/, '');

            const authHeader = upstream.apiKey
                ? (/^bearer\s+/i.test(upstream.apiKey) ? upstream.apiKey : `Bearer ${upstream.apiKey}`)
                : '';
            const upstreamHeaders = upstream && upstream.headers && typeof upstream.headers === 'object' && !Array.isArray(upstream.headers)
                ? upstream.headers
                : {};

            if (!normalizedSuffix || normalizedSuffix === 'models') {
                if ((req.method || 'GET').toUpperCase() !== 'GET') {
                    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
                    return;
                }

                const url = joinApiUrl(upstream.baseUrl, 'models');
                const result = await proxyRequestJson(url, {
                    method: 'GET',
                    headers: {
                        ...(authHeader ? { Authorization: authHeader } : {}),
                        ...upstreamHeaders
                    },
                    httpAgent,
                    httpsAgent
                });
                if (!result.ok) {
                    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: `Upstream request failed: ${result.error}` }));
                    return;
                }
                res.writeHead(result.status || 502, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(result.bodyText || '');
                return;
            }

            if (normalizedSuffix !== 'responses') {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Not Found' }));
                return;
            }

            if ((req.method || 'GET').toUpperCase() !== 'POST') {
                res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Method Not Allowed' }));
                return;
            }

            const { body, error: bodyErr } = await readRequestBody(req, maxBodySize);
            if (bodyErr) {
                res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: bodyErr }));
                return;
            }
            const parsed = parseJsonOrError(body);
            if (parsed.error) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: `Invalid JSON: ${parsed.error}` }));
                return;
            }

            const responsesRequest = parsed.value;
            const streamRequested = !!(responsesRequest && typeof responsesRequest === 'object' && responsesRequest.stream === true);

            // Maxx-style behavior: prefer upstream /responses if supported.
            // Fallback to /chat/completions conversion when upstream does not implement /responses (404/405).
            const upstreamResponsesUrl = joinApiUrl(upstream.baseUrl, 'responses');
            const upstreamResponsesResult = await proxyRequestJson(upstreamResponsesUrl, {
                method: 'POST',
                body: toUpstreamNonStreamingResponsesPayload(responsesRequest),
                headers: {
                    ...(authHeader ? { Authorization: authHeader } : {}),
                    ...upstreamHeaders
                },
                httpAgent,
                httpsAgent
            });

            if (upstreamResponsesResult.ok && upstreamResponsesResult.status >= 200 && upstreamResponsesResult.status < 300) {
                const upstreamJson = parseJsonOrError(upstreamResponsesResult.bodyText);
                if (upstreamJson.error) {
                    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: `Upstream JSON parse failed: ${upstreamJson.error}` }));
                    return;
                }
                const upstreamPayload = upstreamJson.value;
                const model = typeof upstreamPayload.model === 'string'
                    ? upstreamPayload.model
                    : (responsesRequest && typeof responsesRequest.model === 'string' ? responsesRequest.model : '');

                if (streamRequested) {
                    const text = extractResponsesOutputText(upstreamPayload);
                    res.writeHead(200, {
                        'Content-Type': 'text/event-stream; charset=utf-8',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                        'X-Accel-Buffering': 'no'
                    });
                    writeSse(res, 'response.created', {
                        type: 'response.created',
                        response: { id: upstreamPayload.id || `resp_${crypto.randomBytes(10).toString('hex')}`, model }
                    });
                    if (text) {
                        writeSse(res, 'response.output_text.delta', { type: 'response.output_text.delta', delta: text });
                        writeSse(res, 'response.output_text.done', { type: 'response.output_text.done', text });
                    }
                    writeSse(res, 'response.completed', { type: 'response.completed', response: upstreamPayload });
                    writeSse(res, 'done', '[DONE]');
                    res.end();
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(upstreamPayload));
                return;
            }

            if (upstreamResponsesResult.ok && upstreamResponsesResult.status >= 400 && upstreamResponsesResult.status !== 404 && upstreamResponsesResult.status !== 405) {
                res.writeHead(upstreamResponsesResult.status, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(upstreamResponsesResult.bodyText || JSON.stringify({ error: 'Upstream error' }));
                return;
            }

            if (!upstreamResponsesResult.ok) {
                res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: `Upstream request failed: ${upstreamResponsesResult.error}` }));
                return;
            }

            const converted = convertResponsesRequestToChatCompletions(responsesRequest);
            if (converted.error) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: converted.error }));
                return;
            }

            const upstreamUrl = joinApiUrl(upstream.baseUrl, 'chat/completions');
            const upstreamResult = await proxyRequestJson(upstreamUrl, {
                method: 'POST',
                body: converted.chat,
                headers: {
                    ...(authHeader ? { Authorization: authHeader } : {}),
                    ...upstreamHeaders
                },
                httpAgent,
                httpsAgent
            });
            if (!upstreamResult.ok) {
                res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: `Upstream request failed: ${upstreamResult.error}` }));
                return;
            }

            const upstreamJson = parseJsonOrError(upstreamResult.bodyText);
            if (upstreamResult.status >= 400) {
                res.writeHead(upstreamResult.status, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(upstreamResult.bodyText || JSON.stringify({ error: 'Upstream error' }));
                return;
            }
            if (upstreamJson.error) {
                res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: `Upstream JSON parse failed: ${upstreamJson.error}` }));
                return;
            }

            const model = typeof converted.chat.model === 'string' ? converted.chat.model : '';
            const extracted = extractChatCompletionResult(upstreamJson.value);
            const text = extracted && typeof extracted.text === 'string' ? extracted.text : '';
            const toolCalls = extracted && Array.isArray(extracted.toolCalls) ? extracted.toolCalls : [];
            const responsesPayload = buildResponsesPayloadFromChatResult(model, text, toolCalls, upstreamJson.value);

            if (converted.streamRequested) {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no'
                });
                // Use SSE "event:" field for better compatibility with OpenAI Responses streaming clients.
                writeSse(res, 'response.created', { type: 'response.created', response: { id: responsesPayload.id, model } });
                if (text) {
                    writeSse(res, 'response.output_text.delta', { type: 'response.output_text.delta', delta: text });
                    writeSse(res, 'response.output_text.done', { type: 'response.output_text.done', text });
                }
                writeSse(res, 'response.completed', { type: 'response.completed', response: responsesPayload });
                writeSse(res, 'done', '[DONE]');
                res.end();
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(responsesPayload));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: e && e.message ? e.message : 'Internal Error' }));
            }
        })();

        return true;
    };

    handler.matchPath = matchPath;
    return handler;
}

module.exports = {
    readOpenaiBridgeSettings,
    upsertOpenaiBridgeProvider,
    resolveOpenaiBridgeUpstream,
    createOpenaiBridgeHttpHandler
};
