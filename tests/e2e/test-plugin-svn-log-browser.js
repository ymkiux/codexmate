const http = require('http');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function listen(server) {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve(address.port);
        });
    });
}

function close(server) {
    return new Promise((resolve) => server.close(() => resolve()));
}

function readBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.setEncoding('utf-8');
        req.on('data', chunk => body += chunk);
        req.on('end', () => resolve(body));
    });
}

function createMockSvnServer() {
    return http.createServer(async (req, res) => {
        const url = String(req.url || '');
        if (req.method === 'PROPFIND') {
            await readBody(req);
            const payload = url.includes('/broken')
                ? [
                    '<?xml version="1.0" encoding="utf-8"?>',
                    '<D:multistatus xmlns:D="DAV:" xmlns:S="svn:">',
                    '  <D:response>',
                    `    <D:href>${url}</D:href>`,
                    '    <D:propstat>',
                    '      <D:prop>',
                    '        <D:checked-in><D:href>/repo/!svn/ver/12/target</D:href></D:checked-in>',
                    '        <D:version-controlled-configuration><D:href>/repo/!svn/vcc/default</D:href></D:version-controlled-configuration>',
                    '      </D:prop>',
                    '      <D:status>HTTP/1.1 200 OK</D:status>',
                    '    </D:propstat>',
                    '  </D:response>',
                    '</D:multistatus>'
                ].join('\n')
                : [
                    '<?xml version="1.0" encoding="utf-8"?>',
                    '<D:multistatus xmlns:D="DAV:" xmlns:S="svn:">',
                    '  <D:response>',
                    `    <D:href>${url}</D:href>`,
                    '    <D:propstat>',
                    '      <D:prop>',
                    '        <S:repository-root>http://127.0.0.1/repo</S:repository-root>',
                    '        <S:baseline-relative-path>trunk/project</S:baseline-relative-path>',
                    '        <D:checked-in><D:href>/repo/!svn/ver/12/trunk/project</D:href></D:checked-in>',
                    '        <D:version-controlled-configuration><D:href>/repo/!svn/vcc/default</D:href></D:version-controlled-configuration>',
                    '      </D:prop>',
                    '      <D:status>HTTP/1.1 200 OK</D:status>',
                    '    </D:propstat>',
                    '  </D:response>',
                    '</D:multistatus>'
                ].join('\n');
            res.writeHead(207, { 'Content-Type': 'text/xml; charset=utf-8' });
            res.end(payload, 'utf-8');
            return;
        }

        if (req.method === 'REPORT') {
            const body = await readBody(req);
            const limitMatch = body.match(/<S:limit>(\d+)<\/S:limit>/);
            const limit = limitMatch ? Number(limitMatch[1]) || 0 : 0;
            const logItems = [
                [
                    '  <S:log-item>',
                    '    <D:version-name>12</D:version-name>',
                    '    <S:creator-displayname>alice.long.name</S:creator-displayname>',
                    '    <S:date>2026-05-02T00:00:00Z</S:date>',
                    '    <D:comment>fix target path</D:comment>',
                    '    <S:modified-path>/target/file.txt</S:modified-path>',
                    '  </S:log-item>'
                ].join('\n'),
                [
                    '  <S:log-item>',
                    '    <D:version-name>11</D:version-name>',
                    '    <S:creator-displayname>bob</S:creator-displayname>',
                    '    <S:date>2026-05-01T00:00:00Z</S:date>',
                    '    <D:comment>add other path</D:comment>',
                    '    <S:added-path>/other/new.txt</S:added-path>',
                    '  </S:log-item>'
                ].join('\n'),
                [
                    '  <S:log-item>',
                    '    <D:version-name>10</D:version-name>',
                    '    <S:creator-displayname>carol</S:creator-displayname>',
                    '    <S:date>2026-04-30T00:00:00Z</S:date>',
                    '    <D:comment>remove target file</D:comment>',
                    '    <S:deleted-path>/target/old.txt</S:deleted-path>',
                    '  </S:log-item>'
                ].join('\n')
            ];
            const sliced = limit ? logItems.slice(0, Math.min(limit, logItems.length)) : logItems;
            const payload = [
                '<?xml version="1.0" encoding="utf-8"?>',
                '<S:log-report xmlns:S="svn:" xmlns:D="DAV:">',
                ...sliced,
                '</S:log-report>'
            ].join('\n');
            res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
            res.end(payload, 'utf-8');
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found', 'utf-8');
    });
}

module.exports = async function testPluginSvnLogBrowser(ctx) {
    const svn = createMockSvnServer();
    const svnPort = await listen(svn);
    const svnBase = `http://127.0.0.1:${svnPort}/repo/trunk/project`;
    const svnBroken = `http://127.0.0.1:${svnPort}/repo/broken/target`;

    try {
        const firstInfo = await ctx.api('svn-info', { url: svnBase, username: 'u', password: 'p' }, 4000);
        assert(firstInfo && firstInfo.ok === true, 'svn-info should succeed');
        assert(firstInfo.cached === false, 'svn-info should miss cache initially');
        assert(firstInfo.info && firstInfo.info.repositoryRoot, 'svn-info should return repository root');
        assert(firstInfo.info && firstInfo.info.relativePath === 'trunk/project', 'svn-info should return baseline relative path');

        const secondInfo = await ctx.api('svn-info', { url: svnBase, username: 'u', password: 'p' }, 4000);
        assert(secondInfo && secondInfo.ok === true, 'svn-info should succeed on second call');
        assert(secondInfo.cached === true, 'svn-info should hit cache');

        const logsPage1 = await ctx.api('svn-logs', { url: svnBase, username: 'u', password: 'p', page: 1, pageSize: 2 }, 4000);
        assert(logsPage1 && logsPage1.ok === true, 'svn-logs should succeed');
        assert(Array.isArray(logsPage1.items) && logsPage1.items.length === 2, 'svn-logs page 1 should return 2 items');
        assert(logsPage1.items[0].revision === 12, 'svn-logs page 1 should return latest revision first');
        assert(logsPage1.hasMore === true, 'svn-logs page 1 should have more');

        const logsPage2 = await ctx.api('svn-logs', { url: svnBase, username: 'u', password: 'p', page: 2, pageSize: 2 }, 4000);
        assert(logsPage2 && logsPage2.ok === true, 'svn-logs page 2 should succeed');
        assert(Array.isArray(logsPage2.items) && logsPage2.items.length === 1, 'svn-logs page 2 should return remaining items');
        assert(logsPage2.hasMore === false, 'svn-logs page 2 should have no more');

        const brokenLogs = await ctx.api('svn-logs', { url: svnBroken, username: '', password: '', page: 1, pageSize: 20 }, 4000);
        assert(brokenLogs && brokenLogs.ok === true, 'svn-logs should succeed with broken propfind response');
        assert(Array.isArray(brokenLogs.items), 'svn-logs should return items array');
        assert(brokenLogs.items.some((item) => item && item.revision === 12), 'broken logs should include revision 12');
        assert(brokenLogs.items.some((item) => item && item.revision === 10), 'broken logs should include revision 10');
        assert(!brokenLogs.items.some((item) => item && item.revision === 11), 'broken logs should filter unrelated path entries');
    } finally {
        await close(svn);
    }
};
