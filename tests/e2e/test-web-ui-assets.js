const http = require('http');
const { assert } = require('./helpers');

function getText(port, requestPath, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: requestPath,
            method: 'GET'
        }, (res) => {
            let body = '';
            res.setEncoding('utf-8');
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers || {},
                    body
                });
            });
        });

        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('Request timeout'));
        });
        req.end();
    });
}

module.exports = async function testWebUiAssets(ctx) {
    const { port } = ctx;

    const rootPage = await getText(port, '/');
    assert(rootPage.statusCode === 200, 'root web ui page should return 200');
    assert(
        /^text\/html\b/.test(String(rootPage.headers['content-type'] || '')),
        'root web ui page should return html content type'
    );
    assert(rootPage.body.includes('id="panel-market"'), 'root web ui page should inline market panel');
    assert(rootPage.body.includes('class="modal modal-wide skills-modal"'), 'root web ui page should inline skills modal');
    assert(rootPage.body.includes('id="tab-svn"'), 'root web ui page should include svn top tab');
    assert(rootPage.body.includes('id="panel-svn"'), 'root web ui page should include svn panel');
    assert(rootPage.body.includes('src="/web-ui/app.js"'), 'root web ui page should point to the absolute app entry');
    assert(!rootPage.body.includes('src="web-ui/app.js"'), 'root web ui page should not use a relative app entry');
    assert(!/<!--\s*@include\s+/.test(rootPage.body), 'root web ui page should not leak include directives');

    const bundledIndex = await getText(port, '/web-ui/index.html');
    assert(bundledIndex.statusCode === 200, '/web-ui/index.html should return 200');
    assert(
        /^text\/html\b/.test(String(bundledIndex.headers['content-type'] || '')),
        '/web-ui/index.html should return html content type'
    );
    assert(bundledIndex.body.includes('id="settings-panel-trash"'), '/web-ui/index.html should inline settings partials');
    assert(bundledIndex.body.includes('src="/web-ui/app.js"'), '/web-ui/index.html should point to the absolute app entry');
    assert(
        bundledIndex.body.includes('src="/res/vue.global.prod.js"'),
        '/web-ui/index.html should use the production Vue browser build'
    );
    assert(bundledIndex.body.includes('id="tab-svn"'), '/web-ui/index.html should include svn top tab');
    assert(bundledIndex.body.includes('id="panel-svn"'), '/web-ui/index.html should include svn panel');
    assert(
        !bundledIndex.body.includes('src="/res/runtime.global.prod.js"'),
        '/web-ui/index.html should not use the runtime-only Vue build'
    );
    assert(!bundledIndex.body.includes('src="web-ui/app.js"'), '/web-ui/index.html should not use a relative app entry');
    assert(!/<!--\s*@include\s+/.test(bundledIndex.body), '/web-ui/index.html should not leak include directives');

    const bundledIndexWithSlash = await getText(port, '/web-ui/');
    assert(bundledIndexWithSlash.statusCode === 404, '/web-ui/ should preserve the legacy 404 contract');
    assert(
        /^text\/plain\b/.test(String(bundledIndexWithSlash.headers['content-type'] || '')),
        '/web-ui/ should preserve plain-text not found semantics'
    );

    const appEntry = await getText(port, '/web-ui/app.js');
    assert(appEntry.statusCode === 200, 'app entry should return 200');
    assert(
        /^application\/javascript\b/.test(String(appEntry.headers['content-type'] || '')),
        'app entry should return javascript content type'
    );
    assert(appEntry.body.includes('document.addEventListener(\'DOMContentLoaded\''), 'app entry should contain the executable bootstrap');
    assert(
        !/(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]\.[^'"]+['"]\s*;?/.test(appEntry.body),
        'app entry should not leak split relative module imports'
    );
    assert(
        !/(?:^|\n)\s*export\s+\*\s+from\s+['"]\.[^'"]+['"]\s*;?/.test(appEntry.body),
        'app entry should not leak split re-export directives'
    );
    assert(appEntry.body.includes('svn-info'), 'app entry should include svn api action');

    const logicEntry = await getText(port, '/web-ui/logic.mjs');
    assert(logicEntry.statusCode === 200, 'logic entry should return 200');
    assert(
        /^application\/javascript\b/.test(String(logicEntry.headers['content-type'] || '')),
        'logic entry should return javascript content type'
    );
    assert(
        logicEntry.body.includes('export function normalizeClaudeValue'),
        'logic entry should preserve named exports for compatibility'
    );
    assert(
        !/(?:^|\n)\s*export\s+\*\s+from\s+['"]\.[^'"]+['"]\s*;?/.test(logicEntry.body),
        'logic entry should not leak split re-export directives'
    );

    const cssAsset = await getText(port, '/web-ui/styles/base-theme.css');
    assert(cssAsset.statusCode === 404, 'new split css implementation detail should stay private');
    assert(
        /^text\/plain\b/.test(String(cssAsset.headers['content-type'] || '')),
        'private split css asset should return plain-text not found'
    );

    const bundledCss = await getText(port, '/web-ui/styles.css');
    assert(bundledCss.statusCode === 200, 'styles entry should return 200');
    assert(
        /^text\/css\b/.test(String(bundledCss.headers['content-type'] || '')),
        'styles entry should return css content type'
    );
    assert(bundledCss.body.includes('--radius-md:'), 'styles entry should include theme variables');
    assert(
        !/@import\s+url\(['"]\.\/styles\//.test(bundledCss.body),
        'styles entry should not leak split css imports'
    );

    const moduleAsset = await getText(port, '/web-ui/modules/app.constants.mjs');
    assert(moduleAsset.statusCode === 404, 'new split module implementation detail should stay private');
    assert(
        /^text\/plain\b/.test(String(moduleAsset.headers['content-type'] || '')),
        'private split module asset should return plain-text not found'
    );

    const traversal = await getText(port, '/web-ui/../cli.js');
    assert(traversal.statusCode === 403, 'path traversal outside web-ui should be forbidden');
};
