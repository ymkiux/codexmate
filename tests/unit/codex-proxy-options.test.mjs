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
const context = vm.createContext({});
vm.runInContext(parseCodexProxyOptionsSrc, context);
const { parseCodexProxyOptions } = context;

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
