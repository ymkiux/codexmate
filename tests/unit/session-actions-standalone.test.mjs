import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { createSessionActionMethods } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.session-actions.mjs'))
);

function withWindow(windowLike, fn) {
    const previousWindow = globalThis.window;
    globalThis.window = windowLike;
    try {
        return fn();
    } finally {
        globalThis.window = previousWindow;
    }
}

test('buildSessionStandaloneUrl returns empty when neither origin nor apiBase is usable', () => {
    const methods = createSessionActionMethods({ apiBase: '   ' });

    const url = withWindow({
        location: {
            origin: 'null'
        }
    }, () => methods.buildSessionStandaloneUrl.call({}, {
        source: 'codex',
        sessionId: 'session-1'
    }));

    assert.strictEqual(url, '');
});

test('openSessionStandalone shows an error instead of opening an undefined standalone url', () => {
    const methods = createSessionActionMethods({ apiBase: '' });
    const context = {
        ...methods,
        shownMessages: [],
        showMessage(message, type) {
            this.shownMessages.push({ message, type });
        }
    };
    let openedUrl = '';
    const fakeWindow = {
        location: {
            origin: 'null'
        },
        open(url) {
            openedUrl = url;
        }
    };

    withWindow(fakeWindow, () => methods.openSessionStandalone.call(context, {
        source: 'codex',
        sessionId: 'session-1'
    }));

    assert.strictEqual(openedUrl, '');
    assert.deepStrictEqual(context.shownMessages, [{
        message: '无法生成链接',
        type: 'error'
    }]);
});
