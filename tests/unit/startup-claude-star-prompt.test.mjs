import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { createStartupClaudeMethods } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.startup-claude.mjs')));

function withLocalStorage(localStorage, fn) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: localStorage
    });
    try {
        return fn();
    } finally {
        if (previous) {
            Object.defineProperty(globalThis, 'localStorage', previous);
        } else {
            delete globalThis.localStorage;
        }
    }
}

function createContext() {
    const messages = [];
    return {
        messages,
        showMessage(message, level) {
            messages.push({ message, level });
        }
    };
}

const { maybeShowStarPrompt } = createStartupClaudeMethods();

test('maybeShowStarPrompt skips prompting when storage already contains the marker', () => {
    const context = createContext();
    let setItemCalls = 0;

    withLocalStorage({
        getItem() {
            return '1';
        },
        setItem() {
            setItemCalls += 1;
        }
    }, () => {
        maybeShowStarPrompt.call(context);
    });

    assert.deepStrictEqual(context.messages, []);
    assert.strictEqual(setItemCalls, 0);
});

test('maybeShowStarPrompt prompts once and persists the marker on first success', () => {
    const context = createContext();
    const writes = [];

    withLocalStorage({
        getItem() {
            return null;
        },
        setItem(key, value) {
            writes.push([key, value]);
        }
    }, () => {
        maybeShowStarPrompt.call(context);
    });

    assert.deepStrictEqual(context.messages, [{ message: '欢迎到 GitHub 点 Star', level: 'info' }]);
    assert.deepStrictEqual(writes, [['codexmateStarPrompted', '1']]);
});

test('maybeShowStarPrompt only prompts once when persisting the marker fails', () => {
    const context = createContext();

    withLocalStorage({
        getItem() {
            return null;
        },
        setItem() {
            throw new Error('quota exceeded');
        }
    }, () => {
        maybeShowStarPrompt.call(context);
    });

    assert.deepStrictEqual(context.messages, [{ message: '欢迎到 GitHub 点 Star', level: 'info' }]);
});

test('maybeShowStarPrompt still prompts once when reading storage fails', () => {
    const context = createContext();

    withLocalStorage({
        getItem() {
            throw new Error('storage blocked');
        },
        setItem() {
            throw new Error('should not be called');
        }
    }, () => {
        maybeShowStarPrompt.call(context);
    });

    assert.deepStrictEqual(context.messages, [{ message: '欢迎到 GitHub 点 Star', level: 'info' }]);
});
