import {
    DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT,
    DEFAULT_MODEL_CONTEXT_WINDOW,
    DEFAULT_OPENCLAW_TEMPLATE,
    SESSION_TRASH_PAGE_SIZE
} from './modules/app.constants.mjs';
import { createAppComputed } from './modules/app.computed.index.mjs';
import { createAppMethods } from './modules/app.methods.index.mjs';
import { loadConfigTemplateDiffConfirmEnabledFromStorage } from './modules/config-template-confirm-pref.mjs';

document.addEventListener('DOMContentLoaded', () => {
    if (typeof Vue === 'undefined') {
        console.error('Vue 库未能在 DOMContentLoaded 触发前加载完成。');
        const fallbackTarget = document.querySelector('#app') || document.querySelector('[v-cloak]');
        if (fallbackTarget) {
            fallbackTarget.removeAttribute('v-cloak');
            fallbackTarget.classList.remove('v-cloak');
            fallbackTarget.innerHTML = '';
            const notice = document.createElement('div');
            notice.className = 'fallback-message';
            notice.textContent = 'Web UI 加载失败：Vue 未加载。请检查网络或刷新页面。';
            fallbackTarget.appendChild(notice);
        }
        return;
    }

    const { createApp } = Vue;

    const app = createApp({
        data() {
            return {
                lang: 'zh',
                mainTab: 'dashboard',
                configMode: 'codex',
                currentProvider: '',
                currentModel: '',
                serviceTier: 'fast',
                modelReasoningEffort: 'medium',
                modelContextWindowInput: String(DEFAULT_MODEL_CONTEXT_WINDOW),
                modelAutoCompactTokenLimitInput: String(DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT),
                editingCodexBudgetField: '',
                providersList: [],
                models: [],
                codexModelsLoading: false,
                modelsSource: 'remote',
                modelsHasCurrent: true,
                claudeModels: [],
                claudeModelsSource: 'idle',
                claudeModelsHasCurrent: true,
                claudeModelsLoading: false,
                codexModelsRequestSeq: 0,
                claudeModelsRequestSeq: 0,
                loading: true,
                initError: '',
                message: '',
                messageType: '',
                showAddModal: false,
                showEditModal: false,
                showModelModal: false,
                showModelListModal: false,
                showClaudeConfigModal: false,
                showEditConfigModal: false,
                showOpenclawConfigModal: false,
                showConfigTemplateModal: false,
                showAgentsModal: false,
                showSkillsModal: false,
                showHealthCheckModal: false,
                // Plugins
                pluginsActiveId: 'prompt-templates',
                pluginsLoading: false,
                pluginsError: '',
                promptTemplatesListRaw: [],
                promptTemplatesLoadedOnce: false,
                promptTemplatesKeyword: '',
                promptTemplateSelectedId: '',
                promptTemplateDraftRaw: null,
                promptTemplateVarValuesRaw: {},
                promptTemplatesMode: 'compose',
                promptComposerCommand: '',
                promptComposerPickerVisible: false,
                promptComposerPickerKeyword: '',
                promptComposerSelectedTemplateId: '',
                promptComposerVarValuesRaw: {},
                showPromptTemplateVarModal: false,
                promptTemplateVarDraftName: '',
                promptTemplateVarDraftError: '',
                showConfirmDialog: false,
                confirmDialogTitle: '',
                confirmDialogMessage: '',
                confirmDialogConfirmText: '确认',
                confirmDialogCancelText: '取消',
                confirmDialogDanger: false,
                confirmDialogConfirmDisabled: false,
                confirmDialogDisableWhen: null,
                confirmDialogResolver: null,
                configTemplateContent: '',
                configTemplateApplying: false,
                configTemplateDiffVisible: false,
                configTemplateDiffLoading: false,
                configTemplateDiffError: '',
                configTemplateDiffLines: [],
                configTemplateDiffStats: {
                    added: 0,
                    removed: 0,
                    unchanged: 0
                },
                configTemplateDiffHasChangesValue: false,
                configTemplateDiffFingerprint: '',
                _configTemplateDiffPreviewRequestToken: null,
                configTemplateDiffConfirmEnabled: true,
                codexApplying: false,
                _pendingCodexApplyOptions: null,
                agentsContent: '',
                agentsPath: '',
                agentsPath: '',
                agentsExists: false,
                agentsLineEnding: '\n',
                agentsLoading: false,
                agentsSaving: false,
                agentsOriginalContent: '',
                agentsDiffVisible: false,
                agentsDiffLoading: false,
                agentsDiffError: '',
                agentsDiffLines: [],
                agentsDiffStats: {
                    added: 0,
                    removed: 0,
                    unchanged: 0
                },
                agentsDiffTruncated: false,
                agentsDiffHasChangesValue: false,
                agentsDiffFingerprint: '',
                agentsContext: 'codex',
                agentsModalTitle: 'AGENTS.md 编辑器',
                agentsModalHint: '保存后会写入目标 AGENTS.md（与 config.toml 同级）。',
                skillsTargetApp: 'codex',
                skillsRootPath: '',
                skillsList: [],
                skillsSelectedNames: [],
                skillsLoading: false,
                skillsDeleting: false,
                skillsKeyword: '',
                skillsStatusFilter: 'all',
                skillsImportList: [],
                skillsImportSelectedKeys: [],
                skillsScanningImports: false,
                skillsImporting: false,
                skillsZipImporting: false,
                skillsExporting: false,
                skillsMarketLoading: false,
                skillsMarketLocalLoadedOnce: false,
                skillsMarketImportLoadedOnce: false,
                sessionPinnedMap: {},
                __mainTabSwitchState: {
                    intent: '',
                    pendingTarget: '',
                    pendingConfigMode: '',
                    ticket: 0
                },
                sessionsViewMode: 'browser',
                sessionsUsageTimeRange: '7d',
                sessionsUsageList: [],
                sessionsUsageLoadedOnce: false,
                sessionsUsageLoadedLimit: 0,
                sessionsUsageLoading: false,
                sessionsUsageError: '',
                sessionsList: [],
                sessionsLoadedOnce: false,
                sessionsLoading: false,
                sessionFilterSource: 'all',
                sessionPathFilter: '',
                sessionQuery: '',
                sessionRoleFilter: 'all',
                sessionTimePreset: 'all',
                sessionResumeWithYolo: true,
                sessionPathOptions: [],
                sessionPathOptionsLoading: false,
                sessionPathOptionsMap: {
                    all: [],
                    codex: [],
                    claude: [],
                    gemini: []
                },
                sessionPathOptionsLoadedMap: {
                    all: false,
                    codex: false,
                    claude: false,
                    gemini: false
                },
                sessionPathRequestSeqMap: {
                    all: 0,
                    codex: 0,
                    claude: 0,
                    gemini: 0
                },
                sessionExporting: {},
                sessionConverting: {},
                sessionCloning: {},
                sessionDeleting: {},
                activeSession: null,
                activeSessionMessages: [],
                activeSessionDetailError: '',
                activeSessionDetailClipped: false,
                sessionDetailLoading: false,
                sessionDetailRequestSeq: 0,
                sessionDetailInitialMessageLimit: 80,
                sessionDetailFetchStep: 80,
                sessionDetailMessageLimit: 80,
                sessionDetailMessageLimitCap: 1000,
                sessionTimelineActiveKey: '',
                sessionTimelineRafId: 0,
                sessionTimelineLastSyncAt: 0,
                sessionTimelineLastScrollTop: 0,
                sessionTimelineLastAnchorY: 0,
                sessionTimelineLastDirection: 0,
                sessionTimelineEnabled: true,
                sessionMessageRefMap: Object.create(null),
                sessionMessageRefBinderMap: Object.create(null),
                sessionPreviewScrollEl: null,
                sessionPreviewContainerEl: null,
                sessionPreviewHeaderEl: null,
                sessionPreviewHeaderResizeObserver: null,
                sessionListRenderEnabled: false,
                sessionListVisibleCount: 0,
                sessionListInitialBatchSize: 20,
                sessionListLoadStep: 40,
                sessionPreviewRenderEnabled: false,
                sessionTabRenderTicket: 0,
                sessionPreviewVisibleCount: 0,
                sessionPreviewInitialBatchSize: 12,
                sessionPreviewLoadStep: 24,
                sessionPreviewPendingVisibleCount: 0,
                sessionPreviewLoadingMore: false,
                sessionStandalone: false,
                sessionStandaloneError: '',
                sessionStandaloneText: '',
                sessionStandaloneTitle: '',
                sessionStandaloneSourceLabel: '',
                sessionStandaloneLoading: false,
                sessionStandaloneRequestSeq: 0,
                speedResults: {},
                speedLoading: {},
                claudeSpeedResults: {},
                claudeSpeedLoading: {},
                claudeShareLoading: {},
                providerShareLoading: {},
                shareCommandPrefix: 'npm start',
                providerSwitchInProgress: false,
                pendingProviderSwitch: '',
                providerSwitchDisplayTarget: '',
                healthCheckBatchTotal: 0,
                healthCheckBatchDone: 0,
                healthCheckBatchFailed: 0,
                installPackageManager: 'npm',
                installCommandAction: 'install',
                installRegistryPreset: 'default',
                installRegistryCustom: '',
                installStatusTargets: null,
                newProvider: { name: '', url: '', key: '', useTransform: false },
                resetConfigLoading: false,
                editingProvider: { name: '', url: '', key: '', readOnly: false, nonEditable: false },
                newModelName: '',
                currentClaudeConfig: '',
                currentClaudeModel: '',
                editingConfig: { name: '', apiKey: '', baseUrl: '', model: '' },
                claudeConfigs: {
                    '智谱GLM': {
                        apiKey: '',
                        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
                        model: 'glm-4.7',
                        hasKey: false
                    }
                },
                newClaudeConfig: {
                    name: '',
                    apiKey: '',
                    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
                    model: 'glm-4.7'
                },
                currentOpenclawConfig: '',
                openclawConfigs: {
                    '默认配置': {
                        content: DEFAULT_OPENCLAW_TEMPLATE
                    }
                },
                openclawEditing: { name: '', content: '', lockName: false },
                openclawEditorTitle: '添加 OpenClaw 配置',
                openclawConfigPath: '',
                openclawConfigExists: false,
                openclawLineEnding: '\n',
                openclawAuthProfilesByProvider: {},
                openclawPendingAuthProfileUpdates: {},
                openclawFileLoading: false,
                openclawSaving: false,
                openclawApplying: false,
                openclawWorkspaceFileName: 'SOUL.md',
                agentsWorkspaceFileName: '',
                openclawStructured: {
                    agentPrimary: '',
                    agentFallbacks: [],
                    workspace: '',
                    timeout: '',
                    contextTokens: '',
                    maxConcurrent: '',
                    envItems: [],
                    toolsProfile: 'default',
                    toolsAllow: [],
                    toolsDeny: []
                },
                openclawQuick: {
                    providerName: '',
                    baseUrl: '',
                    baseUrlReadOnly: false,
                    baseUrlDisplayKind: 'missing',
                    apiKey: '',
                    apiKeyReadOnly: false,
                    apiKeyDisplayKind: 'missing',
                    apiKeySourceKind: '',
                    apiKeySourceProfileId: '',
                    apiKeySourceWriteField: '',
                    apiKeySourceOriginalValue: '',
                    apiKeySourceCredentialType: '',
                    apiType: 'openai-responses',
                    modelId: '',
                    modelName: '',
                    contextWindow: '',
                    maxTokens: '',
                    setPrimary: true,
                    overrideProvider: true,
                    overrideModels: true,
                    showKey: false
                },
                openclawAgentsList: [],
                openclawProviders: [],
                openclawMissingProviders: [],
                healthCheckLoading: false,
                healthCheckResult: null,
                healthCheckRemote: false,
                claudeDownloadLoading: false,
                claudeDownloadProgress: 0,
                claudeDownloadTimer: null,
                codexDownloadLoading: false,
                codexDownloadProgress: 0,
                codexDownloadTimer: null,
                settingsTab: 'backup',
                sessionTrashEnabled: true,
                sessionTrashItems: [],
                sessionTrashVisibleCount: SESSION_TRASH_PAGE_SIZE,
                sessionTrashTotalCount: 0,
                sessionTrashCountLoadedOnce: false,
                sessionTrashLoadedOnce: false,
                sessionTrashLastLoadFailed: false,
                sessionTrashCountRequestToken: 0,
                sessionTrashListRequestToken: 0,
                sessionTrashCountPendingOptions: null,
                sessionTrashPendingOptions: null,
                sessionTrashCountLoading: false,
                sessionTrashLoading: false,
                sessionTrashRestoring: {},
                sessionTrashPurging: {},
                sessionTrashClearing: false,
                claudeImportLoading: false,
                codexImportLoading: false,
                codexAuthProfiles: [],
                forceCompactLayout: false,
                taskOrchestrationTabEnabled: true,
                taskOrchestration: {
                    loading: false,
                    planning: false,
                    running: false,
                    queueAdding: false,
                    queueStarting: false,
                    retrying: false,
                    target: '',
                    title: '',
                    notes: '',
                    followUpsText: '',
                    workflowIdsText: '',
                    selectedEngine: 'codex',
                    runMode: 'write',
                    concurrency: 2,
                    autoFixRounds: 1,
                    plan: null,
                    planFingerprint: '',
                    planIssues: [],
                    planWarnings: [],
                    overviewWarnings: [],
                    workflows: [],
                    queue: [],
                    runs: [],
                    selectedRunId: '',
                    workspaceTab: 'queue',
                    selectedRunDetail: null,
                    selectedRunLoading: false,
                    selectedRunError: '',
                    detailRequestToken: 0,
                    lastLoadedAt: '',
                    lastError: ''
                },
                _taskOrchestrationPollTimer: 0
            };
        },

        mounted() {
            if (typeof this.initI18n === 'function') {
                this.initI18n();
            }
            if (typeof this.t === 'function') {
                this.confirmDialogConfirmText = this.t('confirm.ok');
                this.confirmDialogCancelText = this.t('confirm.cancel');
                this.agentsModalTitle = this.t('modal.agents.title');
                this.agentsModalHint = this.t('modal.agents.hint');
            }
            {
                const NAV_STATE_STORAGE_KEY = 'codexmateNavState.v1';
                const mainTabSet = new Set(['dashboard', 'config', 'sessions', 'usage', 'orchestration', 'market', 'plugins', 'docs', 'settings']);
                let restored = null;
                try {
                    const raw = localStorage.getItem(NAV_STATE_STORAGE_KEY) || '';
                    restored = raw ? JSON.parse(raw) : null;
                } catch (_) {
                    restored = null;
                }
                const nextMainTab = restored && typeof restored.mainTab === 'string'
                    ? restored.mainTab.trim().toLowerCase()
                    : '';
                const nextConfigMode = restored && typeof restored.configMode === 'string'
                    ? restored.configMode.trim().toLowerCase()
                    : '';
                let urlMainTab = '';
                try {
                    const url = new URL(window.location.href);
                    if (url.pathname !== '/session') {
                        urlMainTab = String(url.searchParams.get('tab') || '').trim().toLowerCase();
                    }
                } catch (_) {
                    urlMainTab = '';
                }
                const resolvedMainTab = urlMainTab && mainTabSet.has(urlMainTab)
                    ? urlMainTab
                    : nextMainTab;
                if (nextConfigMode && typeof this.switchConfigMode === 'function') {
                    this.__navStateRestoring = true;
                    try {
                        if (nextConfigMode === 'codex' || nextConfigMode === 'claude' || nextConfigMode === 'openclaw') {
                            this.configMode = nextConfigMode;
                        }
                        if (resolvedMainTab && mainTabSet.has(resolvedMainTab) && resolvedMainTab !== this.mainTab) {
                            this.switchMainTab(resolvedMainTab);
                        }
                    } finally {
                        this.__navStateRestoring = false;
                    }
                } else if (resolvedMainTab && mainTabSet.has(resolvedMainTab) && resolvedMainTab !== this.mainTab) {
                    this.__navStateRestoring = true;
                    try {
                        this.switchMainTab(resolvedMainTab);
                    } finally {
                        this.__navStateRestoring = false;
                    }
                }
            }
            this.initSessionStandalone();
            this.updateCompactLayoutMode();
            if (!this.taskOrchestrationTabEnabled && this.mainTab === 'orchestration') {
                this.mainTab = 'config';
            }
            const savedSessionYolo = localStorage.getItem('codexmateSessionResumeYolo');
            if (savedSessionYolo === '0' || savedSessionYolo === 'false') {
                this.sessionResumeWithYolo = false;
            } else if (savedSessionYolo === '1' || savedSessionYolo === 'true') {
                this.sessionResumeWithYolo = true;
            }
            this.restoreSessionFilterCache();
            this.restoreSessionPinnedMap();
            this.shareCommandPrefix = this.normalizeShareCommandPrefix(localStorage.getItem('codexmateShareCommandPrefix'));
            this.sessionTrashEnabled = this.normalizeSessionTrashEnabled(localStorage.getItem('codexmateSessionTrashEnabled'));
            this.configTemplateDiffConfirmEnabled = loadConfigTemplateDiffConfirmEnabledFromStorage(localStorage);
            window.addEventListener('resize', this.onWindowResize);
            window.addEventListener('keydown', this.handleGlobalKeydown);
            window.addEventListener('beforeunload', this.handleBeforeUnload);
            const savedConfigs = localStorage.getItem('claudeConfigs');
            if (savedConfigs) {
                try {
                    this.claudeConfigs = JSON.parse(savedConfigs);
                    for (const [name, config] of Object.entries(this.claudeConfigs)) {
                        if (config.apiKey && config.apiKey.includes('****')) {
                            config.apiKey = '';
                            config.hasKey = false;
                        }
                    }
                    localStorage.setItem('claudeConfigs', JSON.stringify(this.claudeConfigs));
                } catch (e) {
                    console.error('加载 Claude 配置失败:', e);
                }
            }
            const normalizeOpenclawConfigs = (configs) => {
                const source = configs && typeof configs === 'object' && !Array.isArray(configs)
                    ? configs
                    : {};
                const defaultEntry = source['默认配置']
                    && typeof source['默认配置'] === 'object'
                    && !Array.isArray(source['默认配置'])
                        ? source['默认配置']
                        : { content: DEFAULT_OPENCLAW_TEMPLATE };
                const normalized = {
                    '默认配置': {
                        content: typeof defaultEntry.content === 'string' ? defaultEntry.content : DEFAULT_OPENCLAW_TEMPLATE
                    }
                };
                for (const [name, value] of Object.entries(source)) {
                    if (name === '默认配置') continue;
                    normalized[name] = value;
                }
                return normalized;
            };
            const savedOpenclawConfigs = localStorage.getItem('openclawConfigs');
            if (savedOpenclawConfigs) {
                try {
                    this.openclawConfigs = normalizeOpenclawConfigs(JSON.parse(savedOpenclawConfigs));
                } catch (e) {
                    console.error('加载 OpenClaw 配置失败:', e);
                    this.openclawConfigs = normalizeOpenclawConfigs(this.openclawConfigs);
                }
            } else {
                this.openclawConfigs = normalizeOpenclawConfigs(this.openclawConfigs);
            }
            const configNames = Object.keys(this.openclawConfigs);
            if (configNames.length > 0) {
                this.currentOpenclawConfig = this.openclawConfigs['默认配置'] ? '默认配置' : configNames[0];
            }
            const runInitialLoad = () => {
                const triggerLoad = async () => {
                    this._initialLoadTimer = 0;
                    const startupOk = await this.loadAll();
                    if (!startupOk) {
                        return;
                    }
                    if (this.mainTab === 'dashboard') {
                        if (!this.__doctorLoadedOnce) {
                            this.__doctorLoadedOnce = true;
                            if (typeof this.runHealthCheck === 'function') {
                                void this.runHealthCheck({ doctor: true, silent: true });
                            }
                        }
                    }
                    void this.refreshClaudeSelectionFromSettings({ silent: true });
                    void this.syncDefaultOpenclawConfigEntry({ silent: true });
                };
                if (typeof requestAnimationFrame === 'function') {
                    this._initialLoadRafId = requestAnimationFrame(() => {
                        this._initialLoadRafId = 0;
                        if (typeof setTimeout === 'function') {
                            this._initialLoadTimer = setTimeout(triggerLoad, 120);
                            return;
                        }
                        triggerLoad();
                    });
                    return;
                }
                if (typeof setTimeout === 'function') {
                    this._initialLoadTimer = setTimeout(triggerLoad, 120);
                    return;
                }
                triggerLoad();
            };
            if (document.readyState === 'complete') {
                runInitialLoad();
            } else {
                this._initialLoadOnWindowLoad = () => {
                    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
                        window.removeEventListener('load', this._initialLoadOnWindowLoad);
                    }
                    this._initialLoadOnWindowLoad = null;
                    runInitialLoad();
                };
                window.addEventListener('load', this._initialLoadOnWindowLoad, { once: true });
            }
        },

        beforeUnmount() {
            this.teardownSessionTabRender();
            this.cancelScheduledSessionTabDeferredTeardown();
            this.disconnectSessionPreviewHeaderResizeObserver();
            if (this._initialLoadOnWindowLoad) {
                window.removeEventListener('load', this._initialLoadOnWindowLoad);
                this._initialLoadOnWindowLoad = null;
            }
            if (this._initialLoadRafId) {
                cancelAnimationFrame(this._initialLoadRafId);
                this._initialLoadRafId = 0;
            }
            if (this._initialLoadTimer) {
                clearTimeout(this._initialLoadTimer);
                this._initialLoadTimer = 0;
            }
            window.removeEventListener('resize', this.onWindowResize);
            window.removeEventListener('keydown', this.handleGlobalKeydown);
            window.removeEventListener('beforeunload', this.handleBeforeUnload);
            this.applyCompactLayoutClass(false);
            this.stopTaskOrchestrationPolling();
            this.sessionPreviewScrollEl = null;
            this.sessionPreviewContainerEl = null;
            this.sessionPreviewHeaderEl = null;
            this.clearSessionTimelineRefs();
        },

        computed: createAppComputed(),
        methods: createAppMethods()
    });

    app.mount('#app');
});
