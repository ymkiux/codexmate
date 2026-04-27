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

test('npm package includes plugins directory for Web UI runtime imports', () => {
    const pkg = readJson(path.join(projectRoot, 'package.json'));
    const files = Array.isArray(pkg.files) ? pkg.files : [];
    assert.ok(files.includes('plugins/'), 'package.json files must include plugins/');
});

