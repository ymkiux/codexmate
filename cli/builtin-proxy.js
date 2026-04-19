const http = require('http');
const net = require('net');
const crypto = require('crypto');
const toml = require('@iarna/toml');
const { readJsonFile, writeJsonAtomic } = require('../lib/cli-file-utils');
const { isValidHttpUrl, normalizeBaseUrl, joinApiUrl } = require('../lib/cli-utils');
const { toIsoTime } = require('../lib/cli-session-utils');

function createBuiltinProxyRuntimeController(deps = {}) {
    const {
        fs,
        https,
        CONFIG_FILE,
        BUILTIN_PROXY_SETTINGS_FILE,
        DEFAULT_BUILTIN_PROXY_SETTINGS,
        BUILTIN_PROXY_PROVIDER_NAME,
        CODEXMATE_MANAGED_MARKER,
        HTTP_KEEP_ALIVE_AGENT,
        HTTPS_KEEP_ALIVE_AGENT,
        readConfig,
        writeConfig,
        readConfigOrVirtualDefault,
        resolveAuthTokenFromCurrentProfile,
        isPlainObject,
        isBuiltinManagedProvider,
        findProviderSectionRanges,
        findProviderDescendantSectionRanges,
        normalizeLegacySegments,
        buildLegacySegmentsKey,
        formatHostForUrl
    } = deps;

    if (!fs) throw new Error('createBuiltinProxyRuntimeController 缺少 fs');
    if (!https) throw new Error('createBuiltinProxyRuntimeController 缺少 https');
    if (!CONFIG_FILE) throw new Error('createBuiltinProxyRuntimeController 缺少 CONFIG_FILE');
    if (!BUILTIN_PROXY_SETTINGS_FILE) throw new Error('createBuiltinProxyRuntimeController 缺少 BUILTIN_PROXY_SETTINGS_FILE');
    if (!DEFAULT_BUILTIN_PROXY_SETTINGS || typeof DEFAULT_BUILTIN_PROXY_SETTINGS !== 'object') {
        throw new Error('createBuiltinProxyRuntimeController 缺少 DEFAULT_BUILTIN_PROXY_SETTINGS');
    }
    if (!BUILTIN_PROXY_PROVIDER_NAME) throw new Error('createBuiltinProxyRuntimeController 缺少 BUILTIN_PROXY_PROVIDER_NAME');
    if (typeof readConfig !== 'function') throw new Error('createBuiltinProxyRuntimeController 缺少 readConfig');
    if (typeof writeConfig !== 'function') throw new Error('createBuiltinProxyRuntimeController 缺少 writeConfig');
    if (typeof readConfigOrVirtualDefault !== 'function') {
        throw new Error('createBuiltinProxyRuntimeController 缺少 readConfigOrVirtualDefault');
    }
    if (typeof resolveAuthTokenFromCurrentProfile !== 'function') {
        throw new Error('createBuiltinProxyRuntimeController 缺少 resolveAuthTokenFromCurrentProfile');
    }
    if (typeof isPlainObject !== 'function') throw new Error('createBuiltinProxyRuntimeController 缺少 isPlainObject');
    if (typeof isBuiltinManagedProvider !== 'function') {
        throw new Error('createBuiltinProxyRuntimeController 缺少 isBuiltinManagedProvider');
    }
    if (typeof findProviderSectionRanges !== 'function') {
        throw new Error('createBuiltinProxyRuntimeController 缺少 findProviderSectionRanges');
    }
    if (typeof findProviderDescendantSectionRanges !== 'function') {
        throw new Error('createBuiltinProxyRuntimeController 缺少 findProviderDescendantSectionRanges');
    }
    if (typeof normalizeLegacySegments !== 'function') {
        throw new Error('createBuiltinProxyRuntimeController 缺少 normalizeLegacySegments');
    }
    if (typeof buildLegacySegmentsKey !== 'function') {
        throw new Error('createBuiltinProxyRuntimeController 缺少 buildLegacySegmentsKey');
    }
    if (typeof formatHostForUrl !== 'function') throw new Error('createBuiltinProxyRuntimeController 缺少 formatHostForUrl');

    let runtime = null;

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

    function shouldFallbackFromUpstreamResponses(status, bodyText) {
        if (!Number.isFinite(status)) return false;
        if (status === 404 || status === 405 || status === 501) return true;
        const text = String(bodyText || '');
        if (!text) return false;
        if (/not implemented/i.test(text)) return true;
        if (/convert_request_failed/i.test(text)) return true;
        try {
            const parsed = JSON.parse(text);
            const code = parsed && parsed.error && typeof parsed.error.code === 'string' ? parsed.error.code : '';
            const msg = parsed && parsed.error && typeof parsed.error.message === 'string' ? parsed.error.message : '';
            if (code === 'convert_request_failed') return true;
            if (/not implemented/i.test(msg)) return true;
        } catch (_) {}
        return false;
    }

    function proxyRequestJson(targetUrl, options = {}) {
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
                agent: parsed.protocol === 'https:' ? HTTPS_KEEP_ALIVE_AGENT : HTTP_KEEP_ALIVE_AGENT
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

    function extractChatCompletionResult(payload) {
        if (!payload || typeof payload !== 'object') return { text: '' };
        const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
        const message = choice && typeof choice === 'object' ? choice.message : null;
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
        return { text };
    }

    function normalizeResponsesInputToChatMessages(input) {
        // 支持：
        // - string
        // - { role, content }（单条 message）
        // - { type:"input_text"|"input_image", ... }（单个 block）
        // - [{ role, content: [{type:"input_text"|"input_image", ...}] }]
        // - [{ type:"input_text"|"input_image", ... }]（视为单条 user 消息）
        if (typeof input === 'string') {
            return [{ role: 'user', content: input }];
        }
        if (input && typeof input === 'object' && !Array.isArray(input)) {
            if (typeof input.role === 'string' && input.content != null) {
                const role = input.role.trim() || 'user';
                const content = Array.isArray(input.content)
                    ? toChatContent(input.content)
                    : input.content;
                return content ? [{ role, content }] : [];
            }
            // 单个 block：{type:"input_text"|"input_image", ...}
            if (typeof input.type === 'string') {
                const content = toChatContent([input]);
                return content ? [{ role: 'user', content }] : [];
            }
            return [];
        }
        if (!Array.isArray(input)) {
            return [];
        }

        const toChatContent = (blocks) => {
            if (!Array.isArray(blocks)) return '';
            const out = [];
            for (const block of blocks) {
                if (!block || typeof block !== 'object') continue;
                const type = typeof block.type === 'string' ? block.type : '';
                if (type === 'input_text' && typeof block.text === 'string') {
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

        const messages = [];
        for (const item of input) {
            if (!item || typeof item !== 'object') continue;
            if (typeof item.role === 'string' && item.content != null) {
                const role = item.role.trim() || 'user';
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

    function ensureResponseMetadata(payload) {
        const base = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
        const id = typeof base.id === 'string' && base.id.trim()
            ? base.id.trim()
            : `resp_${crypto.randomBytes(10).toString('hex')}`;
        const model = typeof base.model === 'string' ? base.model : '';
        return {
            object: 'response',
            id,
            model,
            ...base
        };
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

    function sendResponsesSse(res, responsePayload) {
        const response = ensureResponseMetadata(responsePayload);
        const responseId = response.id;
        const model = response.model;
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
                : `item_${crypto.randomBytes(8).toString('hex')}`;

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

    function canListenPort(host, port) {
        return new Promise((resolve) => {
            const tester = net.createServer();
            tester.unref();
            tester.once('error', () => resolve(false));
            tester.once('listening', () => {
                tester.close(() => resolve(true));
            });
            tester.listen(port, host);
        });
    }

    async function findAvailablePort(host, startPort, maxAttempts = 20) {
        const start = parseInt(String(startPort), 10);
        if (!Number.isFinite(start) || start <= 0) {
            return 0;
        }
        const attempts = Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 20;
        for (let offset = 0; offset < attempts; offset += 1) {
            const candidate = start + offset;
            if (candidate > 65535) {
                break;
            }
            // eslint-disable-next-line no-await-in-loop
            const ok = await canListenPort(host, candidate);
            if (ok) {
                return candidate;
            }
        }
        return 0;
    }

    function resolveBuiltinProxyProviderName(rawProviderName, providers = {}, preferredProvider = '') {
        const providerMap = providers && isPlainObject(providers) ? providers : {};
        const providerNames = Object.keys(providerMap)
            .filter((name) => name && !isBuiltinManagedProvider(name));
        const requested = typeof rawProviderName === 'string' ? rawProviderName.trim() : '';
        if (requested && !isBuiltinManagedProvider(requested) && providerMap[requested]) {
            return requested;
        }
        const preferred = typeof preferredProvider === 'string' ? preferredProvider.trim() : '';
        if (preferred && !isBuiltinManagedProvider(preferred) && providerMap[preferred]) {
            return preferred;
        }
        return providerNames[0] || '';
    }

    function normalizeBuiltinProxySettings(raw) {
        const merged = {
            ...DEFAULT_BUILTIN_PROXY_SETTINGS,
            ...(isPlainObject(raw) ? raw : {})
        };
        const host = typeof merged.host === 'string' ? merged.host.trim() : '';
        const port = parseInt(String(merged.port), 10);
        const provider = typeof merged.provider === 'string' ? merged.provider.trim() : '';
        const authSourceRaw = typeof merged.authSource === 'string' ? merged.authSource.trim().toLowerCase() : '';
        const timeoutMs = parseInt(String(merged.timeoutMs), 10);
        const authSource = authSourceRaw === 'profile' || authSourceRaw === 'none' ? authSourceRaw : 'provider';

        return {
            enabled: merged.enabled !== false,
            host: host || DEFAULT_BUILTIN_PROXY_SETTINGS.host,
            port: Number.isFinite(port) && port > 0 && port <= 65535 ? port : DEFAULT_BUILTIN_PROXY_SETTINGS.port,
            provider,
            authSource,
            timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000
                ? timeoutMs
                : DEFAULT_BUILTIN_PROXY_SETTINGS.timeoutMs
        };
    }

    function readBuiltinProxySettings() {
        const parsed = readJsonFile(BUILTIN_PROXY_SETTINGS_FILE, null);
        return normalizeBuiltinProxySettings(parsed);
    }

    function saveBuiltinProxySettings(payload = {}, options = {}) {
        const current = readBuiltinProxySettings();
        const merged = normalizeBuiltinProxySettings({
            ...current,
            ...(isPlainObject(payload) ? payload : {})
        });

        if (!merged.host) {
            return { error: '代理 host 不能为空' };
        }
        if (!Number.isFinite(merged.port) || merged.port <= 0 || merged.port > 65535) {
            return { error: '代理端口无效（1-65535）' };
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
            writeJsonAtomic(BUILTIN_PROXY_SETTINGS_FILE, normalized);
        }

        return {
            success: true,
            settings: normalized
        };
    }

    function buildProxyListenUrl(settings) {
        const host = formatHostForUrl(settings.host || DEFAULT_BUILTIN_PROXY_SETTINGS.host);
        return `http://${host}:${settings.port}`;
    }

    function buildBuiltinProxyProviderBaseUrl(settings) {
        return `${buildProxyListenUrl(settings).replace(/\/+$/, '')}/v1`;
    }

    function removePersistedBuiltinProxyProviderFromConfig() {
        if (!fs.existsSync(CONFIG_FILE)) {
            return { success: true, removed: false };
        }

        let config;
        try {
            config = readConfig();
        } catch (e) {
            return { error: e.message || '读取 config.toml 失败' };
        }

        if (!config.model_providers || !config.model_providers[BUILTIN_PROXY_PROVIDER_NAME]) {
            return { success: true, removed: false };
        }

        const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
        const hasBom = content.charCodeAt(0) === 0xFEFF;
        const providerConfig = config.model_providers[BUILTIN_PROXY_PROVIDER_NAME];
        const providerSegments = providerConfig && Array.isArray(providerConfig.__codexmate_legacy_segments)
            ? providerConfig.__codexmate_legacy_segments
            : null;
        const providerSegmentVariants = (() => {
            const variants = [];
            const seen = new Set();
            const pushVariant = (segments) => {
                const normalized = normalizeLegacySegments(segments);
                const key = buildLegacySegmentsKey(normalized);
                if (!key || seen.has(key)) return;
                seen.add(key);
                variants.push(normalized);
            };
            if (providerConfig && Array.isArray(providerConfig.__codexmate_legacy_segments)) {
                pushVariant(providerConfig.__codexmate_legacy_segments);
            }
            if (providerConfig && Array.isArray(providerConfig.__codexmate_legacy_segment_variants)) {
                for (const segments of providerConfig.__codexmate_legacy_segment_variants) {
                    pushVariant(segments);
                }
            }
            if (providerSegments) {
                pushVariant(providerSegments);
            }
            if (variants.length === 0) {
                pushVariant(String(BUILTIN_PROXY_PROVIDER_NAME || '').split('.').filter((item) => item));
            }
            return variants;
        })();

        let updatedContent = null;
        const combinedRanges = [];
        for (const segments of providerSegmentVariants) {
            combinedRanges.push(...findProviderSectionRanges(content, BUILTIN_PROXY_PROVIDER_NAME, segments));
            combinedRanges.push(...findProviderDescendantSectionRanges(content, segments));
        }
        if (combinedRanges.length === 0) {
            combinedRanges.push(...findProviderSectionRanges(content, BUILTIN_PROXY_PROVIDER_NAME, providerSegments));
        }

        if (combinedRanges.length > 0) {
            const sorted = combinedRanges.sort((a, b) => b.start - a.start || b.end - a.end);
            const seen = new Set();
            let removedContent = content;
            for (const range of sorted) {
                const rangeKey = `${range.start}:${range.end}`;
                if (seen.has(rangeKey)) continue;
                seen.add(rangeKey);
                removedContent = removedContent.slice(0, range.start) + removedContent.slice(range.end);
            }
            updatedContent = removedContent.replace(/\n{3,}/g, lineEnding + lineEnding);
        }

        if (!updatedContent) {
            const rebuilt = JSON.parse(JSON.stringify(config));
            delete rebuilt.model_providers[BUILTIN_PROXY_PROVIDER_NAME];
            const hasMarker = content.includes(CODEXMATE_MANAGED_MARKER);
            let rebuiltToml = toml.stringify(rebuilt).trimEnd();
            rebuiltToml = rebuiltToml.replace(/\n/g, lineEnding);
            if (hasMarker && !rebuiltToml.includes(CODEXMATE_MANAGED_MARKER)) {
                rebuiltToml = `${CODEXMATE_MANAGED_MARKER}${lineEnding}${rebuiltToml}`;
            }
            updatedContent = rebuiltToml + lineEnding;
            if (hasBom && updatedContent.charCodeAt(0) !== 0xFEFF) {
                updatedContent = '\uFEFF' + updatedContent;
            }
        }

        try {
            writeConfig(updatedContent.trimEnd() + lineEnding);
        } catch (e) {
            return { error: e.message || '写入 config.toml 失败' };
        }

        return { success: true, removed: true };
    }

    function hasCodexConfigReadyForProxy() {
        const result = readConfigOrVirtualDefault();
        if (!result || result.isVirtual) {
            return false;
        }
        const config = result.config || {};
        if (!isPlainObject(config.model_providers)) {
            return false;
        }
        const providerNames = Object.keys(config.model_providers)
            .filter((name) => name && !isBuiltinManagedProvider(name));
        return providerNames.length > 0;
    }

    function resolveBuiltinProxyUpstream(settings) {
        const { config } = readConfigOrVirtualDefault();
        const providers = config && isPlainObject(config.model_providers) ? config.model_providers : {};
        const currentProvider = typeof config.model_provider === 'string' ? config.model_provider.trim() : '';
        const providerName = resolveBuiltinProxyProviderName(settings.provider, providers, currentProvider);
        if (!providerName) {
            return { error: '未找到可用的上游 provider，请先添加 provider' };
        }
        if (providerName === BUILTIN_PROXY_PROVIDER_NAME) {
            return { error: `上游 provider 不能是 ${BUILTIN_PROXY_PROVIDER_NAME}` };
        }
        const provider = providers[providerName];
        if (!provider || !isPlainObject(provider)) {
            return { error: `上游 provider 不存在: ${providerName}` };
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

    function createBuiltinProxyServer(settings, upstream) {
        const connections = new Set();
        const timeoutMs = settings.timeoutMs;

        const server = http.createServer((req, res) => {
            let parsedIncoming;
            try {
                parsedIncoming = new URL(req.url || '/', 'http://localhost');
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'invalid request path' }));
                return;
            }

            const incomingPath = parsedIncoming.pathname || '/';
            if (incomingPath === '/health' || incomingPath === '/status') {
                const body = JSON.stringify({
                    ok: true,
                    upstreamProvider: upstream.providerName,
                    upstreamBaseUrl: upstream.baseUrl
                });
                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': Buffer.byteLength(body, 'utf-8')
                });
                res.end(body, 'utf-8');
                return;
            }

            if (!(incomingPath === '/v1' || incomingPath.startsWith('/v1/'))) {
                const body = JSON.stringify({ error: 'proxy only supports /v1/* paths' });
                res.writeHead(404, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': Buffer.byteLength(body, 'utf-8')
                });
                res.end(body, 'utf-8');
                return;
            }

            // Responses shim：
            // - Codex CLI 默认走 /v1/responses（含 SSE）
            // - 某些上游只支持 /v1/chat/completions
            // 因此这里优先尝试 /v1/responses（stream=false），失败再转换到 chat/completions 并回包为 responses。
            if ((incomingPath === '/v1/responses' || incomingPath === '/v1/responses/') && (req.method || 'GET').toUpperCase() === 'POST') {
                void (async () => {
                    const { body, error } = await readRequestBody(req, 10 * 1024 * 1024);
                    if (error) {
                        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ error }));
                        return;
                    }
                    const parsed = parseJsonOrError(body);
                    if (parsed.error) {
                        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ error: `invalid json: ${parsed.error}` }));
                        return;
                    }

                    const payload = parsed.value && typeof parsed.value === 'object' ? parsed.value : {};
                    const wantsStream = payload.stream === true;

                    const commonHeaders = {
                        ...(upstream.authHeader ? { 'Authorization': upstream.authHeader } : {}),
                        'X-Codexmate-Proxy': '1'
                    };

                    const upstreamResponsesUrl = joinApiUrl(upstream.baseUrl, 'responses');
                    const upstreamResponses = upstreamResponsesUrl
                        ? await proxyRequestJson(upstreamResponsesUrl, {
                            method: 'POST',
                            headers: commonHeaders,
                            timeoutMs,
                            body: { ...payload, stream: false }
                        })
                        : { ok: false, error: 'failed to build upstream URL' };

                    // 优先走上游 /responses（如果支持）。若上游报错且不是“端点不支持”，则直接透传错误。
                    if (upstreamResponses.ok && upstreamResponses.status >= 200 && upstreamResponses.status < 300) {
                        const json = parseJsonOrError(upstreamResponses.bodyText);
                        if (json.error) {
                            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
                            res.end(JSON.stringify({ error: `Upstream JSON parse failed: ${json.error}` }));
                            return;
                        }
                        const responsesPayload = ensureResponseMetadata(json.value);
                        if (wantsStream) {
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
                        res.end(JSON.stringify(responsesPayload));
                        return;
                    }

                    if (upstreamResponses.ok && upstreamResponses.status >= 400) {
                        if (!shouldFallbackFromUpstreamResponses(upstreamResponses.status, upstreamResponses.bodyText)) {
                            res.writeHead(upstreamResponses.status, { 'Content-Type': 'application/json; charset=utf-8' });
                            res.end(upstreamResponses.bodyText || JSON.stringify({ error: 'Upstream error' }));
                            return;
                        }
                        // fallthrough to chat/completions conversion
                    }

                    if (!upstreamResponses.ok) {
                        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ error: upstreamResponses.error || 'Upstream request failed' }));
                        return;
                    }

                    const model = typeof payload.model === 'string' ? payload.model : '';
                    const messages = normalizeResponsesInputToChatMessages(payload.input);
                    const chatBody = {
                        model,
                        messages,
                        stream: false
                    };
                    if (payload.max_output_tokens != null && chatBody.max_tokens == null) {
                        chatBody.max_tokens = payload.max_output_tokens;
                    }

                    const upstreamChatUrl = joinApiUrl(upstream.baseUrl, 'chat/completions');
                    if (!upstreamChatUrl) {
                        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ error: 'failed to build upstream URL' }));
                        return;
                    }

                    const upstreamChat = await proxyRequestJson(upstreamChatUrl, {
                        method: 'POST',
                        headers: commonHeaders,
                        timeoutMs,
                        body: chatBody
                    });
                    if (!upstreamChat.ok) {
                        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ error: upstreamChat.error || 'proxy request failed' }));
                        return;
                    }

                    const chatJson = parseJsonOrError(upstreamChat.bodyText);
                    if (chatJson.error) {
                        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ error: `invalid upstream response: ${chatJson.error}` }));
                        return;
                    }

                    const { text } = extractChatCompletionResult(chatJson.value);
                    const responsesPayload = ensureResponseMetadata({
                        model,
                        output: [{
                            type: 'message',
                            role: 'assistant',
                            content: [{ type: 'output_text', text }]
                        }],
                        usage: chatJson.value && chatJson.value.usage ? chatJson.value.usage : undefined
                    });

                    if (wantsStream) {
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
                    res.end(JSON.stringify(responsesPayload));
                })();
                return;
            }

            const suffix = incomingPath === '/v1'
                ? ''
                : incomingPath.replace(/^\/v1\/?/, '');
            const targetBase = joinApiUrl(upstream.baseUrl, suffix);
            if (!targetBase) {
                const body = JSON.stringify({ error: 'failed to build upstream URL' });
                res.writeHead(500, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': Buffer.byteLength(body, 'utf-8')
                });
                res.end(body, 'utf-8');
                return;
            }

            let targetUrl;
            try {
                targetUrl = new URL(targetBase);
                targetUrl.search = parsedIncoming.search || '';
            } catch (e) {
                const body = JSON.stringify({ error: `invalid upstream URL: ${e.message}` });
                res.writeHead(500, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': Buffer.byteLength(body, 'utf-8')
                });
                res.end(body, 'utf-8');
                return;
            }

            const requestHeaders = { ...req.headers };
            delete requestHeaders.host;
            delete requestHeaders.connection;
            delete requestHeaders['content-length'];
            if (upstream.authHeader) {
                requestHeaders.authorization = upstream.authHeader;
            }
            requestHeaders['x-codexmate-proxy'] = '1';
            if (!requestHeaders['x-forwarded-for'] && req.socket && req.socket.remoteAddress) {
                requestHeaders['x-forwarded-for'] = req.socket.remoteAddress;
            }

            const transport = targetUrl.protocol === 'https:' ? https : http;
            const upstreamReq = transport.request({
                protocol: targetUrl.protocol,
                hostname: targetUrl.hostname,
                port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
                method: req.method || 'GET',
                path: `${targetUrl.pathname}${targetUrl.search}`,
                headers: requestHeaders,
                agent: targetUrl.protocol === 'https:' ? HTTPS_KEEP_ALIVE_AGENT : HTTP_KEEP_ALIVE_AGENT
            }, (upstreamRes) => {
                const responseHeaders = { ...upstreamRes.headers };
                delete responseHeaders.connection;
                res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
                upstreamRes.pipe(res);
            });

            upstreamReq.setTimeout(timeoutMs, () => {
                upstreamReq.destroy(new Error(`upstream timeout (${timeoutMs}ms)`));
            });

            upstreamReq.on('error', (err) => {
                if (res.headersSent) {
                    try { res.destroy(err); } catch (_) {}
                    return;
                }
                const body = JSON.stringify({ error: `proxy request failed: ${err.message}` });
                res.writeHead(502, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': Buffer.byteLength(body, 'utf-8')
                });
                res.end(body, 'utf-8');
            });

            req.pipe(upstreamReq);
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
                    listenUrl: buildProxyListenUrl(settings)
                });
            });
        });
    }

    async function startBuiltinProxyRuntime(payload = {}) {
        if (runtime) {
            return {
                error: '内建代理已在运行',
                runtime: {
                    listenUrl: runtime.listenUrl,
                    upstreamProvider: runtime.upstream.providerName
                }
            };
        }

        const saveResult = saveBuiltinProxySettings(payload);
        if (saveResult.error) {
            return { error: saveResult.error };
        }
        const settings = saveResult.settings;
        const upstream = resolveBuiltinProxyUpstream(settings);
        if (upstream.error) {
            return { error: upstream.error };
        }

        try {
            runtime = await createBuiltinProxyServer(settings, upstream);
            return {
                success: true,
                running: true,
                listenUrl: runtime.listenUrl,
                upstreamProvider: upstream.providerName,
                settings
            };
        } catch (e) {
            return { error: `启动内建代理失败: ${e.message}` };
        }
    }

    async function stopBuiltinProxyRuntime() {
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

    function getBuiltinProxyStatus() {
        const settings = readBuiltinProxySettings();
        return {
            running: !!runtime,
            settings,
            runtime: runtime
                ? {
                    provider: BUILTIN_PROXY_PROVIDER_NAME,
                    startedAt: runtime.startedAt,
                    listenUrl: runtime.listenUrl,
                    upstreamProvider: runtime.upstream.providerName,
                    upstreamBaseUrl: runtime.upstream.baseUrl
                }
                : null
        };
    }

    return {
        canListenPort,
        findAvailablePort,
        normalizeBuiltinProxySettings,
        readBuiltinProxySettings,
        resolveBuiltinProxyProviderName,
        saveBuiltinProxySettings,
        buildProxyListenUrl,
        buildBuiltinProxyProviderBaseUrl,
        removePersistedBuiltinProxyProviderFromConfig,
        hasCodexConfigReadyForProxy,
        resolveBuiltinProxyUpstream,
        createBuiltinProxyServer,
        startBuiltinProxyRuntime,
        stopBuiltinProxyRuntime,
        getBuiltinProxyStatus
    };
}

module.exports = {
    createBuiltinProxyRuntimeController
};
