import assert from 'assert';
import { readProjectFile } from './helpers/web-ui-source.mjs';

const cliSource = readProjectFile('cli.js');

function extractBlockBySignature(source, signature) {
    const startIndex = source.indexOf(signature);
    if (startIndex === -1) {
        throw new Error(`Signature not found: ${signature}`);
    }
    const signatureBraceOffset = signature.lastIndexOf('{');
    const braceStart = signatureBraceOffset >= 0
        ? (startIndex + signatureBraceOffset)
        : source.indexOf('{', startIndex + signature.length);
    if (braceStart === -1) {
        throw new Error(`Opening brace not found for: ${signature}`);
    }
    let depth = 0;
    for (let i = braceStart; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(startIndex, i + 1);
            }
        }
    }
    throw new Error(`Closing brace not found for: ${signature}`);
}

function instantiateFunction(funcSource, funcName, bindings = {}) {
    const bindingNames = Object.keys(bindings);
    const bindingValues = Object.values(bindings);
    return Function(...bindingNames, `${funcSource}\nreturn ${funcName};`)(...bindingValues);
}

test('resolveSpawnCommand keeps bare command names on windows', () => {
    const source = extractBlockBySignature(cliSource, 'function resolveSpawnCommand(command) {');
    const resolveSpawnCommand = instantiateFunction(source, 'resolveSpawnCommand', {
        process: { platform: 'win32' },
        resolveCommandPath() {
            return 'C:\\nvm4w\\nodejs\\codex';
        }
    });

    assert.strictEqual(resolveSpawnCommand('codex'), 'codex');
});

test('runCodexExecTaskNode spawns bare codex command on windows', async () => {
    const source = extractBlockBySignature(cliSource, 'async function runCodexExecTaskNode(node, context = {}) {');
    const spawnCalls = [];
    const runCodexExecTaskNode = instantiateFunction(source, 'runCodexExecTaskNode', {
        process: { platform: 'win32' },
        resolveSpawnCommand() {
            return 'codex';
        },
        commandExists(command, args) {
            assert.strictEqual(command, 'codex');
            assert.strictEqual(args, '--version');
            return true;
        },
        toIsoTime() {
            return '2026-04-13T03:09:00.000Z';
        },
        truncateTaskText(text) {
            return String(text || '');
        },
        ensureDir() {},
        TASK_RUN_DETAILS_DIR: '/tmp/task-runs',
        path: {
            join: (...parts) => parts.join('/'),
            basename(value) {
                const parts = String(value || '').split(/[\\/]/g);
                return parts[parts.length - 1] || '';
            }
        },
        fs: {
            mkdtempSync() {
                return '/tmp/task-runs/tmp/codex-123';
            },
            rmSync() {}
        },
        readCodexLastMessageFile() {
            return 'done';
        },
        findCodexSessionId() {
            return '';
        },
        spawn(command, args, options) {
            spawnCalls.push({ command, args, options });
            return {
                stdout: { on() {} },
                stderr: { on() {} },
                on(event, handler) {
                    if (event === 'close') {
                        handler(0, '');
                    }
                },
                kill() {}
            };
        }
    });

    const result = await runCodexExecTaskNode({
        id: 'analysis-01',
        prompt: 'inspect the bug',
        write: false
    }, {
        cwd: 'C:/repo'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(spawnCalls.length, 1);
    assert.strictEqual(spawnCalls[0].command, 'codex');
    assert.deepStrictEqual(spawnCalls[0].args.slice(0, 7), [
        '-a', 'never',
        '-s', 'read-only',
        '-C', 'C:/repo',
        'exec'
    ]);
});
