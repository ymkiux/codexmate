import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..');

function readText(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), 'utf-8').replace(/\r\n?/g, '\n');
}

test('sessions header actions keep buttons inline (contract)', () => {
    const html = readText('web-ui/partials/index/panel-sessions.html');
    assert(
        html.includes('selector-actions sessions-header-actions'),
        'panel-sessions should mark header actions with sessions-header-actions'
    );

    const css = readText('web-ui/styles/controls-forms.css');
    assert(
        /\.selector-header\s*\{[\s\S]*?flex-wrap:\s*nowrap\s*;[\s\S]*?\}/m.test(css),
        'controls-forms.css should force selector-header to nowrap'
    );
    assert(
        /\.sessions-header-actions\s*\{[\s\S]*?display:\s*inline-flex\s*!important\s*;[\s\S]*?flex-wrap:\s*nowrap\s*!important\s*;[\s\S]*?\}/m.test(css),
        'controls-forms.css should force sessions-header-actions inline-flex nowrap'
    );
    assert(
        /\.sessions-header-actions\s*>\s*\.btn-tool[\s\S]*?width:\s*auto\s*!important\s*;/m.test(css),
        'controls-forms.css should force sessions-header-actions > .btn-tool width auto'
    );
    assert(
        /\.sessions-header-actions\s*>\s*\.btn-tool-compact[\s\S]*?width:\s*auto\s*!important\s*;/m.test(css),
        'controls-forms.css should force sessions-header-actions > .btn-tool-compact width auto'
    );
    assert(
        !/\.sessions-header-actions\s*\{[\s\S]*?flex-wrap:\s*wrap\b/m.test(css),
        'sessions-header-actions must not allow flex-wrap: wrap'
    );

    const stylesDir = path.join(projectRoot, 'web-ui', 'styles');
    const styleFiles = fs.readdirSync(stylesDir)
        .filter((name) => name.endsWith('.css'))
        .map((name) => path.join(stylesDir, name));
    const unexpectedOverrides = [];
    for (const filePath of styleFiles) {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.includes('sessions-header-actions') && !filePath.endsWith(path.join('styles', 'controls-forms.css'))) {
            unexpectedOverrides.push(path.basename(filePath));
        }
    }
    assert.deepStrictEqual(
        unexpectedOverrides,
        [],
        `sessions-header-actions should not be overridden in other stylesheets: ${unexpectedOverrides.join(', ')}`
    );
});
