import assert from 'assert';
import path from 'path';
import { EventEmitter } from 'events';
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

const parseCodexProxyOptionsSrc = extractByRegion(cliContent, 'parseCodexProxyOptions');
const buildScriptCommandArgsSrc = extractByRegion(cliContent, 'buildScriptCommandArgs');
const runProxyCommandWithQueuedFollowUpsSrc = extractByRegion(cliContent, 'runProxyCommandWithQueuedFollowUps');
const cmdCodexStart = 'async function cmdCodex(args = []) {';
const cmdQwenStart = 'async function cmdQwen(args = []) {';
const cmdCodexStartIndex = cliContent.indexOf(cmdCodexStart);
const cmdQwenStartIndex = cliContent.indexOf(cmdQwenStart, cmdCodexStartIndex);
if (cmdCodexStartIndex === -1 || cmdQwenStartIndex === -1) {
    throw new Error('Failed to locate cmdCodex source block');
}
const cmdCodexSrc = cliContent.slice(cmdCodexStartIndex, cmdQwenStartIndex).trim();

function instantiateFunction(funcSource, funcName, bindings = {}) {
    const bindingNames = Object.keys(bindings);
    const bindingValues = Object.values(bindings);
    return Function(...bindingNames, `${funcSource}\nreturn ${funcName};`)(...bindingValues);
}

const parseCodexProxyOptions = instantiateFunction(parseCodexProxyOptionsSrc, 'parseCodexProxyOptions');

function assertArrayEquals(actual, expected, msg) {
    assert.deepStrictEqual(actual, expected, msg);
}

test('parseCodexProxyOptions keeps passthrough args when no codexmate follow-up options', () => {
    const result = parseCodexProxyOptions(['--model', 'gpt-5', '-c', 'foo=1']);
    assertArrayEquals(result.passthroughArgs, ['--model', 'gpt-5', '-c', 'foo=1']);
    assertArrayEquals(result.queuedFollowUps, []);
});

test('parseCodexProxyOptions extracts repeated follow-up options and preserves order', () => {
    const result = parseCodexProxyOptions([
        '--follow-up', 'first message',
        '--queued-follow-up=second message',
        '--model', 'gpt-5.3-codex',
        '--follow-up', 'third message'
    ]);
    assertArrayEquals(result.queuedFollowUps, ['first message', 'second message', 'third message']);
    assertArrayEquals(result.passthroughArgs, ['--model', 'gpt-5.3-codex']);
});

test('parseCodexProxyOptions allows follow-up content that starts with dashes', () => {
    const result = parseCodexProxyOptions(['--follow-up', '--not-an-option']);
    assertArrayEquals(result.queuedFollowUps, ['--not-an-option']);
    assertArrayEquals(result.passthroughArgs, []);
});

test('parseCodexProxyOptions stops parsing codexmate options after --', () => {
    const result = parseCodexProxyOptions(['--', '--follow-up', 'pass-through']);
    assertArrayEquals(result.queuedFollowUps, []);
    assertArrayEquals(result.passthroughArgs, ['--', '--follow-up', 'pass-through']);
});

test('parseCodexProxyOptions throws when follow-up option misses value', () => {
    assert.throws(
        () => parseCodexProxyOptions(['--follow-up']),
        /--follow-up 需要提供内容/
    );
});

test('parseCodexProxyOptions throws when inline follow-up content is empty', () => {
    assert.throws(
        () => parseCodexProxyOptions(['--queued-follow-up=']),
        /--queued-follow-up 需要提供非空内容/
    );
});

test('cmdCodex should only launch codex and must not auto-enable builtin proxy', async () => {
    let ensureCalls = 0;
    const logs = [];
    let runProxyCall = null;
    const cmdCodex = instantiateFunction(cmdCodexSrc, 'cmdCodex', {
        parseCodexProxyOptions: (args) => ({
            passthroughArgs: Array.isArray(args) ? [...args] : [],
            queuedFollowUps: []
        }),
        ensureBuiltinProxyForCodexDefault: async () => {
            ensureCalls += 1;
            return {
                success: true,
                runtime: { listenUrl: 'http://127.0.0.1:8323' }
            };
        },
        runProxyCommand: (...args) => {
            runProxyCall = args;
            return 0;
        },
        console: {
            log: (message) => logs.push(String(message))
        }
    });

    const exitCode = await cmdCodex(['--model', 'gpt-5.3-codex']);
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(ensureCalls, 0, 'cmdCodex should not call ensureBuiltinProxyForCodexDefault');
    assert.deepStrictEqual(runProxyCall, [
        'Codex',
        'codex',
        ['--model', 'gpt-5.3-codex'],
        '',
        { queuedFollowUps: [] }
    ]);
    assert.strictEqual(logs.length, 0, 'cmdCodex should not print builtin proxy banner');
});

function runBuildScriptArgs(platform, commandLine) {
    const buildScriptCommandArgs = instantiateFunction(buildScriptCommandArgsSrc, 'buildScriptCommandArgs', {
        process: { platform }
    });
    return buildScriptCommandArgs(commandLine);
}

test('buildScriptCommandArgs uses util-linux style args on linux', () => {
    const args = runBuildScriptArgs('linux', 'codex --yolo');
    assertArrayEquals(args, ['-q', '-e', '-c', 'codex --yolo', '/dev/null']);
});

test('buildScriptCommandArgs uses BSD/macOS style args on darwin', () => {
    const args = runBuildScriptArgs('darwin', "codex --yolo --model 'gpt-5'");
    assertArrayEquals(args, ['-q', '/dev/null', 'sh', '-lc', "codex --yolo --model 'gpt-5'"]);
});

test('buildScriptCommandArgs uses openbsd-compatible args on openbsd', () => {
    const args = runBuildScriptArgs('openbsd', 'codex --yolo');
    assertArrayEquals(args, ['-c', 'codex --yolo', '/dev/null']);
});

test('buildScriptCommandArgs throws on unsupported platform', () => {
    assert.throws(
        () => runBuildScriptArgs('win32', 'codex --yolo'),
        /当前平台暂不支持 --follow-up 自动排队/
    );
});

class MockProcessStdin extends EventEmitter {
    constructor() {
        super();
        this.isTTY = true;
        this.isRaw = false;
        this.paused = false;
    }

    setRawMode(flag) {
        this.isRaw = !!flag;
    }

    pause() {
        this.paused = true;
    }

    resume() {
        this.paused = false;
    }
}

class MockChildStdin extends EventEmitter {
    constructor() {
        super();
        this.destroyed = false;
        this.chunks = [];
    }

    write(chunk, callback) {
        this.chunks.push(chunk);
        if (typeof callback === 'function') {
            callback();
        }
        return true;
    }
}

function createRunProxyHarness() {
    const processMock = new EventEmitter();
    processMock.stdin = new MockProcessStdin();
    processMock.stdout = {
        chunks: [],
        write(chunk) {
            this.chunks.push(chunk);
        }
    };
    processMock.stderr = {
        chunks: [],
        write(chunk) {
            this.chunks.push(chunk);
        }
    };
    processMock.exitCode = null;
    processMock.exit = (code) => {
        processMock.exitCode = code;
    };

    const child = new EventEmitter();
    child.stdin = new MockChildStdin();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = (signal) => {
        child.killed = true;
        child.killSignal = signal;
    };

    const timers = [];
    const setTimeoutMock = (handler, delay) => {
        const timer = { handler, delay, cleared: false };
        timers.push(timer);
        return timer;
    };
    const clearTimeoutMock = (timer) => {
        if (timer) {
            timer.cleared = true;
        }
    };

    const spawnCalls = [];
    const runProxyCommandWithQueuedFollowUps = instantiateFunction(
        runProxyCommandWithQueuedFollowUpsSrc,
        'runProxyCommandWithQueuedFollowUps',
        {
            process: processMock,
            spawn: (bin, args, options) => {
                spawnCalls.push({ bin, args, options });
                return child;
            },
            resolveCommandPath: () => '/usr/bin/script',
            shellEscapePosixArg: (value) => String(value),
            buildScriptCommandArgs: (commandLine) => ['-c', commandLine, '/dev/null'],
            setTimeout: setTimeoutMock,
            clearTimeout: clearTimeoutMock
        }
    );

    const runAllTimers = () => {
        let index = 0;
        while (index < timers.length) {
            const timer = timers[index];
            index += 1;
            if (!timer.cleared) {
                timer.handler();
            }
        }
    };

    return {
        runProxyCommandWithQueuedFollowUps,
        processMock,
        child,
        timers,
        spawnCalls,
        runAllTimers
    };
}

test('runProxyCommandWithQueuedFollowUps registers and removes process-level cleanup handlers', async () => {
    const harness = createRunProxyHarness();
    const { processMock, child, runProxyCommandWithQueuedFollowUps } = harness;
    const exitBefore = processMock.listenerCount('exit');
    const sigintBefore = processMock.listenerCount('SIGINT');
    const sigtermBefore = processMock.listenerCount('SIGTERM');

    const runPromise = runProxyCommandWithQueuedFollowUps('codex', ['--yolo'], []);

    assert.strictEqual(processMock.listenerCount('exit'), exitBefore + 1);
    assert.strictEqual(processMock.listenerCount('SIGINT'), sigintBefore + 1);
    assert.strictEqual(processMock.listenerCount('SIGTERM'), sigtermBefore + 1);

    child.emit('close', 0, null);
    await runPromise;

    assert.strictEqual(processMock.listenerCount('exit'), exitBefore);
    assert.strictEqual(processMock.listenerCount('SIGINT'), sigintBefore);
    assert.strictEqual(processMock.listenerCount('SIGTERM'), sigtermBefore);
});

test('runProxyCommandWithQueuedFollowUps flushes follow-ups after readiness/timer, not immediately', async () => {
    const harness = createRunProxyHarness();
    const { child, runAllTimers, runProxyCommandWithQueuedFollowUps } = harness;
    const runPromise = runProxyCommandWithQueuedFollowUps('codex', ['--yolo'], ['first follow-up']);

    assertArrayEquals(child.stdin.chunks, [], 'should not write follow-up immediately');

    child.stdout.emit('data', 'prompt ready');
    runAllTimers();

    assert.strictEqual(child.stdin.chunks.includes('first follow-up\r'), true, 'should flush follow-up after timers');

    child.emit('close', 0, null);
    await runPromise;
});

test('runProxyCommandWithQueuedFollowUps submits follow-ups with CR in PTY', async () => {
    const harness = createRunProxyHarness();
    const { child, runAllTimers, runProxyCommandWithQueuedFollowUps } = harness;
    const runPromise = runProxyCommandWithQueuedFollowUps('codex', ['--yolo'], ['submit check']);

    child.stdout.emit('data', 'prompt ready');
    runAllTimers();

    assertArrayEquals(child.stdin.chunks, ['submit check\r']);

    child.emit('close', 0, null);
    await runPromise;
});
