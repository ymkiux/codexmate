import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { cmdConvertSession } = require('../../cli/session-convert');

function writeJsonl(filePath, records) {
    const lines = records.map((r) => JSON.stringify(r));
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8');
}

function listFiles(dirPath) {
    return fs.readdirSync(dirPath).filter(Boolean).sort();
}

test('convert-session converts codex jsonl to claude jsonl', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-convert-'));
    const inputPath = path.join(tmpDir, 'input.jsonl');
    const outDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outDir);

    writeJsonl(inputPath, [
        { type: 'session_meta', timestamp: '2026-04-29T00:00:00.000Z', payload: { id: 'sess-1', cwd: '/repo' } },
        { type: 'response_item', timestamp: '2026-04-29T00:00:01.000Z', payload: { type: 'message', role: 'user', content: 'hi' } },
        { type: 'response_item', timestamp: '2026-04-29T00:00:02.000Z', payload: { type: 'message', role: 'assistant', content: 'hello' } }
    ]);

    await cmdConvertSession(
        ['--from', 'codex', '--to', 'claude', '--file', inputPath, '--output', `${outDir}/`],
        { resolveSessionFilePath: () => inputPath }
    );

    const files = listFiles(outDir);
    assert.deepStrictEqual(files, ['claude-session-sess-1.jsonl']);
    const content = fs.readFileSync(path.join(outDir, files[0]), 'utf-8').trim();
    const records = content.split('\n').map((line) => JSON.parse(line));
    assert.strictEqual(records.length, 2);
    assert.strictEqual(records[0].type, 'user');
    assert.strictEqual(records[0].sessionId, 'sess-1');
    assert.strictEqual(records[0].cwd, '/repo');
    assert.strictEqual(records[0].message.content, 'hi');
    assert.strictEqual(records[1].type, 'assistant');
    assert.strictEqual(records[1].message.content, 'hello');
});

test('convert-session converts claude jsonl to codex jsonl', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-convert-'));
    const inputPath = path.join(tmpDir, 'input.jsonl');
    const outDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outDir);

    writeJsonl(inputPath, [
        { type: 'user', timestamp: '2026-04-29T00:00:01.000Z', sessionId: 'sess-2', cwd: '/repo', message: { content: 'hi' } },
        { type: 'assistant', timestamp: '2026-04-29T00:00:02.000Z', sessionId: 'sess-2', cwd: '/repo', message: { content: 'hello' } }
    ]);

    await cmdConvertSession(
        ['--from', 'claude', '--to', 'codex', '--file', inputPath, '--output', `${outDir}/`],
        { resolveSessionFilePath: () => inputPath }
    );

    const files = listFiles(outDir);
    assert.deepStrictEqual(files, ['codex-session-sess-2.jsonl']);
    const content = fs.readFileSync(path.join(outDir, files[0]), 'utf-8').trim();
    const records = content.split('\n').map((line) => JSON.parse(line));
    assert.strictEqual(records[0].type, 'session_meta');
    assert.strictEqual(records[0].payload.id, 'sess-2');
    assert.strictEqual(records[0].payload.cwd, '/repo');
    assert.strictEqual(records[1].type, 'response_item');
    assert.strictEqual(records[1].payload.role, 'user');
    assert.strictEqual(records[2].payload.role, 'assistant');
});

