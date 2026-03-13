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

    const claudeSearch = await api('list-sessions', { source: 'claude', query: 'claudecode', limit: 20, forceRefresh: true });
    assert(Array.isArray(claudeSearch.sessions), 'claudecode query missing sessions');
    const claudeHit = claudeSearch.sessions.find(item => item.sessionId === claudeSessionId);
    assert(claudeHit, 'claudecode query missing Claude session');
    assert(claudeHit.provider === 'claude', 'Claude session provider missing');
    assert(claudeHit.capabilities && claudeHit.capabilities.code === true, 'Claude session code capability missing');
    assert(Array.isArray(claudeHit.keywords) && claudeHit.keywords.includes('claude_code'), 'Claude session keyword missing');

    const variantSearch = await api('list-sessions', { source: 'claude', query: 'claude-code', limit: 20, forceRefresh: true });
    assert(variantSearch.sessions.some(item => item.sessionId === claudeSessionId), 'claude-code query missing Claude session');

    const combined = await api('list-sessions', { source: 'claude', query: 'claude code hello', limit: 20, forceRefresh: true });
    const combinedIds = combined.sessions.map(item => item.sessionId);
    assert(combinedIds.includes(claudeSessionId), 'combined query missing Claude session');

    const baseline = await api('list-sessions', { source: 'codex', query: 'hello', limit: 20, forceRefresh: true });
    assert(baseline.sessions.some(item => item.sessionId === sessionId), 'baseline query missing codex session');

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

    const paged = await api('list-sessions', {
        source: 'claude',
        query: 'claude code hello',
        queryScope: 'all',
        limit: 1,
        forceRefresh: true
    });
    assert(Array.isArray(paged.sessions) && paged.sessions.length === 1, 'paged search should return first page only');
    assert(paged.sessions[0].sessionId === claudeSessionId, 'paged search first item should be Claude session');

    const html = await fetchHtml(ctx.port);
    assert(html && html.includes('.session-item-snippet'), 'session snippet style missing');
    const lowerHtml = (html || '').toLowerCase();
    assert(lowerHtml.includes('white-space: nowrap'), 'snippet nowrap missing');
    assert(lowerHtml.includes('text-overflow: ellipsis'), 'snippet ellipsis missing');
};
