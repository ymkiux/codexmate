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
const watchPathsForRestartSrc = extractByRegion(
    cliContent,
    'watchPathsForRestart'
);
const createSerializedWebUiRestartHandler = instantiateFunction(
    createSerializedWebUiRestartHandlerSrc,
    'createSerializedWebUiRestartHandler'
);
const restartWebUiServerAfterFrontendChange = instantiateFunction(
    restartWebUiServerAfterFrontendChangeSrc,
    'restartWebUiServerAfterFrontendChange'
);
const watchPathsForRestart = instantiateFunction(
    watchPathsForRestartSrc,
    'watchPathsForRestart',
    { fs, path }
);

test('restartWebUiServerAfterFrontendChange waits 3 seconds after stop before restart', async () => {
    const events = [];
    const nextServerHandle = { stop: async () => {} };
    let resolveStop = null;
    let resolveDelay = null;
    const stopDone = new Promise((resolve) => {
        resolveStop = resolve;
    });
    const delayDone = new Promise((resolve) => {
        resolveDelay = resolve;
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
            return delayDone.then(() => {
                callback();
            });
        },
        logger: {
            log: () => {},
            warn: () => {},
            error: () => {}
        }
    });

    assert.deepStrictEqual(events, ['stop:start']);
    resolveStop();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepStrictEqual(events, ['stop:start', 'stop:done', 'wait:3000']);
    resolveDelay();
    const result = await pending;

    assert.strictEqual(result, nextServerHandle);
    assert.deepStrictEqual(events, [
        'stop:start',
        'stop:done',
        'wait:3000',
        'create'
    ]);
});

test('restartWebUiServerAfterFrontendChange catches async createServer failures', async () => {
    const currentServerHandle = { stop: async () => {} };
    const loggedErrors = [];

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
        createServer: async () => {
            throw new Error('async create failed');
        },
        wait: (callback) => {
            callback();
            return 1;
        },
        logger: {
            log: () => {},
            warn: () => {},
            error: (...args) => {
                loggedErrors.push(args);
            }
        }
    });

    assert.strictEqual(result, currentServerHandle);
    assert.deepStrictEqual(loggedErrors, [['! 重启失败:', 'async create failed']]);
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

test('createSerializedWebUiRestartHandler chains queued callers to the retry after a failure', async () => {
    const events = [];
    let restartCount = 0;
    let rejectFirstRestart = null;
    const firstRestartDone = new Promise((_, reject) => {
        rejectFirstRestart = reject;
    });

    const requestRestart = createSerializedWebUiRestartHandler(async (info) => {
        restartCount += 1;
        const label = info && info.filename ? info.filename : 'unknown';
        events.push(`start:${label}`);
        if (restartCount === 1) {
            await firstRestartDone;
            return;
        }
        events.push(`done:${label}`);
    });

    const first = requestRestart({ filename: 'first.js' });
    const second = requestRestart({ filename: 'second.js' });

    await Promise.resolve();

    assert.strictEqual(first, second);
    assert.deepStrictEqual(events, ['start:first.js']);

    rejectFirstRestart(new Error('first restart failed'));
    await first;

    assert.deepStrictEqual(events, [
        'start:first.js',
        'start:second.js',
        'done:second.js'
    ]);
});

test('watchPathsForRestart falls back to watching existing nested frontend directories when recursive watch is unavailable', () => {
    const watchedTargets = [];
    const fakeFs = {
        existsSync(target) {
            return target === '/tmp/web-ui'
                || target === '/tmp/web-ui/modules'
                || target === '/tmp/web-ui/partials'
                || target === '/tmp/web-ui/styles'
                || target === '/tmp/web-ui/partials/index';
        },
        statSync(target) {
            return {
                isDirectory() {
                    return target !== '/tmp/legacy.html';
                }
            };
        },
        readdirSync(target, options) {
            assert.deepStrictEqual(options, { withFileTypes: true });
            const toEntry = (name) => ({
                name,
                isDirectory() {
                    return true;
                }
            });
            if (target === '/tmp/web-ui') {
                return [toEntry('modules'), toEntry('partials'), toEntry('styles')];
            }
            if (target === '/tmp/web-ui/partials') {
                return [toEntry('index')];
            }
            return [];
        },
        watch(target, options, handler) {
            watchedTargets.push({ target, recursive: !!(options && options.recursive), handler });
            if (options && options.recursive) {
                throw new Error('recursive not supported');
            }
            return { close() {} };
        }
    };
    const watchWithFakeFs = instantiateFunction(
        watchPathsForRestartSrc,
        'watchPathsForRestart',
        { fs: fakeFs, path }
    );

    const stopWatch = watchWithFakeFs(['/tmp/web-ui'], () => {});
    assert.strictEqual(typeof stopWatch, 'function');
    assert.deepStrictEqual(
        watchedTargets.map((item) => `${item.target}:${item.recursive ? 'r' : 'n'}`),
        [
            '/tmp/web-ui:r',
            '/tmp/web-ui:n',
            '/tmp/web-ui/modules:n',
            '/tmp/web-ui/partials:n',
            '/tmp/web-ui/styles:n',
            '/tmp/web-ui/partials/index:n'
        ]
    );
});

test('watchPathsForRestart rescan attaches watchers for newly created nested directories after a rename event', () => {
    const closed = [];
    const watchedTargets = [];
    const watchedHandlers = new Map();
    const existingDirectories = new Set([
        '/tmp/web-ui',
        '/tmp/web-ui/modules'
    ]);
    const fakeFs = {
        existsSync(target) {
            return existingDirectories.has(target);
        },
        statSync() {
            return {
                isDirectory() {
                    return true;
                }
            };
        },
        readdirSync(target, options) {
            assert.deepStrictEqual(options, { withFileTypes: true });
            const toEntry = (name) => ({
                name,
                isDirectory() {
                    return true;
                }
            });
            if (target === '/tmp/web-ui') {
                const names = ['modules'];
                if (existingDirectories.has('/tmp/web-ui/new-parts')) {
                    names.push('new-parts');
                }
                return names.map(toEntry);
            }
            return [];
        },
        watch(target, options, handler) {
            watchedTargets.push({ target, recursive: !!(options && options.recursive) });
            watchedHandlers.set(target, handler);
            if (options && options.recursive) {
                throw new Error('recursive not supported');
            }
            return {
                close() {
                    closed.push(target);
                }
            };
        }
    };
    const watchWithFakeFs = instantiateFunction(
        watchPathsForRestartSrc,
        'watchPathsForRestart',
        { fs: fakeFs, path }
    );

    watchWithFakeFs(['/tmp/web-ui'], () => {});
    existingDirectories.add('/tmp/web-ui/new-parts');
    const rootHandler = watchedHandlers.get('/tmp/web-ui');
    assert.strictEqual(typeof rootHandler, 'function');

    rootHandler('rename', 'new-parts');

    assert.deepStrictEqual(
        watchedTargets.map((item) => `${item.target}:${item.recursive ? 'r' : 'n'}`),
        [
            '/tmp/web-ui:r',
            '/tmp/web-ui:n',
            '/tmp/web-ui/modules:n',
            '/tmp/web-ui/new-parts:n'
        ]
    );
    assert.deepStrictEqual(closed, []);
});

test('watchPathsForRestart reattaches a fallback watcher when a nested directory is recreated at the same path', () => {
    const closed = [];
    const watchedTargets = [];
    const watchedHandlers = new Map();
    const existingDirectories = new Set([
        '/tmp/web-ui',
        '/tmp/web-ui/modules'
    ]);
    const fakeFs = {
        existsSync(target) {
            return existingDirectories.has(target);
        },
        statSync() {
            return {
                isDirectory() {
                    return true;
                }
            };
        },
        readdirSync(target, options) {
            assert.deepStrictEqual(options, { withFileTypes: true });
            const toEntry = (name) => ({
                name,
                isDirectory() {
                    return true;
                }
            });
            if (target === '/tmp/web-ui') {
                const names = [];
                if (existingDirectories.has('/tmp/web-ui/modules')) {
                    names.push('modules');
                }
                return names.map(toEntry);
            }
            return [];
        },
        watch(target, options, handler) {
            watchedTargets.push({ target, recursive: !!(options && options.recursive) });
            watchedHandlers.set(target, handler);
            if (options && options.recursive) {
                throw new Error('recursive not supported');
            }
            return {
                close() {
                    closed.push(target);
                }
            };
        }
    };
    const watchWithFakeFs = instantiateFunction(
        watchPathsForRestartSrc,
        'watchPathsForRestart',
        { fs: fakeFs, path }
    );

    watchWithFakeFs(['/tmp/web-ui'], () => {});
    const rootHandler = watchedHandlers.get('/tmp/web-ui');
    assert.strictEqual(typeof rootHandler, 'function');

    existingDirectories.delete('/tmp/web-ui/modules');
    rootHandler('rename', 'modules');
    assert.deepStrictEqual(closed, ['/tmp/web-ui/modules']);

    existingDirectories.add('/tmp/web-ui/modules');
    rootHandler('rename', 'modules');

    assert.deepStrictEqual(
        watchedTargets.map((item) => `${item.target}:${item.recursive ? 'r' : 'n'}`),
        [
            '/tmp/web-ui:r',
            '/tmp/web-ui:n',
            '/tmp/web-ui/modules:n',
            '/tmp/web-ui/modules:n'
        ]
    );
});
