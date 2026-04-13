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

test('ci workflow contract stays aligned with local npm test coverage', () => {
    const ciWorkflow = fs.readFileSync(path.join(projectRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const pkg = readJson(path.join(projectRoot, 'package.json'));

    assert.match(ciWorkflow, /\bpull_request:\s*$/m);
    assert.match(ciWorkflow, /\bpush:\s*$/m);
    assert.match(ciWorkflow, /-\s+name:\s+Install[\s\S]*?run:\s+npm run ci:install\b/m);
    assert.match(ciWorkflow, /-\s+name:\s+Lint[\s\S]*?run:\s+npm run ci:lint\b/m);
    assert.match(ciWorkflow, /-\s+name:\s+Test[\s\S]*?run:\s+npm run ci:test\b/m);

    assert.strictEqual(pkg.scripts['ci:install'], 'node tools/ci/run-check.js install');
    assert.strictEqual(pkg.scripts['ci:lint'], 'node tools/ci/run-check.js lint');
    assert.strictEqual(pkg.scripts['ci:test'], 'node tools/ci/run-check.js test');
    assert.strictEqual(pkg.scripts.test, 'npm run test:unit && npm run test:e2e');
    assert.strictEqual(pkg.scripts['test:ci'], 'node tools/ci/run-check.js all');
    assert.strictEqual(pkg.scripts['test:unit'], 'node tests/unit/run.mjs');
    assert.strictEqual(pkg.scripts['test:e2e'], 'node tests/e2e/run.js');
});
