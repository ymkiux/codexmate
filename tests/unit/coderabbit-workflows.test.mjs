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

test('coderabbit review workflow only comments when commit count changes and uses an ASCII-safe re-review command', () => {
    const workflow = readProjectFile('.github/workflows/coderabbit-review.yml');
    assert.match(workflow, /uses:\s+actions\/github-script@v8/);
    assert.match(workflow, /github\.paginate\(github\.rest\.issues\.listComments/);
    assert.match(workflow, /codexmate-coderabbit-review-commit-count/);
    assert.match(workflow, /previousCommitCount === pr\.commits/);
    assert.match(workflow, /github\.rest\.issues\.createComment/);
    assert.match(workflow, /@coderabbitai re-review/);
    assert.match(workflow, /Stop making breaking changes, do a proper review!/);
    assert.match(workflow, /If I merge this directly, will it introduce any regressions\? Please list only the impacted issues\./);
    assert.match(workflow, /Do not include style suggestions, speculative concerns, or already-resolved items\./);
    assert.doesNotMatch(workflow, /！/);
});
