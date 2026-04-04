import assert from 'assert';
import {
    readBundledWebUiCss,
    readBundledWebUiHtml,
    readBundledWebUiScript,
    readProjectFile
} from './helpers/web-ui-source.mjs';

test('config template keeps expected config tabs in top and side navigation', () => {
    const html = readBundledWebUiHtml();
    const modalsBasic = readProjectFile('web-ui/partials/index/modals-basic.html');
    const sessionsPanel = readProjectFile('web-ui/partials/index/panel-sessions.html');
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
    assert.match(html, /<span class="selector-title">上下文压缩阈值<\/span>/);
    assert.match(html, /v-model="modelContextWindowInput"/);
    assert.match(html, /v-model="modelAutoCompactTokenLimitInput"/);
    assert.match(html, /@focus="editingCodexBudgetField = 'modelContextWindowInput'"/);
    assert.match(html, /@focus="editingCodexBudgetField = 'modelAutoCompactTokenLimitInput'"/);
    assert.match(html, /@blur="onModelContextWindowBlur"/);
    assert.match(html, /@blur="onModelAutoCompactTokenLimitBlur"/);
    assert.match(html, /@keydown\.enter\.prevent="onModelContextWindowBlur"/);
    assert.match(html, /@keydown\.enter\.prevent="onModelAutoCompactTokenLimitBlur"/);
    assert.doesNotMatch(html, /使用自定义数字输入框；失焦或回车后会按当前 Codex 配置规范写入模板。/);
    assert.match(
        html,
        /<button[^>]*@click="resetCodexContextBudgetDefaults"[^>]*>[\s\S]*?重置默认值[\s\S]*?<\/button>/
    );
    assert.match(html, /class="codex-config-grid"/);
    assert.match(html, /onSettingsTabClick\('backup'\)/);
    assert.match(html, /onSettingsTabClick\('trash'\)/);
    assert.match(html, /settingsTab === 'backup'/);
    assert.match(html, /settingsTab === 'trash'/);
    assert.match(html, /sessionTrashCount/);
    assert.match(html, /id="side-tab-market"/);
    assert.match(html, /id="tab-market"/);
    assert.match(html, /data-main-tab="market"/);
    assert.match(html, /onMainTabPointerDown\('market', \$event\)/);
    assert.match(html, /onMainTabClick\('market', \$event\)/);
    assert.match(html, /aria-controls="panel-market"/);
    assert.match(html, /:aria-selected="mainTab === 'market'"/);
    assert.match(html, /id="panel-market"/);
    assert.match(html, /v-show="mainTab === 'market'"/);
    assert.match(html, /loadSkillsMarketOverview\(\{ forceRefresh: true, silent: false \}\)/);
    assert.match(html, /class="market-grid"/);
    assert.match(html, /class="market-action-grid"/);
    assert.match(html, /skillsTargetApp === 'codex'/);
    assert.match(html, /skillsTargetApp === 'claude'/);
    assert.match(html, /setSkillsTargetApp\('codex', \{ silent: false \}\)/);
    assert.match(html, /setSkillsTargetApp\('claude', \{ silent: false \}\)/);
    const targetSwitchButtons = [...html.matchAll(
        /<button[\s\S]*?:class="\['market-target-chip', \{ active: skillsTargetApp === '(codex|claude)' \}\]"[\s\S]*?@click="setSkillsTargetApp\('\1', \{ silent: false \}\)"[\s\S]*?>/g
    )];
    assert.strictEqual(targetSwitchButtons.length, 4);
    for (const [buttonMarkup] of targetSwitchButtons) {
        assert.match(buttonMarkup, /:disabled="loading \|\| !!initError \|\| skillsMarketBusy"/);
    }
    assert.match(html, /@click="loadSkillsMarketOverview\(\{ forceRefresh: true, silent: false \}\)" :disabled="loading \|\| !!initError \|\| skillsMarketBusy"/);
    assert.match(html, /<button class="market-action-card" @click="openSkillsManager" :disabled="loading \|\| !!initError \|\| skillsMarketBusy">/);
    assert.match(html, /<button class="market-action-card" @click="scanImportableSkills\(\{ silent: false \}\)" :disabled="loading \|\| !!initError \|\| skillsMarketBusy">/);
    assert.match(html, /<button class="market-action-card" @click="triggerSkillsZipImport" :disabled="loading \|\| !!initError \|\| skillsMarketBusy">/);
    assert.match(html, /class="market-target-switch" role="group" aria-label="选择 Skills 安装目标"/);
    assert.match(html, /class="market-target-switch market-target-switch-compact" role="group" aria-label="选择 Skills 管理目标"/);
    assert.doesNotMatch(html, /class="market-target-switch" role="tablist" aria-label="选择 Skills 安装目标"/);
    assert.doesNotMatch(html, /class="market-target-switch market-target-switch-compact" role="tablist" aria-label="选择 Skills 管理目标"/);
    assert.match(html, /skillsDefaultRootPath/);
    assert.match(html, /可直接导入/);
    assert.doesNotMatch(html, /在线生态目录/);
    assert.doesNotMatch(html, /查看在线目录/);
    assert.doesNotMatch(html, /skillsMarketRemoteCount/);
    assert.doesNotMatch(html, /loadOnlineSkillsMarket\(\{ forceRefresh: true, silent: false \}\)/);
    assert.doesNotMatch(html, /resetOnlineSkillsMarketSearch/);
    assert.doesNotMatch(html, /class="market-online-list"/);
    assert.doesNotMatch(html, /class="market-ecosystem-grid"/);
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
    assert.match(html, /class="settings-tab-actions trash-header-actions"/);
    assert.match(html, /<button class="btn-tool btn-tool-compact" @click="loadSessionTrash\(\{ forceRefresh: true \}\)"/);
    assert.match(html, /<button class="btn-tool btn-tool-compact" @click="clearSessionTrash"/);
    assert.doesNotMatch(html, /<span class="selector-title">会话回收站<\/span>/);
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
    assert.match(html, /data-main-tab=\"market\"/);
    assert.match(html, /data-config-mode=\"codex\"/);
    assert.match(html, /isMainTabNavActive\('settings'\)/);
    assert.match(html, /isMainTabNavActive\('market'\)/);
    assert.match(html, /isConfigModeNavActive\('codex'\)/);
    assert.match(html, /:aria-pressed="isSessionPinned\(session\)"/);
    assert.match(
        sessionsPanel,
        /:class="\[[\s\S]*'session-item'[\s\S]*@click="selectSession\(session\)"[\s\S]*@keydown\.enter\.self\.prevent="selectSession\(session\)"[\s\S]*@keydown\.space\.self\.prevent="selectSession\(session\)"[\s\S]*tabindex="0"[\s\S]*role="button"[\s\S]*:aria-current="activeSessionExportKey === getSessionExportKey\(session\) \? 'true' : null"/
    );
    assert.match(html, /class="session-item-copy session-item-pin"/);
    assert.match(html, /class="pin-icon"/);
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
    assert.match(modalsBasic, /<div v-if="showAddModal" class="modal-overlay" @click\.self="closeAddModal">/);
    assert.match(modalsBasic, /<div v-if="showModelModal" class="modal-overlay" @click\.self="closeModelModal">/);
    assert.match(modalsBasic, /<div v-if="showClaudeConfigModal" class="modal-overlay" @click\.self="closeClaudeConfigModal">/);
    for (const modalTitleId of [
        'add-provider-modal-title',
        'install-cli-modal-title',
        'edit-provider-modal-title',
        'add-model-modal-title',
        'manage-models-modal-title',
        'add-claude-config-modal-title',
        'edit-claude-config-modal-title'
    ]) {
        assert.match(modalsBasic, new RegExp(`aria-labelledby="${modalTitleId}"`));
        assert.match(modalsBasic, new RegExp(`id="${modalTitleId}"`));
    }
    assert.doesNotMatch(modalsBasic, /type="password"/);
    assert.match(modalsBasic, /<button type="button" class="btn-remove-model" @click="removeModel\(model\)">删除<\/button>/);
    assert.doesNotMatch(modalsBasic, /<span class="btn-remove-model" @click="removeModel\(model\)">删除<\/span>/);
});

test('web ui script defines provider mode metadata for codex only', () => {
    const appScript = readBundledWebUiScript();
    const constantsSource = readProjectFile('web-ui/modules/app.constants.mjs');
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
    assert.match(appScript, /providerSwitchDisplayTarget:\s*''/);
    assert.match(appScript, /const switching = String\(this\.providerSwitchDisplayTarget \|\| ''\)\.trim\(\);/);
    assert.match(appScript, /if \(switching\) return switching;/);
    assert.match(appScript, /modelContextWindowInput:\s*String\(DEFAULT_MODEL_CONTEXT_WINDOW\)/);
    assert.match(appScript, /modelAutoCompactTokenLimitInput:\s*String\(DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT\)/);
    assert.match(appScript, /editingCodexBudgetField:\s*''/);
    assert.match(appScript, /statusRes\.modelContextWindow/);
    assert.match(appScript, /statusRes\.modelAutoCompactTokenLimit/);
    assert.match(appScript, /onModelContextWindowBlur\(\)/);
    assert.match(appScript, /onModelAutoCompactTokenLimitBlur\(\)/);
    assert.match(appScript, /resetCodexContextBudgetDefaults\(\)/);
    assert.match(appScript, /normalizePositiveIntegerInput\(/);
    assert.match(constantsSource, /export const SESSION_TRASH_LIST_LIMIT = 500;/);
    assert.match(constantsSource, /export const SESSION_TRASH_PAGE_SIZE = 200;/);
    assert.match(appScript, /settingsTab:\s*'backup'/);
    assert.match(appScript, /skillsTargetApp:\s*'codex'/);
    assert.match(appScript, /skillsMarketLoading:\s*false/);
    assert.match(appScript, /skillsMarketLocalLoadedOnce:\s*false/);
    assert.match(appScript, /skillsMarketImportLoadedOnce:\s*false/);
    assert.doesNotMatch(appScript, /skillsMarketRemoteLoading:\s*false/);
    assert.doesNotMatch(appScript, /skillsMarketRemoteLoadedOnce:\s*false/);
    assert.doesNotMatch(appScript, /skillsMarketRemoteItems:\s*\[\]/);
    assert.doesNotMatch(appScript, /skillsMarketRemoteLatestOnly:\s*true/);
    assert.doesNotMatch(appScript, /skillsMarketEcosystems:\s*\[\]/);
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
    assert.match(helperScript, /const shouldLoadSkillsMarketOnEnter = nextTab === 'market'/);
    assert.match(helperScript, /previousTab !== 'market'/);
    assert.match(helperScript, /let marketOverviewLoad = null;/);
    assert.match(helperScript, /marketOverviewLoad = this\.loadSkillsMarketOverview\(\{ silent: true \}\);/);
    assert.match(helperScript, /void Promise\.resolve\(marketOverviewLoad\)\.catch\(\(\) => \{\}\);/);
});

test('trash item styles stay aligned with session card layout and keep mobile usability', () => {
    const styles = readBundledWebUiCss();
    const mobile520Start = styles.indexOf('@media (max-width: 520px)');
    const mobile540Start = styles.indexOf('@media (max-width: 540px)');

    assert.notStrictEqual(mobile520Start, -1, '520px media block should exist');
    assert(mobile540Start > mobile520Start, '540px media block should appear after 520px block');

    const mobile520Block = styles.slice(mobile520Start, mobile540Start);

    assert.match(styles, /\.session-source\s*\{/);
    assert.match(styles, /\.trash-item\.session-item\s*\{[\s\S]*height:\s*auto;/);
    assert.match(styles, /\.session-item:focus-visible\s*\{[\s\S]*outline:\s*3px solid rgba\(201,\s*94,\s*75,\s*0\.25\);[\s\S]*outline-offset:\s*2px;/);
    assert.match(styles, /\.trash-item-title\s*\{[\s\S]*-webkit-line-clamp:\s*2;/);
    assert.match(styles, /\.trash-item-side\s*\{[\s\S]*min-width:\s*132px;/);
    assert.match(styles, /\.trash-item-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(108px,\s*108px\)\);/);
    assert.match(styles, /\.trash-item-actions \.btn-mini\s*\{[\s\S]*min-height:\s*36px;/);
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
    assert.match(styles, /@media \(max-width: 540px\)\s*\{[\s\S]*\.trash-header-actions\s*\{[\s\S]*display:\s*grid;/);
    assert.match(styles, /@media \(max-width: 540px\)\s*\{[\s\S]*\.trash-header-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    assert.match(styles, /@media \(max-width: 540px\)\s*\{[\s\S]*\.trash-header-actions\s*\{[\s\S]*width:\s*100%;/);
    assert.match(
        styles,
        /@media \(max-width: 540px\)\s*\{[\s\S]*\.selector-header \.trash-header-actions > \.btn-tool,\s*[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;[\s\S]*min-height:\s*44px;/
    );
    assert.doesNotMatch(styles, /@media \(max-width: 540px\)\s*\{[\s\S]*\.session-item-copy\.session-item-pin\s*\{[\s\S]*width:\s*44px;/);
    assert.doesNotMatch(
        styles,
        /@media \(max-width: 540px\)\s*\{[\s\S]*\.session-item-copy\.session-item-pin svg,\s*[\s\S]*width:\s*16px;/
    );
    assert.match(styles, /\.codex-config-grid\s*\{/);
    assert.match(styles, /\.codex-config-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(240px,\s*100%\),\s*1fr\)\);/);
    assert.match(styles, /\.codex-config-field\s*\{/);
    assert.match(styles, /\.codex-config-field\s*\{[\s\S]*min-width:\s*0;/);
});

test('settings tab header actions keep compact tool buttons inline on wider screens', () => {
    const styles = readBundledWebUiCss();

    assert.match(styles, /\.settings-tab-header\s*\{[\s\S]*justify-content:\s*flex-end;/);
    assert.match(styles, /\.settings-tab-header\s*\{[\s\S]*align-items:\s*center;/);
    assert.match(styles, /\.settings-tab-actions\s*\{[\s\S]*display:\s*flex;/);
    assert.match(
        styles,
        /\.settings-tab-actions \.btn-tool,\s*\.settings-tab-actions \.btn-tool-compact\s*\{[\s\S]*width:\s*auto;/
    );
    assert.match(styles, /\.trash-header-actions\s*\{[\s\S]*display:\s*flex;/);
    assert.match(styles, /\.trash-header-actions\s*\{[\s\S]*flex-direction:\s*row;/);
    assert.match(styles, /\.trash-header-actions\s*\{[\s\S]*flex-wrap:\s*nowrap;/);
    assert.match(styles, /\.trash-header-actions\s*\{[\s\S]*align-items:\s*stretch;/);
    assert.match(styles, /\.trash-header-actions\s*\{[\s\S]*justify-content:\s*flex-end;/);
    assert.match(styles, /\.trash-header-actions\s*\{[\s\S]*max-width:\s*100%;/);
    assert.match(styles, /\.selector-header \.trash-header-actions > \.btn-tool,\s*\.selector-header \.trash-header-actions > \.btn-tool-compact\s*\{[\s\S]*display:\s*flex;/);
    assert.match(styles, /\.selector-header \.trash-header-actions > \.btn-tool,\s*\.selector-header \.trash-header-actions > \.btn-tool-compact\s*\{[\s\S]*align-self:\s*stretch;/);
    assert.match(styles, /\.selector-header \.trash-header-actions > \.btn-tool,\s*\.selector-header \.trash-header-actions > \.btn-tool-compact\s*\{[\s\S]*margin:\s*0;/);
    assert.match(styles, /\.selector-header \.trash-header-actions > \.btn-tool,\s*\.selector-header \.trash-header-actions > \.btn-tool-compact\s*\{[\s\S]*width:\s*auto;/);
    assert.match(styles, /\.selector-header \.trash-header-actions > \.btn-tool,\s*\.selector-header \.trash-header-actions > \.btn-tool-compact\s*\{[\s\S]*min-width:\s*0;/);
    assert.match(styles, /\.selector-header \.trash-header-actions > \.btn-tool,\s*\.selector-header \.trash-header-actions > \.btn-tool-compact\s*\{[\s\S]*max-width:\s*100%;/);
    assert.match(styles, /\.selector-header \.trash-header-actions > \.btn-tool,\s*\.selector-header \.trash-header-actions > \.btn-tool-compact\s*\{[\s\S]*height:\s*32px;/);
    assert.match(styles, /\.selector-header \.trash-header-actions > \.btn-tool,\s*\.selector-header \.trash-header-actions > \.btn-tool-compact\s*\{[\s\S]*min-height:\s*32px;/);
    assert.match(styles, /\.selector-header \.trash-header-actions > \.btn-tool,\s*\.selector-header \.trash-header-actions > \.btn-tool-compact\s*\{[\s\S]*line-height:\s*1;/);
    assert.match(styles, /\.selector-header \.trash-header-actions > \.btn-tool,\s*\.selector-header \.trash-header-actions > \.btn-tool-compact\s*\{[\s\S]*vertical-align:\s*top;/);
    assert.match(styles, /\.selector-header \.trash-header-actions > \.btn-tool,\s*\.selector-header \.trash-header-actions > \.btn-tool-compact\s*\{[\s\S]*top:\s*0;/);
    assert.match(styles, /\.selector-header \.trash-header-actions > \.btn-tool,\s*\.selector-header \.trash-header-actions > \.btn-tool-compact\s*\{[\s\S]*white-space:\s*nowrap;/);
    assert.match(styles, /\.selector-header \.trash-header-actions > \.btn-tool \+ \.btn-tool\s*\{[\s\S]*margin-top:\s*0;/);
    assert.match(styles, /\.selector-header \.trash-header-actions > \.btn-tool:hover,\s*\.selector-header \.trash-header-actions > \.btn-tool-compact:hover\s*\{[\s\S]*transform:\s*none;/);
    assert.match(styles, /\.market-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    assert.match(styles, /\.market-action-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
    assert.match(styles, /\.market-target-switch\s*\{/);
    assert.match(styles, /\.market-target-chip\.active\s*\{/);
    assert.match(styles, /\.market-target-chip:disabled,\s*\.market-target-chip\[disabled\]\s*\{/);
    assert.match(styles, /\.market-panel-wide\s*\{/);
    assert.match(styles, /--radius-md:\s*[0-9.]+(?:px|rem);/);
    assert.match(styles, /--font-weight-primary:\s*[0-9]+;/);
    assert.match(styles, /--font-size-large:\s*[0-9.]+(?:px|rem);/);
    assert.doesNotMatch(styles, /\.market-online-list\s*\{/);
    assert.doesNotMatch(styles, /\.market-ecosystem-grid\s*\{/);
});
