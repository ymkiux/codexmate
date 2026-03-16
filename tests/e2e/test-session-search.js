const http = require('http');
const { assert } = require('./helpers');

async function fetchHtml(port) {
    return new Promise((resolve, reject) => {
        const req = http.get({
            hostname: '127.0.0.1',
            port,
            path: '/',
            timeout: 2000
        }, (res) => {
            let body = '';
            res.setEncoding('utf-8');
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy(new Error('timeout'));
        });
    });
}

module.exports = async function testSessionSearch(ctx) {
    const { api, sessionId, claudeSessionId, daudeSessionId } = ctx;

    // ========== Basic Query Tests ==========
    const claudeSearch = await api('list-sessions', { source: 'claude', query: 'claudecode', limit: 20, forceRefresh: true });
    assert(Array.isArray(claudeSearch.sessions), 'claudecode query missing sessions');
    const claudeHit = claudeSearch.sessions.find(item => item.sessionId === claudeSessionId);
    assert(claudeHit, 'claudecode query missing Claude session');
    assert(claudeHit.provider === 'claude', 'Claude session provider missing');
    assert(claudeHit.capabilities && claudeHit.capabilities.code === true, 'Claude session code capability missing');
    assert(Array.isArray(claudeHit.keywords) && claudeHit.keywords.includes('claude_code'), 'Claude session keyword missing');

    // ========== Query Variant Tests ==========
    const variantSearch = await api('list-sessions', { source: 'claude', query: 'claude-code', limit: 20, forceRefresh: true });
    assert(variantSearch.sessions.some(item => item.sessionId === claudeSessionId), 'claude-code query missing Claude session');

    const combined = await api('list-sessions', { source: 'claude', query: 'claude code hello', limit: 20, forceRefresh: true });
    const combinedIds = combined.sessions.map(item => item.sessionId);
    assert(combinedIds.includes(claudeSessionId), 'combined query missing Claude session');

    // ========== Codex Query Tests ==========
    const baseline = await api('list-sessions', { source: 'codex', query: 'hello', limit: 20, forceRefresh: true });
    assert(baseline.sessions.some(item => item.sessionId === sessionId), 'baseline query missing codex session');

    // ========== Daude Query Tests ==========
    const daudeSearch = await api('list-sessions', {
        source: 'codex',
        query: 'daude code',
        limit: 20,
        forceRefresh: true
    });
    assert(daudeSearch.sessions.some(item => item.sessionId === daudeSessionId), 'daude code query missing session');

    const daudeHyphen = await api('list-sessions', {
        source: 'codex',
        query: 'daude-code',
        limit: 20,
        forceRefresh: true
    });
    assert(daudeHyphen.sessions.some(item => item.sessionId === daudeSessionId), 'daude-code query missing session');

    const daudeConcat = await api('list-sessions', {
        source: 'codex',
        query: 'daudecode',
        limit: 20,
        forceRefresh: true
    });
    assert(daudeConcat.sessions.some(item => item.sessionId === daudeSessionId), 'daudecode query missing session');

    // ========== Highlight/Snippet Tests ==========
    const highlighted = await api('list-sessions', {
        source: 'claude',
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

    // ========== Numeric Query Tests ==========
    const numeric = await api('list-sessions', {
        source: 'codex',
        query: '222',
        queryScope: 'all',
        contentScanBytes: 8 * 1024,
        limit: 10,
        forceRefresh: true
    });
    const numericHit = numeric.sessions.find(item => item.sessionId === daudeSessionId);
    assert(numericHit, '222 query missing daude session');
    assert(numericHit.match && numericHit.match.hit === true, '222 match missing daude session hit');
    assert(Array.isArray(numericHit.match.snippets) && numericHit.match.snippets.some(
        snippet => typeof snippet === 'string' && snippet.includes('222')
    ), '222 snippets missing numeric token');

    // ========== Pagination Tests ==========
    const paged = await api('list-sessions', {
        source: 'claude',
        query: 'claude code hello',
        queryScope: 'all',
        limit: 1,
        forceRefresh: true
    });
    assert(Array.isArray(paged.sessions) && paged.sessions.length === 1, 'paged search should return first page only');
    assert(paged.sessions[0].sessionId === claudeSessionId, 'paged search first item should be Claude session');

    // ========== Zero Limit Tests ==========
    const zeroLimit = await api('list-sessions', {
        source: 'codex',
        query: 'hello',
        limit: 0,
        forceRefresh: true
    });
    assert(Array.isArray(zeroLimit.sessions), 'zero limit should return empty array');
    assert(zeroLimit.sessions.length === 0, 'zero limit should return empty sessions');

    // ========== Large Limit Tests ==========
    const largeLimit = await api('list-sessions', {
        source: 'codex',
        query: 'hello',
        limit: 10000,
        forceRefresh: true
    });
    assert(Array.isArray(largeLimit.sessions), 'large limit should return array');

    // ========== No Query Tests ==========
    const noQuery = await api('list-sessions', {
        source: 'codex',
        query: '',
        limit: 20,
        forceRefresh: true
    });
    assert(Array.isArray(noQuery.sessions), 'empty query should return sessions');

    // ========== All Sources Query Tests ==========
    const allSourcesQuery = await api('list-sessions', {
        source: 'all',
        query: 'hello',
        limit: 50,
        forceRefresh: true
    });
    assert(Array.isArray(allSourcesQuery.sessions), 'all sources query should return sessions');
    assert(allSourcesQuery.sessions.some(s => s.source === 'codex'), 'all sources should include codex');
    assert(allSourcesQuery.sessions.some(s => s.source === 'claude'), 'all sources should include claude');

    // ========== Role Filter Tests ==========
    const roleUser = await api('list-sessions', {
        source: 'codex',
        query: 'hello',
        roleFilter: 'user',
        limit: 20,
        forceRefresh: true
    });
    assert(Array.isArray(roleUser.sessions), 'role filter(user) should return sessions');

    const roleAssistant = await api('list-sessions', {
        source: 'codex',
        query: 'world',
        roleFilter: 'assistant',
        limit: 20,
        forceRefresh: true
    });
    assert(Array.isArray(roleAssistant.sessions), 'role filter(assistant) should return sessions');

    const roleAll = await api('list-sessions', {
        source: 'codex',
        query: 'hello',
        roleFilter: 'all',
        limit: 20,
        forceRefresh: true
    });
    assert(Array.isArray(roleAll.sessions), 'role filter(all) should return sessions');

    // ========== Time Preset Tests ==========
    const timeAll = await api('list-sessions', {
        source: 'codex',
        query: 'hello',
        timePreset: 'all',
        limit: 20,
        forceRefresh: true
    });
    assert(Array.isArray(timeAll.sessions), 'time preset(all) should return sessions');

    const timeToday = await api('list-sessions', {
        source: 'codex',
        query: 'hello',
        timePreset: 'today',
        limit: 20,
        forceRefresh: true
    });
    assert(Array.isArray(timeToday.sessions), 'time preset(today) should return sessions');

    const timeWeek = await api('list-sessions', {
        source: 'codex',
        query: 'hello',
        timePreset: 'week',
        limit: 20,
        forceRefresh: true
    });
    assert(Array.isArray(timeWeek.sessions), 'time preset(week) should return sessions');

    const timeMonth = await api('list-sessions', {
        source: 'codex',
        query: 'hello',
        timePreset: 'month',
        limit: 20,
        forceRefresh: true
    });
    assert(Array.isArray(timeMonth.sessions), 'time preset(month) should return sessions');

    // ========== HTML Style Tests ==========
    const html = await fetchHtml(ctx.port);
    const lowerHtml = (html || '').toLowerCase();
    assert(lowerHtml.includes('session-item'), 'session item style missing');
};
