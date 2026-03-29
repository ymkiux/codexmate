import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const fs = require('fs');

const cliPath = path.join(__dirname, '..', '..', 'cli.js');
const cliContent = fs.readFileSync(cliPath, 'utf-8');

function extractByRegion(content, regionName) {
    const startMarker = `// #region ${regionName}`;
    const endMarker = `// #endregion ${regionName}`;
    const startIndex = content.indexOf(startMarker);
    if (startIndex === -1) {
        throw new Error(`Region ${regionName} not found`);
    }
    const bodyStartIndex = content.indexOf('\n', startIndex);
    const searchFrom = bodyStartIndex === -1 ? startIndex + startMarker.length : bodyStartIndex + 1;
    const endIndex = content.indexOf(endMarker, searchFrom);
    if (endIndex === -1) {
        throw new Error(`Region ${regionName} not found`);
    }
    return content.slice(searchFrom, endIndex).trim();
}

function instantiateFunction(funcSource, funcName, bindings = {}) {
    const bindingNames = Object.keys(bindings);
    const bindingValues = Object.values(bindings);
    return Function(...bindingNames, `${funcSource}\nreturn ${funcName};`)(...bindingValues);
}

const restartWebUiServerAfterFrontendChangeSrc = extractByRegion(
    cliContent,
    'restartWebUiServerAfterFrontendChange'
);
const restartWebUiServerAfterFrontendChange = instantiateFunction(
    restartWebUiServerAfterFrontendChangeSrc,
    'restartWebUiServerAfterFrontendChange'
);

test('restartWebUiServerAfterFrontendChange waits 3 seconds after stop before restart', async () => {
    const events = [];
    const nextServerHandle = { stop: async () => {} };
    const currentServerHandle = {
        stop: async () => {
            events.push('stop:start');
            events.push('stop:done');
        }
    };

    const result = await restartWebUiServerAfterFrontendChange({
        serverHandle: currentServerHandle,
        serverOptions: {
            htmlPath: '/tmp/index.html',
            assetsDir: '/tmp/res',
            webDir: '/tmp/web-ui',
            host: '127.0.0.1',
            port: 3737,
            openBrowser: false
        },
        createServer: (options) => {
            events.push('create');
            assert.deepStrictEqual(options, {
                htmlPath: '/tmp/index.html',
                assetsDir: '/tmp/res',
                webDir: '/tmp/web-ui',
                host: '127.0.0.1',
                port: 3737,
                openBrowser: false
            });
            return nextServerHandle;
        },
        wait: (callback, ms) => {
            events.push(`wait:${ms}`);
            callback();
            return 1;
        },
        logger: {
            log: () => {},
            warn: () => {},
            error: () => {}
        }
    });

    assert.strictEqual(result, nextServerHandle);
    assert.deepStrictEqual(events, [
        'stop:start',
        'stop:done',
        'wait:3000',
        'create'
    ]);
});
