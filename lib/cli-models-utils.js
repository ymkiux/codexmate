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
    return raw.replace(/[\s-]/g, '_');
}

function buildModelsProbeUrl(baseUrl) {
    return joinApiUrl(baseUrl, 'models');
}

function buildModelProbeSpec(provider, modelName, baseUrl) {
    const model = typeof modelName === 'string' ? modelName.trim() : '';
    if (!model) return null;

    const wireApi = normalizeWireApi(provider && provider.wire_api);
    if (wireApi === 'chat_completions' || wireApi === 'chat') {
        return {
            url: joinApiUrl(baseUrl, 'chat/completions'),
            body: {
                model,
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1,
                temperature: 0
            }
        };
    }

    if (wireApi === 'completions') {
        return {
            url: joinApiUrl(baseUrl, 'completions'),
            body: {
                model,
                prompt: 'ping',
                max_tokens: 1,
                temperature: 0
            }
        };
    }

    return {
        url: joinApiUrl(baseUrl, 'responses'),
        body: {
            model,
            input: 'ping',
            max_output_tokens: 1
        }
    };
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
    buildModelsProbeUrl,
    buildModelProbeSpec,
    hashModelsCacheValue,
    buildModelsCacheKey
};
