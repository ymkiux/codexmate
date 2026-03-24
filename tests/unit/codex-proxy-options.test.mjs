import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const fs = require('fs');

const cliPath = path.join(__dirname, '..', '..', 'cli.js');
const cliContent = fs.readFileSync(cliPath, 'utf-8');

function extractFunction(content, funcName) {
    const regex = new RegExp(`function ${funcName}\\([^)]*\\)\\s*\\{[\\s\\S]*?^\\}`, 'm');
    const match = content.match(regex);
    if (!match) {
        throw new Error(`Function ${funcName} not found`);
    }
    return match[0];
}

const parseCodexProxyOptionsSrc = extractFunction(cliContent, 'parseCodexProxyOptions');
const buildScriptCommandArgsSrc = extractFunction(cliContent, 'buildScriptCommandArgs');
const parseContext = vm.createContext({});
vm.runInContext(parseCodexProxyOptionsSrc, parseContext);
const { parseCodexProxyOptions } = parseContext;

function assertArrayEquals(actual, expected, msg) {
    assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), msg);
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

function runBuildScriptArgs(platform, commandLine) {
    const context = vm.createContext({
        process: { platform }
    });
    vm.runInContext(buildScriptCommandArgsSrc, context);
    return context.buildScriptCommandArgs(commandLine);
}

test('buildScriptCommandArgs uses util-linux style args on linux', () => {
    const args = runBuildScriptArgs('linux', 'codex --yolo');
    assertArrayEquals(args, ['-q', '-e', '-c', 'codex --yolo', '/dev/null']);
});

test('buildScriptCommandArgs uses BSD/macOS style args on darwin', () => {
    const args = runBuildScriptArgs('darwin', "codex --yolo --model 'gpt-5'");
    assertArrayEquals(args, ['-q', '/dev/null', 'sh', '-lc', "codex --yolo --model 'gpt-5'"]);
});

test('buildScriptCommandArgs uses -e/-c style args on openbsd', () => {
    const args = runBuildScriptArgs('openbsd', 'codex --yolo');
    assertArrayEquals(args, ['-q', '-e', '-c', 'codex --yolo', '/dev/null']);
});

test('buildScriptCommandArgs throws on unsupported platform', () => {
    assert.throws(
        () => runBuildScriptArgs('win32', 'codex --yolo'),
        /当前平台暂不支持 --follow-up 自动排队/
    );
});
