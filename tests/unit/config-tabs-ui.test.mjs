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

test('config template keeps expected config tabs in top and side navigation', () => {
    const html = readProjectFile('web-ui/index.html');
    const topTabModes = [...html.matchAll(/id="tab-config-([a-z]+)"/g)]
        .map((match) => match[1]);
    const sideTabModes = [...html.matchAll(/id="side-tab-config-([a-z]+)"/g)]
        .map((match) => match[1]);

    assert.deepStrictEqual(topTabModes, ['codex', 'claude', 'openclaw']);
    assert.deepStrictEqual(sideTabModes, ['codex', 'claude', 'openclaw']);
    assert.match(html, /activeProviderBridgeHint/);
    assert.match(html, /isProviderConfigMode/);
    assert.match(html, /provider-fast-switch-select/);
    assert.match(html, /forceCompactLayout/);
    assert.match(html, /quickSwitchProvider\(\$event\.target\.value\)/);
    assert.match(html, /onMainTabPointerDown\('sessions', \$event\)/);
    assert.match(html, /onConfigTabPointerDown\('codex', \$event\)/);
    assert.match(html, /onMainTabClick\('sessions', \$event\)/);
    assert.match(html, /onConfigTabClick\('codex', \$event\)/);
    assert.match(html, /onSettingsTabClick\('backup'\)/);
    assert.match(html, /onSettingsTabClick\('trash'\)/);
    assert.match(html, /settingsTab === 'backup'/);
    assert.match(html, /settingsTab === 'trash'/);
    assert.match(html, /sessionTrashCount/);
    assert.match(html, /id="settings-tab-backup"/);
    assert.match(html, /id="settings-tab-trash"/);
    assert.match(html, /role="tab"/);
    assert.match(html, /aria-controls="settings-panel-backup"/);
    assert.match(html, /aria-controls="settings-panel-trash"/);
    assert.match(html, /:aria-selected="settingsTab === 'backup'"/);
    assert.match(html, /:aria-selected="settingsTab === 'trash'"/);
    assert.match(html, /id="settings-tab-backup"[\s\S]*tabindex="0"/);
    assert.match(html, /id="settings-tab-trash"[\s\S]*tabindex="0"/);
    assert.match(html, /id="settings-panel-backup"/);
    assert.match(html, /id="settings-panel-trash"/);
    assert.match(html, /<div[\s\S]*v-show="settingsTab === 'backup'"[\s\S]*id="settings-panel-backup"[\s\S]*aria-labelledby="settings-tab-backup">/);
    assert.match(html, /<div[\s\S]*v-show="settingsTab === 'trash'"[\s\S]*id="settings-panel-trash"[\s\S]*aria-labelledby="settings-tab-trash">/);
    assert.match(html, /role="tabpanel"/);
    assert.doesNotMatch(html, /v-if="settingsTab === 'backup'"/);
    assert.match(html, /class="trash-item session-item session-card"/);
    assert.match(html, /class="trash-item-mainline"/);
    assert.match(html, /class="trash-item-side"/);
    assert.match(html, /class="trash-item-time session-item-time"/);
    assert.match(html, /class="trash-item-path session-item-sub session-item-wrap"/);
    assert.match(html, /v-for="item in visibleSessionTrashItems"/);
    assert.match(html, /class="session-source"/);
    assert.match(html, /@click="loadMoreSessionTrashItems"/);
    assert.match(html, /回收站列表加载失败，请刷新重试/);
    assert.match(html, /data-main-tab=\"sessions\"/);
    assert.match(html, /data-config-mode=\"codex\"/);
    assert.match(html, /isMainTabNavActive\('settings'\)/);
    assert.match(html, /isConfigModeNavActive\('codex'\)/);
    assert.doesNotMatch(html, /:aria-pressed=/);
    assert.match(html, /:aria-selected="mainTab === 'sessions'"/);
    assert.match(html, /:aria-selected="mainTab === 'config' && configMode === 'codex'"/);
    assert.match(html, /v-memo="\[activeSessionExportKey === getSessionExportKey\(session\)/);
    assert.match(html, /v-memo="\[msg\.text,\s*msg\.timestamp,\s*msg\.roleLabel,\s*msg\.normalizedRole\]"/);
    assert.match(html, /v-memo="\[sessionTimelineActiveKey === node\.key,\s*node\.safePercent,\s*node\.title\]"/);
    const providerShareButton = html.match(
        /<button[\s\S]*?@click="copyProviderShareCommand\(provider\)"[\s\S]*?aria-label="Share import command">/
    );
    assert(providerShareButton, 'provider share button should exist');
    assert.match(providerShareButton[0], /disabled/);
    assert.match(providerShareButton[0], /title="分享导入命令（暂时禁用）"/);
    assert.match(html, /<button class="card-action-btn"[^>]*@click="copyClaudeShareCommand\(name\)"[^>]*disabled[^>]*>/);
});

test('web ui script defines provider mode metadata for codex only', () => {
    const appScript = readProjectFile('web-ui/app.js');
    const configModeComputed = readProjectFile('web-ui/modules/config-mode.computed.mjs');

    assert.match(appScript, /CONFIG_MODE_SET/);
    assert.match(appScript, /getProviderConfigModeMeta/);
    assert.match(appScript, /createConfigModeComputed/);
    assert.match(appScript, /\.\.\.createConfigModeComputed\(\)/);
    assert.match(appScript, /switchConfigMode\(mode\)/);
    assert.match(appScript, /mode\.trim\(\)\.toLowerCase\(\)/);
    assert.match(appScript, /this\.switchMainTab\('config'\);/);
    assert.match(appScript, /if \(this\.mainTab === 'config'\) {/);
    assert.match(appScript, /this\.clearMainTabSwitchIntent\('config'\);/);
    assert.match(appScript, /setMainTabSwitchIntent\(tab\)/);
    assert.match(appScript, /ensureMainTabSwitchState\(\)/);
    assert.match(appScript, /ensureImmediateNavDomState\(\)/);
    assert.match(appScript, /applyImmediateNavIntent\(tab,\s*configMode = ''\)/);
    assert.match(appScript, /clearImmediateNavIntent\(\)/);
    assert.match(appScript, /setSessionPanelFastHidden\(hidden\)/);
    assert.match(appScript, /isSessionPanelFastHidden\(\)/);
    assert.match(appScript, /recordPointerNavCommit\(kind,\s*value\)/);
    assert.match(appScript, /consumePointerNavCommit\(kind,\s*value\)/);
    assert.match(appScript, /onMainTabPointerDown\(tab\)/);
    assert.match(appScript, /onConfigTabPointerDown\(mode\)/);
    assert.match(appScript, /onMainTabClick\(tab\)/);
    assert.match(appScript, /onConfigTabClick\(mode\)/);
    assert.match(appScript, /if \(pointerType === 'touch'\) {/);
    assert.match(appScript, /node\.classList\.toggle\('nav-intent-active'/);
    assert.match(appScript, /node\.classList\.toggle\('nav-intent-inactive'/);
    assert.match(appScript, /node\.classList\.remove\('nav-intent-active'\)/);
    assert.match(appScript, /node\.classList\.remove\('nav-intent-inactive'\)/);
    assert.match(appScript, /isMainTabNavActive\(tab\)/);
    assert.match(appScript, /isConfigModeNavActive\(mode\)/);
    assert.match(appScript, /const isLeavingSessions = previousTab === 'sessions' && targetTab !== 'sessions';/);
    assert.match(appScript, /if \(targetTab === previousTab\) {/);
    assert.match(appScript, /const shouldDeferApply = isLeavingSessions;/);
    assert.match(appScript, /if \(isLeavingSessions && !this\.isSessionPanelFastHidden\(\)\) {/);
    assert.match(appScript, /switchState\.pendingTarget = targetTab;/);
    assert.match(appScript, /if \(ticket !== liveState\.ticket\) return;/);
    assert.match(appScript, /activeSessionExportKey\(\)/);
    assert.match(appScript, /if \(this\.mainTab !== 'sessions' \|\| !this\.sessionPreviewRenderEnabled\) {/);
    assert.match(appScript, /const scrollRect = scrollEl && typeof scrollEl\.getBoundingClientRect === 'function'/);
    assert.match(appScript, /top = scrollTop \+ \(messageRect\.top - scrollRect\.top\);/);
    assert.match(appScript, /if \(!current \|\| current\.ticket !== this\.sessionTabRenderTicket\) {/);
    assert.match(appScript, /bindSessionMessageRef\(messageKey,\s*el,\s*ticket = this\.sessionTabRenderTicket\)/);
    assert.match(appScript, /this\.getMainTabForNav\(\) !== 'sessions'/);
    assert.match(appScript, /scheduleIdleTask\(task,\s*timeoutMs = 160\)/);
    assert.match(appScript, /scheduleSessionTabDeferredTeardown\(task\)/);
    assert.match(appScript, /cancelScheduledSessionTabDeferredTeardown\(\)/);
    assert.match(appScript, /suspendSessionTabRender\(\)/);
    assert.match(appScript, /finalizeSessionTabTeardown\(\)/);
    assert.match(appScript, /ensureSessionTimelineMeasurementCache\(\)/);
    assert.match(appScript, /invalidateSessionTimelineMeasurementCache\(resetOffset = false\)/);
    assert.match(appScript, /getCachedSessionTimelineMeasuredNodes\(nodes\)/);
    assert.match(appScript, /quickSwitchProvider\(name\)/);
    assert.match(appScript, /performProviderSwitch\(name\)/);
    assert.match(appScript, /waitForCodexApplyIdle\(maxWaitMs = 20000\)/);
    assert.match(appScript, /target === this\.pendingProviderSwitch/);
    assert.match(appScript, /!this\.providerSwitchInProgress && target === this\.currentProvider/);
    assert.match(appScript, /await this\.waitForCodexApplyIdle\(\);/);
    assert.match(appScript, /runLatestOnlyQueue\(/);
    assert.match(appScript, /providerSwitchInProgress:\s*false/);
    assert.match(appScript, /pendingProviderSwitch:\s*''/);
    assert.match(appScript, /const SESSION_TRASH_LIST_LIMIT = 500;/);
    assert.match(appScript, /const SESSION_TRASH_PAGE_SIZE = 200;/);
    assert.match(appScript, /settingsTab:\s*'backup'/);
    assert.match(appScript, /sessionTrashItems:\s*\[\]/);
    assert.match(appScript, /sessionTrashVisibleCount:\s*SESSION_TRASH_PAGE_SIZE/);
    assert.match(appScript, /sessionTrashTotalCount:\s*0/);
    assert.match(appScript, /sessionTrashLoadedOnce:\s*false/);
    assert.match(appScript, /sessionTrashLoading:\s*false/);
    assert.match(appScript, /const totalCount = Number\(this\.sessionTrashTotalCount\);/);
    assert.match(appScript, /visibleSessionTrashItems\(\)/);
    assert.match(appScript, /sessionTrashHasMoreItems\(\)/);
    assert.match(appScript, /sessionTrashHiddenCount\(\)/);
    assert.match(appScript, /normalizeSettingsTab\(tab\)/);
    assert.match(appScript, /switchSettingsTab\(tab,\s*options = \{\}\)/);
    assert.match(appScript, /loadSessionTrash\(options = \{\}\)/);
    assert.match(appScript, /loadMoreSessionTrashItems\(\)/);
    assert.match(appScript, /restoreSessionTrash\(item\)/);
    assert.match(appScript, /purgeSessionTrash\(item\)/);
    assert.match(appScript, /clearSessionTrash\(\)/);
    assert.match(appScript, /buildSessionTrashItemFromSession\(session,\s*result = \{\}\)/);
    assert.match(appScript, /prependSessionTrashItem\(item,\s*options = \{\}\)/);
    assert.match(appScript, /resetSessionTrashVisibleCount\(\)/);
    assert.match(appScript, /normalizeSessionTrashTotalCount\(totalCount,\s*fallbackItems = this\.sessionTrashItems\)/);
    assert.match(appScript, /getSessionTrashViewState\(\)/);
    assert.match(appScript, /this\.sessionTrashTotalCount = this\.normalizeSessionTrashTotalCount\(res\.totalCount,\s*nextItems\);/);
    assert.match(appScript, /this\.sessionTrashTotalCount = this\.normalizeSessionTrashTotalCount\(\s*res && res\.totalCount !== undefined/);
    assert.match(appScript, /messageCount:\s*Number\.isFinite\(Number\(result && result\.messageCount\)\)/);
    assert.match(appScript, /clearActiveSessionState\(\)/);
    assert.match(appScript, /removeSessionFromCurrentList\(session\)/);
    assert.match(appScript, /await this\.removeSessionFromCurrentList\(session\);/);

    assert.match(configModeComputed, /const PROVIDER_CONFIG_MODE_META = Object\.freeze\(/);
    const providerModeKeys = [...configModeComputed.matchAll(/^\s*([a-z]+):\s*Object\.freeze\(/gm)]
        .map((match) => match[1]);
    assert.deepStrictEqual(providerModeKeys, ['codex']);
    assert.match(configModeComputed, /export const CONFIG_MODE_SET = new Set\(/);
    assert.match(configModeComputed, /isProviderConfigMode\(\)/);
    assert.match(configModeComputed, /activeProviderModelPlaceholder\(\)/);
});

test('session helper deferred claude refresh validates live tab and mode before running', () => {
    const helperScript = readProjectFile('web-ui/session-helpers.mjs');
    assert.match(helperScript, /const expectedTab = nextTab;/);
    assert.match(helperScript, /const expectedConfigMode = this\.configMode;/);
    assert.match(helperScript, /if \(this\.mainTab !== expectedTab \|\| this\.configMode !== expectedConfigMode\) return;/);
    assert.match(helperScript, /const shouldLoadTrashListOnSettingsEnter = nextTab === 'settings'/);
    assert.match(helperScript, /this\.settingsTab === 'trash'/);
    assert.match(helperScript, /forceRefresh: !!this\.sessionTrashLoadedOnce/);
    assert.match(helperScript, /const shouldPrimeTrashCountOnSettingsEnter = nextTab === 'settings'/);
    assert.match(helperScript, /this\.settingsTab !== 'trash'/);
    assert.match(helperScript, /this\.sessionTrashLoadedOnce = false;/);
    assert.match(helperScript, /this\.loadSessionTrashCount\(\{ silent: true \}\);/);
});

test('trash item styles stay aligned with session card layout and keep mobile usability', () => {
    const styles = readProjectFile('web-ui/styles.css');
    const mobile520Start = styles.indexOf('@media (max-width: 520px)');
    const mobile540Start = styles.indexOf('@media (max-width: 540px)');

    assert.notStrictEqual(mobile520Start, -1, '520px media block should exist');
    assert(mobile540Start > mobile520Start, '540px media block should appear after 520px block');

    const mobile520Block = styles.slice(mobile520Start, mobile540Start);

    assert.match(styles, /\.session-source\s*\{/);
    assert.match(styles, /\.trash-item\.session-item\s*\{[\s\S]*height:\s*auto;/);
    assert.match(styles, /\.trash-item-title\s*\{[\s\S]*-webkit-line-clamp:\s*2;/);
    assert.match(styles, /\.trash-item-side\s*\{[\s\S]*min-width:\s*132px;/);
    assert.match(styles, /\.trash-item-path\s*\{[\s\S]*grid-template-columns:\s*48px\s+minmax\(0,\s*1fr\);/);
    assert.match(mobile520Block, /\.trash-item-header\s*\{[\s\S]*flex-direction:\s*column;/);
    assert.match(mobile520Block, /\.trash-item-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    assert.match(mobile520Block, /\.trash-item-actions \.btn-mini\s*\{[\s\S]*min-height:\s*40px;/);
    assert.match(styles, /@media \(max-width: 540px\)\s*\{[\s\S]*\.trash-item\.session-item\s*\{[\s\S]*height:\s*auto;/);
    assert.match(styles, /@media \(max-width: 540px\)\s*\{[\s\S]*\.trash-item-header\s*\{[\s\S]*flex-direction:\s*column;/);
    assert.match(styles, /@media \(max-width: 540px\)\s*\{[\s\S]*\.trash-item-mainline\s*\{[\s\S]*flex-direction:\s*column;/);
    assert.match(styles, /@media \(max-width: 540px\)\s*\{[\s\S]*\.trash-item-side\s*\{[\s\S]*width:\s*100%;/);
    assert.match(styles, /@media \(max-width: 540px\)\s*\{[\s\S]*\.trash-item-actions \.btn-mini\s*\{[\s\S]*min-height:\s*44px;/);
    assert.match(styles, /@media \(max-width: 540px\)\s*\{[\s\S]*\.trash-item \.session-count-badge\s*\{[\s\S]*align-self:\s*flex-start;/);
    assert.match(styles, /@media \(max-width: 540px\)\s*\{[\s\S]*\.trash-item-title\s*\{[\s\S]*-webkit-line-clamp:\s*3;/);
});

test('settings tab header actions keep compact tool buttons inline on wider screens', () => {
    const styles = readProjectFile('web-ui/styles.css');

    assert.match(styles, /\.settings-tab-actions\s*\{[\s\S]*display:\s*flex;/);
    assert.match(
        styles,
        /\.settings-tab-actions \.btn-tool,\s*\.settings-tab-actions \.btn-tool-compact\s*\{[\s\S]*width:\s*auto;/
    );
});
