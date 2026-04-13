import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

test('package exposes a real lint script backed by local checks', () => {
    const pkg = readJson(path.join(projectRoot, 'package.json'));

    assert.strictEqual(pkg.scripts.lint, 'node tools/dev/lint.js');
    assert.strictEqual(pkg.scripts['ci:lint'], 'node tools/ci/run-check.js lint');
    assert.strictEqual(fs.existsSync(path.join(projectRoot, 'tools', 'dev', 'lint.js')), true);
});
