import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const coderabbitConfigPath = path.join(projectRoot, '.coderabbit.yaml');

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

test('coderabbit requested changes workflow is disabled', () => {
    const config = fs.readFileSync(coderabbitConfigPath, 'utf8');
    assert.match(config, /request_changes_workflow:\s*false/);
    assert.doesNotMatch(config, /request_changes_workflow:\s*true/);
});
