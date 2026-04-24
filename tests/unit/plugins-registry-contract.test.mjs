import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const root = path.join(__dirname, '..', '..');
const registryPath = path.join(root, 'plugins', 'registry.mjs');
const generator = require(path.join(root, 'tools', 'dev', 'generate-plugins-registry.js'));

test('plugins registry matches generator output', () => {
    const actual = fs.readFileSync(registryPath, 'utf8').replace(/^\uFEFF/u, '');
    const expected = String(generator.generatePluginsRegistrySource() || '').replace(/^\uFEFF/u, '');
    assert.strictEqual(actual, expected);
});

