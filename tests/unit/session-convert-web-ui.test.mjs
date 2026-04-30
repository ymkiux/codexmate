import assert from 'assert';
import { buildConvertedSessionJsonl } from '../../web-ui/logic.session-convert.mjs';

test('buildConvertedSessionJsonl emits codex jsonl', () => {
    const text = buildConvertedSessionJsonl('codex', {
        sessionId: 'sess-1',
        cwd: '/repo',
        messages: [
            { role: 'system', text: 'sys', timestamp: '2026-04-29T00:00:00.000Z' },
            { role: 'user', text: 'hi', timestamp: '2026-04-29T00:00:01.000Z' },
            { role: 'assistant', text: 'hello', timestamp: '2026-04-29T00:00:02.000Z' }
        ]
    });
    const lines = text.trim().split('\n').map((line) => JSON.parse(line));
    assert.strictEqual(lines[0].type, 'session_meta');
    assert.strictEqual(lines[0].payload.id, 'sess-1');
    assert.strictEqual(lines[0].payload.cwd, '/repo');
    assert.strictEqual(lines[1].payload.role, 'user');
    assert.strictEqual(lines[1].payload.content, 'hi');
    assert.strictEqual(lines[2].payload.role, 'assistant');
    assert.strictEqual(lines[2].payload.content, 'hello');
});

test('buildConvertedSessionJsonl emits claude jsonl', () => {
    const text = buildConvertedSessionJsonl('claude', {
        sessionId: 'sess-2',
        cwd: '/repo',
        messages: [
            { role: 'system', text: 'sys', timestamp: '2026-04-29T00:00:00.000Z' },
            { role: 'user', text: 'hi', timestamp: '2026-04-29T00:00:01.000Z' },
            { role: 'assistant', text: 'hello', timestamp: '2026-04-29T00:00:02.000Z' }
        ]
    });
    const lines = text.trim().split('\n').map((line) => JSON.parse(line));
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[0].type, 'user');
    assert.strictEqual(lines[0].sessionId, 'sess-2');
    assert.strictEqual(lines[0].cwd, '/repo');
    assert.strictEqual(lines[0].message.content, 'hi');
    assert.strictEqual(lines[1].type, 'assistant');
    assert.strictEqual(lines[1].message.content, 'hello');
});

