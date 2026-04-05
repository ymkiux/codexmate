import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { createOpenclawCoreMethods } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.openclaw-core.mjs'))
);

const methods = createOpenclawCoreMethods();

test('parseOptionalNumber preserves numeric zero values', () => {
    assert.deepStrictEqual(methods.parseOptionalNumber(0, 'Timeout'), { ok: true, value: 0 });
    assert.deepStrictEqual(methods.parseOptionalNumber('0', 'Timeout'), { ok: true, value: 0 });
});

test('getOpenclawParser falls back to JSON helpers when window is unavailable', () => {
    const previousWindow = globalThis.window;
    try {
        delete globalThis.window;
        const parser = methods.getOpenclawParser();
        assert.strictEqual(parser.parse, JSON.parse);
        assert.strictEqual(parser.stringify, JSON.stringify);
    } finally {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
    }
});
