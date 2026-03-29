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

test('buildLineDiff still surfaces diff points for large inputs', () => {
    const beforeLines = Array.from({ length: 3200 }, (_, index) => `line-${index}`);
    const afterLines = beforeLines.slice();
    afterLines.splice(1600, 1, 'line-1600-updated');
    const result = buildLineDiff(beforeLines.join('\n'), afterLines.join('\n'));

    assert.strictEqual(result.truncated, false);
    assert.strictEqual(result.oldLineCount, 3200);
    assert.strictEqual(result.newLineCount, 3200);
    assert.strictEqual(result.stats.added, 1);
    assert.strictEqual(result.stats.removed, 1);
    assert.ok(result.lines.some(line => line.type === 'del' && line.value === 'line-1600'));
    assert.ok(result.lines.some(line => line.type === 'add' && line.value === 'line-1600-updated'));
});

test('buildLineDiff tolerates non-string input', () => {
    const result = buildLineDiff(null, 123);
    assert.strictEqual(result.oldLineCount, 0);
    assert.strictEqual(result.newLineCount, 0);
    assert.strictEqual(result.lines.length, 0);
});
