function toIsoTime(value, fallback = '') {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return fallback;
    }
    return date.toISOString();
}

function updateLatestIso(currentIso, candidate) {
    const currentTime = Date.parse(currentIso || '') || 0;
    const candidateIso = toIsoTime(candidate, '');
    const candidateTime = Date.parse(candidateIso || '') || 0;
    if (!candidateTime) {
        return currentIso;
    }
    return candidateTime > currentTime ? candidateIso : currentIso;
}

function truncateText(text, maxLength = 90) {
    if (!text) return '';
    const normalized = String(text).replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return normalized.slice(0, maxLength - 1) + '…';
}

function extractMessageText(content) {
    if (typeof content === 'string') {
        return content.trim();
    }

    if (Array.isArray(content)) {
        const parts = content
            .map(item => extractMessageText(item))
            .filter(Boolean);
        return parts.join('\n').trim();
    }

    if (!content || typeof content !== 'object') {
        return '';
    }

    if (typeof content.text === 'string') {
        return content.text.trim();
    }

    if (typeof content.value === 'string') {
        return content.value.trim();
    }

    if (content.content !== undefined) {
        return extractMessageText(content.content);
    }

    if (typeof content.output === 'string') {
        return content.output.trim();
    }

    return '';
}

function normalizeRole(value) {
    if (typeof value !== 'string') {
        return '';
    }
    const role = value.trim().toLowerCase();
    if (role === 'assistant' || role === 'user' || role === 'system') {
        return role;
    }
    return '';
}

function parseMaxMessagesValue(value) {
    if (value === Infinity) {
        return Infinity;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        const lower = trimmed.toLowerCase();
        if (lower === 'all' || lower === 'infinity' || lower === 'inf') {
            return Infinity;
        }
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
        return null;
    }

    if (Number.isFinite(value)) {
        return value;
    }
    return null;
}

function resolveMaxMessagesValue(value, fallback) {
    const parsed = parseMaxMessagesValue(value);
    if (parsed === null) {
        return fallback;
    }
    if (parsed === Infinity) {
        return Infinity;
    }
    return Math.max(1, Math.floor(parsed));
}

module.exports = {
    toIsoTime,
    updateLatestIso,
    truncateText,
    extractMessageText,
    normalizeRole,
    parseMaxMessagesValue,
    resolveMaxMessagesValue
};
