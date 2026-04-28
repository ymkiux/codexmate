const fs = require('fs');

const {
    toIsoTime,
    truncateText,
    extractMessageText,
    normalizeRole
} = require('./cli-session-utils');

const DEFAULT_SESSION_DETAIL_MESSAGES = 300;
const FAST_SESSION_DETAIL_PREVIEW_FILE_BYTES = 256 * 1024;
const FAST_SESSION_DETAIL_PREVIEW_CHUNK_BYTES = 64 * 1024;
const FAST_SESSION_DETAIL_PREVIEW_MAX_BYTES = 1024 * 1024;

const BOOTSTRAP_TEXT_MARKERS = [
    'agents.md instructions',
    '<instructions>',
    '<environment_context>',
    'you are a coding agent',
    'codex cli'
];

function getFileStatSafe(filePath) {
    try {
        return fs.statSync(filePath);
    } catch (e) {
        return null;
    }
}

function isBootstrapLikeText(text) {
    if (!text || typeof text !== 'string') {
        return false;
    }

    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return false;
    }

    if (normalized.length < 80) {
        return false;
    }
    let hits = 0;
    for (const marker of BOOTSTRAP_TEXT_MARKERS) {
        if (normalized.includes(marker)) {
            hits += 1;
        }
    }
    if (hits >= 2) {
        return true;
    }
    if (normalized.includes('<environment_context>')) {
        return true;
    }
    if (normalized.includes('agents.md instructions')) {
        return true;
    }
    return false;
}

function removeLeadingSystemMessage(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return [];
    }

    let startIndex = 0;
    while (startIndex < messages.length) {
        const item = messages[startIndex];
        const role = item ? normalizeRole(item.role) : '';
        const text = item && typeof item.text === 'string' ? item.text : '';
        const isSystemRole = role === 'system';
        const isBootstrapText = isBootstrapLikeText(text);
        if (!item || isSystemRole || isBootstrapText) {
            startIndex += 1;
            continue;
        }
        break;
    }

    if (startIndex <= 0) {
        return messages;
    }
    return messages.slice(startIndex);
}

function normalizeQueryTokens(query) {
    if (typeof query !== 'string') {
        return [];
    }
    return query
        .split(/\s+/)
        .map(item => item.trim())
        .map(item => item.toLowerCase())
        .filter(Boolean);
}

function expandSessionQueryTokens(tokens) {
    const base = Array.isArray(tokens) ? tokens.map(t => String(t || '').toLowerCase()).filter(Boolean) : [];
    const result = [];
    const seen = new Set();
    let hasClaudeAlias = false;
    let hasDaudeAlias = false;

    // First pass: detect multi-token aliases (e.g., "claude code", "daude code")
    for (let i = 0; i < base.length; i++) {
        const token = base[i];
        const nextToken = base[i + 1] || '';

        // Check for "claude code" pattern (two separate tokens)
        if (token === 'claude' && nextToken === 'code') {
            hasClaudeAlias = true;
            i++; // Skip next token
            continue;
        }
        // Check for "daude code" pattern (two separate tokens)
        if (token === 'daude' && nextToken === 'code') {
            hasDaudeAlias = true;
            i++; // Skip next token
            continue;
        }
        // Check for combined patterns (e.g., "claude-code", "claude_code", "claudecode")
        if (/^claude[-_ ]?code$/.test(token) || token === 'claudecode') {
            hasClaudeAlias = true;
            continue;
        }
        if (/^daude[-_ ]?code$/.test(token) || token === 'daudecode') {
            hasDaudeAlias = true;
            continue;
        }
        if (!seen.has(token)) {
            seen.add(token);
            result.push(token);
        }
    }

    const push = (token) => {
        const normalized = String(token || '').toLowerCase();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        result.push(normalized);
    };

    if (hasClaudeAlias) {
        push('claude');
        push('code');
    }
    if (hasDaudeAlias) {
        push('daude');
        push('code');
    }

    return result;
}

function matchTokensInText(text, tokens, mode = 'and') {
    if (!Array.isArray(tokens) || tokens.length === 0) {
        return true;
    }
    const haystack = String(text || '').toLowerCase();
    if (!haystack) {
        return false;
    }
    if (mode === 'or') {
        return tokens.some(token => haystack.includes(token));
    }
    return tokens.every(token => haystack.includes(token));
}

function extractMessageFromRecord(record, source) {
    if (!record) {
        return null;
    }
    if (source === 'codex') {
        if (record.type === 'response_item' && record.payload && record.payload.type === 'message') {
            const role = normalizeRole(record.payload.role);
            const text = extractMessageText(record.payload.content);
            if (!role || !text) {
                return null;
            }
            return { role, text };
        }
        return null;
    }

    const role = normalizeRole(record.type);
    if (!role) {
        return null;
    }
    const content = record.message ? record.message.content : '';
    const text = extractMessageText(content);
    if (!text) {
        return null;
    }
    return { role, text };
}

function appendSessionDetailTailMessage(state, record, source, lineIndex = -1) {
    if (!state || typeof state !== 'object') {
        return;
    }

    const message = extractMessageFromRecord(record, source);
    if (!message) {
        return;
    }

    const role = normalizeRole(message.role);
    const text = typeof message.text === 'string' ? message.text : '';
    if (!role || !text) {
        return;
    }

    if (state.leadingSystem && (role === 'system' || isBootstrapLikeText(text))) {
        return;
    }

    state.leadingSystem = false;
    state.totalMessages += 1;
    if (!Number.isFinite(state.tailLimit) || state.tailLimit <= 0) {
        return;
    }

    if (state.messages.length >= state.tailLimit) {
        state.messages.shift();
    }
    state.messages.push({
        role,
        text,
        timestamp: toIsoTime(record && record.timestamp, ''),
        recordLineIndex: Number.isInteger(lineIndex) ? lineIndex : -1
    });
}

function applySessionDetailRecordMetadata(record, source, state) {
    if (!state || typeof state !== 'object' || !record) {
        return;
    }

    if (record.timestamp) {
        state.updatedAt = toIsoTime(record.timestamp, state.updatedAt);
    }

    if (source === 'codex') {
        if (record.type === 'session_meta' && record.payload) {
            state.sessionId = record.payload.id || state.sessionId;
            state.cwd = record.payload.cwd || state.cwd;
        }
        return;
    }

    if (!state.sessionId && record.sessionId) {
        state.sessionId = record.sessionId;
    }
    if (!state.cwd && record.cwd) {
        state.cwd = record.cwd;
    }
}

function extractSessionDetailPreviewFromTailText(text, source, messageLimit) {
    const safeMessageLimit = Number.isFinite(Number(messageLimit))
        ? Math.max(1, Math.floor(Number(messageLimit)))
        : DEFAULT_SESSION_DETAIL_MESSAGES;
    const state = {
        sessionId: '',
        cwd: '',
        updatedAt: '',
        messages: [],
        tailLimit: safeMessageLimit,
        totalMessages: null,
        clipped: false
    };
    const lines = typeof text === 'string' && text
        ? text.split(/\r?\n/)
        : [];

    for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
        const trimmed = lines[lineIndex].trim();
        if (!trimmed) {
            continue;
        }

        let record;
        try {
            record = JSON.parse(trimmed);
        } catch (_) {
            continue;
        }

        if (record && record.timestamp && !state.updatedAt) {
            state.updatedAt = toIsoTime(record.timestamp, '');
        }
        if ((!state.sessionId || !state.cwd) && record) {
            applySessionDetailRecordMetadata(record, source, state);
        }

        const message = extractMessageFromRecord(record, source);
        if (!message) {
            continue;
        }

        const role = normalizeRole(message.role);
        const textValue = typeof message.text === 'string' ? message.text : '';
        if (!role || !textValue) {
            continue;
        }

        if (state.messages.length >= safeMessageLimit) {
            state.clipped = true;
            break;
        }

        state.messages.unshift({
            role,
            text: textValue,
            timestamp: toIsoTime(record && record.timestamp, ''),
            recordLineIndex: -1
        });
    }

    state.messages = removeLeadingSystemMessage(state.messages);
    return state;
}

function extractSessionDetailPreviewFromFileFast(filePath, source, messageLimit) {
    const fileStat = getFileStatSafe(filePath);
    if (!fileStat || !Number.isFinite(fileStat.size) || fileStat.size <= FAST_SESSION_DETAIL_PREVIEW_FILE_BYTES) {
        return null;
    }
    const safeMessageLimit = Number.isFinite(Number(messageLimit))
        ? Math.max(1, Math.floor(Number(messageLimit)))
        : DEFAULT_SESSION_DETAIL_MESSAGES;

    let fd = null;
    let position = fileStat.size;
    let totalBytesRead = 0;
    let combined = Buffer.alloc(0);
    let latest = {
        sessionId: '',
        cwd: '',
        updatedAt: '',
        messages: [],
        totalMessages: null,
        clipped: false
    };

    try {
        fd = fs.openSync(filePath, 'r');
        while (position > 0 && totalBytesRead < FAST_SESSION_DETAIL_PREVIEW_MAX_BYTES) {
            const remainingBudget = FAST_SESSION_DETAIL_PREVIEW_MAX_BYTES - totalBytesRead;
            const chunkSize = Math.min(FAST_SESSION_DETAIL_PREVIEW_CHUNK_BYTES, position, remainingBudget);
            if (chunkSize <= 0) {
                break;
            }

            position -= chunkSize;
            const chunk = Buffer.allocUnsafe(chunkSize);
            const bytesRead = fs.readSync(fd, chunk, 0, chunkSize, position);
            if (bytesRead <= 0) {
                break;
            }

            totalBytesRead += bytesRead;
            combined = Buffer.concat([chunk.subarray(0, bytesRead), combined]);
            latest = extractSessionDetailPreviewFromTailText(combined.toString('utf-8'), source, safeMessageLimit);
            if (latest.messages.length >= safeMessageLimit) {
                latest.clipped = latest.clipped || position > 0;
                return latest;
            }
        }

        if (position > 0) {
            latest.clipped = latest.clipped || position > 0;
            return latest;
        }
        const normalizedMessages = removeLeadingSystemMessage(latest.messages);
        latest.messages = normalizedMessages.length > safeMessageLimit
            ? normalizedMessages.slice(-safeMessageLimit)
            : normalizedMessages;
        latest.totalMessages = normalizedMessages.length;
        latest.clipped = latest.totalMessages > latest.messages.length;
        return latest;
    } catch (_) {
        return null;
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (e) {}
        }
    }
}

module.exports = {
    BOOTSTRAP_TEXT_MARKERS,
    getFileStatSafe,
    isBootstrapLikeText,
    removeLeadingSystemMessage,
    normalizeQueryTokens,
    expandSessionQueryTokens,
    matchTokensInText,
    extractMessageFromRecord,
    appendSessionDetailTailMessage,
    applySessionDetailRecordMetadata,
    extractSessionDetailPreviewFromTailText,
    extractSessionDetailPreviewFromFileFast
};
