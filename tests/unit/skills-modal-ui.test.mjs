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
    assert.match(html, /triggerSkillsZipImport/);
    assert.match(html, /exportSelectedSkills/);
    assert.match(html, /skillsZipImportInput/);
});

test('skills modal script is modularized and exposes computed/methods from skills modules', () => {
    const appScript = readProjectFile('web-ui/app.js');
    const skillsComputed = readProjectFile('web-ui/modules/skills.computed.mjs');
    const skillsMethods = readProjectFile('web-ui/modules/skills.methods.mjs');

    assert.match(appScript, /createSkillsComputed/);
    assert.match(appScript, /createSkillsMethods/);
    assert.match(appScript, /\.\.\.createSkillsComputed\(\)/);
    assert.match(appScript, /\.\.\.createSkillsMethods\(\{ api \}\)/);
    assert.match(appScript, /showConfirmDialog:\s*false/);
    assert.match(appScript, /requestConfirmDialog\(/);
    assert.match(appScript, /resolveConfirmDialog\(/);

    assert.match(skillsComputed, /skillsConfiguredCount\(\)/);
    assert.match(skillsComputed, /skillsMissingSkillFileCount\(\)/);
    assert.match(skillsComputed, /skillsImportConfiguredCount\(\)/);
    assert.match(skillsComputed, /skillsImportMissingSkillFileCount\(\)/);
    assert.match(skillsComputed, /skillsFilterDirty\(\)/);

    assert.match(skillsMethods, /resetSkillsFilters\(\)/);
    assert.match(skillsMethods, /skillsZipImporting/);
    assert.match(skillsMethods, /skillsExporting/);
    assert.match(skillsMethods, /importSkillsFromZipFile/);
    assert.match(skillsMethods, /exportSelectedSkills\(\)/);
    assert.match(skillsMethods, /requestConfirmDialog\(/);
    assert.doesNotMatch(skillsMethods, /window\.confirm\(/);
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
    assert.match(styles, /\.confirm-dialog/);
    assert.match(styles, /\.confirm-dialog-message/);
});
