import assert from 'assert';
import {
    readBundledWebUiHtml,
    readBundledWebUiScript,
    readProjectFile
} from './helpers/web-ui-source.mjs';

test('agents modal exposes diff preview hooks in template and script', () => {
    const template = readBundledWebUiHtml();
    assert.match(template, /agentsDiffVisible/);
    assert.match(template, /agentsDiffLines/);
    assert.match(template, /agents-diff/);
    assert.match(template, /agents-diff-editor/);
    assert.match(template, /agentsDiffHasChanges/);
    assert.match(template, /agents-diff-hint/);
    assert.match(template, /agents-diff-save-alert/);
    assert.match(template, /t\('modal\.agents\.unsaved\.detectedHint'\)/);
    assert.match(template, /t\('modal\.agents\.hint\.shortcuts'\)/);
    assert.match(template, /agentsDiffTruncated/);
    assert.match(template, /@click\.self="!configTemplateApplying && closeConfigTemplateModal\(\)"/);
    assert.match(template, /:readonly="configTemplateApplying \|\| configTemplateDiffLoading"/);
    assert.match(template, /<button class="btn btn-cancel" @click="closeConfigTemplateModal" :disabled="configTemplateApplying \|\| configTemplateDiffLoading">\{\{\s*t\('common\.cancel'\)\s*\}\}<\/button>/);
    assert.match(template, /:readonly="agentsLoading \|\| agentsSaving"/);
    assert.match(template, /agentsDiffVisible\s*\?\s*t\('common\.apply'\)/);
    assert.match(template, /t\('common\.applying'\)/);
    assert.match(template, /showConfirmDialog/);
    assert.match(template, /confirm-dialog/);
    assert.match(template, /aria-describedby="confirm-dialog-message"/);
    assert.match(template, /:aria-labelledby="confirmDialogTitle \? 'confirm-dialog-title' : null"/);
    assert.match(template, /id="confirm-dialog-title"/);
    assert.match(template, /id="confirm-dialog-message"/);

    const script = readBundledWebUiScript();
    assert.match(script, /agentsDiffVisible:\s*false/);
    assert.match(script, /prepareAgentsDiff\(/);
    assert.match(script, /resetAgentsDiffState\(/);
    assert.match(script, /handleGlobalKeydown\(/);
    assert.match(script, /handleBeforeUnload\(/);
    assert.match(script, /hasPendingAgentsDraft\(/);
    assert.match(script, /window\.addEventListener\('keydown', this\.handleGlobalKeydown\)/);
    assert.match(script, /window\.removeEventListener\('keydown', this\.handleGlobalKeydown\)/);
    assert.match(script, /window\.addEventListener\('beforeunload', this\.handleBeforeUnload\)/);
    assert.match(script, /window\.removeEventListener\('beforeunload', this\.handleBeforeUnload\)/);
    assert.match(script, /requestConfirmDialog\(/);
    assert.match(script, /resolveConfirmDialog\(/);
    assert.match(script, /放弃并关闭/);
    assert.doesNotMatch(script, /window\.confirm\(/);
});

test('agents diff preview avoids extra file reads and caps api payload size', () => {
    const cliSource = readProjectFile('cli.js');
    assert.match(cliSource, /MAX_API_BODY_SIZE/);
    assert.match(cliSource, /bodySize\s*>\s*MAX_API_BODY_SIZE/);
    assert.match(cliSource, /buildAgentsDiff[\s\S]*metaOnly/);

    const appSource = readBundledWebUiScript();
    assert.match(appSource, /buildAgentsDiffPreviewRequest\(/);
    assert.match(appSource, /previewRequest\.exceedsBodyLimit/);
    assert.match(appSource, /applyPreviewState\(buildAgentsDiffPreview\(/);
});
