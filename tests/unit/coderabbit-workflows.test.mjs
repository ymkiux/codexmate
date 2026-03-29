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

test('coderabbit autofix workflow skips fork pull requests and uses github-script v8', () => {
    const workflow = readProjectFile('.github/workflows/coderabbit-autofix.yml');
    assert.match(workflow, /github\.event\.pull_request\.head\.repo\.fork == false/);
    assert.match(workflow, /uses:\s+actions\/github-script@v8/);
});

test('coderabbit review workflow uses github-script v8 and sends the re-review command', () => {
    const workflow = readProjectFile('.github/workflows/coderabbit-review.yml');
    assert.match(workflow, /uses:\s+actions\/github-script@v8/);
    assert.match(workflow, /@coderabbitai re-review ！Stop making breaking changes, do a proper review！/);
});
