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
const createSerializedWebUiRestartHandlerSrc = extractByRegion(
    cliContent,
    'createSerializedWebUiRestartHandler'
);
const createSerializedWebUiRestartHandler = instantiateFunction(
    createSerializedWebUiRestartHandlerSrc,
    'createSerializedWebUiRestartHandler'
);
const restartWebUiServerAfterFrontendChange = instantiateFunction(
    restartWebUiServerAfterFrontendChangeSrc,
    'restartWebUiServerAfterFrontendChange'
);

test('restartWebUiServerAfterFrontendChange waits 3 seconds after stop before restart', async () => {
    const events = [];
    const nextServerHandle = { stop: async () => {} };
    let resolveStop = null;
    const stopDone = new Promise((resolve) => {
        resolveStop = resolve;
    });
    const currentServerHandle = {
        stop: () => {
            events.push('stop:start');
            return stopDone.then(() => {
                events.push('stop:done');
            });
        }
    };

    const pending = restartWebUiServerAfterFrontendChange({
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

    assert.deepStrictEqual(events, ['stop:start']);
    resolveStop();
    const result = await pending;

    assert.strictEqual(result, nextServerHandle);
    assert.deepStrictEqual(events, [
        'stop:start',
        'stop:done',
        'wait:3000',
        'create'
    ]);
});

test('createSerializedWebUiRestartHandler coalesces overlapping restarts to the latest change', async () => {
    const events = [];
    let restartCount = 0;
    let releaseFirstRestart = null;
    const firstRestartDone = new Promise((resolve) => {
        releaseFirstRestart = resolve;
    });

    const requestRestart = createSerializedWebUiRestartHandler(async (info) => {
        restartCount += 1;
        const label = info && info.filename ? info.filename : 'unknown';
        events.push(`start:${label}`);
        if (restartCount === 1) {
            await firstRestartDone;
        }
        events.push(`done:${label}`);
    });

    const first = requestRestart({ filename: 'first.js' });
    const second = requestRestart({ filename: 'second.js' });
    const third = requestRestart({ filename: 'third.js' });

    await Promise.resolve();

    assert.strictEqual(first, second);
    assert.strictEqual(second, third);
    assert.deepStrictEqual(events, ['start:first.js']);

    releaseFirstRestart();
    await first;

    assert.deepStrictEqual(events, [
        'start:first.js',
        'done:first.js',
        'start:third.js',
        'done:third.js'
    ]);
});
