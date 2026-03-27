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

test('buildLineDiff tolerates non-string input', () => {
    const result = buildLineDiff(null, 123);
    assert.strictEqual(result.oldLineCount, 0);
    assert.strictEqual(result.newLineCount, 0);
    assert.strictEqual(result.lines.length, 0);
});
