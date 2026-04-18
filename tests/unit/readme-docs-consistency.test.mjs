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

test('README OpenClaw state diagram includes the documented runtime config file', () => {
    const readme = readProjectFile('README.md');
    const readmeZh = readProjectFile('README.zh.md');
    assert.match(
        readme,
        /OPENCLAW\["~\/\.openclaw\/\*\.json5 \+ ~\/\.openclaw\/openclaw\.json \+ workspace\/AGENTS\.md"\]/
    );
    assert.match(
        readmeZh,
        /OPENCLAW\["~\/\.openclaw\/\*\.json5 \+ ~\/\.openclaw\/openclaw\.json \+ workspace\/AGENTS\.md"\]/
    );
});
