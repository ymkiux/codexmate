import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { createInstallMethods } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.install.mjs')));

const methods = createInstallMethods();

function createContext(overrides = {}) {
    return {
        ...methods,
        installRegistryPreset: 'default',
        installRegistryCustom: '',
        quoteShellArg(value) {
            return `'${value.replace(/'/g, `'\\''`)}'`;
        },
        ...overrides
    };
}

test('normalizeInstallRegistryUrl rejects scheme-only values', () => {
    assert.strictEqual(methods.normalizeInstallRegistryUrl('http://'), '');
    assert.strictEqual(methods.normalizeInstallRegistryUrl('https://'), '');
    assert.strictEqual(methods.normalizeInstallRegistryUrl(' https:// '), '');
});

test('normalizeInstallRegistryUrl accepts valid registries and trims trailing slashes', () => {
    assert.strictEqual(
        methods.normalizeInstallRegistryUrl('https://registry.example.com/'),
        'https://registry.example.com'
    );
    assert.strictEqual(
        methods.normalizeInstallRegistryUrl('http://localhost:4873/'),
        'http://localhost:4873'
    );
});

test('resolveInstallRegistryUrl returns empty for invalid custom registry', () => {
    const context = createContext();
    assert.strictEqual(methods.resolveInstallRegistryUrl.call(context, 'custom', 'https://'), '');
});

test('appendInstallRegistryOption skips registry for invalid custom input', () => {
    const context = createContext({
        installRegistryPreset: 'custom',
        installRegistryCustom: 'https://'
    });
    const command = methods.appendInstallRegistryOption.call(context, 'npm install -g @openai/codex', 'install');
    assert.strictEqual(command, 'npm install -g @openai/codex');
});

test('appendInstallRegistryOption appends registry for valid custom input', () => {
    const context = createContext({
        installRegistryPreset: 'custom',
        installRegistryCustom: 'https://registry.example.com/'
    });
    const command = methods.appendInstallRegistryOption.call(context, 'npm install -g @openai/codex', 'install');
    assert.strictEqual(command, "npm install -g @openai/codex --registry='https://registry.example.com'");
});

test('appendInstallRegistryOption skips registry for uninstall action', () => {
    const context = createContext({
        installRegistryPreset: 'custom',
        installRegistryCustom: 'https://registry.example.com'
    });
    const command = methods.appendInstallRegistryOption.call(context, 'npm uninstall -g @openai/codex', 'uninstall');
    assert.strictEqual(command, 'npm uninstall -g @openai/codex');
});
