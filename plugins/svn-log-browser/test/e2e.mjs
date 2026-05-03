import assert from 'assert';
import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createApp } = require('../server.js');

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
        req.on('data', (chunk) => body += chunk);
        req.on('end', () => resolve(body));
    });
}

function createMockSvnServer() {
    const server = http.createServer(async (req, res) => {
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
                    '        <D:checked-in><D:href>/repo/!svn/ver/5/trunk/project</D:href></D:checked-in>',
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

    return server;
}

async function postJson(port, path, payload) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    return { status: res.status, data };
}

async function getText(port, path) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const text = await res.text();
    return { status: res.status, text };
}

async function main() {
    const svn = createMockSvnServer();
    const svnPort = await listen(svn);
    const svnBase = `http://127.0.0.1:${svnPort}/repo/trunk/project`;
    const svnBroken = `http://127.0.0.1:${svnPort}/repo/broken/target`;

    const appServer = http.createServer(createApp());
    const appPort = await listen(appServer);

    try {
        const page = await getText(appPort, '/');
        assert.strictEqual(page.status, 200);
        assert.ok(page.text.includes('SVN 日志浏览器'));

        const firstInfo = await postJson(appPort, '/api/svn/info', { url: svnBase, username: 'u', password: 'p' });
        assert.strictEqual(firstInfo.status, 200);
        assert.strictEqual(firstInfo.data.ok, true);
        assert.strictEqual(firstInfo.data.cached, false);
        assert.ok(firstInfo.data.info.repositoryRoot);
        assert.strictEqual(firstInfo.data.info.relativePath, 'trunk/project');

        const secondInfo = await postJson(appPort, '/api/svn/info', { url: svnBase, username: 'u', password: 'p' });
        assert.strictEqual(secondInfo.status, 200);
        assert.strictEqual(secondInfo.data.cached, true);

        const logsPage1 = await postJson(appPort, '/api/svn/logs', { url: svnBase, username: 'u', password: 'p', page: 1, pageSize: 2 });
        assert.strictEqual(logsPage1.status, 200);
        assert.strictEqual(logsPage1.data.items.length, 2);
        assert.strictEqual(logsPage1.data.items[0].revision, 12);

        const logsPage2 = await postJson(appPort, '/api/svn/logs', { url: svnBase, username: 'u', password: 'p', page: 2, pageSize: 2 });
        assert.strictEqual(logsPage2.status, 200);
        assert.strictEqual(logsPage2.data.items.length, 1);

        const brokenLogs = await postJson(appPort, '/api/svn/logs', { url: svnBroken, username: '', password: '', page: 1, pageSize: 20 });
        assert.strictEqual(brokenLogs.status, 200);
        assert.ok(brokenLogs.data.items.some((item) => item && item.revision === 12));
        assert.ok(brokenLogs.data.items.some((item) => item && item.revision === 10));
        assert.ok(!brokenLogs.data.items.some((item) => item && item.revision === 11));
    } finally {
        await close(appServer);
        await close(svn);
    }
}

await main();

