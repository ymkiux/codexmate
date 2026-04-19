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
    // 支持：
    // - string
    // - { role, content }（单条 message）
    // - { type:"input_text"|"input_image", ... }（单个 block）
    // - [{ role, content: [...] }]（messages array）
    // - [{ type:"input_text"|"input_image", ... }]（blocks array -> 单条 user 消息）
    if (typeof input === 'string') {
        return [{ role: 'user', content: input }];
    }

    const toChatContent = (blocks) => {
        if (!Array.isArray(blocks)) return '';
        const out = [];
        for (const block of blocks) {
            if (!block || typeof block !== 'object') continue;
            const type = typeof block.type === 'string' ? block.type : '';
            if ((type === 'input_text' || type === 'output_text') && typeof block.text === 'string') {
                out.push({ type: 'text', text: block.text });
                continue;
            }
            if (type === 'input_image') {
                const raw = block.image_url != null ? block.image_url : block.imageUrl;
                const url = typeof raw === 'string'
                    ? raw
                    : (raw && typeof raw === 'object' && typeof raw.url === 'string' ? raw.url : '');
                if (url) {
                    out.push({ type: 'image_url', image_url: { url } });
                }
                continue;
            }
            // 容错：兼容已是 chat content 的 {type:"text"} / {type:"image_url"}
            if (type === 'text' && typeof block.text === 'string') {
                out.push({ type: 'text', text: block.text });
                continue;
            }
            if (type === 'image_url' && block.image_url) {
                out.push({ type: 'image_url', image_url: block.image_url });
            }
        }
        if (out.length === 0) return '';
        return out;
    };

    const toRole = (value) => {
        const roleRaw = typeof value === 'string' ? value.trim().toLowerCase() : '';
        return roleRaw === 'assistant' ? 'assistant' : (roleRaw === 'system' ? 'system' : 'user');
    };

    if (input && typeof input === 'object' && !Array.isArray(input)) {
        if (typeof input.role === 'string' && input.content != null) {
            const role = toRole(input.role);
            const content = Array.isArray(input.content)
                ? toChatContent(input.content)
                : input.content;
            return content ? [{ role, content }] : [];
        }
        if (typeof input.type === 'string') {
            const content = toChatContent([input]);
            return content ? [{ role: 'user', content }] : [];
        }
        return [];
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
                        function: { name, arguments: args || '' }
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
                messages.push({ role: 'tool', tool_call_id: toolCallId, content: String(content || '') });
            }
            continue;
        }

        // message form
        if (typeof item.role === 'string' && item.content != null) {
            const role = toRole(item.role);
            const content = Array.isArray(item.content)
                ? toChatContent(item.content)
                : item.content;
            if (content) {
                messages.push({ role, content });
            }
            continue;
        }
    }

    if (messages.length > 0) {
        return messages;
    }

    // 退化：把 input array 当作单条 user content blocks
    const fallbackContent = toChatContent(input);
    if (fallbackContent) {
        return [{ role: 'user', content: fallbackContent }];
    }
    return [];
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
    const createdAt = Math.floor(Date.now() / 1000);
    const output = [];
    const trimmedText = typeof text === 'string' ? text : '';
    if (trimmedText) {
        output.push({
            id: `msg_${crypto.randomBytes(8).toString('hex')}`,
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: trimmedText }]
        });
    }

    // Convert chat.completions tool_calls into Responses-style function_call output items.
    // This is important for Codex, which appends function_call + function_call_output back into `input`.
    if (Array.isArray(toolCalls)) {
        for (const call of toolCalls) {
            if (!call || typeof call !== 'object') continue;
            const callId = typeof call.id === 'string' && call.id.trim() ? call.id.trim() : `call_${crypto.randomBytes(8).toString('hex')}`;
            const fn = call.function && typeof call.function === 'object' ? call.function : {};
            const name = typeof fn.name === 'string' ? fn.name : '';
            const args = typeof fn.arguments === 'string' ? fn.arguments : '';
            if (!name) continue;
            output.push({
                type: 'function_call',
                call_id: callId,
                name,
                arguments: args
            });
        }
    }

    const payload = {
        id: responseId,
        object: 'response',
        model,
        created_at: createdAt,
        status: 'completed',
        output,
        output_text: trimmedText
    };

    if (usage) {
        // Map chat.completions usage -> responses usage shape when possible.
        const promptTokens = Number.isFinite(usage.prompt_tokens) ? Number(usage.prompt_tokens) : null;
        const completionTokens = Number.isFinite(usage.completion_tokens) ? Number(usage.completion_tokens) : null;
        const totalTokens = Number.isFinite(usage.total_tokens) ? Number(usage.total_tokens) : null;
        if (promptTokens !== null || completionTokens !== null || totalTokens !== null) {
            payload.usage = {
                input_tokens: promptTokens ?? undefined,
                output_tokens: completionTokens ?? undefined,
                total_tokens: totalTokens ?? undefined
            };
            Object.keys(payload.usage).forEach((key) => payload.usage[key] === undefined && delete payload.usage[key]);
        } else {
            payload.usage = usage;
        }
    }

    return payload;
}

function ensureResponseMetadata(response) {
    const payload = response && typeof response === 'object' ? response : {};
    if (typeof payload.created_at !== 'number') {
        payload.created_at = Math.floor(Date.now() / 1000);
    }
    if (typeof payload.status !== 'string' || !payload.status.trim()) {
        payload.status = 'completed';
    }
    if (!Array.isArray(payload.output)) {
        payload.output = [];
    }
    return payload;
}

function sendResponsesSse(res, responsePayload) {
    const response = ensureResponseMetadata(responsePayload);
    const responseId = typeof response.id === 'string' && response.id.trim()
        ? response.id.trim()
        : `resp_${crypto.randomBytes(10).toString('hex')}`;
    const model = typeof response.model === 'string' ? response.model : '';

    let sequence = 0;
    const nextSeq = () => {
        sequence += 1;
        return sequence;
    };

    writeSse(res, 'response.created', {
        type: 'response.created',
        response: {
            id: responseId,
            model,
            created_at: response.created_at
        }
    });

    const output = Array.isArray(response.output) ? response.output : [];
    for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
        const item = output[outputIndex];
        if (!item || typeof item !== 'object') continue;
        const itemType = typeof item.type === 'string' ? item.type : '';
        const itemId = typeof item.id === 'string' && item.id.trim()
            ? item.id.trim()
            : (typeof item.call_id === 'string' && item.call_id.trim() ? item.call_id.trim() : `item_${crypto.randomBytes(8).toString('hex')}`);

        // Emit item added so Codex can anchor subsequent deltas by output_index/content_index/item_id.
        writeSse(res, 'response.output_item.added', {
            type: 'response.output_item.added',
            output_index: outputIndex,
            item: { ...item, id: itemId }
        });

        if (itemType === 'message') {
            const content = Array.isArray(item.content) ? item.content : [];
            for (let contentIndex = 0; contentIndex < content.length; contentIndex += 1) {
                const block = content[contentIndex];
                if (!block || typeof block !== 'object') continue;
                if (block.type !== 'output_text') continue;
                const text = typeof block.text === 'string' ? block.text : '';
                if (text) {
                    writeSse(res, 'response.output_text.delta', {
                        type: 'response.output_text.delta',
                        item_id: itemId,
                        output_index: outputIndex,
                        content_index: contentIndex,
                        delta: text,
                        sequence_number: nextSeq()
                    });
                }
                writeSse(res, 'response.output_text.done', {
                    type: 'response.output_text.done',
                    item_id: itemId,
                    output_index: outputIndex,
                    content_index: contentIndex,
                    text,
                    sequence_number: nextSeq()
                });
            }
        }

        // Emit item done for all item types (message/function_call/etc).
        writeSse(res, 'response.output_item.done', {
            type: 'response.output_item.done',
            output_index: outputIndex,
            item: { ...item, id: itemId },
            sequence_number: nextSeq()
        });
    }

    writeSse(res, 'response.completed', { type: 'response.completed', response });
    writeSse(res, 'done', '[DONE]');
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

function shouldFallbackFromUpstreamResponses(status, bodyText) {
    if (!Number.isFinite(status)) return false;
    // Common "unsupported" status codes for a route.
    if (status === 404 || status === 405 || status === 501) return true;

    // Some OpenAI-compatible gateways respond with 500 + "not implemented" (e.g. convert_request_failed)
    // instead of 404/405 for unsupported endpoints. In that case we can safely fallback to chat/completions.
    const text = String(bodyText || '');
    if (!text) return false;
    if (/not implemented/i.test(text)) return true;
    if (/convert_request_failed/i.test(text)) return true;
    if (/unknown (endpoint|route)/i.test(text)) return true;
    if (/unsupported.*\/?v1\/responses/i.test(text)) return true;
    if (/does not support.*responses/i.test(text)) return true;

    // Best-effort parse for structured error codes.
    try {
        const parsed = JSON.parse(text);
        const code = parsed && parsed.error && typeof parsed.error.code === 'string' ? parsed.error.code : '';
        const msg = parsed && parsed.error && typeof parsed.error.message === 'string' ? parsed.error.message : '';
        if (code === 'convert_request_failed') return true;
        if (/not implemented/i.test(msg)) return true;
        if (/unknown (endpoint|route)/i.test(msg)) return true;
        if (/unsupported.*\/?v1\/responses/i.test(msg)) return true;
        if (/does not support.*responses/i.test(msg)) return true;
    } catch (_) {}

    return false;
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
            const isLoopback = isLoopbackAddress(remoteAddr);
            if (!token && !isLoopback) {
                res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
            // loopback 上的本地代理：允许客户端携带任意 Authorization（例如 Codex 会附带 provider apiKey）。
            // 非 loopback 时仍强制校验 expectedToken，避免局域网被未授权调用。
            if (!isLoopback && token && token !== expectedToken) {
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
                if (streamRequested) {
                    res.writeHead(200, {
                        'Content-Type': 'text/event-stream; charset=utf-8',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                        'X-Accel-Buffering': 'no'
                    });
                    sendResponsesSse(res, upstreamPayload);
                    res.end();
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(ensureResponseMetadata(upstreamPayload)));
                return;
            }

            if (upstreamResponsesResult.ok && upstreamResponsesResult.status >= 400) {
                if (!shouldFallbackFromUpstreamResponses(upstreamResponsesResult.status, upstreamResponsesResult.bodyText)) {
                    res.writeHead(upstreamResponsesResult.status, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(upstreamResponsesResult.bodyText || JSON.stringify({ error: 'Upstream error' }));
                    return;
                }
                // fallthrough to chat/completions conversion
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
                sendResponsesSse(res, responsesPayload);
                res.end();
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(ensureResponseMetadata(responsesPayload)));
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
