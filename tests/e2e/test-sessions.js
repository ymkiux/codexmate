const path = require('path');
const { assert } = require('./helpers');

module.exports = async function testSessions(ctx) {
    const { api, sessionId, tmpHome, claudeSessionId } = ctx;

    // ========== List Sessions Tests - Codex ==========
    const apiSessions = await api('list-sessions', { source: 'codex', limit: 50, forceRefresh: true });
    assert(Array.isArray(apiSessions.sessions), 'api sessions missing');
    assert(apiSessions.sessions.some(item => item.sessionId === sessionId), 'api sessions missing codex entry');
    assert(typeof apiSessions.source === 'string', 'list-sessions missing source');

    // ========== List Sessions Tests - Claude ==========
    const apiSessionsClaude = await api('list-sessions', { source: 'claude', limit: 50, forceRefresh: true });
    assert(Array.isArray(apiSessionsClaude.sessions), 'api sessions(claude) missing');
    assert(apiSessionsClaude.sessions.some(item => item.sessionId === claudeSessionId), 'api sessions(claude) missing claude entry');

    // ========== List Sessions Tests - All Sources ==========
    const apiSessionsAll = await api('list-sessions', { source: 'all', limit: 50, forceRefresh: true });
    assert(Array.isArray(apiSessionsAll.sessions), 'api sessions(all) missing');
    assert(apiSessionsAll.sessions.some(item => item.sessionId === sessionId), 'api sessions(all) missing codex entry');
    assert(apiSessionsAll.sessions.some(item => item.sessionId === claudeSessionId), 'api sessions(all) missing claude entry');

    // ========== List Sessions Tests - Invalid Source ==========
    const apiSessionsInvalid = await api('list-sessions', { source: 'invalid', limit: 50 });
    assert(apiSessionsInvalid.error, 'list-sessions should fail for invalid source');

    // ========== List Sessions Tests - Query ==========
    const claudeCodeQuery = await api('list-sessions', { source: 'claude', query: 'claude code', limit: 50, forceRefresh: true });
    assert(Array.isArray(claudeCodeQuery.sessions), 'claude code query missing sessions');
    const claudeCodeHit = claudeCodeQuery.sessions.find(item => item.sessionId === claudeSessionId);
    assert(claudeCodeHit, 'claude code query missing Claude session');
    assert(claudeCodeHit.provider === 'claude', 'claude code query provider mismatch');
    assert(claudeCodeHit.capabilities && claudeCodeHit.capabilities.code === true, 'claude code query missing code capability');
    assert(Array.isArray(claudeCodeHit.keywords) && claudeCodeHit.keywords.includes('claude_code'), 'claude code query missing keyword');

    // ========== Session Detail Tests ==========
    const sessionDetail = await api('session-detail', { source: 'codex', sessionId });
    assert(Array.isArray(sessionDetail.messages), 'session-detail missing messages');
    assert(sessionDetail.messages.length > 0, 'session-detail messages empty');
    assert(typeof sessionDetail.source === 'string', 'session-detail missing source');

    const sessionDetailClaude = await api('session-detail', { source: 'claude', sessionId: claudeSessionId });
    assert(Array.isArray(sessionDetailClaude.messages), 'session-detail(claude) missing messages');

    const sessionDetailMissing = await api('session-detail', { source: 'codex', sessionId: 'missing-session' });
    assert(sessionDetailMissing.error, 'session-detail should fail for missing session');

    const sessionDetailInvalidSource = await api('session-detail', { source: 'invalid', sessionId });
    assert(sessionDetailInvalidSource.error, 'session-detail should fail for invalid source');

    // ========== Session Plain Tests ==========
    const sessionPlain = await api('session-plain', { source: 'codex', sessionId });
    assert(sessionPlain.text && sessionPlain.text.includes('world'), 'session-plain missing content');
    assert(typeof sessionPlain.text === 'string', 'session-plain text missing');

    const sessionPlainMissing = await api('session-plain', { source: 'codex', sessionId: 'missing-session' });
    assert(sessionPlainMissing.error, 'session-plain should fail for missing session');

    const sessionPlainInvalidSource = await api('session-plain', { source: 'invalid', sessionId });
    assert(sessionPlainInvalidSource.error, 'session-plain should fail for invalid source');

    // ========== Export Session Tests ==========
    const exportSession = await api('export-session', { source: 'codex', sessionId, maxMessages: 1 });
    assert(exportSession.content, 'export-session missing content');
    assert(exportSession.truncated === true, 'export-session should be truncated with maxMessages');
    assert(typeof exportSession.content === 'string', 'export-session content not string');

    const exportSessionFull = await api('export-session', { source: 'codex', sessionId, maxMessages: 100 });
    assert(exportSessionFull.content, 'export-session(full) missing content');
    assert(exportSessionFull.truncated === false, 'export-session(full) should not be truncated');

    const exportSessionMissing = await api('export-session', { source: 'codex', sessionId: 'missing', maxMessages: 10 });
    assert(exportSessionMissing.error, 'export-session should fail for missing session');

    const exportSessionInvalidSource = await api('export-session', { source: 'invalid', sessionId, maxMessages: 10 });
    assert(exportSessionInvalidSource.error, 'export-session should fail for invalid source');

    // ========== Clone Session Tests ==========
    const cloneResult = await api('clone-session', { source: 'codex', sessionId });
    assert(cloneResult.success === true, 'clone-session failed');
    assert(cloneResult.sessionId && cloneResult.sessionId !== sessionId, 'clone-session id invalid');
    assert(cloneResult.filePath && cloneResult.filePath.endsWith('.jsonl'), 'clone-session file path invalid');
    assert(cloneResult.filePath && require('fs').existsSync(cloneResult.filePath), 'clone-session file missing');
    const cloneSessionId = cloneResult.sessionId;

    const cloneInvalid = await api('clone-session', { source: 'claude', sessionId });
    assert(cloneInvalid.error, 'clone-session should reject non-codex source');

    const cloneMissing = await api('clone-session', { source: 'codex', sessionId: 'missing-session' });
    assert(cloneMissing.error, 'clone-session should fail for missing session');

    const apiSessionsAfterClone = await api('list-sessions', { source: 'codex', limit: 50, forceRefresh: true });
    assert(Array.isArray(apiSessionsAfterClone.sessions), 'api sessions after clone missing');
    assert(
        apiSessionsAfterClone.sessions[0]
        && apiSessionsAfterClone.sessions[0].sessionId === cloneSessionId,
        'clone session not latest'
    );

    // ========== Delete Session Tests ==========
    const deleteResult = await api('delete-session', { source: 'codex', sessionId });
    assert(deleteResult.success === true, 'delete-session failed');

    const deleteMissing = await api('delete-session', { source: 'codex', sessionId });
    assert(deleteMissing.error, 'delete-session should fail for missing session');

    const deleteInvalidSource = await api('delete-session', { source: 'invalid', sessionId });
    assert(deleteInvalidSource.error, 'delete-session should fail for invalid source');

    const detailMissing = await api('session-detail', { source: 'codex', sessionId });
    assert(detailMissing.error, 'session-detail should fail after delete');

    const apiSessionsAfterDelete = await api('list-sessions', { source: 'codex', limit: 50, forceRefresh: true });
    assert(!apiSessionsAfterDelete.sessions.some(item => item.sessionId === sessionId), 'deleted session still listed');
    assert(apiSessionsAfterDelete.sessions.some(item => item.sessionId === cloneSessionId), 'clone session missing after delete');

    // ========== Session Paths Tests ==========
    const pathsCodex = await api('list-session-paths', { source: 'codex', limit: 100, forceRefresh: true });
    assert(Array.isArray(pathsCodex.paths), 'list-session-paths(codex) missing');

    const pathsClaude = await api('list-session-paths', { source: 'claude', limit: 100, forceRefresh: true });
    assert(Array.isArray(pathsClaude.paths), 'list-session-paths(claude) missing');

    const pathsAll = await api('list-session-paths', { source: 'all', limit: 100, forceRefresh: true });
    assert(Array.isArray(pathsAll.paths), 'list-session-paths(all) missing');

    const pathsInvalid = await api('list-session-paths', { source: 'invalid', limit: 100 });
    assert(pathsInvalid.error, 'list-session-paths should fail for invalid source');

    const pathsZeroLimit = await api('list-session-paths', { source: 'codex', limit: 0, forceRefresh: true });
    assert(Array.isArray(pathsZeroLimit.paths), 'list-session-paths(zero limit) should return array');

    Object.assign(ctx, { cloneSessionId });
};
