const fs = require('fs');
const readline = require('readline');

const {
    toIsoTime,
    extractMessageText,
    normalizeRole,
    resolveMaxMessagesValue
} = require('../lib/cli-session-utils');

const { removeLeadingSystemMessage } = require('../lib/cli-sessions');

async function readSessionMessages(filePath, source, maxMessages) {
    const limit = resolveMaxMessagesValue(maxMessages, 200);
    const state = { sessionId: '', cwd: '', updatedAt: '', messages: [], truncated: false };
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
        const trimmed = String(line || '').trim();
        if (!trimmed) continue;
        let record;
        try { record = JSON.parse(trimmed); } catch (_) { continue; }
        const timestamp = toIsoTime(record.timestamp, '');
        if (timestamp) state.updatedAt = timestamp;
        if (source === 'codex' && record.type === 'session_meta' && record.payload) {
            if (!state.sessionId && record.payload.id) state.sessionId = String(record.payload.id || '');
            if (!state.cwd && record.payload.cwd) state.cwd = String(record.payload.cwd || '');
            continue;
        }
        if (source === 'claude') {
            if (!state.sessionId && record.sessionId) state.sessionId = String(record.sessionId || '');
            if (!state.cwd && record.cwd) state.cwd = String(record.cwd || '');
        }
        let role = '';
        let text = '';
        if (source === 'codex' && record.type === 'response_item' && record.payload && record.payload.type === 'message') {
            role = normalizeRole(record.payload.role);
            text = extractMessageText(record.payload.content);
        } else if (source === 'claude') {
            role = normalizeRole(record.type);
            text = extractMessageText(record.message ? record.message.content : '');
        }
        if (!role || !text) continue;
        state.messages.push({ role, text, timestamp });
        if (limit !== Infinity && state.messages.length > limit) {
            state.messages.shift();
            state.truncated = true;
        }
    }
    state.messages = removeLeadingSystemMessage(state.messages);
    return state;
}

function buildTargetRecords(target, payload) {
    const now = Date.now();
    const sessionId = String(payload.sessionId || '').trim();
    const cwd = String(payload.cwd || '').trim();
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    if (target === 'codex') {
        const records = [{ type: 'session_meta', timestamp: new Date(now).toISOString(), payload: { id: sessionId, cwd } }];
        for (let i = 0; i < messages.length; i += 1) {
            const m = messages[i] || {};
            const role = normalizeRole(m.role);
            const text = typeof m.text === 'string' ? m.text : '';
            if (!role || !text) continue;
            records.push({ type: 'response_item', timestamp: m.timestamp || new Date(now + i).toISOString(), payload: { type: 'message', role, content: text } });
        }
        return records;
    }
    const records = [];
    for (let i = 0; i < messages.length; i += 1) {
        const m = messages[i] || {};
        const role = normalizeRole(m.role);
        const text = typeof m.text === 'string' ? m.text : '';
        if (!role || !text) continue;
        records.push({ type: role, timestamp: m.timestamp || new Date(now + i).toISOString(), sessionId, cwd, message: { content: text } });
    }
    return records;
}

module.exports = { readSessionMessages, buildTargetRecords };

