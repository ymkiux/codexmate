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

test('app script includes compact layout detection and body class toggling', () => {
    const appScript = readProjectFile('web-ui/app.js');
    assert.match(appScript, /forceCompactLayout:\s*false/);
    assert.match(appScript, /updateCompactLayoutMode\(\)/);
    assert.match(appScript, /shouldForceCompactLayout\(\)/);
    assert.match(appScript, /applyCompactLayoutClass\(enabled\)/);
    assert.match(appScript, /shouldForceCompactLayoutMode\(\{/);
    assert.match(appScript, /classList\.toggle\('force-compact'/);
});

test('styles include force-compact fallback rules for readability on touch devices', () => {
    const styles = readProjectFile('web-ui/styles.css');
    assert.match(styles, /\.card-trailing\s*\{[\s\S]*align-items:\s*start;[\s\S]*align-self:\s*flex-start;/);
    assert.match(styles, /\.card-trailing\s+\.card-actions\s*\{[\s\S]*justify-self:\s*end;/);
    assert.match(styles, /\.card-trailing\s+\.pill,\s*[\s\S]*justify-self:\s*end;/);
    assert.match(styles, /body\.force-compact\s*\{/);
    assert.match(styles, /body\.force-compact\s+\.app-shell\s*\{/);
    assert.match(styles, /body\.force-compact\s+\.status-inspector\s*\{[\s\S]*display:\s*none;/);
    assert.match(styles, /body\.force-compact\s+\.top-tabs\s*\{[\s\S]*display:\s*grid\s*!important;[\s\S]*grid-template-columns:\s*repeat\(1,\s*minmax\(0,\s*1fr\)\);/);
    assert.match(styles, /@media\s*\(min-width:\s*541px\)\s*\{[\s\S]*body\.force-compact\s+\.top-tabs\s*\{[\s\S]*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    assert.match(styles, /body\.force-compact\s+\.card-subtitle/);
    const compactSubtitleBlock = styles.match(/body\.force-compact\s+\.card-subtitle\s*\{[^}]*\}/);
    assert.ok(compactSubtitleBlock, 'missing compact subtitle block');
    assert.match(compactSubtitleBlock[0], /overflow:\s*hidden;/);
    assert.doesNotMatch(compactSubtitleBlock[0], /word-break:\s*break-word;/);
    assert.match(styles, /body\.force-compact\s+\.provider-fast-switch\s*\{/);
    assert.match(styles, /body\.force-compact\s+\.card\s*\{[\s\S]*flex-direction:\s*column;/);
    assert.match(styles, /body\.force-compact\s+\.card-trailing\s*\{[\s\S]*justify-items:\s*end;/);
    assert.match(styles, /body\.force-compact\s+\.card-trailing\s+\.card-actions\s*\{[\s\S]*justify-content:\s*flex-end;/);
    assert.match(styles, /body\.force-compact\s+\.card-trailing\s+\.pill,\s*[\s\S]*justify-self:\s*end;/);
    assert.match(styles, /body\.force-compact\s+\.card-actions\s*\{[\s\S]*opacity:\s*1;/);
});

test('styles keep desktop layout wide and session history readable on large screens', () => {
    const styles = readProjectFile('web-ui/styles.css');
    assert.match(styles, /\.container\s*\{[\s\S]*max-width:\s*2200px;/);
    assert.match(styles, /\.session-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(260px,\s*360px\)\s*minmax\(0,\s*1fr\);/);
    assert.match(styles, /\.session-item\s*\{[\s\S]*min-height:\s*102px;/);

    const titleBlock = styles.match(/\.session-item-title\s*\{[^}]*\}/);
    assert.ok(titleBlock, 'missing session item title style block');
    assert.match(titleBlock[0], /display:\s*-webkit-box;/);
    assert.match(titleBlock[0], /-webkit-line-clamp:\s*2;/);
    assert.match(titleBlock[0], /white-space:\s*normal;/);
    assert.match(titleBlock[0], /max-width:\s*none;/);
});
