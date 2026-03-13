const { assert } = require('./helpers');

module.exports = async function testSessionSearch(ctx) {
    const { api, sessionId, claudeSessionId } = ctx;

    const claudeSearch = await api('list-sessions', { source: 'all', query: 'claudecode', limit: 20, forceRefresh: true });
    assert(Array.isArray(claudeSearch.sessions), 'claudecode query missing sessions');
    const claudeHit = claudeSearch.sessions.find(item => item.sessionId === claudeSessionId);
    assert(claudeHit, 'claudecode query missing Claude session');
    assert(claudeHit.provider === 'claude', 'Claude session provider missing');
    assert(claudeHit.capabilities && claudeHit.capabilities.code === true, 'Claude session code capability missing');
    assert(Array.isArray(claudeHit.keywords) && claudeHit.keywords.includes('claude_code'), 'Claude session keyword missing');

    const variantSearch = await api('list-sessions', { source: 'all', query: 'claude-code', limit: 20, forceRefresh: true });
    assert(variantSearch.sessions.some(item => item.sessionId === claudeSessionId), 'claude-code query missing Claude session');

    const combined = await api('list-sessions', { source: 'all', query: 'claude code hello', limit: 20, forceRefresh: true });
    const combinedIds = combined.sessions.map(item => item.sessionId);
    assert(combinedIds.includes(claudeSessionId), 'combined query missing Claude session');

    const baseline = await api('list-sessions', { source: 'all', query: 'hello', limit: 20, forceRefresh: true });
    assert(baseline.sessions.some(item => item.sessionId === sessionId), 'baseline query missing codex session');

    const highlighted = await api('list-sessions', {
        source: 'all',
        query: 'claude code hello',
        queryScope: 'all',
        contentScanBytes: 8 * 1024,
        limit: 5,
        forceRefresh: true
    });
    const highlightedHit = highlighted.sessions.find(item => item.sessionId === claudeSessionId);
    assert(highlightedHit, 'highlight query missing Claude session');
    assert(highlightedHit.match && highlightedHit.match.hit === true, 'highlight match missing for Claude session');
    assert(Array.isArray(highlightedHit.match.snippets) && highlightedHit.match.snippets.some(
        snippet => typeof snippet === 'string' && snippet.toLowerCase().includes('hello from claude code session')
    ), 'highlight snippets missing Claude code text');

    const paged = await api('list-sessions', {
        source: 'all',
        query: 'claude code hello',
        queryScope: 'all',
        limit: 1,
        forceRefresh: true
    });
    assert(Array.isArray(paged.sessions) && paged.sessions.length === 1, 'paged search should return first page only');
    assert(paged.sessions[0].sessionId === claudeSessionId, 'paged search first item should be Claude session');
};
