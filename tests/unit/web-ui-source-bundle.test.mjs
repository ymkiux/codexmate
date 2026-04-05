import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import {
    projectRoot,
    readBundledWebUiCss,
    readBundledWebUiHtml,
    readBundledWebUiScript,
    readExecutableBundledWebUiModule,
    readExecutableBundledWebUiScript
} from './helpers/web-ui-source.mjs';
import { captureCurrentBundledAppOptions as captureBundledAppOptions } from './helpers/web-ui-app-options.mjs';

const require = createRequire(import.meta.url);
const sourceBundle = require('../../web-ui/source-bundle.cjs');

test('bundled web ui html inlines partials without leaking include directives', () => {
    const html = readBundledWebUiHtml();

    assert.match(html, /id="panel-market"/);
    assert.match(html, /id="settings-panel-trash"/);
    assert.match(html, /id="settings-panel-device"/);
    assert.match(html, /class="modal modal-wide skills-modal"/);
    assert.match(html, /<script type="module" src="\/web-ui\/app\.js"><\/script>/);
    assert.doesNotMatch(html, /<script type="module" src="web-ui\/app\.js"><\/script>/);
    assert.doesNotMatch(html, /<!--\s*@include\s+/);
    assert.notStrictEqual(html.charCodeAt(0), 0xFEFF);
});

test('bundled web ui css inlines split styles without leaving local import directives', () => {
    const css = readBundledWebUiCss();

    assert.match(css, /\.market-grid\s*\{/);
    assert.match(css, /body\.force-compact/);
    assert.match(css, /--radius-md:/);
    assert.doesNotMatch(css, /@import\s+['"]\.\/styles\//);
    assert.notStrictEqual(css.charCodeAt(0), 0xFEFF);
});

test('bundled web ui css keeps session preview headers visible', () => {
    const css = readBundledWebUiCss();

    assert.match(css, /\.session-item-sub\.session-item-snippet\s*\{/);
    assert.doesNotMatch(
        css,
        /\.session-item-sub\.session-item-snippet,\s*\.session-preview-meta,\s*\.session-preview-title\s*\{/s
    );
});

test('bundled web ui script includes split modules once and strips a leading BOM', () => {
    const script = readBundledWebUiScript();
    const constantsMarkers = script.match(/FILE: web-ui\/modules\/app\.constants\.mjs/g) || [];

    assert.match(script, /FILE: web-ui\/app\.js/);
    assert.match(script, /FILE: web-ui\/modules\/app\.methods\.index\.mjs/);
    assert.match(script, /FILE: web-ui\/modules\/app\.constants\.mjs/);
    assert.match(script, /export const DEFAULT_MODEL_CONTEXT_WINDOW = 190000;/);
    assert.strictEqual(constantsMarkers.length, 1);
    assert.notStrictEqual(script.charCodeAt(0), 0xFEFF);
});

test('executable web ui app bundle strips relative module imports and remains loadable', async () => {
    const script = readExecutableBundledWebUiScript();

    assert.doesNotMatch(script, /(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]\.[^'"]+['"]\s*;?/);
    assert.doesNotMatch(script, /(?:^|\n)\s*export\s+\*\s+from\s+['"]\.[^'"]+['"]\s*;?/);
    const appOptions = await captureBundledAppOptions();
    assert.strictEqual(typeof appOptions.data, 'function');
    assert.strictEqual(typeof appOptions.mounted, 'function');
    assert.strictEqual(typeof appOptions.beforeUnmount, 'function');
    assert.strictEqual(typeof appOptions.methods.switchConfigMode, 'function');
    assert.strictEqual(typeof appOptions.methods.loadSessions, 'function');
    assert.strictEqual(typeof appOptions.methods.loadActiveSessionDetail, 'function');
    assert.strictEqual(typeof appOptions.methods.loadMoreSessionMessages, 'function');
    assert.strictEqual(typeof appOptions.computed.activeSessionVisibleMessages, 'function');
});

test('executable logic bundle preserves named exports without leaking split re-exports', async () => {
    const script = readExecutableBundledWebUiModule('web-ui/logic.mjs');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-web-ui-logic-'));
    const tempFile = path.join(tempDir, 'logic.bundle.mjs');

    fs.writeFileSync(tempFile, script, 'utf8');

    assert.doesNotMatch(script, /(?:^|\n)\s*export\s+\*\s+from\s+['"]\.[^'"]+['"]\s*;?/);
    assert.match(script, /export function normalizeClaudeValue/);
    assert.match(script, /export function buildSessionTimelineNodes/);

    try {
        const moduleNs = await import(`${pathToFileURL(tempFile).href}?t=${Date.now()}`);
        assert.strictEqual(typeof moduleNs.normalizeClaudeValue, 'function');
        assert.strictEqual(typeof moduleNs.buildSessionTimelineNodes, 'function');
    } finally {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    }
});

test('source bundle exports the expected entry readers', () => {
    const files = sourceBundle.collectJavaScriptFiles(path.join(projectRoot, 'web-ui', 'app.js'))
        .map(filePath => path.relative(projectRoot, filePath).replace(/\\/g, '/'));

    assert.ok(files.length > 3);
    assert.ok(files.includes('web-ui/modules/app.constants.mjs'));
    assert.ok(files.includes('web-ui/modules/app.methods.index.mjs'));
    assert.strictEqual(files[files.length - 1], 'web-ui/app.js');
    assert.strictEqual(new Set(files).size, files.length);
    assert.strictEqual(typeof sourceBundle.readUtf8Text, 'function');
    assert.strictEqual(typeof sourceBundle.collectJavaScriptFiles, 'function');
    assert.strictEqual(typeof sourceBundle.readBundledWebUiHtml, 'function');
    assert.strictEqual(typeof sourceBundle.readBundledWebUiCss, 'function');
    assert.strictEqual(typeof sourceBundle.readBundledWebUiScript, 'function');
    assert.strictEqual(typeof sourceBundle.readExecutableBundledWebUiScript, 'function');
    assert.strictEqual(typeof sourceBundle.readExecutableBundledJavaScriptModule, 'function');
});

test('source bundle resolves relative module entry paths from the web-ui bundle root', () => {
    const script = sourceBundle.readExecutableBundledJavaScriptModule('web-ui/logic.mjs');

    assert.match(script, /export function normalizeClaudeValue/);
    assert.match(script, /export function buildSessionTimelineNodes/);
});

test('readUtf8Text normalizes lone carriage returns', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-source-bundle-'));
    const tempFile = path.join(tempDir, 'legacy-cr.txt');

    try {
        fs.writeFileSync(tempFile, 'alpha\rbeta\r', 'utf8');
        assert.strictEqual(sourceBundle.readUtf8Text(tempFile), 'alpha\nbeta\n');
    } finally {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    }
});
