import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

test('coderabbit autofix workflow is removed', () => {
    assert.strictEqual(
        fs.existsSync(path.join(projectRoot, '.github', 'workflows', 'coderabbit-autofix.yml')),
        false
    );
});

test('coderabbit review workflow is removed', () => {
    assert.strictEqual(
        fs.existsSync(path.join(projectRoot, '.github', 'workflows', 'coderabbit-review.yml')),
        false
    );
});
