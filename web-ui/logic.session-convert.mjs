function stripLeadingSystemMessage(messages) {
    if (!Array.isArray(messages) || messages.length < 2) return messages;
    const first = messages[0];
    if (!first || first.role !== 'system') return messages;
    return messages.slice(1);
}

function toIsoTimestamp(value, fallback) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) return text;
    return typeof fallback === 'string' ? fallback : '';
}

export function normalizeSessionConvertSource(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'codex' || normalized === 'claude') return normalized;
    return '';
}

export function getConvertTargetSource(source) {
    return source === 'codex' ? 'claude' : (source === 'claude' ? 'codex' : '');
}

export function buildConvertedSessionJsonl(target, payload) {
    const now = Date.now();
    const baseTime = new Date(now).toISOString();
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
    const cwd = typeof payload.cwd === 'string' ? payload.cwd : '';
    const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
    const messages = stripLeadingSystemMessage(rawMessages);
    const lines = [];

    if (target === 'codex') {
        lines.push(JSON.stringify({ type: 'session_meta', timestamp: baseTime, payload: { id: sessionId, cwd } }));
        for (let i = 0; i < messages.length; i += 1) {
            const message = messages[i];
            if (!message) continue;
            const role = message.role === 'user' || message.role === 'assistant' || message.role === 'system'
                ? message.role
                : 'assistant';
            const text = typeof message.text === 'string' ? message.text : '';
            if (!text) continue;
            lines.push(JSON.stringify({
                type: 'response_item',
                timestamp: toIsoTimestamp(message.timestamp, new Date(now + i).toISOString()),
                payload: { type: 'message', role, content: text }
            }));
        }
        return `${lines.join('\n')}\n`;
    }

    for (let i = 0; i < messages.length; i += 1) {
        const message = messages[i];
        if (!message) continue;
        const role = message.role === 'user' || message.role === 'assistant' || message.role === 'system'
            ? message.role
            : 'assistant';
        const text = typeof message.text === 'string' ? message.text : '';
        if (!text) continue;
        lines.push(JSON.stringify({
            type: role,
            timestamp: toIsoTimestamp(message.timestamp, new Date(now + i).toISOString()),
            sessionId,
            cwd,
            message: { content: text }
        }));
    }
    return `${lines.join('\n')}\n`;
}

