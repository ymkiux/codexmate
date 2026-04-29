import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { createSessionActionMethods } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.session-actions.mjs'))
);

test('isResumeCommandAvailable supports codex and codebuddy with sessionId', () => {
    const methods = createSessionActionMethods();
    assert.strictEqual(methods.isResumeCommandAvailable({ source: 'codex', sessionId: 'sess-1' }), true);
    assert.strictEqual(methods.isResumeCommandAvailable({ source: 'codebuddy', sessionId: 'abc123' }), true);
    assert.strictEqual(methods.isResumeCommandAvailable({ source: 'codebuddy', sessionId: '' }), false);
    assert.strictEqual(methods.isResumeCommandAvailable({ source: 'claude', sessionId: 'sess-2' }), false);
});

test('buildResumeCommand generates codex resume with optional --yolo and codebuddy -r', () => {
    const methods = createSessionActionMethods();
    const contextBase = {
        ...methods,
        sessionResumeWithYolo: false
    };

    assert.strictEqual(
        methods.buildResumeCommand.call(contextBase, { source: 'codex', sessionId: 'sess-1' }),
        'codex resume sess-1'
    );

    assert.strictEqual(
        methods.buildResumeCommand.call({ ...contextBase, sessionResumeWithYolo: true }, { source: 'codex', sessionId: 'sess-1' }),
        'codex --yolo resume sess-1'
    );

    assert.strictEqual(
        methods.buildResumeCommand.call({ ...contextBase, sessionResumeWithYolo: true }, { source: 'codebuddy', sessionId: 'abc123' }),
        'codebuddy -r abc123'
    );
});

