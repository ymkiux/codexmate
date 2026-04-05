const crypto = require('crypto');
const { joinApiUrl, normalizeBaseUrl } = require('./cli-utils');

function extractModelNames(payload) {
    if (!payload || typeof payload !== 'object') return [];
    const data = Array.isArray(payload.data)
        ? payload.data
        : (Array.isArray(payload.models) ? payload.models : []);
    const names = [];
    for (const item of data) {
        if (typeof item === 'string') {
            if (item.trim()) names.push(item.trim());
            continue;
        }
        if (!item || typeof item !== 'object') continue;
        const name = item.id || item.name || item.model || '';
        if (typeof name === 'string' && name.trim()) {
            names.push(name.trim());
        }
    }
    return Array.from(new Set(names));
}

function hasModelsListPayload(payload) {
    if (!payload || typeof payload !== 'object') return false;
    return Array.isArray(payload.data) || Array.isArray(payload.models);
}

function extractModelIds(payload) {
    const ids = [];
    const pushValue = (value) => {
        if (typeof value === 'string' && value.trim()) {
            ids.push(value.trim());
        }
    };

    if (!payload) return ids;

    if (Array.isArray(payload)) {
        for (const item of payload) {
            if (item && typeof item === 'object') {
                pushValue(item.id);
                pushValue(item.model);
                pushValue(item.name);
            } else {
                pushValue(item);
            }
        }
        return ids;
    }

    if (Array.isArray(payload.data)) {
        for (const item of payload.data) {
            if (item && typeof item === 'object') {
                pushValue(item.id);
                pushValue(item.model);
                pushValue(item.name);
            } else {
                pushValue(item);
            }
        }
    }

    if (Array.isArray(payload.models)) {
        for (const item of payload.models) {
            if (item && typeof item === 'object') {
                pushValue(item.id);
                pushValue(item.model);
                pushValue(item.name);
            } else {
                pushValue(item);
            }
        }
    }

    return ids;
}

function normalizeWireApi(value) {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!raw) return 'responses';
    return raw.replace(/[\s\-\/]/g, '_');
}

function buildApiProbeUrlCandidates(baseUrl, pathSuffix) {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) return [];

    const safeSuffix = String(pathSuffix || '').replace(/^\/+/g, '');
    if (!safeSuffix) return [normalized];

    const candidates = [];
    const pushUnique = (value) => {
        if (value && !candidates.includes(value)) {
            candidates.push(value);
        }
    };

    let pathname = '';
    try {
        pathname = new URL(normalized).pathname.replace(/\/+$/g, '');
    } catch (e) {
        pathname = '';
    }

    const directUrl = `${normalized}/${safeSuffix}`;
    const versionedUrl = joinApiUrl(normalized, safeSuffix);
    if (/\/v\d+$/i.test(pathname)) {
        pushUnique(directUrl);
        return candidates;
    }

    if (!pathname || pathname === '/') {
        pushUnique(versionedUrl);
        pushUnique(directUrl);
        return candidates;
    }

    pushUnique(directUrl);
    pushUnique(versionedUrl);
    return candidates;
}

function buildModelsProbeUrl(baseUrl) {
    return buildApiProbeUrlCandidates(baseUrl, 'models')[0] || '';
}

function buildModelProbeSpecs(provider, modelName, baseUrl) {
    const model = typeof modelName === 'string' ? modelName.trim() : '';
    if (!model) return [];

    const wireApi = normalizeWireApi(provider && provider.wire_api);
    let pathSuffix = 'responses';
    let body = {
        model,
        input: 'ping',
        max_output_tokens: 1
    };

    if (wireApi === 'chat_completions' || wireApi === 'chat') {
        pathSuffix = 'chat/completions';
        body = {
            model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            temperature: 0
        };
    } else if (wireApi === 'completions') {
        pathSuffix = 'completions';
        body = {
            model,
            prompt: 'ping',
            max_tokens: 1,
            temperature: 0
        };
    }

    return buildApiProbeUrlCandidates(baseUrl, pathSuffix).map((url) => ({
        url,
        body
    }));
}

function buildModelProbeSpec(provider, modelName, baseUrl) {
    return buildModelProbeSpecs(provider, modelName, baseUrl)[0] || null;
}

function buildModelConversationSpecs(provider, modelName, baseUrl, prompt, options = {}) {
    const model = typeof modelName === 'string' ? modelName.trim() : '';
    const userPrompt = typeof prompt === 'string' ? prompt.trim() : '';
    if (!model || !userPrompt) return [];

    const wireApi = normalizeWireApi(provider && provider.wire_api);
    const maxOutputTokens = Number.isFinite(options.maxOutputTokens)
        ? Math.max(1, Number(options.maxOutputTokens))
        : 256;
    let pathSuffix = 'responses';
    let body = {
        model,
        input: userPrompt,
        max_output_tokens: maxOutputTokens
    };

    if (wireApi === 'chat_completions' || wireApi === 'chat') {
        pathSuffix = 'chat/completions';
        body = {
            model,
            messages: [{ role: 'user', content: userPrompt }],
            max_tokens: maxOutputTokens
        };
    } else if (wireApi === 'completions') {
        pathSuffix = 'completions';
        body = {
            model,
            prompt: userPrompt,
            max_tokens: maxOutputTokens
        };
    }

    return buildApiProbeUrlCandidates(baseUrl, pathSuffix).map((url) => ({
        url,
        body,
        wireApi
    }));
}

function collectStructuredText(content, pieces) {
    if (typeof content === 'string') {
        const text = content.trim();
        if (text) pieces.push(text);
        return;
    }
    if (Array.isArray(content)) {
        for (const item of content) {
            collectStructuredText(item, pieces);
        }
        return;
    }
    if (!content || typeof content !== 'object') {
        return;
    }

    if (typeof content.output_text === 'string' && content.output_text.trim()) {
        pieces.push(content.output_text.trim());
    }
    if (typeof content.text === 'string' && content.text.trim()) {
        pieces.push(content.text.trim());
    }
    if (typeof content.content === 'string' && content.content.trim()) {
        pieces.push(content.content.trim());
    }

    if (Array.isArray(content.content)) {
        collectStructuredText(content.content, pieces);
    }
    if (content.message) {
        collectStructuredText(content.message, pieces);
    }
}

function extractModelResponseText(payload) {
    if (!payload || typeof payload !== 'object') {
        return '';
    }

    if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
        return payload.output_text.trim();
    }

    const pieces = [];

    if (Array.isArray(payload.output)) {
        for (const item of payload.output) {
            collectStructuredText(item, pieces);
        }
    }

    if (Array.isArray(payload.choices)) {
        for (const choice of payload.choices) {
            if (!choice || typeof choice !== 'object') continue;
            if (typeof choice.text === 'string' && choice.text.trim()) {
                pieces.push(choice.text.trim());
            }
            if (choice.message) {
                collectStructuredText(choice.message, pieces);
            }
        }
    }

    if (payload.message) {
        collectStructuredText(payload.message, pieces);
    }
    if (payload.content) {
        collectStructuredText(payload.content, pieces);
    }
    if (typeof payload.text === 'string' && payload.text.trim()) {
        pieces.push(payload.text.trim());
    }

    return Array.from(new Set(pieces)).join('\n\n').trim();
}

function hashModelsCacheValue(value) {
    if (!value) return '';
    try {
        return crypto.createHash('sha256').update(String(value)).digest('hex');
    } catch (e) {
        return '';
    }
}

function buildModelsCacheKey(baseUrl, apiKey) {
    const normalizedUrl = normalizeBaseUrl(baseUrl);
    const apiKeyHash = hashModelsCacheValue(apiKey);
    return `${normalizedUrl}|${apiKeyHash}`;
}

module.exports = {
    extractModelNames,
    hasModelsListPayload,
    extractModelIds,
    normalizeWireApi,
    buildApiProbeUrlCandidates,
    buildModelsProbeUrl,
    buildModelProbeSpecs,
    buildModelProbeSpec,
    buildModelConversationSpecs,
    extractModelResponseText,
    hashModelsCacheValue,
    buildModelsCacheKey
};
