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

test('skills modal template includes overview counters and reset entry', () => {
    const html = readProjectFile('web-ui/index.html');
    assert.match(html, /skills-summary-strip/);
    assert.match(html, /skillsConfiguredCount/);
    assert.match(html, /skillsMissingSkillFileCount/);
    assert.match(html, /resetSkillsFilters/);
});

test('skills modal script exposes derived counters and filter reset method', () => {
    const script = readProjectFile('web-ui/app.js');
    assert.match(script, /skillsConfiguredCount\(\)/);
    assert.match(script, /skillsMissingSkillFileCount\(\)/);
    assert.match(script, /skillsImportConfiguredCount\(\)/);
    assert.match(script, /skillsImportMissingSkillFileCount\(\)/);
    assert.match(script, /skillsFilterDirty\(\)/);
    assert.match(script, /resetSkillsFilters\(\)/);
});

test('skills modal styles define summary and panel layout hooks', () => {
    const styles = readProjectFile('web-ui/styles.css');
    assert.match(styles, /\.form-select/);
    assert.match(styles, /\.skills-summary-strip/);
    assert.match(styles, /\.skills-summary-item/);
    assert.match(styles, /\.skills-panel/);
    assert.match(styles, /\.skills-panel-header/);
    assert.match(styles, /\.skill-item-path/);
    assert.match(styles, /\.skill-list::\-webkit-scrollbar/);
    assert.match(styles, /\.skill-list::\-webkit-scrollbar-thumb/);
});
