import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildLineDiff } = require('../../lib/text-diff');

test('buildLineDiff returns add/del/context lines with stats', () => {
    const before = 'alpha\nbeta\ngamma';
    const after = 'alpha\nbeta 2\ngamma\nzeta';
    const result = buildLineDiff(before, after);

    assert.strictEqual(result.oldLineCount, 3);
    assert.strictEqual(result.newLineCount, 4);
    assert.deepStrictEqual(
        result.lines.map(line => line.type),
        ['context', 'del', 'add', 'context', 'add']
    );
    assert.strictEqual(result.lines[0].oldNumber, 1);
    assert.strictEqual(result.lines[0].newNumber, 1);
    assert.strictEqual(result.lines[1].oldNumber, 2);
    assert.strictEqual(result.lines[1].newNumber, null);
    assert.strictEqual(result.lines[2].oldNumber, null);
    assert.strictEqual(result.lines[2].newNumber, 2);
    assert.strictEqual(result.stats.added, 2);
    assert.strictEqual(result.stats.removed, 1);
});

test('buildLineDiff normalizes line endings', () => {
    const before = 'one\r\ntwo\r\nthree';
    const after = 'one\ntwo\nthree\nfour';
    const result = buildLineDiff(before, after);
    assert.strictEqual(result.stats.added, 1);
    assert.strictEqual(result.stats.removed, 0);
});

test('buildLineDiff ignores single trailing newline', () => {
    const withTrailing = buildLineDiff('a\nb\n', 'a\nb\n');
    const withoutTrailing = buildLineDiff('a\nb', 'a\nb');
    assert.strictEqual(withTrailing.oldLineCount, 2);
    assert.strictEqual(withTrailing.newLineCount, 2);
    assert.strictEqual(withTrailing.lines.length, 2);
    assert.strictEqual(withoutTrailing.lines.length, 2);
});

test('buildLineDiff truncates large inputs', () => {
    const lines = Array.from({ length: 3001 }, (_, index) => `line-${index}`);
    const text = lines.join('\n');
    const result = buildLineDiff(text, text);
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.oldLineCount, 3001);
    assert.strictEqual(result.newLineCount, 3001);
    assert.strictEqual(result.lines.length, 0);
});

test('buildLineDiff tolerates non-string input', () => {
    const result = buildLineDiff(null, 123);
    assert.strictEqual(result.oldLineCount, 0);
    assert.strictEqual(result.newLineCount, 0);
    assert.strictEqual(result.lines.length, 0);
});
