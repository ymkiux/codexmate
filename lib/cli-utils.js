const fs = require('fs');
const path = require('path');
const os = require('os');

const UTF8_BOM = '\ufeff';

function expandHomePath(value) {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    if (trimmed === '~') {
        return os.homedir();
    }
    if (trimmed.startsWith(`~${path.sep}`) || trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
        return path.resolve(os.homedir(), trimmed.slice(2));
    }
    return trimmed;
}

function resolveExistingDir(candidates = [], fallback = '') {
    for (const raw of candidates) {
        const candidate = expandHomePath(raw);
        if (!candidate) continue;
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                return candidate;
            }
        } catch (e) {}
    }
    return fallback;
}

function resolveHomePath(input) {
    const raw = typeof input === 'string' ? input.trim() : '';
    if (!raw) return '';
    if (raw === '~') return os.homedir();
    if (raw.startsWith('~/') || raw.startsWith('~\\')) {
        return path.join(os.homedir(), raw.slice(2));
    }
    return raw;
}

function hasUtf8Bom(text) {
    return typeof text === 'string' && text.charCodeAt(0) === 0xfeff;
}

function stripUtf8Bom(text) {
    if (!text) return '';
    return hasUtf8Bom(text) ? text.slice(1) : text;
}

function ensureUtf8Bom(text) {
    const content = typeof text === 'string' ? text : '';
    return hasUtf8Bom(content) ? content : UTF8_BOM + content;
}

function detectLineEnding(text) {
    return typeof text === 'string' && text.includes('\r\n') ? '\r\n' : '\n';
}

function normalizeLineEnding(text, lineEnding) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return lineEnding === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

function isValidProviderName(name) {
    return typeof name === 'string' && /^[a-zA-Z0-9._-]+$/.test(name.trim());
}

function escapeTomlBasicString(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
}

function buildModelProviderTableHeader(providerName) {
    const raw = typeof providerName === 'string' ? providerName.trim() : '';
    if (/^[a-zA-Z0-9_-]+$/.test(raw)) {
        return `[model_providers.${raw}]`;
    }
    return `[model_providers."${escapeTomlBasicString(raw)}"]`;
}

function buildModelsCandidates(baseUrl) {
    const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : '';
    if (!trimmed) return [];
    if (/\/models\/?$/.test(trimmed)) {
        return [trimmed];
    }
    const normalized = trimmed.replace(/\/+$/, '');
    const candidates = [];
    const pushUnique = (url) => {
        if (url && !candidates.includes(url)) {
            candidates.push(url);
        }
    };

    if (/\/v1$/i.test(normalized)) {
        pushUnique(normalized + '/models');
    } else {
        pushUnique(normalized + '/v1/models');
        pushUnique(normalized + '/models');
    }

    pushUnique(trimmed);
    return candidates;
}

function isValidHttpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

function normalizeBaseUrl(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\/+$/g, '');
}

function joinApiUrl(baseUrl, pathSuffix) {
    const trimmed = normalizeBaseUrl(baseUrl);
    if (!trimmed) return '';
    const safeSuffix = String(pathSuffix || '').replace(/^\/+/g, '');
    if (!safeSuffix) return trimmed;
    if (/\/v1$/i.test(trimmed)) {
        return `${trimmed}/${safeSuffix}`;
    }
    return `${trimmed}/v1/${safeSuffix}`;
}

module.exports = {
    expandHomePath,
    resolveExistingDir,
    resolveHomePath,
    hasUtf8Bom,
    stripUtf8Bom,
    ensureUtf8Bom,
    detectLineEnding,
    normalizeLineEnding,
    isValidProviderName,
    escapeTomlBasicString,
    buildModelProviderTableHeader,
    buildModelsCandidates,
    isValidHttpUrl,
    normalizeBaseUrl,
    joinApiUrl
};
