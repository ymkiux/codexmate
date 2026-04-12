const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { readJsonFile, writeJsonAtomic } = require('../lib/cli-file-utils');
const { isValidHttpUrl, normalizeBaseUrl, joinApiUrl } = require('../lib/cli-utils');
const {
    extractModelNames,
    extractModelResponseText,
    normalizeWireApi
} = require('../lib/cli-models-utils');
const { toIsoTime } = require('../lib/cli-session-utils');

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNonNegativeInteger(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value.trim(), 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    }
    return 0;
}

function formatHostForUrl(host) {
    const value = typeof host === 'string' ? host.trim() : '';
    if (!value) return '';
    if (value.startsWith('[') && value.endsWith(']')) {
        return value;
    }
    if (value.includes(':')) {
        return `[${value}]`;
    }
    return value;
}

function normalizeAnthropicContentBlocks(content) {
    if (typeof content === 'string') {
        return content.trim() ? [{ type: 'text', text: content }] : [];
    }
    if (Array.isArray(content)) {
        return content.flatMap((item) => normalizeAnthropicContentBlocks(item));
    }
    if (content && typeof content === 'object') {
        if (typeof content.type === 'string') {
            return [content];
        }
        if (typeof content.text === 'string') {
            return [{ type: 'text', text: content.text }];
        }
    }
    return [];
}

function collectAnthropicTextContent(content) {
    const pieces = [];
    for (const block of normalizeAnthropicContentBlocks(content)) {
        if (block && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            pieces.push(block.text.trim());
        }
    }
    return pieces.join('\n\n').trim();
}

function safeJsonStringify(value) {
    try {
        return JSON.stringify(value);
    } catch (e) {
        return JSON.stringify(String(value));
    }
}

function stringifyAnthropicToolResultContent(content) {
    if (typeof content === 'string') {
        return content;
    }
    const text = collectAnthropicTextContent(content);
    if (text) {
        return text;
    }
    return safeJsonStringify(content);
}

function appendAnthropicMessageToResponsesInput(target, message) {
    if (!message || typeof message !== 'object') return;
    const roleRaw = typeof message.role === 'string' ? message.role.trim().toLowerCase() : '';
    const role = roleRaw === 'assistant' ? 'assistant' : 'user';
    const textType = role === 'assistant' ? 'output_text' : 'input_text';
    let buffered = [];

    const flushBuffered = () => {
        if (!buffered.length) return;
        target.push({ role, content: buffered });
        buffered = [];
    };

    for (const block of normalizeAnthropicContentBlocks(message.content)) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'text' && typeof block.text === 'string' && block.text) {
            buffered.push({ type: textType, text: block.text });
            continue;
        }
        if (block.type === 'tool_use' && typeof block.name === 'string' && block.name.trim()) {
            flushBuffered();
            target.push({
                type: 'function_call',
                call_id: typeof block.id === 'string' && block.id.trim()
                    ? block.id.trim()
                    : `call_${crypto.randomBytes(8).toString('hex')}`,
                name: block.name.trim(),
                arguments: safeJsonStringify(block.input && typeof block.input === 'object' ? block.input : {})
            });
            continue;
        }
        if (block.type === 'tool_result' && typeof block.tool_use_id === 'string' && block.tool_use_id.trim()) {
            flushBuffered();
            target.push({
                type: 'function_call_output',
                call_id: block.tool_use_id.trim(),
                output: stringifyAnthropicToolResultContent(block.content)
            });
            continue;
        }
        buffered.push({
            type: textType,
            text: `[unsupported anthropic block: ${typeof block.type === 'string' ? block.type : 'unknown'}]`
        });
    }

    flushBuffered();
}

function mapAnthropicToolChoiceToResponses(toolChoice) {
    if (!toolChoice) return undefined;
    if (typeof toolChoice === 'string') {
        if (toolChoice === 'auto') return 'auto';
        if (toolChoice === 'any') return 'required';
        return undefined;
    }
    if (!toolChoice || typeof toolChoice !== 'object') return undefined;
    const type = typeof toolChoice.type === 'string' ? toolChoice.type.trim().toLowerCase() : '';
    if (type === 'auto') return 'auto';
    if (type === 'any') return 'required';
    if (type === 'tool' && typeof toolChoice.name === 'string' && toolChoice.name.trim()) {
        return {
            type: 'function',
            name: toolChoice.name.trim()
        };
    }
    return undefined;
}

function buildBuiltinClaudeResponsesRequest(payload = {}) {
    const model = typeof payload.model === 'string' ? payload.model.trim() : '';
    if (!model) {
        throw new Error('Anthropic messages 请求缺少 model');
    }
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    if (!messages.length) {
        throw new Error('Anthropic messages 请求缺少 messages');
    }

    const maxTokens = parseInt(String(payload.max_tokens), 10);
    const requestBody = {
        model,
        input: [],
        max_output_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 1024
    };

    const instructions = collectAnthropicTextContent(payload.system);
    if (instructions) {
        requestBody.instructions = instructions;
    }

    for (const message of messages) {
        appendAnthropicMessageToResponsesInput(requestBody.input, message);
    }

    if (Number.isFinite(payload.temperature)) {
        requestBody.temperature = Number(payload.temperature);
    }
    if (Number.isFinite(payload.top_p)) {
        requestBody.top_p = Number(payload.top_p);
    }
    if (Array.isArray(payload.stop_sequences) && payload.stop_sequences.length) {
        requestBody.stop = payload.stop_sequences.filter((item) => typeof item === 'string' && item.trim());
    }
    if (isPlainObject(payload.metadata)) {
        requestBody.metadata = payload.metadata;
    }
    if (Array.isArray(payload.tools) && payload.tools.length) {
        requestBody.tools = payload.tools
            .map((tool) => {
                if (!tool || typeof tool !== 'object') return null;
                const name = typeof tool.name === 'string' ? tool.name.trim() : '';
                if (!name) return null;
                return {
                    type: 'function',
                    name,
                    description: typeof tool.description === 'string' ? tool.description : '',
                    parameters: isPlainObject(tool.input_schema) ? tool.input_schema : { type: 'object', properties: {} }
                };
            })
            .filter(Boolean);
        if (!requestBody.tools.length) {
            delete requestBody.tools;
        }
    }

    const toolChoice = mapAnthropicToolChoiceToResponses(payload.tool_choice);
    if (toolChoice !== undefined) {
        requestBody.tool_choice = toolChoice;
    }

    return requestBody;
}

function parseJsonObjectLoose(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }
    if (typeof value !== 'string' || !value.trim()) {
        return {};
    }
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
        return {};
    }
}

function readResponsesUsageValue(value) {
    const parsed = readNonNegativeInteger(value);
    return parsed > 0 ? parsed : 0;
}

function buildAnthropicUsageFromResponses(payload) {
    const usage = payload && payload.usage && typeof payload.usage === 'object' ? payload.usage : {};
    return {
        input_tokens: readResponsesUsageValue(usage.input_tokens),
        output_tokens: readResponsesUsageValue(usage.output_tokens)
    };
}

function collectAnthropicContentFromResponsesOutput(payload) {
    const content = [];
    const output = Array.isArray(payload && payload.output) ? payload.output : [];
    for (const item of output) {
        if (!item || typeof item !== 'object') continue;
        if (item.type === 'function_call') {
            content.push({
                type: 'tool_use',
                id: typeof item.call_id === 'string' && item.call_id.trim()
                    ? item.call_id.trim()
                    : (typeof item.id === 'string' && item.id.trim()
                        ? item.id.trim()
                        : `toolu_${crypto.randomBytes(8).toString('hex')}`),
                name: typeof item.name === 'string' ? item.name : '',
                input: parseJsonObjectLoose(item.arguments)
            });
            continue;
        }
        if (item.type === 'message' && Array.isArray(item.content)) {
            for (const block of item.content) {
                if (!block || typeof block !== 'object') continue;
                if ((block.type === 'output_text' || block.type === 'text' || block.type === 'input_text')
                    && typeof block.text === 'string' && block.text) {
                    content.push({ type: 'text', text: block.text });
                }
            }
        }
    }
    if (!content.length) {
        const fallbackText = extractModelResponseText(payload);
        if (fallbackText) {
            content.push({ type: 'text', text: fallbackText });
        }
    }
    return content;
}

function buildAnthropicStopReasonFromResponses(payload, content) {
    if (Array.isArray(content) && content.some((item) => item && item.type === 'tool_use')) {
        return 'tool_use';
    }
    const incompleteReason = payload && payload.incomplete_details && typeof payload.incomplete_details.reason === 'string'
        ? payload.incomplete_details.reason
        : '';
    if (incompleteReason === 'max_output_tokens') {
        return 'max_tokens';
    }
    return 'end_turn';
}

function buildAnthropicMessageFromResponses(payload, requestPayload = {}) {
    const content = collectAnthropicContentFromResponsesOutput(payload);
    const usage = buildAnthropicUsageFromResponses(payload);
    return {
        id: typeof payload.id === 'string' && payload.id.trim()
            ? payload.id.trim()
            : `msg_${crypto.randomBytes(8).toString('hex')}`,
        type: 'message',
        role: 'assistant',
        model: typeof payload.model === 'string' && payload.model.trim()
            ? payload.model.trim()
            : (typeof requestPayload.model === 'string' ? requestPayload.model : ''),
        content,
        stop_reason: buildAnthropicStopReasonFromResponses(payload, content),
        stop_sequence: null,
        usage
    };
}

function buildAnthropicStreamEvents(message) {
    const usage = message && message.usage && typeof message.usage === 'object' ? message.usage : {};
    const startUsage = {
        input_tokens: readResponsesUsageValue(usage.input_tokens),
        output_tokens: 0
    };
    const events = [{
        event: 'message_start',
        data: {
            type: 'message_start',
            message: {
                ...message,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: startUsage
            }
        }
    }];

    const blocks = Array.isArray(message && message.content) ? message.content : [];
    blocks.forEach((block, index) => {
        if (!block || typeof block !== 'object') return;
        if (block.type === 'text') {
            events.push({
                event: 'content_block_start',
                data: {
                    type: 'content_block_start',
                    index,
                    content_block: { type: 'text', text: '' }
                }
            });
            if (typeof block.text === 'string' && block.text) {
                events.push({
                    event: 'content_block_delta',
                    data: {
                        type: 'content_block_delta',
                        index,
                        delta: { type: 'text_delta', text: block.text }
                    }
                });
            }
            events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index } });
            return;
        }
        if (block.type === 'tool_use') {
            events.push({
                event: 'content_block_start',
                data: {
                    type: 'content_block_start',
                    index,
                    content_block: {
                        type: 'tool_use',
                        id: block.id,
                        name: block.name,
                        input: {}
                    }
                }
            });
            const partialJson = safeJsonStringify(block.input && typeof block.input === 'object' ? block.input : {});
            if (partialJson && partialJson !== '{}') {
                events.push({
                    event: 'content_block_delta',
                    data: {
                        type: 'content_block_delta',
                        index,
                        delta: { type: 'input_json_delta', partial_json: partialJson }
                    }
                });
            }
            events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index } });
        }
    });

    events.push({
        event: 'message_delta',
        data: {
            type: 'message_delta',
            delta: {
                stop_reason: message && message.stop_reason ? message.stop_reason : 'end_turn',
                stop_sequence: message && Object.prototype.hasOwnProperty.call(message, 'stop_sequence')
                    ? message.stop_sequence
                    : null
            },
            usage: {
                output_tokens: readResponsesUsageValue(usage.output_tokens)
            }
        }
    });
    events.push({ event: 'message_stop', data: { type: 'message_stop' } });
    return events;
}

function buildAnthropicModelsPayload(upstreamPayload) {
    const ids = extractModelNames(upstreamPayload);
    return {
        data: ids.map((id) => ({
            type: 'model',
            id,
            display_name: id,
            created_at: '1970-01-01T00:00:00Z'
        })),
        first_id: ids[0] || null,
        last_id: ids.length ? ids[ids.length - 1] : null,
        has_more: false
    };
}

function createBuiltinClaudeProxyRuntimeController(deps = {}) {
    const {
        BUILTIN_CLAUDE_PROXY_SETTINGS_FILE,
        DEFAULT_BUILTIN_CLAUDE_PROXY_SETTINGS,
        BUILTIN_PROXY_PROVIDER_NAME,
        MAX_API_BODY_SIZE,
        HTTP_KEEP_ALIVE_AGENT,
        HTTPS_KEEP_ALIVE_AGENT,
        readConfigOrVirtualDefault,
        resolveBuiltinProxyProviderName,
        resolveAuthTokenFromCurrentProfile
    } = deps;

    if (!BUILTIN_CLAUDE_PROXY_SETTINGS_FILE) {
        throw new Error('createBuiltinClaudeProxyRuntimeController 缺少 BUILTIN_CLAUDE_PROXY_SETTINGS_FILE');
    }
    if (!DEFAULT_BUILTIN_CLAUDE_PROXY_SETTINGS || typeof DEFAULT_BUILTIN_CLAUDE_PROXY_SETTINGS !== 'object') {
        throw new Error('createBuiltinClaudeProxyRuntimeController 缺少 DEFAULT_BUILTIN_CLAUDE_PROXY_SETTINGS');
    }
    if (typeof readConfigOrVirtualDefault !== 'function') {
        throw new Error('createBuiltinClaudeProxyRuntimeController 缺少 readConfigOrVirtualDefault');
    }
    if (typeof resolveBuiltinProxyProviderName !== 'function') {
        throw new Error('createBuiltinClaudeProxyRuntimeController 缺少 resolveBuiltinProxyProviderName');
    }
    if (typeof resolveAuthTokenFromCurrentProfile !== 'function') {
        throw new Error('createBuiltinClaudeProxyRuntimeController 缺少 resolveAuthTokenFromCurrentProfile');
    }

    let runtime = null;

    function normalizeBuiltinClaudeProxySettings(raw) {
        const merged = {
            ...DEFAULT_BUILTIN_CLAUDE_PROXY_SETTINGS,
            ...(isPlainObject(raw) ? raw : {})
        };
        const host = typeof merged.host === 'string' ? merged.host.trim() : '';
        const port = parseInt(String(merged.port), 10);
        const provider = typeof merged.provider === 'string' ? merged.provider.trim() : '';
        const authSourceRaw = typeof merged.authSource === 'string' ? merged.authSource.trim().toLowerCase() : '';
        const timeoutMs = parseInt(String(merged.timeoutMs), 10);
        const authSource = authSourceRaw === 'profile' || authSourceRaw === 'none' || authSourceRaw === 'request'
            ? authSourceRaw
            : 'provider';

        return {
            enabled: merged.enabled !== false,
            host: host || DEFAULT_BUILTIN_CLAUDE_PROXY_SETTINGS.host,
            port: Number.isFinite(port) && port > 0 && port <= 65535 ? port : DEFAULT_BUILTIN_CLAUDE_PROXY_SETTINGS.port,
            provider,
            authSource,
            timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000
                ? timeoutMs
                : DEFAULT_BUILTIN_CLAUDE_PROXY_SETTINGS.timeoutMs
        };
    }

    function readBuiltinClaudeProxySettings() {
        const parsed = readJsonFile(BUILTIN_CLAUDE_PROXY_SETTINGS_FILE, null);
        return normalizeBuiltinClaudeProxySettings(parsed);
    }

    function saveBuiltinClaudeProxySettings(payload = {}, options = {}) {
        const current = readBuiltinClaudeProxySettings();
        const merged = normalizeBuiltinClaudeProxySettings({
            ...current,
            ...(isPlainObject(payload) ? payload : {})
        });

        if (!merged.host) {
            return { error: 'Claude 兼容代理 host 不能为空' };
        }
        if (!Number.isFinite(merged.port) || merged.port <= 0 || merged.port > 65535) {
            return { error: 'Claude 兼容代理端口无效（1-65535）' };
        }

        const { config } = readConfigOrVirtualDefault();
        const providers = config && isPlainObject(config.model_providers) ? config.model_providers : {};
        const preferredProvider = typeof config.model_provider === 'string' ? config.model_provider.trim() : '';
        const finalProvider = resolveBuiltinProxyProviderName(merged.provider, providers, preferredProvider);
        const normalized = {
            ...merged,
            provider: finalProvider
        };

        if (!options.skipWrite) {
            writeJsonAtomic(BUILTIN_CLAUDE_PROXY_SETTINGS_FILE, normalized);
        }

        return {
            success: true,
            settings: normalized
        };
    }

    function buildBuiltinClaudeProxyListenUrl(settings) {
        const host = formatHostForUrl(settings.host || DEFAULT_BUILTIN_CLAUDE_PROXY_SETTINGS.host);
        return `http://${host}:${settings.port}`;
    }

    function resolveBuiltinClaudeProxyUpstream(settings) {
        const { config } = readConfigOrVirtualDefault();
        const providers = config && isPlainObject(config.model_providers) ? config.model_providers : {};
        const currentProvider = typeof config.model_provider === 'string' ? config.model_provider.trim() : '';
        const providerName = resolveBuiltinProxyProviderName(settings.provider, providers, currentProvider);
        if (!providerName) {
            return { error: '未找到可用的上游 provider，请先添加 responses provider' };
        }
        if (providerName === BUILTIN_PROXY_PROVIDER_NAME) {
            return { error: `Claude 兼容代理的上游 provider 不能是 ${BUILTIN_PROXY_PROVIDER_NAME}` };
        }
        const provider = providers[providerName];
        if (!provider || !isPlainObject(provider)) {
            return { error: `上游 provider 不存在: ${providerName}` };
        }

        const wireApi = normalizeWireApi(provider.wire_api);
        if (wireApi !== 'responses') {
            return { error: `Claude 兼容代理仅支持上游 responses provider: ${providerName}` };
        }

        const baseUrl = typeof provider.base_url === 'string' ? provider.base_url.trim() : '';
        if (!baseUrl || !isValidHttpUrl(baseUrl)) {
            return { error: `上游 provider base_url 无效: ${providerName}` };
        }

        let token = '';
        if (settings.authSource === 'profile') {
            token = resolveAuthTokenFromCurrentProfile();
        } else if (settings.authSource === 'provider') {
            token = typeof provider.preferred_auth_method === 'string' ? provider.preferred_auth_method.trim() : '';
            if (!token) {
                token = resolveAuthTokenFromCurrentProfile();
            }
        }

        let authHeader = '';
        if (token) {
            authHeader = /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
        }

        return {
            providerName,
            baseUrl: normalizeBaseUrl(baseUrl),
            authHeader
        };
    }

    function buildBuiltinClaudeProxyRequestAuthHeader(req, settings, upstream) {
        if (settings && settings.authSource === 'request') {
            const apiKey = typeof req.headers['x-api-key'] === 'string'
                ? req.headers['x-api-key'].trim()
                : '';
            if (!apiKey) {
                return { error: '缺少 x-api-key，无法转发到上游 responses provider', statusCode: 401 };
            }
            return {
                authHeader: /^bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`
            };
        }
        return { authHeader: upstream.authHeader || '' };
    }

    function readJsonRequestBody(req, options = {}) {
        const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
            ? Math.floor(options.maxBytes)
            : MAX_API_BODY_SIZE;
        return new Promise((resolve, reject) => {
            const chunks = [];
            let total = 0;
            req.on('data', (chunk) => {
                total += chunk.length;
                if (total > maxBytes) {
                    reject(new Error(`request body too large (${maxBytes} bytes max)`));
                    try { req.destroy(); } catch (_) {}
                    return;
                }
                chunks.push(chunk);
            });
            req.on('error', reject);
            req.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8').trim();
                if (!raw) {
                    resolve({});
                    return;
                }
                try {
                    resolve(JSON.parse(raw));
                } catch (e) {
                    reject(new Error(`invalid JSON body: ${e.message}`));
                }
            });
        });
    }

    function extractProxyErrorMessage(payload, fallback = '') {
        if (!payload || typeof payload !== 'object') {
            return fallback || 'upstream request failed';
        }
        if (payload.error && typeof payload.error === 'object') {
            if (typeof payload.error.message === 'string' && payload.error.message.trim()) {
                return payload.error.message.trim();
            }
            if (typeof payload.error.error === 'string' && payload.error.error.trim()) {
                return payload.error.error.trim();
            }
        }
        if (typeof payload.message === 'string' && payload.message.trim()) {
            return payload.message.trim();
        }
        if (typeof payload.error === 'string' && payload.error.trim()) {
            return payload.error.trim();
        }
        return fallback || 'upstream request failed';
    }

    function writeAnthropicProxyError(res, statusCode, message, type = 'api_error') {
        const body = JSON.stringify({
            type: 'error',
            error: {
                type,
                message: typeof message === 'string' && message.trim() ? message.trim() : 'request failed'
            }
        });
        res.writeHead(statusCode, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(body, 'utf-8')
        });
        res.end(body, 'utf-8');
    }

    function requestBuiltinClaudeProxyUpstream(upstream, requestOptions = {}) {
        const pathSuffix = typeof requestOptions.pathSuffix === 'string' ? requestOptions.pathSuffix : '';
        const targetBase = joinApiUrl(upstream.baseUrl, pathSuffix);
        if (!targetBase) {
            return Promise.reject(new Error('failed to build upstream URL'));
        }

        let targetUrl;
        try {
            targetUrl = new URL(targetBase);
        } catch (e) {
            return Promise.reject(new Error(`invalid upstream URL: ${e.message}`));
        }

        const bodyText = requestOptions.body === undefined ? '' : JSON.stringify(requestOptions.body);
        const headers = {
            Accept: 'application/json',
            ...(isPlainObject(requestOptions.headers) ? requestOptions.headers : {})
        };
        if (bodyText) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(bodyText);
        }
        if (requestOptions.authHeader) {
            headers.authorization = requestOptions.authHeader;
        }
        headers['x-codexmate-claude-proxy'] = '1';

        const transport = targetUrl.protocol === 'https:' ? https : http;
        const timeoutMs = Number.isFinite(requestOptions.timeoutMs) && requestOptions.timeoutMs > 0
            ? requestOptions.timeoutMs
            : DEFAULT_BUILTIN_CLAUDE_PROXY_SETTINGS.timeoutMs;

        return new Promise((resolve, reject) => {
            const upstreamReq = transport.request({
                protocol: targetUrl.protocol,
                hostname: targetUrl.hostname,
                port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
                method: requestOptions.method || 'POST',
                path: `${targetUrl.pathname}${targetUrl.search}`,
                headers,
                agent: targetUrl.protocol === 'https:' ? HTTPS_KEEP_ALIVE_AGENT : HTTP_KEEP_ALIVE_AGENT
            }, (upstreamRes) => {
                const chunks = [];
                let total = 0;
                upstreamRes.on('data', (chunk) => {
                    total += chunk.length;
                    if (total > MAX_API_BODY_SIZE) {
                        upstreamReq.destroy(new Error(`upstream body too large (${MAX_API_BODY_SIZE} bytes max)`));
                        return;
                    }
                    chunks.push(chunk);
                });
                upstreamRes.on('error', reject);
                upstreamRes.on('end', () => {
                    const rawBody = Buffer.concat(chunks).toString('utf-8');
                    let payload = null;
                    if (rawBody.trim()) {
                        try {
                            payload = JSON.parse(rawBody);
                        } catch (_) {
                            payload = null;
                        }
                    }
                    resolve({
                        statusCode: upstreamRes.statusCode || 502,
                        headers: upstreamRes.headers,
                        rawBody,
                        payload
                    });
                });
            });

            upstreamReq.setTimeout(timeoutMs, () => {
                upstreamReq.destroy(new Error(`upstream timeout (${timeoutMs}ms)`));
            });
            upstreamReq.on('error', reject);
            if (bodyText) {
                upstreamReq.write(bodyText, 'utf-8');
            }
            upstreamReq.end();
        });
    }

    function writeAnthropicStreamEvents(res, message) {
        const events = buildAnthropicStreamEvents(message);
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        for (const event of events) {
            if (event && event.event) {
                res.write(`event: ${event.event}\n`);
            }
            res.write(`data: ${JSON.stringify(event && event.data ? event.data : {})}\n\n`);
        }
        res.end();
    }

    async function handleBuiltinClaudeProxyRequest(req, res, settings, upstream) {
        let parsedIncoming;
        try {
            parsedIncoming = new URL(req.url || '/', 'http://localhost');
        } catch (e) {
            writeAnthropicProxyError(res, 400, 'invalid request path', 'invalid_request_error');
            return;
        }

        const incomingPath = parsedIncoming.pathname || '/';
        if (incomingPath === '/health' || incomingPath === '/status') {
            const body = JSON.stringify({
                ok: true,
                upstreamProvider: upstream.providerName,
                upstreamBaseUrl: upstream.baseUrl,
                mode: 'anthropic-to-responses'
            });
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(body, 'utf-8')
            });
            res.end(body, 'utf-8');
            return;
        }

        const authResult = buildBuiltinClaudeProxyRequestAuthHeader(req, settings, upstream);
        if (authResult.error) {
            writeAnthropicProxyError(res, authResult.statusCode || 401, authResult.error, 'authentication_error');
            return;
        }

        if (incomingPath === '/v1/models') {
            if ((req.method || 'GET').toUpperCase() !== 'GET') {
                res.writeHead(405, { Allow: 'GET' });
                res.end();
                return;
            }
            const upstreamResponse = await requestBuiltinClaudeProxyUpstream(upstream, {
                method: 'GET',
                pathSuffix: 'models',
                authHeader: authResult.authHeader,
                timeoutMs: settings.timeoutMs
            });
            if (upstreamResponse.statusCode < 200 || upstreamResponse.statusCode >= 300) {
                writeAnthropicProxyError(
                    res,
                    upstreamResponse.statusCode,
                    extractProxyErrorMessage(upstreamResponse.payload, upstreamResponse.rawBody),
                    'api_error'
                );
                return;
            }
            const body = JSON.stringify(buildAnthropicModelsPayload(upstreamResponse.payload));
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(body, 'utf-8')
            });
            res.end(body, 'utf-8');
            return;
        }

        if (incomingPath !== '/v1/messages') {
            writeAnthropicProxyError(res, 404, 'Claude 兼容代理仅支持 /v1/messages 与 /v1/models', 'not_found_error');
            return;
        }

        if ((req.method || 'POST').toUpperCase() !== 'POST') {
            res.writeHead(405, { Allow: 'POST' });
            res.end();
            return;
        }

        const payload = await readJsonRequestBody(req);
        const upstreamRequestBody = buildBuiltinClaudeResponsesRequest(payload);
        const upstreamResponse = await requestBuiltinClaudeProxyUpstream(upstream, {
            method: 'POST',
            pathSuffix: 'responses',
            body: upstreamRequestBody,
            authHeader: authResult.authHeader,
            timeoutMs: settings.timeoutMs
        });

        if (upstreamResponse.statusCode < 200 || upstreamResponse.statusCode >= 300) {
            writeAnthropicProxyError(
                res,
                upstreamResponse.statusCode,
                extractProxyErrorMessage(upstreamResponse.payload, upstreamResponse.rawBody),
                'api_error'
            );
            return;
        }

        const anthropicMessage = buildAnthropicMessageFromResponses(upstreamResponse.payload || {}, payload);
        if (payload.stream === true) {
            writeAnthropicStreamEvents(res, anthropicMessage);
            return;
        }

        const body = JSON.stringify(anthropicMessage);
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(body, 'utf-8')
        });
        res.end(body, 'utf-8');
    }

    function createBuiltinClaudeProxyServer(settings, upstream) {
        const connections = new Set();
        const server = http.createServer((req, res) => {
            handleBuiltinClaudeProxyRequest(req, res, settings, upstream).catch((err) => {
                if (res.headersSent) {
                    try { res.destroy(err); } catch (_) {}
                    return;
                }
                writeAnthropicProxyError(res, 502, `claude proxy request failed: ${err.message}`, 'api_error');
            });
        });

        server.on('connection', (socket) => {
            connections.add(socket);
            socket.on('close', () => connections.delete(socket));
        });

        return new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(settings.port, settings.host, () => {
                server.removeListener('error', reject);
                resolve({
                    server,
                    connections,
                    settings,
                    upstream,
                    startedAt: toIsoTime(Date.now()),
                    listenUrl: buildBuiltinClaudeProxyListenUrl(settings)
                });
            });
        });
    }

    async function startBuiltinClaudeProxyRuntime(payload = {}) {
        if (runtime) {
            return {
                error: 'Claude 兼容代理已在运行',
                runtime: {
                    listenUrl: runtime.listenUrl,
                    upstreamProvider: runtime.upstream.providerName
                }
            };
        }

        const saveResult = saveBuiltinClaudeProxySettings(payload);
        if (saveResult.error) {
            return { error: saveResult.error };
        }
        const settings = saveResult.settings;
        const upstream = resolveBuiltinClaudeProxyUpstream(settings);
        if (upstream.error) {
            return { error: upstream.error };
        }

        try {
            runtime = await createBuiltinClaudeProxyServer(settings, upstream);
            return {
                success: true,
                running: true,
                listenUrl: runtime.listenUrl,
                upstreamProvider: upstream.providerName,
                mode: 'anthropic-to-responses',
                settings
            };
        } catch (e) {
            return { error: `启动 Claude 兼容代理失败: ${e.message}` };
        }
    }

    async function stopBuiltinClaudeProxyRuntime() {
        if (!runtime) {
            return { success: true, running: false };
        }
        const currentRuntime = runtime;
        runtime = null;

        await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve();
            };

            currentRuntime.server.close(() => finish());
            setTimeout(() => finish(), 1000);
        });

        for (const socket of currentRuntime.connections) {
            try { socket.destroy(); } catch (_) {}
        }
        currentRuntime.connections.clear();

        return {
            success: true,
            running: false
        };
    }

    function getBuiltinClaudeProxyStatus() {
        const settings = readBuiltinClaudeProxySettings();
        return {
            running: !!runtime,
            settings,
            runtime: runtime
                ? {
                    startedAt: runtime.startedAt,
                    listenUrl: runtime.listenUrl,
                    upstreamProvider: runtime.upstream.providerName,
                    upstreamBaseUrl: runtime.upstream.baseUrl,
                    mode: 'anthropic-to-responses'
                }
                : null
        };
    }

    return {
        normalizeBuiltinClaudeProxySettings,
        readBuiltinClaudeProxySettings,
        saveBuiltinClaudeProxySettings,
        buildBuiltinClaudeProxyListenUrl,
        resolveBuiltinClaudeProxyUpstream,
        startBuiltinClaudeProxyRuntime,
        stopBuiltinClaudeProxyRuntime,
        getBuiltinClaudeProxyStatus
    };
}

module.exports = {
    createBuiltinClaudeProxyRuntimeController,
    buildBuiltinClaudeResponsesRequest,
    buildAnthropicMessageFromResponses,
    buildAnthropicStreamEvents,
    buildAnthropicModelsPayload
};
