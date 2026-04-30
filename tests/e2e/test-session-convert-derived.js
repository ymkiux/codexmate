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

module.exports = async function testSessionConvertDerived(ctx) {
    const { api, tmpHome, sessionId, sessionPath } = ctx;

    const beforeHash = sha256File(sessionPath);

    const resCodexToClaude = await api('convert-session', {
        source: 'codex',
        target: 'claude',
        sessionId,
        maxMessages: 'all'
    });
    assert(!resCodexToClaude.error, `convert-session codex->claude failed: ${resCodexToClaude.error || ''}`);
    assert(resCodexToClaude.session && resCodexToClaude.session.filePath, 'convert-session codex->claude missing session.filePath');
    const derivedClaudePath = resCodexToClaude.session.filePath;
    assert(fs.existsSync(derivedClaudePath), 'derived claude session file missing');
    assert(fs.existsSync(derivedMetaPath(derivedClaudePath)), 'derived claude meta missing');
    assert(
        derivedClaudePath.startsWith(path.join(tmpHome, '.codexmate', 'sessions', 'derived', 'claude') + path.sep),
        'derived claude session path should stay inside ~/.codexmate'
    );

    const listClaude = await api('list-sessions', { source: 'claude', limit: 200, forceRefresh: true });
    assert(Array.isArray(listClaude.sessions), 'list-sessions(claude) missing sessions');
    assert(listClaude.sessions.some((item) => item && item.filePath === derivedClaudePath), 'derived claude session not listed');

    const detailClaude = await api('session-detail', { source: 'claude', filePath: derivedClaudePath, maxMessages: 50 });
    assert(Array.isArray(detailClaude.messages), 'session-detail(derived claude) missing messages');
    assert(detailClaude.messages.length === 2, 'session-detail(derived claude) should keep exact short length');
    assert(detailClaude.messages[0].text === 'hello', 'session-detail(derived claude) user text mismatch');
    assert(detailClaude.messages[1].text === 'world', 'session-detail(derived claude) assistant text mismatch');

    const resClaudeToCodex = await api('convert-session', {
        source: 'claude',
        target: 'codex',
        filePath: derivedClaudePath,
        maxMessages: 'all'
    });
    assert(!resClaudeToCodex.error, `convert-session claude->codex failed: ${resClaudeToCodex.error || ''}`);
    assert(resClaudeToCodex.session && resClaudeToCodex.session.filePath, 'convert-session claude->codex missing session.filePath');
    const derivedCodexPath = resClaudeToCodex.session.filePath;
    assert(fs.existsSync(derivedCodexPath), 'derived codex session file missing');
    assert(fs.existsSync(derivedMetaPath(derivedCodexPath)), 'derived codex meta missing');
    assert(
        derivedCodexPath.startsWith(path.join(tmpHome, '.codexmate', 'sessions', 'derived', 'codex') + path.sep),
        'derived codex session path should stay inside ~/.codexmate'
    );

    const listCodex = await api('list-sessions', { source: 'codex', limit: 200, forceRefresh: true });
    assert(Array.isArray(listCodex.sessions), 'list-sessions(codex) missing sessions');
    assert(listCodex.sessions.some((item) => item && item.filePath === derivedCodexPath), 'derived codex session not listed');

    const detailCodex = await api('session-detail', { source: 'codex', filePath: derivedCodexPath, maxMessages: 50 });
    assert(Array.isArray(detailCodex.messages), 'session-detail(derived codex) missing messages');
    assert(detailCodex.messages.length === 2, 'session-detail(derived codex) should keep exact short length');
    assert(detailCodex.messages[0].text === 'hello', 'session-detail(derived codex) user text mismatch');
    assert(detailCodex.messages[1].text === 'world', 'session-detail(derived codex) assistant text mismatch');

    const resCodexToClaude2 = await api('convert-session', {
        source: 'codex',
        target: 'claude',
        sessionId,
        maxMessages: 'all'
    });
    assert(!resCodexToClaude2.error, `convert-session codex->claude #2 failed: ${resCodexToClaude2.error || ''}`);
    const derivedClaudePath2 = resCodexToClaude2.session && resCodexToClaude2.session.filePath ? resCodexToClaude2.session.filePath : '';
    assert(derivedClaudePath2 && derivedClaudePath2 !== derivedClaudePath, 'second derived session should create a distinct file');
    assert(fs.existsSync(derivedClaudePath2), 'second derived claude session file missing');

    const afterHash = sha256File(sessionPath);
    assert(afterHash === beforeHash, 'source codex session should remain unchanged after conversions');
};
