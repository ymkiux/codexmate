import assert from 'assert';
import {
    readBundledWebUiCss,
    readProjectFile,
    readBundledWebUiScript,
    readBundledWebUiHtml
} from './helpers/web-ui-source.mjs';

test('app script includes compact layout detection and body class toggling', () => {
    const appScript = readBundledWebUiScript();
    assert.match(appScript, /forceCompactLayout:\s*false/);
    assert.match(appScript, /updateCompactLayoutMode\(\)/);
    assert.match(appScript, /shouldForceCompactLayout\(\)/);
    assert.match(appScript, /applyCompactLayoutClass\(enabled\)/);
    assert.match(appScript, /shouldForceCompactLayoutMode\(\{/);
    assert.match(appScript, /classList\.toggle\('force-compact'/);
});

test('styles include force-compact fallback rules for readability on touch devices', () => {
    const styles = readBundledWebUiCss();
    const layoutShell = readProjectFile('web-ui/styles/layout-shell.css');
    assert.match(styles, /\.card-trailing\s*\{[\s\S]*align-items:\s*start;[\s\S]*align-self:\s*flex-start;/);
    assert.match(styles, /\.card-trailing\s+\.card-actions\s*\{[\s\S]*justify-self:\s*end;/);
    assert.match(styles, /\.card-trailing\s+\.pill,\s*[\s\S]*justify-self:\s*end;/);
    assert.match(styles, /\.card-actions\s*\{[\s\S]*pointer-events:\s*none;/);
    assert.match(styles, /\.card:focus-within\s+\.card-actions\s*\{[\s\S]*opacity:\s*1;[\s\S]*transform:\s*translateX\(0\);/);
    assert.match(styles, /\.card:hover\s+\.card-actions\s*\{[\s\S]*pointer-events:\s*auto;/);
    assert.match(styles, /\.card:focus-within\s+\.card-actions\s*\{[\s\S]*pointer-events:\s*auto;/);
    assert.match(styles, /body\.force-compact\s*\{/);
    assert.match(styles, /body\.force-compact\s+\.app-shell\s*\{/);
    assert.match(styles, /body\.force-compact\s+\.status-inspector\s*\{[\s\S]*display:\s*none;/);
    assert.match(styles, /body\.force-compact\s+\.top-tabs\s*\{[\s\S]*display:\s*flex\s*!important;[\s\S]*flex-wrap:\s*nowrap;[\s\S]*overflow-x:\s*auto;/);
    assert.match(styles, /body\.force-compact\s+\.top-tabs::-webkit-scrollbar\s*\{[\s\S]*display:\s*none;/);
    assert.match(layoutShell, /@media\s*\(min-width:\s*721px\)\s*\{[\s\S]*body:not\(.force-compact\)\s+#app\s*>\s*\.top-tabs\s*\{[\s\S]*display:\s*none;/);
    assert.doesNotMatch(layoutShell, /^\s*\.top-tabs\s*\{[\s\S]*display:\s*none\s*!important;/m);
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
    const styles = readBundledWebUiCss();
    assert.match(styles, /\.container\s*\{[\s\S]*max-width:\s*none;[\s\S]*min-height:\s*100vh;/);
    assert.match(styles, /\.app-shell\s*\{[\s\S]*grid-template-columns:\s*248px\s+minmax\(0,\s*1fr\);[\s\S]*min-height:\s*100vh;[\s\S]*height:\s*100vh;[\s\S]*overflow:\s*hidden;/);
    assert.match(styles, /\.side-rail\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-width:\s*none;/);
    assert.match(styles, /\.main-panel\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*height:\s*100vh;[\s\S]*scrollbar-width:\s*none;/);
    assert.match(styles, /\.main-panel-topbar\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*0;/);
    assert.match(styles, /\.side-item-meta\s*\{[\s\S]*display:\s*flex;[\s\S]*opacity:\s*1;/);
    assert.match(styles, /\.brand-logo\s*\{[\s\S]*width:\s*38px;[\s\S]*height:\s*38px;/);
    assert.match(styles, /\.content-wrapper\s*\{[\s\S]*width:\s*min\(100%,\s*1480px\);[\s\S]*max-width:\s*none;/);
    assert.match(styles, /\.mode-content\s*\{[\s\S]*width:\s*100%;/);
    assert.match(styles, /\.trash-item-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(116px,\s*116px\)\);/);
    assert.match(styles, /\.trash-item-actions\s+\.btn-mini\s*\{[\s\S]*height:\s*38px;[\s\S]*min-height:\s*38px;[\s\S]*white-space:\s*nowrap;/);
    assert.match(styles, /\.session-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(260px,\s*360px\)\s*minmax\(0,\s*1fr\);/);
    assert.match(styles, /\.session-preview-scroll\s*\{[\s\S]*padding-right:\s*52px;/);
    assert.match(styles, /\.session-timeline\s*\{[\s\S]*right:\s*4px;[\s\S]*width:\s*44px;/);
    assert.match(styles, /\.session-item\s*\{[\s\S]*min-height:\s*80px;/);

    const html = readBundledWebUiHtml();
    assert.match(html, /class="brand-logo"\s+src="\/res\/logo-pack\.webp"/);

    const titleBlock = styles.match(/\.session-item-title\s*\{[^}]*\}/);
    assert.ok(titleBlock, 'missing session item title style block');
    assert.match(titleBlock[0], /display:\s*-webkit-box;/);
    assert.match(titleBlock[0], /-webkit-line-clamp:\s*2;/);
    assert.match(titleBlock[0], /white-space:\s*normal;/);
    assert.match(titleBlock[0], /max-width:\s*none;/);
});
