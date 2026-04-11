const path = require('path');
const fs = require('fs');
const { assert } = require('./helpers');

module.exports = async function testSessions(ctx) {
    const { api, sessionId, tmpHome, claudeSessionId, sessionPath, claudeSessionPath } = ctx;
    const buildTimestamp = (baseIso, offsetSeconds) => new Date(Date.parse(baseIso) + (offsetSeconds * 1000)).toISOString();
    const bestEffortApi = async (action, params) => {
        try {
            return await api(action, params);
        } catch (e) {
            return { error: e && e.message ? e.message : String(e) };
        }
    };

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

    // ========== Usage Session Summary Tests ==========
    const usageSessions = await api('list-sessions-usage', { source: 'all', limit: 50, forceRefresh: true });
    assert(Array.isArray(usageSessions.sessions), 'list-sessions-usage missing sessions');
    assert(usageSessions.sessions.some((item) => item.sessionId === sessionId), 'list-sessions-usage missing codex entry');
    assert(usageSessions.sessions.some((item) => item.sessionId === claudeSessionId), 'list-sessions-usage missing claude entry');
    assert(usageSessions.sessions.every((item) => !Object.prototype.hasOwnProperty.call(item, '__messageCountExact')), 'list-sessions-usage should not expose exact hydration markers');
    const defaultUsageSessions = await api('list-sessions-usage');
    assert(Array.isArray(defaultUsageSessions.sessions), 'list-sessions-usage without params should still return sessions');
    assert(defaultUsageSessions.source === 'all', 'list-sessions-usage without params should default source to all');

    const usageSessionsInvalid = await api('list-sessions-usage', { source: 'invalid', limit: 50 });
    assert(usageSessionsInvalid.error, 'list-sessions-usage should fail for invalid source');

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
    assert(sessionDetail.totalMessages === 2, 'session-detail should keep exact totalMessages for short codex session');
    assert(sessionDetail.messages.length === 2, 'session-detail should not duplicate short codex session messages');
    assert(sessionDetail.messages[0].messageIndex === 0, 'session-detail should start short codex session indexes at zero');
    assert(sessionDetail.messages[1].messageIndex === 1, 'session-detail should keep sequential indexes for short codex session');

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
    let cloneResult = null;
    let cloneSessionId = '';
    const syntheticTrashIds = new Set();
    let deleteResult = null;
    let deleteCloneResult = null;
    let deleteClaudeResult = null;
    let deleteIndexlessClaudeResult = null;
    let deleteLongResult = null;
    let staleTrashFilePath = '';
    const claudeIndexPath = path.join(path.dirname(claudeSessionPath), 'sessions-index.json');
    const indexlessClaudeSessionId = 'claude-indexless-trash-count-e2e';
    const indexlessClaudeSessionPath = path.join(path.dirname(claudeSessionPath), `${indexlessClaudeSessionId}.jsonl`);
    const longSessionId = 'codex-long-trash-count-e2e';
    const longSessionPath = path.join(tmpHome, '.codex', 'sessions', `${longSessionId}.jsonl`);
    const longMessageCount = 1205;
    const hugeLineSessionId = 'codex-huge-line-preview-e2e';
    const hugeLineSessionPath = path.join(tmpHome, '.codex', 'sessions', `${hugeLineSessionId}.jsonl`);
    const trashRoot = path.join(tmpHome, '.codex', 'codexmate-session-trash');
    const trashFilesDir = path.join(trashRoot, 'files');
    const trashIndexPath = path.join(trashRoot, 'index.json');
    try {
        cloneResult = await api('clone-session', { source: 'codex', sessionId });
        assert(cloneResult.success === true, 'clone-session failed');
        assert(cloneResult.sessionId && cloneResult.sessionId !== sessionId, 'clone-session id invalid');
        assert(cloneResult.filePath && cloneResult.filePath.endsWith('.jsonl'), 'clone-session file path invalid');
        assert(cloneResult.filePath && require('fs').existsSync(cloneResult.filePath), 'clone-session file missing');
        cloneSessionId = cloneResult.sessionId;

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

        const hardDeleteSessionId = 'codex-hard-delete-e2e';
        const hardDeleteSessionPath = path.join(tmpHome, '.codex', 'sessions', `${hardDeleteSessionId}.jsonl`);
        fs.writeFileSync(hardDeleteSessionPath, [
            JSON.stringify({
                type: 'session_meta',
                payload: { id: hardDeleteSessionId, cwd: '/tmp/hard-delete' },
                timestamp: '2025-03-01T00:00:00.000Z'
            }),
            JSON.stringify({
                type: 'response_item',
                payload: { type: 'message', role: 'user', content: 'hard delete me' },
                timestamp: '2025-03-01T00:00:01.000Z'
            })
        ].join('\n') + '\n', 'utf-8');
        const hardDeleteResult = await api('delete-session', { source: 'codex', sessionId: hardDeleteSessionId });
        assert(hardDeleteResult.success === true, 'delete-session should keep permanent delete semantics');
        assert(hardDeleteResult.deleted === true, 'delete-session should report permanent deletion');
        assert(!fs.existsSync(hardDeleteSessionPath), 'hard-deleted codex session should be removed from disk');
        const trashAfterHardDelete = await api('list-session-trash', { limit: 20 });
        assert(!trashAfterHardDelete.items.some(item => item.sessionId === hardDeleteSessionId), 'delete-session should not add permanently deleted sessions into trash');

        // ========== Trash Session Tests ==========
        deleteResult = await api('trash-session', { source: 'codex', sessionId });
        assert(deleteResult.success === true, 'trash-session failed');
        assert(deleteResult.trashed === true, 'trash-session should move session into trash');
        assert(typeof deleteResult.trashId === 'string' && deleteResult.trashId, 'trash-session missing trashId');
        assert(deleteResult.messageCount === 2, 'trash-session should return codex trash messageCount');
        assert(!fs.existsSync(sessionPath), 'deleted codex session should be moved away from original path');

        const deleteMissing = await api('trash-session', { source: 'codex', sessionId });
        assert(deleteMissing.error, 'trash-session should fail for missing session');

        const deleteInvalidSource = await api('trash-session', { source: 'invalid', sessionId });
        assert(deleteInvalidSource.error, 'trash-session should fail for invalid source');

        const detailMissing = await api('session-detail', { source: 'codex', sessionId });
        assert(detailMissing.error, 'session-detail should fail after delete');

        const trashAfterDelete = await api('list-session-trash', { limit: 100 });
        assert(Array.isArray(trashAfterDelete.items), 'list-session-trash should return items');
        assert(trashAfterDelete.totalCount === trashAfterDelete.items.length, 'list-session-trash totalCount should match visible count when under limit');
        const trashCountOnly = await api('list-session-trash', { countOnly: true });
        assert(trashCountOnly.totalCount === trashAfterDelete.totalCount, 'list-session-trash countOnly should keep exact totalCount');
        assert(Array.isArray(trashCountOnly.items) && trashCountOnly.items.length === 0, 'list-session-trash countOnly should skip item hydration');
        const deletedCodexTrashItem = trashAfterDelete.items.find(item => item.trashId === deleteResult.trashId);
        assert(deletedCodexTrashItem, 'deleted codex session missing in trash');
        assert(deletedCodexTrashItem.sessionId === sessionId, 'deleted codex session trash entry mismatch');
        assert(deletedCodexTrashItem.messageCount === deleteResult.messageCount, 'trash-session codex messageCount should match trash item');

        const restoreResult = await api('restore-session-trash', { trashId: deleteResult.trashId });
        assert(restoreResult.success === true, 'restore-session-trash failed for codex session');
        assert(fs.existsSync(sessionPath), 'restored codex session should return to original path');

        const restoredDetail = await api('session-detail', { source: 'codex', sessionId });
        assert(Array.isArray(restoredDetail.messages) && restoredDetail.messages.length > 0, 'restored codex session detail missing');

        const trashAfterRestore = await api('list-session-trash', { limit: 100 });
        assert(!trashAfterRestore.items.some(item => item.trashId === deleteResult.trashId), 'restored codex session should leave trash');

        deleteCloneResult = await api('trash-session', { source: 'codex', sessionId: cloneSessionId });
        assert(deleteCloneResult.success === true, 'trash-session should trash cloned session');
        assert(typeof deleteCloneResult.trashId === 'string' && deleteCloneResult.trashId, 'trash-session missing clone trashId');

        const purgeCloneResult = await api('purge-session-trash', { trashId: deleteCloneResult.trashId });
        assert(purgeCloneResult.success === true, 'purge-session-trash failed');
        assert(purgeCloneResult.count === 1, 'purge-session-trash should remove one entry');

        const cloneDetailMissing = await api('session-detail', { source: 'codex', sessionId: cloneSessionId });
        assert(cloneDetailMissing.error, 'purged clone session should stay deleted');

        deleteClaudeResult = await api('trash-session', { source: 'claude', sessionId: claudeSessionId });
        assert(deleteClaudeResult.success === true, 'trash-session should trash Claude session');
        assert(deleteClaudeResult.trashed === true, 'trash-session should move Claude session into trash');
        assert(typeof deleteClaudeResult.trashId === 'string' && deleteClaudeResult.trashId, 'trash-session missing Claude trashId');
        assert(deleteClaudeResult.messageCount === 2, 'trash-session should return Claude trash messageCount');
        assert(!fs.existsSync(claudeSessionPath), 'deleted Claude session should be moved away from original path');

        const claudeDetailMissing = await api('session-detail', { source: 'claude', sessionId: claudeSessionId });
        assert(claudeDetailMissing.error, 'session-detail should fail after Claude delete');

        const trashAfterClaudeDelete = await api('list-session-trash', { limit: 100 });
        assert(trashAfterClaudeDelete.totalCount === trashAfterClaudeDelete.items.length, 'list-session-trash totalCount should stay exact before overflow');
        const deletedClaudeTrashItem = trashAfterClaudeDelete.items.find(item => item.trashId === deleteClaudeResult.trashId);
        assert(deletedClaudeTrashItem, 'deleted Claude session missing in trash');
        assert(deletedClaudeTrashItem.source === 'claude', 'deleted Claude session trash source mismatch');
        assert(deletedClaudeTrashItem.messageCount === deleteClaudeResult.messageCount, 'trash-session Claude messageCount should match trash item');

        const indexlessClaudeMessageCount = 1205;
        const indexlessClaudeRecords = [];
        for (let i = 0; i < indexlessClaudeMessageCount; i += 1) {
            indexlessClaudeRecords.push({
                type: i % 2 === 0 ? 'user' : 'assistant',
                message: { content: `claude-indexless-trash-count-${i}-` + 'z'.repeat(256) },
                timestamp: buildTimestamp('2025-03-06T00:00:00.000Z', i)
            });
        }
        fs.writeFileSync(indexlessClaudeSessionPath, indexlessClaudeRecords.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf-8');

        deleteIndexlessClaudeResult = await api('trash-session', {
            source: 'claude',
            sessionId: indexlessClaudeSessionId,
            filePath: indexlessClaudeSessionPath
        });
        assert(deleteIndexlessClaudeResult.success === true, 'trash-session should trash Claude session even when index entry is missing');
        assert(deleteIndexlessClaudeResult.messageCount === indexlessClaudeMessageCount, 'trash-session should keep exact messageCount for indexless Claude session');

        const restoreIndexlessClaudeResult = await api('restore-session-trash', { trashId: deleteIndexlessClaudeResult.trashId });
        assert(restoreIndexlessClaudeResult.success === true, 'restore-session-trash should restore indexless Claude session');
        assert(fs.existsSync(indexlessClaudeSessionPath), 'restored indexless Claude session should return to original path');

        const restoredClaudeIndex = JSON.parse(fs.readFileSync(claudeIndexPath, 'utf-8'));
        const restoredIndexlessClaudeEntry = restoredClaudeIndex.entries.find(item => item.sessionId === indexlessClaudeSessionId);
        assert(restoredIndexlessClaudeEntry, 'restore-session-trash should recreate missing Claude index entry');
        assert(
            restoredIndexlessClaudeEntry.messageCount === indexlessClaudeMessageCount + 1,
            'restore-session-trash should rebuild Claude index messageCount using stored-count semantics'
        );

        const restoredIndexlessClaudeSessions = await api('list-sessions', { source: 'claude', limit: 200, forceRefresh: true });
        const restoredIndexlessClaudeItem = restoredIndexlessClaudeSessions.sessions.find(item => item.sessionId === indexlessClaudeSessionId);
        assert(restoredIndexlessClaudeItem, 'restored indexless Claude session should be listed again');
        assert(Number.isFinite(restoredIndexlessClaudeItem.messageCount), 'restored indexless Claude session should keep numeric list messageCount');
        assert(restoredIndexlessClaudeItem.messageCount >= 0, 'restored indexless Claude session should keep non-negative list messageCount');

        const longSessionRecords = [{
            type: 'session_meta',
            payload: { id: longSessionId, cwd: '/tmp/long-trash-count' },
            timestamp: '2025-03-01T00:00:00.000Z'
        }];
        for (let i = 0; i < longMessageCount; i += 1) {
            longSessionRecords.push({
                type: 'response_item',
                payload: {
                    type: 'message',
                    role: i % 2 === 0 ? 'user' : 'assistant',
                    content: `long-trash-count-${i}-` + 'x'.repeat(256)
                },
                timestamp: buildTimestamp('2025-03-01T00:00:01.000Z', i)
            });
        }
        fs.writeFileSync(longSessionPath, longSessionRecords.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf-8');

        const longSessionsBeforeDelete = await api('list-sessions', { source: 'codex', limit: 200, forceRefresh: true });
        const longSessionListItem = longSessionsBeforeDelete.sessions.find(item => item.sessionId === longSessionId);
        assert(longSessionListItem, 'long codex session should appear in list-sessions');
        assert(Number.isFinite(longSessionListItem.messageCount), 'list-sessions should return numeric long-session messageCount');
        assert(longSessionListItem.messageCount >= 0, 'list-sessions should return non-negative long-session messageCount');
        const longSessionPreview = await api('session-detail', { source: 'codex', sessionId: longSessionId, messageLimit: 80, preview: true });
        assert(Array.isArray(longSessionPreview.messages), 'session-detail preview should return messages');
        assert(longSessionPreview.messages.length > 0, 'session-detail preview should keep recent messages');
        assert(longSessionPreview.messages.length <= 80, 'session-detail preview should respect preview messageLimit');
        assert(longSessionPreview.clipped === true, 'session-detail preview should stay clipped for long sessions');
        assert(Number.isFinite(longSessionPreview.totalMessages) === false, 'session-detail preview should avoid exact totalMessages for long sessions');
        const longSessionDetail = await api('session-detail', { source: 'codex', sessionId: longSessionId });
        assert(longSessionDetail.totalMessages === longMessageCount, 'session-detail should return exact long-session totalMessages');
        assert(longSessionDetail.messageLimit === 300, 'session-detail should keep default detail window size');
        assert(longSessionDetail.messages.length === 300, 'session-detail should keep only the latest default window');
        assert(longSessionDetail.clipped === true, 'session-detail should mark long session as clipped');
        assert(longSessionDetail.messages[0].messageIndex === longMessageCount - longSessionDetail.messages.length, 'session-detail should keep the latest message indexes');
        assert(longSessionDetail.messages[longSessionDetail.messages.length - 1].messageIndex === longMessageCount - 1, 'session-detail should keep the latest tail message index');

        const hugeLineRecords = [{
            type: 'session_meta',
            payload: { id: hugeLineSessionId, cwd: '/tmp/huge-line-preview' },
            timestamp: '2025-03-01T00:00:00.000Z'
        }];
        for (let i = 0; i < 3; i += 1) {
            hugeLineRecords.push({
                type: 'response_item',
                payload: {
                    type: 'message',
                    role: i % 2 === 0 ? 'user' : 'assistant',
                    content: `huge-line-preview-${i}-` + 'q'.repeat(1300000)
                },
                timestamp: buildTimestamp('2025-03-07T00:00:00.000Z', i)
            });
        }
        fs.writeFileSync(hugeLineSessionPath, hugeLineRecords.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf-8');

        const hugeLinePreview = await api('session-detail', {
            source: 'codex',
            sessionId: hugeLineSessionId,
            messageLimit: 80,
            preview: true
        });
        assert(Array.isArray(hugeLinePreview.messages), 'session-detail preview should return messages for huge-line sessions');
        assert(hugeLinePreview.messages.length > 0, 'session-detail preview should fall back when huge lines exceed the fast tail window');
        assert(hugeLinePreview.messages.length <= 3, 'session-detail preview should not duplicate huge-line messages');
        assert(hugeLinePreview.clipped === false, 'session-detail preview should report unclipped when fallback can read the whole huge-line session');
        assert(
            hugeLinePreview.messages.every((message) => typeof message.text === 'string' && message.text.length <= 4000),
            'session-detail preview should cap huge-line payload text before sending it to the web ui'
        );

        const hugeLineDetail = await api('session-detail', {
            source: 'codex',
            sessionId: hugeLineSessionId,
            messageLimit: 80
        });
        assert(hugeLineDetail.totalMessages === 3, 'session-detail should keep exact totalMessages for huge-line sessions');
        assert(hugeLineDetail.messages.length === 3, 'session-detail should keep all huge-line messages when under limit');
        assert(
            hugeLineDetail.messages.some((message) => typeof message.text === 'string' && message.text.length > 1000000),
            'full session-detail should keep the original huge-line content outside preview mode'
        );

        deleteLongResult = await api('trash-session', { source: 'codex', sessionId: longSessionId });
        assert(deleteLongResult.success === true, 'trash-session should trash long codex session');
        assert(deleteLongResult.messageCount === longMessageCount, 'trash-session should return exact long-session messageCount');

        const trashAfterLongDelete = await api('list-session-trash', { limit: 200 });
        assert(trashAfterLongDelete.totalCount >= trashAfterLongDelete.items.length, 'list-session-trash totalCount should not be smaller than visible items');
        const deletedLongTrashItem = trashAfterLongDelete.items.find(item => item.trashId === deleteLongResult.trashId);
        assert(deletedLongTrashItem, 'long codex session missing in trash');
        assert(deletedLongTrashItem.messageCount === longMessageCount, 'trash entry should keep exact long-session messageCount');

        fs.mkdirSync(trashFilesDir, { recursive: true });

        const staleTrashId = 'trash-stale-count-e2e';
        const staleTrashFileName = `${staleTrashId}.jsonl`;
        staleTrashFilePath = path.join(trashFilesDir, staleTrashFileName);
        const staleMessageCount = 24;
        const staleRecords = [{
            type: 'session_meta',
            payload: { id: 'stale-trash-session', cwd: '/tmp/stale-trash-count' },
            timestamp: '2025-03-02T00:00:00.000Z'
        }];
        syntheticTrashIds.add(staleTrashId);
        for (let i = 0; i < staleMessageCount; i += 1) {
            staleRecords.push({
                type: 'response_item',
                payload: {
                    type: 'message',
                    role: i % 2 === 0 ? 'user' : 'assistant',
                    content: `stale-trash-count-${i}-` + 'y'.repeat(256)
                },
                timestamp: `2025-03-02T00:${String(Math.floor(i / 2)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`
            });
        }
        fs.writeFileSync(staleTrashFilePath, staleRecords.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf-8');

        const trashIndex = JSON.parse(fs.readFileSync(trashIndexPath, 'utf-8'));
        trashIndex.entries.unshift({
            trashId: staleTrashId,
            trashFileName: staleTrashFileName,
            source: 'codex',
            sourceLabel: 'Codex',
            sessionId: 'stale-trash-session',
            title: 'stale trash count session',
            cwd: '/tmp/stale-trash-count',
            createdAt: '2025-03-02T00:00:00.000Z',
            updatedAt: '2025-03-02T00:23:00.000Z',
            deletedAt: '2025-03-03T00:00:00.000Z',
            messageCount: 10,
            originalFilePath: '/tmp/stale-trash-count/session.jsonl',
            provider: 'codex',
            keywords: [],
            capabilities: {}
        });
        fs.writeFileSync(trashIndexPath, JSON.stringify(trashIndex, null, 2), 'utf-8');

        const staleTrashList = await api('list-session-trash', { limit: 200, forceRefresh: true });
        assert(staleTrashList.totalCount >= staleTrashList.items.length, 'list-session-trash totalCount should be returned with stale-count repair');
        const correctedStaleTrashItem = staleTrashList.items.find(item => item.trashId === staleTrashId);
        assert(correctedStaleTrashItem, 'stale trash entry should still be listed');
        assert(correctedStaleTrashItem.messageCount === staleMessageCount, 'list-session-trash should repair stale trash messageCount');

        const persistedTrashIndex = JSON.parse(fs.readFileSync(trashIndexPath, 'utf-8'));
        const persistedStaleEntry = persistedTrashIndex.entries.find(item => item.trashId === staleTrashId);
        assert(persistedStaleEntry, 'repaired stale trash entry should persist in index');
        assert(persistedStaleEntry.messageCount === staleMessageCount, 'repaired stale trash messageCount should be written back');

        const mtimeOnlyTrashId = 'trash-mtime-only-e2e';
        syntheticTrashIds.add(mtimeOnlyTrashId);
        const mtimeOnlyIndex = JSON.parse(fs.readFileSync(trashIndexPath, 'utf-8'));
        mtimeOnlyIndex.entries.unshift({
            trashId: mtimeOnlyTrashId,
            trashFileName: staleTrashFileName,
            source: 'codex',
            sourceLabel: 'Codex',
            sessionId: 'mtime-only-trash-session',
            title: 'mtime only trash count session',
            cwd: '/tmp/stale-trash-count',
            createdAt: '2025-03-02T00:00:00.000Z',
            updatedAt: '2025-03-02T00:23:00.000Z',
            deletedAt: '2025-03-03T00:00:01.000Z',
            messageCount: staleMessageCount,
            originalFilePath: '/tmp/stale-trash-count/session-mtime-only.jsonl',
            provider: 'codex',
            keywords: [],
            capabilities: {}
        });
        fs.writeFileSync(trashIndexPath, JSON.stringify(mtimeOnlyIndex, null, 2), 'utf-8');

        const mtimeOnlyTrashList = await api('list-session-trash', { limit: 200, forceRefresh: true });
        const mtimeOnlyTrashItem = mtimeOnlyTrashList.items.find(item => item.trashId === mtimeOnlyTrashId);
        assert(mtimeOnlyTrashItem, 'mtime-only trash entry should still be listed');

        const persistedMtimeIndex = JSON.parse(fs.readFileSync(trashIndexPath, 'utf-8'));
        const persistedMtimeEntry = persistedMtimeIndex.entries.find(item => item.trashId === mtimeOnlyTrashId);
        assert(persistedMtimeEntry, 'mtime-only trash entry should persist in index');
        assert(
            Number.isFinite(Number(persistedMtimeEntry.messageCountMtimeMs)) && Number(persistedMtimeEntry.messageCountMtimeMs) > 0,
            'list-session-trash should persist messageCountMtimeMs even when messageCount is already exact'
        );

        const overflowExtraCount = 205;
        const overflowIndex = JSON.parse(fs.readFileSync(trashIndexPath, 'utf-8'));
        for (let i = 0; i < overflowExtraCount; i += 1) {
            const overflowTrashId = `trash-overflow-${i}`;
            syntheticTrashIds.add(overflowTrashId);
            overflowIndex.entries.unshift({
                trashId: overflowTrashId,
                trashFileName: staleTrashFileName,
                source: 'codex',
                sourceLabel: 'Codex',
                sessionId: `overflow-trash-session-${i}`,
                title: `overflow trash session ${i}`,
                cwd: '/tmp/overflow-trash-count',
                createdAt: '2025-03-04T00:00:00.000Z',
                updatedAt: buildTimestamp('2025-03-04T00:00:00.000Z', i),
                deletedAt: buildTimestamp('2025-03-05T00:00:00.000Z', i),
                messageCount: 1,
                originalFilePath: `/tmp/overflow-trash-count/session-${i}.jsonl`,
                provider: 'codex',
                keywords: [],
                capabilities: {}
            });
        }
        fs.writeFileSync(trashIndexPath, JSON.stringify(overflowIndex, null, 2), 'utf-8');

        const overflowTrashList = await api('list-session-trash', { limit: 200, forceRefresh: true });
        assert(overflowTrashList.totalCount === mtimeOnlyTrashList.totalCount + overflowExtraCount, 'list-session-trash totalCount should reflect entries beyond the visible slice');
        assert(overflowTrashList.items.length === 200, 'list-session-trash should keep the visible slice capped by limit');
        assert(overflowTrashList.totalCount > overflowTrashList.items.length, 'list-session-trash totalCount should stay larger than visible items when overflowing');

        const tamperedTrashIndex = JSON.parse(fs.readFileSync(trashIndexPath, 'utf-8'));
        const tamperedClaudeEntry = tamperedTrashIndex.entries.find(item => item.trashId === deleteClaudeResult.trashId);
        const escapedClaudeIndexPath = path.join(tmpHome, 'escape-root', 'sessions-index.json');
        assert(tamperedClaudeEntry, 'deleted Claude trash entry should exist before restore tampering');
        tamperedClaudeEntry.claudeIndexPath = escapedClaudeIndexPath;
        fs.writeFileSync(trashIndexPath, JSON.stringify(tamperedTrashIndex, null, 2), 'utf-8');

        const restoreClaudeResult = await api('restore-session-trash', { trashId: deleteClaudeResult.trashId });
        assert(restoreClaudeResult.success === true, 'restore-session-trash failed for Claude session');
        assert(fs.existsSync(claudeSessionPath), 'restored Claude session should return to original path');
        assert(!fs.existsSync(escapedClaudeIndexPath), 'restore-session-trash should ignore untrusted Claude index path');

        const restoredClaudeDetail = await api('session-detail', { source: 'claude', sessionId: claudeSessionId });
        assert(Array.isArray(restoredClaudeDetail.messages) && restoredClaudeDetail.messages.length > 0, 'restored Claude session detail missing');

        const restoreLongResult = await api('restore-session-trash', { trashId: deleteLongResult.trashId });
        assert(restoreLongResult.success === true, 'restore-session-trash failed for long codex session');
        assert(fs.existsSync(longSessionPath), 'restored long codex session should return to original path');
        const restoredLongDetail = await api('session-detail', { source: 'codex', sessionId: longSessionId });
        assert(restoredLongDetail.totalMessages === longMessageCount, 'restored long codex session should keep exact totalMessages');

        const apiSessionsAfterRestore = await api('list-sessions', { source: 'codex', limit: 50, forceRefresh: true });
        assert(apiSessionsAfterRestore.sessions.some(item => item.sessionId === sessionId), 'restored codex session missing after restore');
        assert(!apiSessionsAfterRestore.sessions.some(item => item.sessionId === cloneSessionId), 'purged clone session should not reappear');
        assert(apiSessionsAfterRestore.sessions.some(item => item.sessionId === longSessionId), 'restored long codex session missing after restore');

        const apiClaudeSessionsAfterRestore = await api('list-sessions', { source: 'claude', limit: 50, forceRefresh: true });
        assert(apiClaudeSessionsAfterRestore.sessions.some(item => item.sessionId === claudeSessionId), 'restored Claude session missing after restore');
    } finally {
        if (deleteResult && deleteResult.trashId) {
            await bestEffortApi('restore-session-trash', { trashId: deleteResult.trashId });
        }
        if (deleteClaudeResult && deleteClaudeResult.trashId) {
            await bestEffortApi('restore-session-trash', { trashId: deleteClaudeResult.trashId });
        }
        if (deleteLongResult && deleteLongResult.trashId) {
            await bestEffortApi('restore-session-trash', { trashId: deleteLongResult.trashId });
        }
        if (deleteIndexlessClaudeResult && deleteIndexlessClaudeResult.trashId) {
            await bestEffortApi('restore-session-trash', { trashId: deleteIndexlessClaudeResult.trashId });
        }

        const syntheticIds = [...syntheticTrashIds];
        if (deleteCloneResult && deleteCloneResult.trashId) {
            syntheticIds.unshift(deleteCloneResult.trashId);
        }
        if (syntheticIds.length > 0) {
            await bestEffortApi('purge-session-trash', { trashIds: syntheticIds });
        }

        if (fs.existsSync(trashIndexPath)) {
            try {
                const cleanupTrashIds = new Set(syntheticTrashIds);
                if (deleteCloneResult && deleteCloneResult.trashId) {
                    cleanupTrashIds.add(deleteCloneResult.trashId);
                }
                const cleanupIndex = JSON.parse(fs.readFileSync(trashIndexPath, 'utf-8'));
                cleanupIndex.entries = Array.isArray(cleanupIndex.entries)
                    ? cleanupIndex.entries.filter((entry) => !cleanupTrashIds.has(entry && entry.trashId))
                    : [];
                fs.writeFileSync(trashIndexPath, JSON.stringify(cleanupIndex, null, 2), 'utf-8');
            } catch (e) {}
        }
        if (staleTrashFilePath && fs.existsSync(staleTrashFilePath)) {
            try {
                fs.unlinkSync(staleTrashFilePath);
            } catch (e) {}
        }
        if (cloneSessionId) {
            await bestEffortApi('delete-session', {
                source: 'codex',
                sessionId: cloneSessionId,
                filePath: cloneResult && cloneResult.filePath
            });
        }
        await bestEffortApi('delete-session', {
            source: 'claude',
            sessionId: indexlessClaudeSessionId,
            filePath: indexlessClaudeSessionPath
        });
    }

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

    Object.assign(ctx, { longSessionId, longMessageCount });
};
