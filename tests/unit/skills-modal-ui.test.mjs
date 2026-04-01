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
    assert.match(appScript, /confirmDialogConfirmDisabled:\s*false/);
    assert.match(appScript, /confirmDialogDisableWhen:\s*null/);
    assert.match(appScript, /requestConfirmDialog\(/);
    assert.match(appScript, /isConfirmDialogDisabled\(\)/);
    assert.match(appScript, /isConfirmDialogDisabled\(\)\s*\{[\s\S]*catch \(_\)\s*\{\s*return true;\s*\}/);
    assert.match(appScript, /resolveConfirmDialog\(/);

    assert.match(skillsComputed, /skillsConfiguredCount\(\)/);
    assert.match(skillsComputed, /skillsMissingSkillFileCount\(\)/);
    assert.match(skillsComputed, /skillsImportConfiguredCount\(\)/);
    assert.match(skillsComputed, /skillsImportMissingSkillFileCount\(\)/);
    assert.match(skillsComputed, /skillsFilterDirty\(\)/);
    assert.match(skillsComputed, /skillsTargetLabel\(\)/);
    assert.match(skillsComputed, /skillsDefaultRootPath\(\)/);
    assert.doesNotMatch(skillsComputed, /skillsMarketRemoteCount\(\)/);

    assert.match(skillsMethods, /setSkillsTargetApp\(app,\s*options = \{\}\)/);
    assert.match(skillsMethods, /resetSkillsFilters\(\)/);
    assert.match(skillsMethods, /skillsZipImporting/);
    assert.match(skillsMethods, /skillsExporting/);
    assert.match(skillsMethods, /importSkillsFromZipFile/);
    assert.match(skillsMethods, /exportSelectedSkills\(\)/);
    assert.match(skillsMethods, /requestConfirmDialog\(/);
    assert.match(skillsMethods, /api\('list-skills'/);
    assert.match(skillsMethods, /api\('scan-unmanaged-skills'/);
    assert.match(skillsMethods, /api\('import-skills'/);
    assert.match(skillsMethods, /api\('export-skills'/);
    assert.match(skillsMethods, /api\('delete-skills'/);
    assert.doesNotMatch(skillsMethods, /api\('list-online-skills-market'/);
    assert.doesNotMatch(skillsMethods, /window\.confirm\(/);
});

test('skills modal styles define summary and panel layout hooks', () => {
    const styles = readProjectFile('web-ui/styles.css');
    const html = readProjectFile('web-ui/index.html');
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
    assert.match(styles, /\.market-target-chip/);
    assert.match(styles, /\.market-target-chip:disabled,\s*\.market-target-chip\[disabled\]/);
    assert.doesNotMatch(styles, /\.market-online-toolbar/);
    assert.doesNotMatch(styles, /\.market-ecosystem-card/);
    assert.match(html, /:disabled="isConfirmDialogDisabled\(\)"/);
});
