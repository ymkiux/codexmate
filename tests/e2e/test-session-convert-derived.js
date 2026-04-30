const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { assert } = require('./helpers');

function sha256File(filePath) {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function derivedMetaPath(filePath) {
    return filePath.endsWith('.jsonl') ? filePath.replace(/\.jsonl$/, '.meta.json') : `${filePath}.meta.json`;
}

function isCodexSessionPath(tmpHome, filePath) {
    const normalized = String(filePath || '');
    return normalized.startsWith(path.join(tmpHome, '.codex', 'sessions') + path.sep)
        || normalized.startsWith(path.join(tmpHome, '.config', 'codex', 'sessions') + path.sep);
}

function isClaudeProjectPath(tmpHome, filePath) {
    const normalized = String(filePath || '');
    return normalized.startsWith(path.join(tmpHome, '.claude', 'projects') + path.sep)
        || normalized.startsWith(path.join(tmpHome, '.config', 'claude', 'projects') + path.sep);
}

function buildIso(baseIso, offsetSeconds) {
    return new Date(Date.parse(baseIso) + (offsetSeconds * 1000)).toISOString();
}

function writeCodexSession(filePath, sessionId, messages, options = {}) {
    const baseIso = options.baseIso || '2025-06-01T00:00:00.000Z';
    const cwd = options.cwd || `/tmp/${sessionId}`;
    const records = [];
    records.push({
        type: 'session_meta',
        payload: { id: sessionId, cwd },
        timestamp: baseIso
    });
    let offset = 1;
    for (const message of messages) {
        records.push({
            type: 'response_item',
            payload: {
                type: 'message',
                role: message.role,
                content: message.content
            },
            timestamp: buildIso(baseIso, offset)
        });
        offset += 1;
    }
    fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

async function convertAndAssertListed(api, tmpHome, source, target, params = {}, options = {}) {
    const res = await api('convert-session', { source, target, ...params });
    assert(!res.error, `convert-session ${source}->${target} failed: ${res.error || ''}`);
    assert(res.session && res.session.filePath, `convert-session ${source}->${target} missing session.filePath`);
    const outPath = res.session.filePath;
    assert(fs.existsSync(outPath), `derived ${target} session file missing`);
    assert(fs.existsSync(derivedMetaPath(outPath)), `derived ${target} meta missing`);
    if (target === 'codex') {
        assert(isCodexSessionPath(tmpHome, outPath), 'derived codex session path should stay inside ~/.codex or ~/.config/codex');
    } else if (target === 'claude') {
        assert(isClaudeProjectPath(tmpHome, outPath), 'derived claude session path should stay inside ~/.claude/projects or ~/.config/claude/projects');
    } else {
        assert(
            outPath.startsWith(path.join(tmpHome, '.codexmate', 'sessions', 'derived', target) + path.sep),
            `derived ${target} session path should stay inside ~/.codexmate`
        );
    }
    if (options.assertListed !== false) {
        const list = await api('list-sessions', { source: target, limit: 300, forceRefresh: true });
        assert(Array.isArray(list.sessions), `list-sessions(${target}) missing sessions`);
        assert(list.sessions.some((item) => item && item.filePath === outPath), `derived ${target} session not listed`);
    }
    return { res, outPath };
}

module.exports = async function testSessionConvertDerived(ctx) {
    const {
        api,
        tmpHome,
        sessionId,
        sessionPath,
        daudeSessionPath,
        claudeSessionId,
        claudeSessionPath
    } = ctx;

    const beforeHash = sha256File(sessionPath);

    const { outPath: derivedClaudePath } = await convertAndAssertListed(api, tmpHome, 'codex', 'claude', {
        sessionId,
        maxMessages: 'all'
    });

    const detailClaude = await api('session-detail', { source: 'claude', filePath: derivedClaudePath, maxMessages: 50 });
    assert(Array.isArray(detailClaude.messages), 'session-detail(derived claude) missing messages');
    assert(detailClaude.messages.length === 2, 'session-detail(derived claude) should keep exact short length');
    assert(detailClaude.messages[0].text === 'hello', 'session-detail(derived claude) user text mismatch');
    assert(detailClaude.messages[1].text === 'world', 'session-detail(derived claude) assistant text mismatch');

    const { outPath: derivedCodexPath } = await convertAndAssertListed(api, tmpHome, 'claude', 'codex', {
        filePath: derivedClaudePath,
        maxMessages: 'all'
    });

    const detailCodex = await api('session-detail', { source: 'codex', filePath: derivedCodexPath, maxMessages: 50 });
    assert(Array.isArray(detailCodex.messages), 'session-detail(derived codex) missing messages');
    assert(detailCodex.messages.length === 2, 'session-detail(derived codex) should keep exact short length');
    assert(detailCodex.messages[0].text === 'hello', 'session-detail(derived codex) user text mismatch');
    assert(detailCodex.messages[1].text === 'world', 'session-detail(derived codex) assistant text mismatch');

    const { outPath: derivedClaudePath2 } = await convertAndAssertListed(api, tmpHome, 'codex', 'claude', {
        sessionId,
        maxMessages: 'all'
    });
    assert(derivedClaudePath2 && derivedClaudePath2 !== derivedClaudePath, 'second derived session should create a distinct file');
    assert(fs.existsSync(derivedClaudePath2), 'second derived claude session file missing');

    const afterHash = sha256File(sessionPath);
    assert(afterHash === beforeHash, 'source codex session should remain unchanged after conversions');

    if (daudeSessionPath) {
        const beforeDaudeHash = sha256File(daudeSessionPath);
        const { outPath: daudeDerivedClaudePath } = await convertAndAssertListed(api, tmpHome, 'codex', 'claude', {
            filePath: daudeSessionPath,
            maxMessages: 'all'
        });
        const daudeDetail = await api('session-detail', { source: 'claude', filePath: daudeDerivedClaudePath, maxMessages: 20 });
        const daudeTexts = (daudeDetail.messages || []).map((m) => m.text);
        assert(daudeTexts.length === 2, 'daude derived claude session should keep message count');
        assert(daudeTexts[0] === 'daude code quick start 222', 'daude derived claude user text mismatch');
        assert(daudeTexts[1] === 'sharing daude-code bootstrap', 'daude derived claude assistant text mismatch');
        assert(sha256File(daudeSessionPath) === beforeDaudeHash, 'daude source session should remain unchanged after conversion');
    }

    if (claudeSessionId && claudeSessionPath) {
        const beforeClaudeHash = sha256File(claudeSessionPath);
        const { outPath: claudeDerivedCodexPath } = await convertAndAssertListed(api, tmpHome, 'claude', 'codex', {
            sessionId: claudeSessionId,
            maxMessages: 'all'
        });
        const detail = await api('session-detail', { source: 'codex', filePath: claudeDerivedCodexPath, maxMessages: 50 });
        const texts = (detail.messages || []).map((m) => m.text);
        assert(texts.length === 2, 'claude derived codex session should keep message count');
        assert(texts[0] === 'hello from claude code session', 'claude derived codex user text mismatch');
        assert(texts[1] === 'initialized project', 'claude derived codex assistant text mismatch');
        assert(sha256File(claudeSessionPath) === beforeClaudeHash, 'claude source session should remain unchanged after conversion');
    }

    const invalidSame = await api('convert-session', { source: 'codex', target: 'codex', sessionId, maxMessages: 'all' });
    assert(invalidSame.error, 'convert-session should reject same source/target');
    const invalidTarget = await api('convert-session', { source: 'codex', target: 'gemini', sessionId, maxMessages: 'all' });
    assert(invalidTarget.error, 'convert-session should reject invalid target');

    const sessionsDir = path.join(tmpHome, '.codex', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    {
        const systemLeadingId = 'e2e-convert-system-leading';
        const systemLeadingPath = path.join(sessionsDir, `${systemLeadingId}.jsonl`);
        writeCodexSession(systemLeadingPath, systemLeadingId, [
            { role: 'system', content: 'SYS-LEADING' },
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'world' }
        ]);
        const before = sha256File(systemLeadingPath);
        const { outPath } = await convertAndAssertListed(api, tmpHome, 'codex', 'claude', { filePath: systemLeadingPath, maxMessages: 'all' }, { assertListed: false });
        const detail = await api('session-detail', { source: 'claude', filePath: outPath, maxMessages: 10 });
        const texts = (detail.messages || []).map((m) => m.text);
        assert(texts.length === 2, 'leading system message should be dropped during conversion');
        assert(texts[0] === 'hello' && texts[1] === 'world', 'leading system drop should preserve conversation ordering');
        assert(sha256File(systemLeadingPath) === before, 'system-leading source should remain unchanged');
    }

    {
        const systemMiddleId = 'e2e-convert-system-middle';
        const systemMiddlePath = path.join(sessionsDir, `${systemMiddleId}.jsonl`);
        writeCodexSession(systemMiddlePath, systemMiddleId, [
            { role: 'user', content: 'u' },
            { role: 'system', content: 'SYS-MIDDLE' },
            { role: 'assistant', content: 'a' }
        ]);
        const { outPath } = await convertAndAssertListed(api, tmpHome, 'codex', 'claude', { filePath: systemMiddlePath, maxMessages: 'all' }, { assertListed: false });
        const detail = await api('session-detail', { source: 'claude', filePath: outPath, maxMessages: 10 });
        const texts = (detail.messages || []).map((m) => m.text);
        assert(texts.join('|') === 'u|SYS-MIDDLE|a', 'middle system message should be preserved during conversion');
    }

    {
        const unicodeId = 'e2e-convert-unicode';
        const unicodePath = path.join(sessionsDir, `${unicodeId}.jsonl`);
        writeCodexSession(unicodePath, unicodeId, [
            { role: 'user', content: '中文🚀\r\nline2' },
            { role: 'assistant', content: 'ok' }
        ]);
        const { outPath } = await convertAndAssertListed(api, tmpHome, 'codex', 'claude', { filePath: unicodePath, maxMessages: 'all' }, { assertListed: false });
        const detail = await api('session-detail', { source: 'claude', filePath: outPath, maxMessages: 10 });
        assert((detail.messages || [])[0] && String(detail.messages[0].text || '').includes('中文'), 'unicode text should survive conversion');
        assert(String(detail.messages[0].text || '').includes('line2'), 'CRLF payload should survive conversion');
    }

    {
        const truncId = 'e2e-convert-truncate';
        const truncPath = path.join(sessionsDir, `${truncId}.jsonl`);
        writeCodexSession(truncPath, truncId, [
            { role: 'user', content: 'm1' },
            { role: 'assistant', content: 'm2' },
            { role: 'user', content: 'm3' },
            { role: 'assistant', content: 'm4' },
            { role: 'user', content: 'm5' }
        ]);
        const { res, outPath } = await convertAndAssertListed(api, tmpHome, 'codex', 'claude', { filePath: truncPath, maxMessages: 2 }, { assertListed: false });
        assert(res.truncated === true, 'convert-session should expose truncated flag when maxMessages is smaller than message count');
        const detail = await api('session-detail', { source: 'claude', filePath: outPath, maxMessages: 10 });
        const texts = (detail.messages || []).map((m) => m.text);
        assert(texts.join('|') === 'm1|m2', 'conversion should keep first N messages when truncated');
    }

    {
        const hugeId = 'e2e-convert-huge-line';
        const hugePath = path.join(sessionsDir, `${hugeId}.jsonl`);
        writeCodexSession(hugePath, hugeId, [
            { role: 'user', content: 'x'.repeat(20000) },
            { role: 'assistant', content: 'done' }
        ]);
        const { outPath } = await convertAndAssertListed(api, tmpHome, 'codex', 'claude', { filePath: hugePath, maxMessages: 'all' }, { assertListed: false });
        const detail = await api('session-detail', { source: 'claude', filePath: outPath, maxMessages: 10 });
        assert((detail.messages || []).length === 2, 'huge message conversion should keep message count');
        const firstText = String(detail.messages[0] && detail.messages[0].text ? detail.messages[0].text : '');
        assert(firstText.startsWith('x'), 'huge message should keep prefix');
        assert(firstText.length <= 20000, 'huge message text should not exceed the original payload');
    }
};
