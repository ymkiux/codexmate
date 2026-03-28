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

test('agents modal exposes diff preview hooks in template and script', () => {
    const template = readProjectFile('web-ui/index.html');
    assert.match(template, /agentsDiffVisible/);
    assert.match(template, /agentsDiffLines/);
    assert.match(template, /agents-diff/);
    assert.match(template, /agents-diff-editor/);
    assert.match(template, /agentsDiffHasChanges/);
    assert.match(template, /agentsDiffTruncated/);
    assert.match(template, /:readonly="agentsLoading"/);
    assert.match(template, /v-if="!agentsDiffVisible"/);
    assert.match(template, /agentsDiffVisible \? '应用'/);
    assert.match(template, /应用中\.\.\./);

    const script = readProjectFile('web-ui/app.js');
    assert.match(script, /agentsDiffVisible:\s*false/);
    assert.match(script, /prepareAgentsDiff\(/);
    assert.match(script, /resetAgentsDiffState\(/);
});
