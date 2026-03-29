import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

function readProjectFile(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

test('coderabbit autofix workflow is removed', () => {
    assert.strictEqual(
        fs.existsSync(path.join(projectRoot, '.github', 'workflows', 'coderabbit-autofix.yml')),
        false
    );
});

test('coderabbit review workflow uses github-script v8 and sends the re-review command', () => {
    const workflow = readProjectFile('.github/workflows/coderabbit-review.yml');
    assert.match(workflow, /uses:\s+actions\/github-script@v8/);
    assert.match(workflow, /@coderabbitai re-review ！Stop making breaking changes, do a proper review！/);
});
