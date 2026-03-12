const path = require('path');
const { assert } = require('./helpers');

module.exports = async function testSessions(ctx) {
    const { api, sessionId, tmpHome } = ctx;

    const apiSessions = await api('list-sessions', { source: 'codex', limit: 50, forceRefresh: true });
    assert(Array.isArray(apiSessions.sessions), 'api sessions missing');
    assert(apiSessions.sessions.some(item => item.sessionId === sessionId), 'api sessions missing codex entry');

    const apiSessionsAll = await api('list-sessions', { source: 'all', limit: 50, forceRefresh: true });
    assert(Array.isArray(apiSessionsAll.sessions), 'api sessions(all) missing');
    assert(apiSessionsAll.sessions.some(item => item.sessionId === sessionId), 'api sessions(all) missing codex entry');

    const sessionDetail = await api('session-detail', { source: 'codex', sessionId });
    assert(Array.isArray(sessionDetail.messages), 'session-detail missing messages');

    const sessionPlain = await api('session-plain', { source: 'codex', sessionId });
    assert(sessionPlain.text && sessionPlain.text.includes('world'), 'session-plain missing content');

    const sessionPlainMissing = await api('session-plain', { source: 'codex', sessionId: 'missing-session' });
    assert(sessionPlainMissing.error, 'session-plain should fail for missing session');

    const exportSession = await api('export-session', { source: 'codex', sessionId, maxMessages: 1 });
    assert(exportSession.content, 'export-session missing content');
    assert(exportSession.truncated === true, 'export-session should be truncated with maxMessages');

    const cloneResult = await api('clone-session', { source: 'codex', sessionId });
    assert(cloneResult.success === true, 'clone-session failed');
    assert(cloneResult.sessionId && cloneResult.sessionId !== sessionId, 'clone-session id invalid');
    assert(cloneResult.filePath && cloneResult.filePath.endsWith('.jsonl'), 'clone-session file path invalid');
    assert(cloneResult.filePath && require('fs').existsSync(cloneResult.filePath), 'clone-session file missing');
    const cloneSessionId = cloneResult.sessionId;

    const cloneInvalid = await api('clone-session', { source: 'claude', sessionId });
    assert(cloneInvalid.error, 'clone-session should reject non-codex source');

    const apiSessionsAfterClone = await api('list-sessions', { source: 'codex', limit: 50, forceRefresh: true });
    assert(Array.isArray(apiSessionsAfterClone.sessions), 'api sessions after clone missing');
    assert(
        apiSessionsAfterClone.sessions[0]
        && apiSessionsAfterClone.sessions[0].sessionId === cloneSessionId,
        'clone session not latest'
    );

    const deleteResult = await api('delete-session', { source: 'codex', sessionId });
    assert(deleteResult.success === true, 'delete-session failed');

    const deleteMissing = await api('delete-session', { source: 'codex', sessionId });
    assert(deleteMissing.error, 'delete-session should fail for missing session');

    const detailMissing = await api('session-detail', { source: 'codex', sessionId });
    assert(detailMissing.error, 'session-detail should fail after delete');

    const apiSessionsAfterDelete = await api('list-sessions', { source: 'codex', limit: 50, forceRefresh: true });
    assert(!apiSessionsAfterDelete.sessions.some(item => item.sessionId === sessionId), 'deleted session still listed');
    assert(apiSessionsAfterDelete.sessions.some(item => item.sessionId === cloneSessionId), 'clone session missing after delete');

    Object.assign(ctx, { cloneSessionId });
};
