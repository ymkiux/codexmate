import {
    normalizeClaudeValue,
    normalizeClaudeConfig,
    normalizeClaudeSettingsEnv,
    matchClaudeConfigFromSettings,
    findDuplicateClaudeConfigName,
    formatLatency,
    buildSpeedTestIssue,
    isSessionQueryEnabled,
    normalizeSessionSource,
    normalizeSessionPathFilter,
    buildSessionFilterCacheState,
    buildSessionTimelineNodes,
    normalizeSessionMessageRole,
    runLatestOnlyQueue,
    shouldForceCompactLayoutMode
} from './logic.mjs';
import {
    switchMainTab as switchMainTabHelper,
    loadSessions as loadSessionsHelper,
    loadActiveSessionDetail as loadActiveSessionDetailHelper,
    loadMoreSessionMessages as loadMoreSessionMessagesHelper
} from './session-helpers.mjs';
import {
    CONFIG_MODE_SET,
    getProviderConfigModeMeta,
    createConfigModeComputed
} from './modules/config-mode.computed.mjs';
import { createSkillsComputed } from './modules/skills.computed.mjs';
import { createSkillsMethods } from './modules/skills.methods.mjs';

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
            const API_BASE = (location && location.origin && location.origin !== 'null')
                ? location.origin
                : 'http://localhost:3737';
            const DEFAULT_OPENCLAW_TEMPLATE = `{
  // OpenClaw config (JSON5)
  agent: {
    model: "gpt-4.1"
  },
  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace"
    }
  }
}`;

            async function api(action, params = {}) {
                const res = await fetch(`${API_BASE}/api`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, params })
                });
                return await res.json();
            }

            const app = createApp({
            data() {
                return {
                    mainTab: 'config',
                    configMode: 'codex',
                    currentProvider: '',
                    currentModel: '',
                    serviceTier: 'fast',
                    modelReasoningEffort: 'high',
                    providersList: [],
                    models: [],
                    codexModelsLoading: false,
                    modelsSource: 'remote',
                    modelsHasCurrent: true,
                    claudeModels: [],
                    claudeModelsSource: 'idle',
                    claudeModelsHasCurrent: true,
                    claudeModelsLoading: false,
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
                    showInstallModal: false,
                    configTemplateContent: '',
                    configTemplateApplying: false,
                    codexApplying: false,
                    agentsContent: '',
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
                    agentsDiffFingerprint: '',
                    agentsContext: 'codex',
                    agentsModalTitle: 'AGENTS.md 编辑器',
                    agentsModalHint: '保存后会写入目标 AGENTS.md（与 config.toml 同级）。',
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
                        claude: []
                    },
                    sessionPathOptionsLoadedMap: {
                        all: false,
                        codex: false,
                        claude: false
                    },
                    sessionPathRequestSeq: 0,
                    sessionExporting: {},
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
                    sessionTimelineEnabled: false,
                    sessionMessageRefMap: Object.create(null),
                    sessionPreviewScrollEl: null,
                    sessionPreviewContainerEl: null,
                    sessionPreviewHeaderEl: null,
                    sessionPreviewHeaderResizeObserver: null,
                    sessionListRenderEnabled: false,
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
                    providerSwitchInProgress: false,
                    pendingProviderSwitch: '',
                    installPackageManager: 'npm',
                    installCommandAction: 'install',
                    installRegistryPreset: 'default',
                    installRegistryCustom: '',
                    installStatusTargets: [
                        {
                            id: 'claude',
                            name: 'Claude Code CLI',
                            packageName: '@anthropic-ai/claude-code',
                            installed: false,
                            bin: 'claude',
                            version: '',
                            commandPath: '',
                            error: ''
                        },
                        {
                            id: 'codex',
                            name: 'Codex CLI',
                            packageName: '@openai/codex',
                            installed: false,
                            bin: 'codex',
                            version: '',
                            commandPath: '',
                            error: ''
                        }
                    ],
                    newProvider: { name: '', url: '', key: '' },
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
                        apiKey: '',
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
                    claudeImportLoading: false,
                    codexImportLoading: false,
                    codexAuthProfiles: [],
                    codexAuthImportLoading: false,
                    codexAuthSwitching: {},
                    codexAuthDeleting: {},
                    proxySettings: {
                        enabled: false,
                        host: '127.0.0.1',
                        port: 8318,
                        provider: '',
                        authSource: 'provider',
                        timeoutMs: 30000
                    },
                    proxyRuntime: null,
                    proxyLoading: false,
                    proxySaving: false,
                    proxyStarting: false,
                    proxyStopping: false,
                    proxyApplying: false,
                    showProxyAdvanced: false,
                    forceCompactLayout: false
                }
            },
            mounted() {
                this.initSessionStandalone();
                this.updateCompactLayoutMode();
                const savedSessionYolo = localStorage.getItem('codexmateSessionResumeYolo');
                if (savedSessionYolo === '0' || savedSessionYolo === 'false') {
                    this.sessionResumeWithYolo = false;
                } else if (savedSessionYolo === '1' || savedSessionYolo === 'true') {
                    this.sessionResumeWithYolo = true;
                }
                this.restoreSessionFilterCache();
                window.addEventListener('resize', this.onWindowResize);
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
                void this.refreshClaudeSelectionFromSettings({ silent: true });
                const savedOpenclawConfigs = localStorage.getItem('openclawConfigs');
                if (savedOpenclawConfigs) {
                    try {
                        this.openclawConfigs = JSON.parse(savedOpenclawConfigs);
                        const configNames = Object.keys(this.openclawConfigs);
                        if (configNames.length > 0) {
                            this.currentOpenclawConfig = configNames[0];
                        }
                    } catch (e) {
                        console.error('加载 OpenClaw 配置失败:', e);
                    }
                } else {
                    const configNames = Object.keys(this.openclawConfigs);
                    if (configNames.length > 0) {
                        this.currentOpenclawConfig = configNames[0];
                    }
                }
                this.loadAll();
            },
            beforeUnmount() {
                this.teardownSessionTabRender();
                this.disconnectSessionPreviewHeaderResizeObserver();
                window.removeEventListener('resize', this.onWindowResize);
                this.applyCompactLayoutClass(false);
                this.sessionPreviewScrollEl = null;
                this.sessionPreviewContainerEl = null;
                this.sessionPreviewHeaderEl = null;
                this.sessionMessageRefMap = Object.create(null);
            },

            computed: {
                isSessionQueryEnabled() {
                    return isSessionQueryEnabled(this.sessionFilterSource);
                },
                activeSessionVisibleMessages() {
                    if (this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) {
                        return [];
                    }
                    const list = Array.isArray(this.activeSessionMessages) ? this.activeSessionMessages : [];
                    const rawCount = Number(this.sessionPreviewVisibleCount);
                    const visibleCount = Number.isFinite(rawCount)
                        ? Math.max(0, Math.floor(rawCount))
                        : 0;
                    if (visibleCount <= 0) {
                        if (!list.length) return [];
                        // Defensive fallback: avoid getting stuck in "正在渲染会话内容..."
                        // when visible count has not been primed yet.
                        return list.slice(0, Math.min(8, list.length));
                    }
                    if (visibleCount >= list.length) return list;
                    return list.slice(0, visibleCount);
                },
                canLoadMoreSessionMessages() {
                    if (this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) {
                        return false;
                    }
                    const total = Array.isArray(this.activeSessionMessages) ? this.activeSessionMessages.length : 0;
                    const visible = Array.isArray(this.activeSessionVisibleMessages) ? this.activeSessionVisibleMessages.length : 0;
                    return total > visible;
                },
                sessionPreviewRemainingCount() {
                    const total = Array.isArray(this.activeSessionMessages) ? this.activeSessionMessages.length : 0;
                    const visible = Array.isArray(this.activeSessionVisibleMessages) ? this.activeSessionVisibleMessages.length : 0;
                    return Math.max(0, total - visible);
                },
                sessionTimelineNodes() {
                    if (!this.sessionTimelineEnabled || this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) {
                        return [];
                    }
                    return buildSessionTimelineNodes(this.activeSessionVisibleMessages, {
                        getKey: (message, index) => this.getRecordRenderKey(message, index)
                    });
                },
                sessionTimelineActiveTitle() {
                    if (!this.sessionTimelineActiveKey) return '';
                    const nodes = Array.isArray(this.sessionTimelineNodes) ? this.sessionTimelineNodes : [];
                    const matched = nodes.find(node => node.key === this.sessionTimelineActiveKey);
                    return matched ? matched.title : '';
                },
                sessionQueryPlaceholder() {
                    if (this.isSessionQueryEnabled) {
                        return '关键词检索（支持 Codex/Claude，例：claude code）';
                    }
                    return '当前来源暂不支持关键词检索';
                },
                agentsDiffHasChanges() {
                    const stats = this.agentsDiffStats || {};
                    const added = Number(stats.added || 0);
                    const removed = Number(stats.removed || 0);
                    return added > 0 || removed > 0;
                },
                claudeModelHasList() {
                    return Array.isArray(this.claudeModels) && this.claudeModels.length > 0;
                },
                claudeModelOptions() {
                    const list = Array.isArray(this.claudeModels) ? [...this.claudeModels] : [];
                    const current = (this.currentClaudeModel || '').trim();
                    if (current && !list.includes(current)) {
                        list.unshift(current);
                    }
                    return list;
                },
                proxyProviderOptions() {
                    const source = Array.isArray(this.providersList) ? this.providersList : [];
                    const list = source
                        .map((item) => (item && typeof item.name === 'string' ? item.name.trim() : ''))
                        .filter((name) => name && name !== 'codexmate-proxy');
                    return Array.from(new Set(list));
                },
                proxyRuntimeDisplayProvider() {
                    if (!this.proxyRuntime) return '';
                    const value = typeof this.proxyRuntime.provider === 'string'
                        ? this.proxyRuntime.provider.trim()
                        : '';
                    return value || 'local';
                },
                installTargetCards() {
                    const targets = Array.isArray(this.installStatusTargets) ? this.installStatusTargets : [];
                    const action = this.normalizeInstallAction(this.installCommandAction);
                    return targets.map((target) => {
                        const id = target && typeof target.id === 'string' ? target.id : '';
                        return {
                            ...target,
                            command: this.getInstallCommand(id, action)
                        };
                    });
                },
                installRegistryPreview() {
                    return this.resolveInstallRegistryUrl(this.installRegistryPreset, this.installRegistryCustom);
                },
                ...createSkillsComputed(),

                ...createConfigModeComputed(),

                inspectorBusyStatus() {
                    const tasks = [];
                    if (this.loading) tasks.push('初始化');
                    if (this.sessionsLoading) tasks.push('会话加载');
                    if (this.codexModelsLoading || this.claudeModelsLoading) tasks.push('模型加载');
                    if (this.codexApplying || this.configTemplateApplying || this.openclawApplying) tasks.push('配置应用');
                    if (this.agentsSaving) tasks.push('AGENTS 保存');
                    if (this.skillsLoading || this.skillsDeleting || this.skillsScanningImports || this.skillsImporting || this.skillsZipImporting || this.skillsExporting) tasks.push('Skills 管理');
                    if (this.proxySaving || this.proxyApplying || this.proxyStarting || this.proxyStopping) tasks.push('代理更新');
                    return tasks.length ? tasks.join(' / ') : '空闲';
                },
                inspectorMessageSummary() {
                    const value = typeof this.message === 'string' ? this.message.trim() : '';
                    return value || '暂无提示';
                },
                inspectorSessionSourceLabel() {
                    if (this.sessionFilterSource === 'codex') return 'Codex';
                    if (this.sessionFilterSource === 'claude') return 'Claude Code';
                    return '全部';
                },
                inspectorSessionPathLabel() {
                    const value = typeof this.sessionPathFilter === 'string' ? this.sessionPathFilter.trim() : '';
                    return value || '全部路径';
                },
                inspectorSessionQueryLabel() {
                    if (!this.isSessionQueryEnabled) return '当前来源不支持';
                    const value = typeof this.sessionQuery === 'string' ? this.sessionQuery.trim() : '';
                    return value || '未设置';
                },
                inspectorHealthStatus() {
                    if (this.initError) return '读取失败';
                    if (this.loading) return '初始化中';
                    return '正常';
                },
                inspectorHealthTone() {
                    if (this.initError) return 'error';
                    if (this.loading) return 'warn';
                    return 'ok';
                },
                inspectorModelLoadStatus() {
                    if (this.codexModelsLoading || this.claudeModelsLoading) {
                        return '加载中';
                    }
                    if (this.modelsSource === 'error' || this.claudeModelsSource === 'error') {
                        return '加载异常';
                    }
                    return '正常';
                },
                inspectorProxyStatus() {
                    if (this.proxySaving || this.proxyApplying || this.proxyStarting || this.proxyStopping) {
                        return '状态更新中';
                    }
                    if (this.proxyRuntime && this.proxyRuntime.running === true) {
                        return `运行中（${this.proxyRuntimeDisplayProvider}）`;
                    }
                    return '未运行';
                },
                installTroubleshootingTips() {
                    const platform = this.resolveInstallPlatform();
                    if (platform === 'win32') {
                        return [
                            'PowerShell 报权限不足（EACCES/EPERM）时，请以管理员身份执行安装命令。',
                            '安装后若仍提示找不到命令，重开终端并执行：where codex / where claude。',
                            '公司网络受限时，可先切换镜像源快捷项（npmmirror / 腾讯云 / 自定义）。'
                        ];
                    }
                    return [
                        '出现 EACCES 权限错误时，优先修复 Node 全局目录权限，不建议直接 sudo npm。',
                        '安装后若命令未生效，重开终端并执行：which codex / which claude。',
                        '公司网络受限时，可先切换镜像源快捷项（npmmirror / 腾讯云 / 自定义）。'
                    ];
                }
            },
            methods: {
                async loadAll() {
                    this.loading = true;
                    this.initError = '';
                    try {
                        const [statusRes, listRes] = await Promise.all([api('status'), api('list')]);

                        if (statusRes.error) {
                            this.initError = statusRes.error;
                        } else {
                            this.currentProvider = statusRes.provider;
                            this.currentModel = statusRes.model;
                            {
                                const tier = typeof statusRes.serviceTier === 'string'
                                    ? statusRes.serviceTier.trim().toLowerCase()
                                    : '';
                                this.serviceTier = tier === 'fast' ? 'fast' : (tier ? 'standard' : 'fast');
                            }
                            {
                                const effort = typeof statusRes.modelReasoningEffort === 'string'
                                    ? statusRes.modelReasoningEffort.trim().toLowerCase()
                                    : '';
                                this.modelReasoningEffort = effort || 'high';
                            }
                            this.providersList = listRes.providers;
                            if (statusRes.configReady === false) {
                                this.showMessage('配置已加载', 'info');
                            }
                            if (statusRes.initNotice) {
                                this.showMessage('配置就绪', 'info');
                            }
                            this.maybeShowStarPrompt();
                        }
                    } catch (e) {
                        this.initError = '连接失败: ' + e.message;
                    } finally {
                        this.loading = false;
                    }

                    // 模型加载单独异步，不阻塞主 loading
                    try {
                        await this.loadModelsForProvider(this.currentProvider);
                    } catch (e) {
                        // loadModelsForProvider 内部已有 toast，这里吞掉防止抛出
                    }

                    try {
                        await Promise.all([
                            this.loadCodexAuthProfiles(),
                            this.loadProxyStatus()
                        ]);
                    } catch (e) {
                        // 认证/代理状态加载失败不阻塞主界面
                    }
                },

                async loadModelsForProvider(providerName, options = {}) {
                    const silentError = !!options.silentError;
                    this.codexModelsLoading = true;
                    if (!providerName) {
                        this.models = [];
                        this.modelsSource = 'unlimited';
                        this.modelsHasCurrent = true;
                        this.codexModelsLoading = false;
                        return;
                    }
                    try {
                        const res = await api('models', { provider: providerName });
                        if (res.unlimited) {
                            this.models = [];
                            this.modelsSource = 'unlimited';
                            this.modelsHasCurrent = true;
                            return;
                        }
                        if (res.error) {
                            if (!silentError) {
                                this.showMessage('获取模型列表失败', 'error');
                            }
                            this.models = [];
                            this.modelsSource = 'error';
                            this.modelsHasCurrent = true;
                            return;
                        }
                        const list = Array.isArray(res.models) ? res.models : [];
                        this.models = list;
                        this.modelsSource = res.source || 'remote';
                        this.modelsHasCurrent = !!this.currentModel && list.includes(this.currentModel);
                    } catch (e) {
                        if (!silentError) {
                            this.showMessage('获取模型列表失败', 'error');
                        }
                        this.models = [];
                        this.modelsSource = 'error';
                        this.modelsHasCurrent = true;
                    } finally {
                        this.codexModelsLoading = false;
                    }
                },

                getCurrentClaudeConfig() {
                    if (!this.currentClaudeConfig) return null;
                    return this.claudeConfigs[this.currentClaudeConfig] || null;
                },

                normalizeClaudeValue,

                normalizeClaudeConfig(config) {
                    return normalizeClaudeConfig(config);
                },

                normalizeClaudeSettingsEnv(env) {
                    return normalizeClaudeSettingsEnv(env);
                },

                matchClaudeConfigFromSettings(env) {
                    return matchClaudeConfigFromSettings(this.claudeConfigs, env);
                },

                findDuplicateClaudeConfigName(config) {
                    return findDuplicateClaudeConfigName(this.claudeConfigs, config);
                },

                mergeClaudeConfig(existing = {}, updates = {}) {
                    const previous = this.normalizeClaudeConfig(existing);
                    const next = this.normalizeClaudeConfig({ ...existing, ...updates });
                    const externalCredentialType = next.apiKey
                        ? ''
                        : (next.externalCredentialType || previous.externalCredentialType || '');
                    return {
                        apiKey: next.apiKey,
                        baseUrl: next.baseUrl,
                        model: next.model || previous.model || 'glm-4.7',
                        hasKey: !!(next.apiKey || externalCredentialType),
                        externalCredentialType
                    };
                },

                buildClaudeImportedConfigName(baseUrl) {
                    const normalizedUrl = typeof baseUrl === 'string' ? baseUrl.trim() : '';
                    if (!normalizedUrl) return '导入配置';
                    try {
                        const parsed = new URL(normalizedUrl);
                        const host = typeof parsed.host === 'string' ? parsed.host.trim() : '';
                        if (host) return `导入-${host}`;
                    } catch (_) {
                        // keep generic fallback name
                    }
                    return '导入配置';
                },

                ensureClaudeConfigFromSettings(env = {}) {
                    const normalized = this.normalizeClaudeSettingsEnv(env);
                    const hasCredential = !!(normalized.apiKey || normalized.authToken || normalized.useKey);
                    if (!normalized.baseUrl || !hasCredential) return '';

                    const duplicateName = this.findDuplicateClaudeConfigName(normalized);
                    if (duplicateName) return duplicateName;

                    const preferredName = this.buildClaudeImportedConfigName(normalized.baseUrl);
                    let candidateName = preferredName;
                    let suffix = 2;
                    while (this.claudeConfigs[candidateName]) {
                        candidateName = `${preferredName}-${suffix}`;
                        suffix += 1;
                    }

                    this.claudeConfigs[candidateName] = this.mergeClaudeConfig({}, normalized);
                    this.saveClaudeConfigs();
                    return candidateName;
                },

                async refreshClaudeSelectionFromSettings(options = {}) {
                    const silent = !!options.silent;
                    const silentModelError = !!options.silentModelError || silent;
                    try {
                        const res = await api('get-claude-settings');
                        if (res && res.error) {
                            if (!silent) {
                                this.showMessage('读取配置失败', 'error');
                            }
                            return;
                        }
                        const matchName = this.matchClaudeConfigFromSettings((res && res.env) || {});
                        if (matchName) {
                            if (this.currentClaudeConfig !== matchName) {
                                this.currentClaudeConfig = matchName;
                            }
                            this.refreshClaudeModelContext({ silentError: silentModelError });
                            return;
                        }
                        const importedName = this.ensureClaudeConfigFromSettings((res && res.env) || {});
                        if (importedName) {
                            if (this.currentClaudeConfig !== importedName) {
                                this.currentClaudeConfig = importedName;
                            }
                            this.refreshClaudeModelContext({ silentError: silentModelError });
                            if (!silent) {
                                this.showMessage(`检测到外部 Claude 配置，已自动导入：${importedName}`, 'success');
                            }
                            return;
                        }
                        this.currentClaudeConfig = '';
                        this.currentClaudeModel = '';
                        this.resetClaudeModelsState();
                        if (!silent) {
                            const tip = res && res.exists
                                ? '当前 Claude settings.json 与本地配置不匹配，已取消选中'
                                : '未检测到 Claude settings.json，已取消选中';
                            this.showMessage(tip, 'info');
                        }
                    } catch (e) {
                        if (!silent) {
                            this.showMessage('读取配置失败', 'error');
                        }
                    }
                },

                syncClaudeModelFromConfig() {
                    const config = this.getCurrentClaudeConfig();
                    this.currentClaudeModel = config && config.model ? config.model : '';
                },

                refreshClaudeModelContext(options = {}) {
                    this.syncClaudeModelFromConfig();
                    return this.loadClaudeModels(options);
                },

                resetClaudeModelsState() {
                    this.claudeModels = [];
                    this.claudeModelsSource = 'idle';
                    this.claudeModelsHasCurrent = true;
                    this.claudeModelsLoading = false;
                },

                updateClaudeModelsCurrent() {
                    const currentModel = (this.currentClaudeModel || '').trim();
                    this.claudeModelsHasCurrent = !!currentModel && this.claudeModels.includes(currentModel);
                },

                async loadClaudeModels(options = {}) {
                    const silentError = !!options.silentError;
                    const config = this.getCurrentClaudeConfig();
                    if (!config) {
                        this.resetClaudeModelsState();
                        return;
                    }
                    const baseUrl = (config.baseUrl || '').trim();
                    const apiKey = (config.apiKey || '').trim();
                    const externalCredentialType = typeof config.externalCredentialType === 'string'
                        ? config.externalCredentialType.trim()
                        : '';

                    if (!baseUrl) {
                        this.resetClaudeModelsState();
                        return;
                    }
                    if (!apiKey && externalCredentialType) {
                        this.claudeModels = [];
                        this.claudeModelsSource = 'unlimited';
                        this.claudeModelsHasCurrent = true;
                        return;
                    }

                    this.claudeModelsLoading = true;
                    try {
                        const res = await api('models-by-url', { baseUrl, apiKey });
                        if (res.unlimited) {
                            this.claudeModels = [];
                            this.claudeModelsSource = 'unlimited';
                            this.claudeModelsHasCurrent = true;
                            return;
                        }
                        if (res.error) {
                            if (!silentError) {
                                this.showMessage('获取模型列表失败', 'error');
                            }
                            this.claudeModels = [];
                            this.claudeModelsSource = 'error';
                            this.claudeModelsHasCurrent = true;
                            return;
                        }
                        const list = Array.isArray(res.models) ? res.models : [];
                        this.claudeModels = list;
                        this.claudeModelsSource = res.source || 'remote';
                        this.updateClaudeModelsCurrent();
                    } catch (e) {
                        if (!silentError) {
                            this.showMessage('获取模型列表失败', 'error');
                        }
                        this.claudeModels = [];
                        this.claudeModelsSource = 'error';
                        this.claudeModelsHasCurrent = true;
                    } finally {
                        this.claudeModelsLoading = false;
                    }
                },

                openClaudeConfigModal() {
                    this.showClaudeConfigModal = true;
                },

                maybeShowStarPrompt() {
                    const storageKey = 'codexmateStarPrompted';
                    if (localStorage.getItem(storageKey)) {
                        return;
                    }
                    this.showMessage('欢迎到 GitHub 点 Star', 'info');
                    localStorage.setItem(storageKey, '1');
                },

                switchConfigMode(mode) {
                    const normalizedMode = typeof mode === 'string'
                        ? mode.trim().toLowerCase()
                        : '';
                    this.mainTab = 'config';
                    this.configMode = CONFIG_MODE_SET.has(normalizedMode) ? normalizedMode : 'codex';
                    if (this.configMode === 'claude') {
                        this.refreshClaudeModelContext();
                    }
                },

                switchMainTab(tab) {
                    return switchMainTabHelper.call(this, tab);
                },

                scheduleAfterFrame(task) {
                    const callback = typeof task === 'function' ? task : () => {};
                    if (typeof requestAnimationFrame === 'function') {
                        requestAnimationFrame(callback);
                        return;
                    }
                    setTimeout(callback, 16);
                },

                resetSessionPreviewMessageRender() {
                    this.sessionPreviewVisibleCount = 0;
                },

                resetSessionDetailPagination() {
                    const initialLimit = Number.isFinite(this.sessionDetailInitialMessageLimit)
                        ? Math.max(1, Math.floor(this.sessionDetailInitialMessageLimit))
                        : 80;
                    this.sessionDetailMessageLimit = initialLimit;
                    this.sessionPreviewPendingVisibleCount = 0;
                },

                primeSessionPreviewMessageRender() {
                    this.sessionPreviewVisibleCount = 0;
                    if (this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) {
                        return;
                    }
                    const total = Array.isArray(this.activeSessionMessages)
                        ? this.activeSessionMessages.length
                        : 0;
                    if (total <= 0) return;
                    const baseSize = Number.isFinite(this.sessionPreviewInitialBatchSize)
                        ? Math.max(1, Math.floor(this.sessionPreviewInitialBatchSize))
                        : 40;
                    this.sessionPreviewVisibleCount = Math.min(baseSize, total);
                },

                async loadMoreSessionMessages(stepSize) {
                    return loadMoreSessionMessagesHelper.call(this, stepSize);
                },

                teardownSessionTabRender() {
                    this.sessionTabRenderTicket += 1;
                    this.sessionListRenderEnabled = false;
                    this.sessionPreviewRenderEnabled = false;
                    this.resetSessionPreviewMessageRender();
                    this.cancelSessionTimelineSync();
                    this.sessionTimelineLastSyncAt = 0;
                    this.sessionTimelineLastScrollTop = 0;
                },

                prepareSessionTabRender() {
                    const ticket = ++this.sessionTabRenderTicket;
                    this.sessionListRenderEnabled = false;
                    this.sessionPreviewRenderEnabled = false;
                    this.resetSessionPreviewMessageRender();

                    this.scheduleAfterFrame(() => {
                        if (ticket !== this.sessionTabRenderTicket || this.mainTab !== 'sessions') {
                            return;
                        }
                        this.sessionListRenderEnabled = true;

                        this.scheduleAfterFrame(() => {
                            if (ticket !== this.sessionTabRenderTicket || this.mainTab !== 'sessions') {
                                return;
                            }
                            this.sessionPreviewRenderEnabled = true;
                            this.$nextTick(() => {
                                if (ticket !== this.sessionTabRenderTicket || this.mainTab !== 'sessions') {
                                    return;
                                }
                                this.primeSessionPreviewMessageRender();
                                this.updateSessionTimelineOffset();
                                this.scheduleSessionTimelineSync();
                            });
                        });
                    });
                },

                getSessionStandaloneContext() {
                    try {
                        const url = new URL(window.location.href);
                        if (url.pathname !== '/session') {
                            return { requested: false, params: null, error: '' };
                        }

                        const source = (url.searchParams.get('source') || '').trim().toLowerCase();
                        const sessionId = (url.searchParams.get('sessionId') || url.searchParams.get('id') || '').trim();
                        const filePath = (url.searchParams.get('filePath') || url.searchParams.get('path') || '').trim();
                        let error = '';
                        if (!source) {
                            error = '缺少 source 参数';
                        } else if (source !== 'codex' && source !== 'claude') {
                            error = 'source 仅支持 codex 或 claude';
                        }
                        if (!sessionId && !filePath) {
                            error = error ? `${error}，还缺少 sessionId 或 filePath` : '缺少 sessionId 或 filePath 参数';
                        }

                        if (error) {
                            return { requested: true, params: null, error };
                        }

                        return {
                            requested: true,
                            params: {
                                source,
                                sessionId,
                                filePath
                            },
                            error: ''
                        };
                    } catch (_) {
                        return { requested: false, params: null, error: '' };
                    }
                },

                initSessionStandalone() {
                    const context = this.getSessionStandaloneContext();
                    if (!context.requested) return;

                    this.sessionStandalone = true;
                    this.mainTab = 'sessions';
                    this.prepareSessionTabRender();

                    if (context.error || !context.params) {
                        this.sessionStandaloneError = `会话链接参数不完整：${context.error || '参数解析失败'}`;
                        return;
                    }

                    const sourceLabel = context.params.source === 'codex' ? 'Codex' : 'Claude Code';
                    this.activeSession = {
                        source: context.params.source,
                        sourceLabel,
                        sessionId: context.params.sessionId,
                        filePath: context.params.filePath,
                        title: context.params.sessionId || context.params.filePath || '会话'
                    };
                    this.activeSessionMessages = [];
                    this.activeSessionDetailError = '';
                    this.activeSessionDetailClipped = false;
                    this.cancelSessionTimelineSync();
                    this.sessionTimelineActiveKey = '';
                    this.sessionMessageRefMap = Object.create(null);
                    this.sessionStandaloneError = '';
                    this.sessionStandaloneText = '';
                    this.sessionStandaloneTitle = this.activeSession.title || '会话';
                    this.sessionStandaloneSourceLabel = sourceLabel;
                    this.loadSessionStandalonePlain();
                },

                buildSessionStandaloneUrl(session) {
                    if (!session) return '';
                    const source = typeof session.source === 'string' ? session.source.trim().toLowerCase() : '';
                    if (!source || (source !== 'codex' && source !== 'claude')) return '';
                    const sessionId = typeof session.sessionId === 'string' ? session.sessionId.trim() : '';
                    const filePath = typeof session.filePath === 'string' ? session.filePath.trim() : '';
                    if (!sessionId && !filePath) return '';
                    const origin = window.location.origin && window.location.origin !== 'null'
                        ? window.location.origin
                        : API_BASE;
                    const params = new URLSearchParams();
                    params.set('source', source);
                    if (sessionId) params.set('sessionId', sessionId);
                    if (filePath) params.set('filePath', filePath);
                    return `${origin}/session?${params.toString()}`;
                },

                openSessionStandalone(session) {
                    const url = this.buildSessionStandaloneUrl(session);
                    if (!url) {
                        this.showMessage('无法生成链接', 'error');
                        return;
                    }
                    window.open(url, '_blank', 'noopener');
                },

                getSessionExportKey(session) {
                    return `${session.source || 'unknown'}:${session.sessionId || ''}:${session.filePath || ''}`;
                },

                isResumeCommandAvailable(session) {
                    if (!session) return false;
                    const source = String(session.source || '').trim().toLowerCase();
                    const sessionId = typeof session.sessionId === 'string' ? session.sessionId.trim() : '';
                    return source === 'codex' && !!sessionId;
                },

                isCloneAvailable(session) {
                    if (!session) return false;
                    const source = String(session.source || '').trim().toLowerCase();
                    const sessionId = typeof session.sessionId === 'string' ? session.sessionId.trim() : '';
                    const filePath = typeof session.filePath === 'string' ? session.filePath.trim() : '';
                    return source === 'codex' && (!!sessionId || !!filePath);
                },

                isDeleteAvailable(session) {
                    if (!session) return false;
                    const source = String(session.source || '').trim().toLowerCase();
                    if (source !== 'codex' && source !== 'claude') return false;
                    const sessionId = typeof session.sessionId === 'string' ? session.sessionId.trim() : '';
                    const filePath = typeof session.filePath === 'string' ? session.filePath.trim() : '';
                    return !!sessionId || !!filePath;
                },

                buildResumeCommand(session) {
                    const sessionId = session && session.sessionId ? String(session.sessionId).trim() : '';
                    const arg = this.quoteResumeArg(sessionId);
                    if (this.sessionResumeWithYolo) {
                        return `codex --yolo resume ${arg}`;
                    }
                    return `codex resume ${arg}`;
                },

                quoteShellArg(value) {
                    const text = typeof value === 'string' ? value : String(value || '');
                    if (!text) return "''";
                    if (/^[a-zA-Z0-9._-]+$/.test(text)) return text;
                    const escaped = text.replace(/'/g, "'\\''");
                    return `'${escaped}'`;
                },

                quoteResumeArg(value) {
                    return this.quoteShellArg(value);
                },

                fallbackCopyText(text) {
                    let textarea = null;
                    try {
                        textarea = document.createElement('textarea');
                        textarea.value = text;
                        textarea.setAttribute('readonly', '');
                        textarea.style.position = 'fixed';
                        textarea.style.top = '-9999px';
                        textarea.style.left = '-9999px';
                        textarea.style.opacity = '0';
                        document.body.appendChild(textarea);
                        textarea.select();
                        textarea.setSelectionRange(0, textarea.value.length);
                        return document.execCommand('copy');
                    } catch (e) {
                        return false;
                    } finally {
                        if (textarea && textarea.parentNode) {
                            textarea.parentNode.removeChild(textarea);
                        }
                    }
                },

                copyAgentsContent() {
                    const text = typeof this.agentsContent === 'string' ? this.agentsContent : '';
                    if (!text) {
                        this.showMessage('没有可复制内容', 'info');
                        return;
                    }
                    const ok = this.fallbackCopyText(text);
                    if (ok) {
                        this.showMessage('已复制', 'success');
                        return;
                    }
                    this.showMessage('复制失败', 'error');
                },

                exportAgentsContent() {
                    const text = typeof this.agentsContent === 'string' ? this.agentsContent : '';
                    if (!text) {
                        this.showMessage('没有可导出内容', 'info');
                        return;
                    }
                    const now = new Date();
                    const year = String(now.getFullYear());
                    const month = String(now.getMonth() + 1).padStart(2, '0');
                    const day = String(now.getDate()).padStart(2, '0');
                    const hour = String(now.getHours()).padStart(2, '0');
                    const minute = String(now.getMinutes()).padStart(2, '0');
                    const second = String(now.getSeconds()).padStart(2, '0');
                    const fileName = `agent-${year}${month}${day}-${hour}${minute}${second}.txt`;
                    this.downloadTextFile(fileName, text, 'text/plain;charset=utf-8');
                    this.showMessage(`已导出 ${fileName}`, 'success');
                },

                async copyInstallCommand(cmd) {
                    const text = typeof cmd === 'string' ? cmd.trim() : '';
                    if (!text) {
                        this.showMessage('没有可复制内容', 'info');
                        return;
                    }
                    try {
                        if (navigator.clipboard && window.isSecureContext) {
                            await navigator.clipboard.writeText(text);
                            this.showMessage('已复制命令', 'success');
                            return;
                        }
                    } catch (e) {
                        // fallback to legacy copy path
                    }
                    const ok = this.fallbackCopyText(text);
                    if (ok) {
                        this.showMessage('已复制命令', 'success');
                        return;
                    }
                    this.showMessage('复制失败', 'error');
                },

                async copyResumeCommand(session) {
                    if (!this.isResumeCommandAvailable(session)) {
                        this.showMessage('不支持此操作', 'error');
                        return;
                    }
                    const command = this.buildResumeCommand(session);
                    const ok = this.fallbackCopyText(command);
                    if (ok) {
                        this.showMessage('已复制', 'success');
                        return;
                    }
                    try {
                        if (navigator.clipboard && window.isSecureContext) {
                            await navigator.clipboard.writeText(command);
                            this.showMessage('已复制', 'success');
                            return;
                        }
                    } catch (e) {
                        // keep fallback failure message
                    }
                    this.showMessage('复制失败', 'error');
                },

                buildProviderShareCommand(payload) {
                    if (!payload || typeof payload !== 'object') return '';
                    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
                    const baseUrl = typeof payload.baseUrl === 'string' ? payload.baseUrl.trim() : '';
                    const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey : '';
                    const model = typeof payload.model === 'string' ? payload.model.trim() : '';
                    if (!name || !baseUrl) return '';

                    const nameArg = this.quoteShellArg(name);
                    const urlArg = this.quoteShellArg(baseUrl);
                    const keyArg = apiKey ? this.quoteShellArg(apiKey) : '';
                    const switchCmd = `codexmate switch ${nameArg}`;
                    const addCmd = apiKey
                        ? `codexmate add ${nameArg} ${urlArg} ${keyArg}`
                        : `codexmate add ${nameArg} ${urlArg}`;
                    const modelCmd = model ? ` && codexmate use ${this.quoteShellArg(model)}` : '';
                    return `${addCmd} && ${switchCmd}${modelCmd}`;
                },

                buildClaudeShareCommand(payload) {
                    if (!payload || typeof payload !== 'object') return '';
                    const baseUrl = typeof payload.baseUrl === 'string' ? payload.baseUrl.trim() : '';
                    const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey : '';
                    const model = typeof payload.model === 'string' && payload.model.trim()
                        ? payload.model.trim()
                        : 'glm-4.7';
                    if (!baseUrl || !apiKey) return '';
                    const urlArg = this.quoteShellArg(baseUrl);
                    const keyArg = this.quoteShellArg(apiKey);
                    const modelArg = this.quoteShellArg(model);
                    return `codexmate claude ${urlArg} ${keyArg} ${modelArg}`;
                },

                async copyProviderShareCommand(provider) {
                    const name = provider && typeof provider.name === 'string' ? provider.name.trim() : '';
                    if (!name) {
                        this.showMessage('参数无效', 'error');
                        return;
                    }
                    if (!this.shouldAllowProviderShare(provider)) {
                        this.showMessage('本地入口不可分享', 'info');
                        return;
                    }
                    if (this.providerShareLoading[name]) {
                        return;
                    }
                    this.providerShareLoading[name] = true;
                    try {
                        const res = await api('export-provider', { name });
                        if (res && res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        const command = this.buildProviderShareCommand(res && res.payload ? res.payload : null);
                        if (!command) {
                            this.showMessage('生成命令失败', 'error');
                            return;
                        }
                        const ok = this.fallbackCopyText(command);
                        if (ok) {
                            this.showMessage('已复制', 'success');
                            return;
                        }
                        try {
                            if (navigator.clipboard && window.isSecureContext) {
                                await navigator.clipboard.writeText(command);
                                this.showMessage('已复制', 'success');
                                return;
                            }
                        } catch (e) {
                            // keep fallback failure message
                        }
                        this.showMessage('复制失败', 'error');
                    } catch (e) {
                        this.showMessage('生成命令失败', 'error');
                    } finally {
                        this.providerShareLoading[name] = false;
                    }
                },

                async copyClaudeShareCommand(name) {
                    const config = this.claudeConfigs[name];
                    if (!config) {
                        this.showMessage('配置不存在', 'error');
                        return;
                    }
                    if (this.claudeShareLoading[name]) return;
                    this.claudeShareLoading[name] = true;
                    try {
                        const res = await api('export-claude-share', { config });
                        if (res && res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        const command = this.buildClaudeShareCommand(res && res.payload ? res.payload : null);
                        if (!command) {
                            this.showMessage('生成命令失败', 'error');
                            return;
                        }
                        const ok = this.fallbackCopyText(command);
                        if (ok) {
                            this.showMessage('已复制', 'success');
                            return;
                        }
                        try {
                            if (navigator.clipboard && window.isSecureContext) {
                                await navigator.clipboard.writeText(command);
                                this.showMessage('已复制', 'success');
                                return;
                            }
                        } catch (e) {
                            // fall through
                        }
                        this.showMessage('复制失败', 'error');
                    } catch (e) {
                        this.showMessage('生成命令失败', 'error');
                    } finally {
                        this.claudeShareLoading[name] = false;
                    }
                },

                async cloneSession(session) {
                    if (!this.isCloneAvailable(session)) {
                        this.showMessage('不支持此操作', 'error');
                        return;
                    }
                    const key = this.getSessionExportKey(session);
                    if (this.sessionCloning[key]) {
                        return;
                    }
                    this.sessionCloning[key] = true;
                    try {
                        const res = await api('clone-session', {
                            source: session.source,
                            sessionId: session.sessionId,
                            filePath: session.filePath
                        });
                        if (res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }

                        this.showMessage('操作成功', 'success');
                        await this.loadSessions();
                        if (res.sessionId) {
                            const matched = this.sessionsList.find(item => item.source === 'codex' && item.sessionId === res.sessionId);
                            if (matched) {
                                await this.selectSession(matched);
                            }
                        }
                    } catch (e) {
                        this.showMessage('克隆失败', 'error');
                    } finally {
                        this.sessionCloning[key] = false;
                    }
                },

                async deleteSession(session) {
                    if (!this.isDeleteAvailable(session)) {
                        this.showMessage('不支持此操作', 'error');
                        return;
                    }
                    const key = this.getSessionExportKey(session);
                    if (this.sessionDeleting[key]) {
                        return;
                    }
                    this.sessionDeleting[key] = true;
                    try {
                        const res = await api('delete-session', {
                            source: session.source,
                            sessionId: session.sessionId,
                            filePath: session.filePath
                        });
                        if (res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        this.showMessage('操作成功', 'success');
                        await this.loadSessions();
                    } catch (e) {
                        this.showMessage('删除失败', 'error');
                    } finally {
                        this.sessionDeleting[key] = false;
                    }
                },

                normalizeSessionPathValue(value) {
                    return normalizeSessionPathFilter(value);
                },

                mergeSessionPathOptions(baseList = [], incomingList = []) {
                    const merged = [];
                    const seen = new Set();
                    const append = (items) => {
                        if (!Array.isArray(items)) return;
                        for (const item of items) {
                            const value = this.normalizeSessionPathValue(item);
                            if (!value) continue;
                            const key = value.toLowerCase();
                            if (seen.has(key)) continue;
                            seen.add(key);
                            merged.push(value);
                        }
                    };

                    append(baseList);
                    append(incomingList);
                    return merged;
                },

                extractPathOptionsFromSessions(sessions) {
                    const paths = [];
                    if (!Array.isArray(sessions)) {
                        return paths;
                    }

                    const seen = new Set();
                    for (const session of sessions) {
                        const value = this.normalizeSessionPathValue(session && session.cwd ? session.cwd : '');
                        if (!value) continue;
                        const key = value.toLowerCase();
                        if (seen.has(key)) continue;
                        seen.add(key);
                        paths.push(value);
                    }
                    return paths;
                },

                syncSessionPathOptionsForSource(source, nextOptions, mergeWithExisting = false) {
                    const targetSource = source === 'claude' ? 'claude' : (source === 'all' ? 'all' : 'codex');
                    const current = Array.isArray(this.sessionPathOptionsMap[targetSource])
                        ? this.sessionPathOptionsMap[targetSource]
                        : [];
                    const merged = mergeWithExisting
                        ? this.mergeSessionPathOptions(current, nextOptions)
                        : this.mergeSessionPathOptions([], nextOptions);
                    this.sessionPathOptionsMap = {
                        ...this.sessionPathOptionsMap,
                        [targetSource]: merged
                    };
                    this.refreshSessionPathOptions(targetSource);
                },

                refreshSessionPathOptions(source) {
                    const targetSource = source === 'claude' ? 'claude' : (source === 'all' ? 'all' : 'codex');
                    const base = Array.isArray(this.sessionPathOptionsMap[targetSource])
                        ? [...this.sessionPathOptionsMap[targetSource]]
                        : [];
                    const selected = this.normalizeSessionPathValue(this.sessionPathFilter);
                    if (selected && !base.some(item => item.toLowerCase() === selected.toLowerCase())) {
                        base.unshift(selected);
                    }
                    if (targetSource === this.sessionFilterSource) {
                        this.sessionPathOptions = base;
                    }
                },

                async loadSessionPathOptions(options = {}) {
                    const source = options.source === 'claude' ? 'claude' : (options.source === 'all' ? 'all' : 'codex');
                    const forceRefresh = !!options.forceRefresh;
                    const loaded = !!this.sessionPathOptionsLoadedMap[source];
                    if (!forceRefresh && loaded) {
                        return;
                    }

                    const requestSeq = ++this.sessionPathRequestSeq;
                    this.sessionPathOptionsLoading = true;
                    try {
                        const res = await api('list-session-paths', {
                            source,
                            limit: 500,
                            forceRefresh
                        });
                        if (requestSeq !== this.sessionPathRequestSeq) {
                            return;
                        }
                        if (res && !res.error && Array.isArray(res.paths)) {
                            this.syncSessionPathOptionsForSource(source, res.paths, true);
                            this.sessionPathOptionsLoadedMap = {
                                ...this.sessionPathOptionsLoadedMap,
                                [source]: true
                            };
                        }
                    } catch (_) {
                        // 路径补全失败不影响会话主流程
                    } finally {
                        if (requestSeq === this.sessionPathRequestSeq) {
                            this.sessionPathOptionsLoading = false;
                        }
                    }
                },

                onSessionResumeYoloChange() {
                    const value = this.sessionResumeWithYolo ? '1' : '0';
                    localStorage.setItem('codexmateSessionResumeYolo', value);
                },
                restoreSessionFilterCache() {
                    const sourceCache = localStorage.getItem('codexmateSessionFilterSource');
                    const pathCache = localStorage.getItem('codexmateSessionPathFilter');
                    const cached = buildSessionFilterCacheState(sourceCache, pathCache);
                    this.sessionFilterSource = cached.source;
                    this.sessionPathFilter = cached.pathFilter;
                    this.refreshSessionPathOptions(this.sessionFilterSource);
                },
                persistSessionFilterCache() {
                    const cached = buildSessionFilterCacheState(this.sessionFilterSource, this.sessionPathFilter);
                    localStorage.setItem('codexmateSessionFilterSource', cached.source);
                    if (cached.pathFilter) {
                        localStorage.setItem('codexmateSessionPathFilter', cached.pathFilter);
                    } else {
                        localStorage.removeItem('codexmateSessionPathFilter');
                    }
                },

                async onSessionSourceChange() {
                    this.refreshSessionPathOptions(this.sessionFilterSource);
                    this.persistSessionFilterCache();
                    await this.loadSessions();
                },

                async onSessionPathFilterChange() {
                    this.persistSessionFilterCache();
                    await this.loadSessions();
                },

                async onSessionFilterChange() {
                    await this.loadSessions();
                },

                async clearSessionFilters() {
                    this.sessionFilterSource = 'all';
                    this.sessionPathFilter = '';
                    this.sessionQuery = '';
                    this.sessionRoleFilter = 'all';
                    this.sessionTimePreset = 'all';
                    this.persistSessionFilterCache();
                    await this.onSessionSourceChange();
                },
                setSessionPreviewContainerRef(el) {
                    this.sessionPreviewContainerEl = el || null;
                    this.updateSessionTimelineOffset();
                },
                disconnectSessionPreviewHeaderResizeObserver() {
                    if (!this.sessionPreviewHeaderResizeObserver) return;
                    this.sessionPreviewHeaderResizeObserver.disconnect();
                    this.sessionPreviewHeaderResizeObserver = null;
                },
                observeSessionPreviewHeaderResize() {
                    this.disconnectSessionPreviewHeaderResizeObserver();
                    if (!this.sessionPreviewHeaderEl || typeof ResizeObserver !== 'function') return;
                    this.sessionPreviewHeaderResizeObserver = new ResizeObserver(() => {
                        this.updateSessionTimelineOffset();
                    });
                    this.sessionPreviewHeaderResizeObserver.observe(this.sessionPreviewHeaderEl);
                },
                setSessionPreviewHeaderRef(el) {
                    this.disconnectSessionPreviewHeaderResizeObserver();
                    this.sessionPreviewHeaderEl = el || null;
                    this.observeSessionPreviewHeaderResize();
                    this.updateSessionTimelineOffset();
                },
                setSessionPreviewScrollRef(el) {
                    this.sessionPreviewScrollEl = el || null;
                    if (
                        this.sessionTimelineEnabled
                        && this.sessionPreviewScrollEl
                        && this.mainTab === 'sessions'
                        && this.sessionPreviewRenderEnabled
                    ) {
                        this.scheduleSessionTimelineSync();
                    } else {
                        this.cancelSessionTimelineSync();
                    }
                    this.updateSessionTimelineOffset();
                },
                updateSessionTimelineOffset() {
                    const container = this.sessionPreviewContainerEl || this.$refs.sessionPreviewContainer;
                    if (!container || !container.style) return;
                    const header = this.sessionPreviewHeaderEl
                        || (this.sessionPreviewScrollEl ? this.sessionPreviewScrollEl.querySelector('.session-preview-header') : null)
                        || container.querySelector('.session-preview-header');
                    const headerHeight = header ? Math.ceil(header.getBoundingClientRect().height) : 0;
                    const offset = headerHeight > 0 ? (headerHeight + 12) : 72;
                    container.style.setProperty('--session-preview-header-offset', `${offset}px`);
                },
                bindSessionMessageRef(messageKey, el) {
                    if (!this.sessionTimelineEnabled) return;
                    if (!messageKey) return;
                    if (el) {
                        this.sessionMessageRefMap[messageKey] = el;
                    } else {
                        delete this.sessionMessageRefMap[messageKey];
                    }
                },
                toggleSessionTimeline() {
                    this.sessionTimelineEnabled = !this.sessionTimelineEnabled;
                    if (!this.sessionTimelineEnabled) {
                        this.cancelSessionTimelineSync();
                        this.sessionTimelineActiveKey = '';
                        this.sessionMessageRefMap = Object.create(null);
                        return;
                    }
                    this.$nextTick(() => {
                        if (!this.sessionTimelineEnabled) return;
                        this.updateSessionTimelineOffset();
                        this.scheduleSessionTimelineSync();
                    });
                },
                cancelSessionTimelineSync() {
                    if (!this.sessionTimelineRafId) return;
                    if (typeof cancelAnimationFrame === 'function') {
                        cancelAnimationFrame(this.sessionTimelineRafId);
                    }
                    this.sessionTimelineRafId = 0;
                },
                scheduleSessionTimelineSync() {
                    if (this.sessionTimelineRafId) return;
                    if (typeof requestAnimationFrame === 'function') {
                        this.sessionTimelineRafId = requestAnimationFrame(() => {
                            this.sessionTimelineRafId = 0;
                            this.syncSessionTimelineActiveFromScroll();
                        });
                        return;
                    }
                    this.syncSessionTimelineActiveFromScroll();
                },
                onSessionPreviewScroll() {
                    if (!this.sessionTimelineEnabled || this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) return;
                    const scrollEl = this.sessionPreviewScrollEl || this.$refs.sessionPreviewScroll;
                    if (!scrollEl) return;
                    const now = Date.now();
                    const currentTop = Number(scrollEl.scrollTop || 0);
                    const delta = Math.abs(currentTop - Number(this.sessionTimelineLastScrollTop || 0));
                    const elapsed = now - Number(this.sessionTimelineLastSyncAt || 0);
                    if (delta < 48 && elapsed < 120) {
                        return;
                    }
                    this.sessionTimelineLastScrollTop = currentTop;
                    this.sessionTimelineLastSyncAt = now;
                    this.scheduleSessionTimelineSync();
                },
                onWindowResize() {
                    this.updateCompactLayoutMode();
                    if (!this.sessionTimelineEnabled || this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) {
                        return;
                    }
                    this.updateSessionTimelineOffset();
                    this.scheduleSessionTimelineSync();
                },
                shouldForceCompactLayout() {
                    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
                        return false;
                    }
                    const doc = typeof document !== 'undefined' ? document : null;
                    const viewportWidth = Math.max(
                        0,
                        Number(window.innerWidth || 0),
                        Number(doc && doc.documentElement ? doc.documentElement.clientWidth : 0)
                    );
                    const screenWidth = Number(window.screen && window.screen.width ? window.screen.width : 0);
                    const screenHeight = Number(window.screen && window.screen.height ? window.screen.height : 0);
                    const shortEdge = screenWidth > 0 && screenHeight > 0
                        ? Math.min(screenWidth, screenHeight)
                        : 0;
                    const touchPoints = Number(navigator.maxTouchPoints || 0);
                    const userAgent = String(navigator.userAgent || '');
                    const isMobileUa = /(Android|iPhone|iPad|iPod|Mobile)/i.test(userAgent);
                    let coarsePointer = false;
                    let noHover = false;
                    try {
                        coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
                    } catch (_) {}
                    try {
                        noHover = !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
                    } catch (_) {}
                    return shouldForceCompactLayoutMode({
                        viewportWidth,
                        screenWidth,
                        screenHeight,
                        shortEdge,
                        maxTouchPoints: touchPoints,
                        userAgent,
                        isMobileUa,
                        coarsePointer,
                        noHover
                    });
                },
                applyCompactLayoutClass(enabled) {
                    if (typeof document === 'undefined' || !document.body) {
                        return;
                    }
                    document.body.classList.toggle('force-compact', !!enabled);
                },
                updateCompactLayoutMode() {
                    const enabled = this.shouldForceCompactLayout();
                    this.forceCompactLayout = enabled;
                    this.applyCompactLayoutClass(enabled);
                },
                syncSessionTimelineActiveFromScroll() {
                    if (!this.sessionTimelineEnabled || this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) {
                        if (this.sessionTimelineActiveKey) {
                            this.sessionTimelineActiveKey = '';
                        }
                        return;
                    }
                    const nodes = Array.isArray(this.sessionTimelineNodes) ? this.sessionTimelineNodes : [];
                    if (!nodes.length) {
                        if (this.sessionTimelineActiveKey) {
                            this.sessionTimelineActiveKey = '';
                        }
                        return;
                    }
                    const scrollEl = this.sessionPreviewScrollEl || this.$refs.sessionPreviewScroll;
                    if (!scrollEl) {
                        const fallbackKey = nodes[0].key;
                        if (this.sessionTimelineActiveKey !== fallbackKey) {
                            this.sessionTimelineActiveKey = fallbackKey;
                        }
                        return;
                    }
                    const headerEl = scrollEl.querySelector('.session-preview-header');
                    const headerHeight = headerEl ? Number(headerEl.getBoundingClientRect().height || 0) : 0;
                    const scrollRect = scrollEl.getBoundingClientRect();
                    const anchorY = scrollRect.top + headerHeight + 8;
                    let activeKey = nodes[0].key;
                    for (const node of nodes) {
                        const messageEl = this.sessionMessageRefMap[node.key];
                        if (!messageEl) continue;
                        const messageRect = messageEl.getBoundingClientRect();
                        if (messageRect.top <= anchorY) {
                            activeKey = node.key;
                            continue;
                        }
                        break;
                    }
                    if (this.sessionTimelineActiveKey !== activeKey) {
                        this.sessionTimelineActiveKey = activeKey;
                    }
                },
                jumpToSessionTimelineNode(messageKey) {
                    if (!this.sessionTimelineEnabled || this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) return;
                    if (!messageKey) return;
                    const scrollEl = this.sessionPreviewScrollEl || this.$refs.sessionPreviewScroll;
                    if (!scrollEl) return;
                    const messageEl = this.sessionMessageRefMap[messageKey];
                    if (!messageEl) return;
                    const headerEl = scrollEl.querySelector('.session-preview-header');
                    const stickyOffset = headerEl ? (headerEl.offsetHeight + 8) : 8;
                    const scrollRect = scrollEl.getBoundingClientRect();
                    const messageRect = messageEl.getBoundingClientRect();
                    const targetScrollTop = scrollEl.scrollTop + (messageRect.top - scrollRect.top) - stickyOffset;
                    this.sessionTimelineActiveKey = messageKey;
                    if (typeof scrollEl.scrollTo === 'function') {
                        scrollEl.scrollTo({
                            top: Math.max(0, targetScrollTop),
                            behavior: 'smooth'
                        });
                    } else {
                        messageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                },

                normalizeSessionMessage(message) {
                    const fallback = {
                        role: 'assistant',
                        normalizedRole: 'assistant',
                        roleLabel: 'Assistant',
                        text: typeof message === 'string' ? message : '',
                        timestamp: ''
                    };
                    const safeMessage = message && typeof message === 'object' ? message : fallback;
                    const normalizedRole = normalizeSessionMessageRole(
                        safeMessage.normalizedRole || safeMessage.role
                    );
                    const roleLabel = normalizedRole === 'user'
                        ? 'User'
                        : (normalizedRole === 'system' ? 'System' : 'Assistant');
                    return {
                        ...safeMessage,
                        role: normalizedRole,
                        normalizedRole,
                        roleLabel
                    };
                },

                getRecordKey(message) {
                    if (!message || !Number.isInteger(message.recordLineIndex) || message.recordLineIndex < 0) {
                        return '';
                    }
                    return String(message.recordLineIndex);
                },

                getRecordRenderKey(message, idx) {
                    const recordKey = this.getRecordKey(message);
                    if (recordKey) {
                        return `record-${recordKey}`;
                    }
                    return `record-fallback-${idx}-${message && message.timestamp ? message.timestamp : ''}`;
                },

                syncActiveSessionMessageCount(messageCount) {
                    if (!Number.isFinite(messageCount) || messageCount < 0) return;
                    if (this.activeSession) {
                        this.activeSession.messageCount = messageCount;
                    }
                    const activeKey = this.activeSession ? this.getSessionExportKey(this.activeSession) : '';
                    if (!activeKey) return;
                    const matched = this.sessionsList.find(item => this.getSessionExportKey(item) === activeKey);
                    if (matched) {
                        matched.messageCount = messageCount;
                    }
                },

                async loadSessions() {
                    return loadSessionsHelper.call(this, api);
                },

                async selectSession(session) {
                    if (!session) return;
                    if (this.activeSession && this.getSessionExportKey(this.activeSession) === this.getSessionExportKey(session)) return;
                    this.activeSession = session;
                    this.activeSessionMessages = [];
                    this.resetSessionDetailPagination();
                    this.resetSessionPreviewMessageRender();
                    this.activeSessionDetailError = '';
                    this.activeSessionDetailClipped = false;
                    this.cancelSessionTimelineSync();
                    this.sessionTimelineActiveKey = '';
                    this.sessionMessageRefMap = Object.create(null);
                    await this.loadActiveSessionDetail();
                },

                async loadSessionStandalonePlain() {
                    if (!this.activeSession) {
                        this.sessionStandaloneText = '';
                        this.sessionStandaloneTitle = '会话';
                        this.sessionStandaloneSourceLabel = '';
                        this.sessionStandaloneError = '';
                        return;
                    }

                    const requestSeq = ++this.sessionStandaloneRequestSeq;
                    this.sessionStandaloneLoading = true;
                    this.sessionStandaloneError = '';
                    try {
                        const res = await api('session-plain', {
                            source: this.activeSession.source,
                            sessionId: this.activeSession.sessionId,
                            filePath: this.activeSession.filePath
                        });

                        if (requestSeq !== this.sessionStandaloneRequestSeq) {
                            return;
                        }

                        if (res.error) {
                            this.sessionStandaloneText = '';
                            this.sessionStandaloneError = res.error;
                            return;
                        }

                        this.sessionStandaloneSourceLabel = res.sourceLabel || this.activeSession.sourceLabel || '';
                        this.sessionStandaloneTitle = res.sessionId || this.activeSession.title || '会话';
                        this.sessionStandaloneText = typeof res.text === 'string' ? res.text : '';
                    } catch (e) {
                        if (requestSeq !== this.sessionStandaloneRequestSeq) {
                            return;
                        }
                        this.sessionStandaloneText = '';
                        this.sessionStandaloneError = '加载会话内容失败: ' + e.message;
                    } finally {
                        if (requestSeq === this.sessionStandaloneRequestSeq) {
                            this.sessionStandaloneLoading = false;
                        }
                    }
                },

                async loadActiveSessionDetail(options = {}) {
                    return loadActiveSessionDetailHelper.call(this, api, options);
                },

                downloadTextFile(fileName, content, mimeType = 'text/markdown;charset=utf-8') {
                    // 使用 UTF-8 BOM 确保文本编辑器正确识别编码
                    const BOM = '\uFEFF';
                    const blob = new Blob([BOM + content], { type: mimeType });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = fileName;
                    link.click();
                    URL.revokeObjectURL(url);
                },

                async exportSession(session) {
                    const key = this.getSessionExportKey(session);
                    if (this.sessionExporting[key]) return;

                    this.sessionExporting[key] = true;
                    try {
                        const res = await api('export-session', {
                            source: session.source,
                            sessionId: session.sessionId,
                            filePath: session.filePath
                        });
                        if (res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }

                        const fileName = res.fileName || `${session.source || 'session'}-${session.sessionId || Date.now()}.md`;
                        this.downloadTextFile(fileName, res.content || '');
                        if (res.truncated) {
                            const maxLabel = res.maxMessages === 'all' ? 'all' : res.maxMessages;
                            this.showMessage(`会话导出完成（已截断：最多 ${maxLabel} 条消息）`, 'info');
                        } else {
                            this.showMessage('操作成功', 'success');
                        }
                    } catch (e) {
                        this.showMessage('导出失败', 'error');
                    } finally {
                        this.sessionExporting[key] = false;
                    }
                },

                async quickSwitchProvider(name) {
                    const target = String(name || '').trim();
                    if (!target || target === this.pendingProviderSwitch) {
                        return;
                    }
                    if (!this.providerSwitchInProgress && target === this.currentProvider) {
                        return;
                    }
                    await this.switchProvider(target);
                },

                async waitForCodexApplyIdle(maxWaitMs = 20000) {
                    const startedAt = Date.now();
                    while (this.codexApplying) {
                        if ((Date.now() - startedAt) > maxWaitMs) {
                            throw new Error('等待配置应用完成超时');
                        }
                        await new Promise((resolve) => setTimeout(resolve, 50));
                    }
                },

                async performProviderSwitch(name) {
                    await this.waitForCodexApplyIdle();
                    this.currentProvider = name;
                    await this.loadModelsForProvider(name);
                    if (this.modelsSource === 'remote' && this.models.length > 0 && !this.models.includes(this.currentModel)) {
                        this.currentModel = this.models[0];
                    }
                    if (getProviderConfigModeMeta(this.configMode)) {
                        await this.waitForCodexApplyIdle();
                        await this.applyCodexConfigDirect({ silent: true });
                    }
                },

                async switchProvider(name) {
                    const target = String(name || '').trim();
                    if (!target) {
                        return;
                    }
                    if (this.providerSwitchInProgress) {
                        this.pendingProviderSwitch = target;
                        return;
                    }
                    this.providerSwitchInProgress = true;
                    let lastError = '';
                    try {
                        this.pendingProviderSwitch = '';
                        const result = await runLatestOnlyQueue(target, {
                            perform: async (queuedTarget) => {
                                await this.performProviderSwitch(queuedTarget);
                            },
                            consumePending: () => {
                                const queued = this.pendingProviderSwitch;
                                this.pendingProviderSwitch = '';
                                return queued;
                            }
                        });
                        if (result && typeof result.lastError === 'string') {
                            lastError = result.lastError;
                        }
                    } finally {
                        this.providerSwitchInProgress = false;
                        this.pendingProviderSwitch = '';
                    }
                    if (lastError) {
                        this.showMessage(lastError, 'error');
                    }
                },

                async onModelChange() {
                    await this.applyCodexConfigDirect();
                },

                async onServiceTierChange() {
                    await this.applyCodexConfigDirect({ silent: true });
                },

                async onReasoningEffortChange() {
                    await this.applyCodexConfigDirect({ silent: true });
                },

                async runHealthCheck() {
                    this.healthCheckLoading = true;
                    this.healthCheckResult = null;
                    try {
                        const res = await api('config-health-check', {
                            remote: false
                        });
                        if (res && typeof res === 'object') {
                            const issues = Array.isArray(res.issues) ? [...res.issues] : [];
                            let remote = res.remote || null;
                            {
                                const providers = (this.providersList || [])
                                    .filter(provider => provider && provider.name);
                                const tasks = providers.map(provider =>
                                    this.runSpeedTest(provider.name, { silent: true })
                                        .then(result => ({ name: provider.name, result }))
                                        .catch(err => ({
                                            name: provider.name,
                                            result: { ok: false, error: err && err.message ? err.message : 'Speed test failed' }
                                        }))
                                );
                                const pairs = await Promise.all(tasks);
                                const results = {};
                                for (const pair of pairs) {
                                    results[pair.name] = pair.result || null;
                                    const issue = this.buildSpeedTestIssue(pair.name, pair.result);
                                    if (issue) issues.push(issue);
                                }
                                remote = {
                                    type: 'speed-test',
                                    results
                                };
                            }

                            const ok = issues.length === 0;
                            this.healthCheckResult = {
                                ...res,
                                ok,
                                issues,
                                remote
                            };
                            if (ok) {
                                this.showMessage('检查通过', 'success');
                            }
                        } else {
                            this.healthCheckResult = null;
                            this.showMessage('检查失败', 'error');
                        }
                    } catch (e) {
                        this.healthCheckResult = null;
                        this.showMessage('检查失败', 'error');
                    } finally {
                        if (this.configMode === 'claude') {
                            try {
                                const entries = Object.entries(this.claudeConfigs || {});
                                await Promise.all(entries.map(([name, config]) => this.runClaudeSpeedTest(name, config)));
                            } catch (e) {}
                        }
                        this.healthCheckLoading = false;
                    }
                },

                escapeTomlString(value) {
                    return String(value || '')
                        .replace(/\\/g, '\\\\')
                        .replace(/"/g, '\\"');
                },

                async openConfigTemplateEditor(options = {}) {
                    try {
                        const res = await api('get-config-template', {
                            provider: this.currentProvider,
                            model: this.currentModel,
                            serviceTier: this.serviceTier
                        });
                        if (res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        let template = res.template || '';
                        const appendHint = typeof options.appendHint === 'string' ? options.appendHint.trim() : '';
                        const appendBlock = typeof options.appendBlock === 'string' ? options.appendBlock.trim() : '';
                        if (appendHint) {
                            template = `${template.trimEnd()}\n\n# -------------------------------\n# ${appendHint}\n# -------------------------------\n`;
                        }
                        if (appendBlock) {
                            template = `${template.trimEnd()}\n\n${appendBlock}\n`;
                        }
                        this.configTemplateContent = template;
                        this.showConfigTemplateModal = true;
                    } catch (e) {
                        this.showMessage('加载模板失败', 'error');
                    }
                },

                async applyCodexConfigDirect(options = {}) {
                    if (this.codexApplying) return;

                    const provider = (this.currentProvider || '').trim();
                    const model = (this.currentModel || '').trim();
                    if (!provider || !model) {
                        this.showMessage('请选择提供商和模型', 'error');
                        return;
                    }

                    this.codexApplying = true;
                    try {
                        const tplRes = await api('get-config-template', {
                            provider,
                            model,
                            serviceTier: this.serviceTier,
                            reasoningEffort: this.modelReasoningEffort
                        });
                        if (tplRes.error) {
                            this.showMessage('获取模板失败', 'error');
                            return;
                        }

                        const applyRes = await api('apply-config-template', {
                            template: tplRes.template
                        });
                        if (applyRes.error) {
                            this.showMessage('应用模板失败', 'error');
                            return;
                        }

                        if (options.silent !== true) {
                            this.showMessage('配置已应用', 'success');
                        }

                        await this.loadAll();
                    } catch (e) {
                        this.showMessage('应用失败', 'error');
                    } finally {
                        this.codexApplying = false;
                    }
                },

                closeConfigTemplateModal() {
                    this.showConfigTemplateModal = false;
                    this.configTemplateContent = '';
                },

                async applyConfigTemplate() {
                    if (!this.configTemplateContent || !this.configTemplateContent.trim()) {
                        this.showMessage('模板不能为空', 'error');
                        return;
                    }

                    this.configTemplateApplying = true;
                    try {
                        const res = await api('apply-config-template', {
                            template: this.configTemplateContent
                        });
                        if (res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        this.showMessage('模板已应用', 'success');
                        this.closeConfigTemplateModal();
                        await this.loadAll();
                    } catch (e) {
                        this.showMessage('应用模板失败', 'error');
                    } finally {
                        this.configTemplateApplying = false;
                    }
                },

                async openAgentsEditor() {
                    this.setAgentsModalContext('codex');
                    this.agentsLoading = true;
                    try {
                        const res = await api('get-agents-file');
                        if (res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        this.agentsContent = res.content || '';
                        this.agentsOriginalContent = this.agentsContent;
                        this.agentsPath = res.path || '';
                        this.agentsExists = !!res.exists;
                        this.agentsLineEnding = res.lineEnding === '\r\n' ? '\r\n' : '\n';
                        this.resetAgentsDiffState();
                        this.showAgentsModal = true;
                    } catch (e) {
                        this.showMessage('加载文件失败', 'error');
                    } finally {
                        this.agentsLoading = false;
                    }
                },

                ...createSkillsMethods({ api }),

                async openOpenclawAgentsEditor() {
                    this.setAgentsModalContext('openclaw');
                    this.agentsLoading = true;
                    try {
                        const res = await api('get-openclaw-agents-file');
                        if (res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        if (res.configError) {
                            this.showMessage(`OpenClaw 配置解析失败，已使用默认 Workspace：${res.configError}`, 'error');
                        }
                        this.agentsContent = res.content || '';
                        this.agentsOriginalContent = this.agentsContent;
                        this.agentsPath = res.path || '';
                        this.agentsExists = !!res.exists;
                        this.agentsLineEnding = res.lineEnding === '\r\n' ? '\r\n' : '\n';
                        this.resetAgentsDiffState();
                        this.showAgentsModal = true;
                    } catch (e) {
                        this.showMessage('加载文件失败', 'error');
                    } finally {
                        this.agentsLoading = false;
                    }
                },

                async openOpenclawWorkspaceEditor() {
                    const fileName = (this.openclawWorkspaceFileName || '').trim();
                    if (!fileName) {
                        this.showMessage('请输入文件名', 'error');
                        return;
                    }
                    this.setAgentsModalContext('openclaw-workspace', { fileName });
                    this.agentsLoading = true;
                    try {
                        const res = await api('get-openclaw-workspace-file', { fileName });
                        if (res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        if (res.configError) {
                            this.showMessage(`OpenClaw 配置解析失败，已使用默认 Workspace：${res.configError}`, 'error');
                        }
                        this.agentsContent = res.content || '';
                        this.agentsOriginalContent = this.agentsContent;
                        this.agentsPath = res.path || '';
                        this.agentsExists = !!res.exists;
                        this.agentsLineEnding = res.lineEnding === '\r\n' ? '\r\n' : '\n';
                        this.resetAgentsDiffState();
                        this.showAgentsModal = true;
                    } catch (e) {
                        this.showMessage('加载文件失败', 'error');
                    } finally {
                        this.agentsLoading = false;
                    }
                },

                setAgentsModalContext(context, options = {}) {
                    if (context === 'openclaw-workspace') {
                        const fileName = (options.fileName || this.openclawWorkspaceFileName || 'AGENTS.md').trim();
                        this.agentsContext = 'openclaw-workspace';
                        this.agentsWorkspaceFileName = fileName;
                        this.agentsModalTitle = `OpenClaw 工作区文件: ${fileName}`;
                        this.agentsModalHint = `保存后会写入 OpenClaw Workspace 下的 ${fileName}。`;
                        return;
                    }
                    this.agentsContext = context === 'openclaw' ? 'openclaw' : 'codex';
                    if (this.agentsContext === 'openclaw') {
                        this.agentsModalTitle = 'OpenClaw AGENTS.md 编辑器';
                        this.agentsModalHint = '保存后会写入 OpenClaw Workspace 下的 AGENTS.md。';
                    } else {
                        this.agentsModalTitle = 'AGENTS.md 编辑器';
                        this.agentsModalHint = '保存后会写入目标 AGENTS.md（与 config.toml 同级）。';
                    }
                    this.agentsWorkspaceFileName = '';
                },

                resetAgentsDiffState() {
                    this.agentsDiffVisible = false;
                    this.agentsDiffLoading = false;
                    this.agentsDiffError = '';
                    this.agentsDiffLines = [];
                    this.agentsDiffStats = {
                        added: 0,
                        removed: 0,
                        unchanged: 0
                    };
                    this.agentsDiffFingerprint = '';
                },
                hasAgentsContentChanged() {
                    const original = typeof this.agentsOriginalContent === 'string' ? this.agentsOriginalContent : '';
                    const current = typeof this.agentsContent === 'string' ? this.agentsContent : '';
                    return original !== current;
                },
                onAgentsContentInput() {
                    if (this.agentsDiffVisible || this.agentsDiffLines.length) {
                        this.resetAgentsDiffState();
                    }
                },
                buildAgentsDiffFingerprint() {
                    const context = this.agentsContext || 'codex';
                    const fileName = context === 'openclaw-workspace'
                        ? (this.agentsWorkspaceFileName || '')
                        : '';
                    const lineEnding = this.agentsLineEnding || '\n';
                    const content = typeof this.agentsContent === 'string' ? this.agentsContent : '';
                    const original = typeof this.agentsOriginalContent === 'string' ? this.agentsOriginalContent : '';
                    return `${context}::${fileName}::${lineEnding}::${content.length}::${content}::${original.length}::${original}`;
                },
                async prepareAgentsDiff() {
                    this.agentsDiffVisible = true;
                    this.agentsDiffLoading = true;
                    this.agentsDiffError = '';
                    this.agentsDiffLines = [];
                    this.agentsDiffStats = {
                        added: 0,
                        removed: 0,
                        unchanged: 0
                    };
                    try {
                        const params = {
                            baseContent: this.agentsOriginalContent,
                            content: this.agentsContent,
                            lineEnding: this.agentsLineEnding,
                            context: this.agentsContext
                        };
                        if (this.agentsContext === 'openclaw-workspace') {
                            params.fileName = this.agentsWorkspaceFileName;
                        }
                        const res = await api('preview-agents-diff', params);
                        if (res.error) {
                            this.agentsDiffError = res.error;
                            return;
                        }
                        const diff = res.diff && typeof res.diff === 'object' ? res.diff : {};
                        const rawLines = Array.isArray(diff.lines) ? diff.lines : [];
                        this.agentsDiffLines = rawLines.filter(line => line && line.type);
                        if (diff.stats && typeof diff.stats === 'object') {
                            this.agentsDiffStats = {
                                added: Number(diff.stats.added || 0),
                                removed: Number(diff.stats.removed || 0),
                                unchanged: Number(diff.stats.unchanged || 0)
                            };
                        } else {
                            const stats = { added: 0, removed: 0, unchanged: 0 };
                            for (const line of this.agentsDiffLines) {
                                if (line && line.type === 'add') stats.added += 1;
                                else if (line && line.type === 'del') stats.removed += 1;
                                else stats.unchanged += 1;
                            }
                            this.agentsDiffStats = stats;
                        }
                        this.agentsDiffFingerprint = this.buildAgentsDiffFingerprint();
                    } catch (e) {
                        this.agentsDiffError = '生成差异失败';
                    } finally {
                        this.agentsDiffLoading = false;
                    }
                },

                closeAgentsModal() {
                    this.showAgentsModal = false;
                    this.agentsContent = '';
                    this.agentsOriginalContent = '';
                    this.agentsPath = '';
                    this.agentsExists = false;
                    this.agentsLineEnding = '\n';
                    this.agentsSaving = false;
                    this.agentsWorkspaceFileName = '';
                    this.resetAgentsDiffState();
                    this.setAgentsModalContext('codex');
                },

                async applyAgentsContent() {
                    if (!this.agentsDiffVisible) {
                        if (!this.hasAgentsContentChanged()) {
                            this.showMessage('未检测到改动', 'info');
                            return;
                        }
                        await this.prepareAgentsDiff();
                        return;
                    }
                    if (this.agentsDiffLoading) {
                        return;
                    }
                    if (this.agentsDiffError) {
                        this.showMessage(this.agentsDiffError, 'error');
                        return;
                    }
                    const fingerprint = this.buildAgentsDiffFingerprint();
                    if (this.agentsDiffFingerprint !== fingerprint) {
                        await this.prepareAgentsDiff();
                        return;
                    }
                    if (!this.agentsDiffHasChanges) {
                        this.showMessage('未检测到改动', 'info');
                        return;
                    }
                    this.agentsSaving = true;
                    try {
                        let action = 'apply-agents-file';
                        const params = {
                            content: this.agentsContent,
                            lineEnding: this.agentsLineEnding
                        };
                        if (this.agentsContext === 'openclaw') {
                            action = 'apply-openclaw-agents-file';
                        } else if (this.agentsContext === 'openclaw-workspace') {
                            action = 'apply-openclaw-workspace-file';
                            params.fileName = this.agentsWorkspaceFileName;
                        }
                        const res = await api(action, params);
                        if (res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        const successLabel = this.agentsContext === 'openclaw-workspace'
                            ? `工作区文件已保存${this.agentsWorkspaceFileName ? `: ${this.agentsWorkspaceFileName}` : ''}`
                            : (this.agentsContext === 'openclaw' ? 'OpenClaw AGENTS.md 已保存' : 'AGENTS.md 已保存');
                        this.showMessage(successLabel, 'success');
                        this.closeAgentsModal();
                    } catch (e) {
                        this.showMessage('保存失败', 'error');
                    } finally {
                        this.agentsSaving = false;
                    }
                },

                async addProvider() {
                    if (!this.newProvider.name || !this.newProvider.url) {
                        return this.showMessage('名称和URL必填', 'error');
                    }
                    const name = this.newProvider.name.trim();
                    if (!name) {
                        return this.showMessage('名称不能为空', 'error');
                    }
                    if (name.toLowerCase() === 'local') {
                        return this.showMessage('local provider 为系统保留名称，不可新增', 'error');
                    }
                    if (this.providersList.some(item => item.name === name)) {
                        return this.showMessage('名称已存在', 'error');
                    }

                    try {
                        const res = await api('add-provider', {
                            name,
                            url: this.newProvider.url.trim(),
                            key: this.newProvider.key || ''
                        });
                        if (res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }

                        this.showMessage('操作成功', 'success');
                        this.closeAddModal();
                        await this.loadAll();
                    } catch (e) {
                        this.showMessage('添加失败', 'error');
                    }
                },

                getCurrentCodexAuthProfile() {
                    const list = Array.isArray(this.codexAuthProfiles) ? this.codexAuthProfiles : [];
                    return list.find((item) => !!(item && item.current)) || null;
                },

                isLocalLikeProvider(providerOrName) {
                    if (!providerOrName) return false;
                    const rawName = typeof providerOrName === 'object'
                        ? String(providerOrName.name || '')
                        : String(providerOrName);
                    const normalized = rawName.trim().toLowerCase();
                    return normalized === 'local' || normalized === 'codexmate-proxy';
                },

                providerPillState(provider) {
                    if (this.isLocalLikeProvider(provider)) {
                        const currentProfile = this.getCurrentCodexAuthProfile();
                        return currentProfile
                            ? { configured: true, text: '已登录' }
                            : { configured: false, text: '未登录' };
                    }
                    const configured = !!(provider && provider.hasKey);
                    return {
                        configured,
                        text: configured ? '已配置' : '未配置'
                    };
                },

                providerPillConfigured(provider) {
                    return this.providerPillState(provider).configured;
                },

                providerPillText(provider) {
                    return this.providerPillState(provider).text;
                },

                isReadOnlyProvider(providerOrName) {
                    if (!providerOrName) return false;
                    if (typeof providerOrName === 'object') {
                        return !!providerOrName.readOnly;
                    }
                    const name = String(providerOrName).trim();
                    if (!name) return false;
                    const target = (this.providersList || []).find((item) => item && item.name === name);
                    return !!(target && target.readOnly);
                },

                isNonDeletableProvider(providerOrName) {
                    if (!providerOrName) return false;
                    if (typeof providerOrName === 'object') {
                        const directName = String(providerOrName.name || '').trim().toLowerCase();
                        if (directName === 'local' || directName === 'codexmate-proxy') {
                            return true;
                        }
                        return !!providerOrName.nonDeletable;
                    }
                    const name = String(providerOrName).trim();
                    if (!name) return false;
                    const normalized = name.toLowerCase();
                    if (normalized === 'local' || normalized === 'codexmate-proxy') {
                        return true;
                    }
                    const target = (this.providersList || []).find((item) => item && item.name === name);
                    return !!(target && target.nonDeletable);
                },

                shouldShowProviderDelete(provider) {
                    return !this.isReadOnlyProvider(provider) && !this.isNonDeletableProvider(provider);
                },

                shouldShowProviderEdit(provider) {
                    return !this.isReadOnlyProvider(provider) && !this.isNonDeletableProvider(provider);
                },

                shouldAllowProviderShare(provider) {
                    return !this.isReadOnlyProvider(provider) && !this.isLocalLikeProvider(provider);
                },

                async deleteProvider(name) {
                    if (this.isNonDeletableProvider(name)) {
                        this.showMessage('该 provider 为保留项，不可删除', 'info');
                        return;
                    }
                    const res = await api('delete-provider', { name });
                    if (res.error) {
                        this.showMessage(res.error, 'error');
                        return;
                    }
                    if (res.switched && res.provider) {
                        this.showMessage(`已删除提供商，自动切换到 ${res.provider}${res.model ? ` / ${res.model}` : ''}`, 'success');
                    } else {
                        this.showMessage('操作成功', 'success');
                    }
                    await this.loadAll();
                },

                openEditModal(provider) {
                    if (!this.shouldShowProviderEdit(provider)) {
                        this.showMessage('该 provider 为保留项，不可编辑', 'info');
                        return;
                    }
                    this.editingProvider = {
                        name: provider.name,
                        url: provider.url || '',
                        key: '',
                        readOnly: !!provider.readOnly,
                        nonEditable: this.isNonDeletableProvider(provider)
                    };
                    this.showEditModal = true;
                },

                async updateProvider() {
                    if (this.editingProvider.readOnly || this.editingProvider.nonEditable) {
                        this.showMessage('该 provider 为保留项，不可编辑', 'error');
                        this.closeEditModal();
                        return;
                    }
                    if (!this.editingProvider.url) {
                        return this.showMessage('URL 必填', 'error');
                    }

                    const name = this.editingProvider.name;
                    const url = this.editingProvider.url.trim();
                    const key = this.editingProvider.key || '';
                    this.closeEditModal();
                    try {
                        const res = await api('update-provider', { name, url, key });
                        if (res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        this.showMessage('操作成功', 'success');
                        await this.loadAll();
                    } catch (e) {
                        this.showMessage('更新失败', 'error');
                    }
                },

                closeEditModal() {
                    this.showEditModal = false;
                    this.editingProvider = { name: '', url: '', key: '', readOnly: false, nonEditable: false };
                },

                async resetConfig() {
                    if (this.resetConfigLoading) return;
                    this.resetConfigLoading = true;
                    try {
                        const res = await api('reset-config');
                        if (res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        const backup = res.backupFile ? `（已备份: ${res.backupFile}）` : '';
                        this.showMessage(`配置已重装${backup}`, 'success');
                        await this.loadAll();
                    } catch (e) {
                        this.showMessage('重装失败', 'error');
                    } finally {
                        this.resetConfigLoading = false;
                    }
                },

                async addModel() {
                    if (!this.newModelName || !this.newModelName.trim()) {
                        return this.showMessage('请输入模型', 'error');
                    }
                    const res = await api('add-model', { model: this.newModelName.trim() });
                    if (res.error) {
                        this.showMessage(res.error, 'error');
                    } else {
                        this.showMessage('操作成功', 'success');
                        this.closeModelModal();
                        await this.loadAll();
                    }
                },

                async removeModel(model) {
                    const res = await api('delete-model', { model });
                    if (res.error) {
                        this.showMessage(res.error, 'error');
                    } else {
                        this.showMessage('操作成功', 'success');
                        await this.loadAll();
                    }
                },

                closeAddModal() {
                    this.showAddModal = false;
                    this.newProvider = { name: '', url: '', key: '' };
                },

                closeModelModal() {
                    this.showModelModal = false;
                    this.newModelName = '';
                },

                formatKey(key) {
                    if (!key) return '(未设置)';
                    if (key.length > 10) {
                        return key.substring(0, 3) + '****' + key.substring(key.length - 3);
                    }
                    return '****';
                },

                displayApiKey(configName) {
                    const key = this.claudeConfigs[configName]?.apiKey;
                    return this.formatKey(key);
                },

                switchClaudeConfig(name) {
                    this.currentClaudeConfig = name;
                    this.refreshClaudeModelContext();
                },

                onClaudeModelChange() {
                    const name = this.currentClaudeConfig;
                    if (!name) {
                        this.showMessage('请先选择配置', 'error');
                        return;
                    }
                    const model = (this.currentClaudeModel || '').trim();
                    if (!model) {
                        this.showMessage('请输入模型', 'error');
                        return;
                    }
                    const existing = this.claudeConfigs[name] || {};
                    this.currentClaudeModel = model;
                    this.claudeConfigs[name] = this.mergeClaudeConfig(existing, { model });
                    this.saveClaudeConfigs();
                    this.updateClaudeModelsCurrent();
                    if (!this.claudeConfigs[name].apiKey) {
                        this.showMessage('请先配置 API Key', 'error');
                        return;
                    }
                    this.applyClaudeConfig(name);
                },

                saveClaudeConfigs() {
                    localStorage.setItem('claudeConfigs', JSON.stringify(this.claudeConfigs));
                },

                openEditConfigModal(name) {
                    const config = this.claudeConfigs[name];
                    this.editingConfig = {
                        name: name,
                        apiKey: config.apiKey || '',
                        baseUrl: config.baseUrl || '',
                        model: config.model || ''
                    };
                    this.showEditConfigModal = true;
                },

                updateConfig() {
                    const name = this.editingConfig.name;
                    this.claudeConfigs[name] = this.mergeClaudeConfig(this.claudeConfigs[name], this.editingConfig);
                    this.saveClaudeConfigs();
                    this.showMessage('操作成功', 'success');
                    this.closeEditConfigModal();
                    if (name === this.currentClaudeConfig) {
                        this.refreshClaudeModelContext();
                    }
                },

                closeEditConfigModal() {
                    this.showEditConfigModal = false;
                    this.editingConfig = { name: '', apiKey: '', baseUrl: '', model: '' };
                },

                async saveAndApplyConfig() {
                    const name = this.editingConfig.name;
                    this.claudeConfigs[name] = this.mergeClaudeConfig(this.claudeConfigs[name], this.editingConfig);
                    this.saveClaudeConfigs();

                    const config = this.claudeConfigs[name];
                    if (!config.apiKey) {
                        this.showMessage('已保存，未应用', 'info');
                        this.closeEditConfigModal();
                        if (name === this.currentClaudeConfig) {
                            this.refreshClaudeModelContext();
                        }
                        return;
                    }

                    const res = await api('apply-claude-config', { config });
                    if (res.error || res.success === false) {
                        this.showMessage(res.error || '应用配置失败', 'error');
                    } else {
                        const targetTip = res.targetPath ? `（${res.targetPath}）` : '';
                        this.showMessage(`已保存并应用到 Claude 配置${targetTip}`, 'success');
                        this.closeEditConfigModal();
                        if (name === this.currentClaudeConfig) {
                            this.refreshClaudeModelContext();
                        }
                    }
                },

                addClaudeConfig() {
                    if (!this.newClaudeConfig.name || !this.newClaudeConfig.name.trim()) {
                        return this.showMessage('请输入名称', 'error');
                    }
                    const name = this.newClaudeConfig.name.trim();
                    if (this.claudeConfigs[name]) {
                        return this.showMessage('名称已存在', 'error');
                    }
                    const duplicateName = this.findDuplicateClaudeConfigName(this.newClaudeConfig);
                    if (duplicateName) {
                        return this.showMessage('配置已存在', 'info');
                    }

                    this.claudeConfigs[name] = this.mergeClaudeConfig({}, this.newClaudeConfig);

                    this.currentClaudeConfig = name;
                    this.saveClaudeConfigs();
                    this.showMessage('操作成功', 'success');
                    this.closeClaudeConfigModal();
                    this.refreshClaudeModelContext();
                },

                deleteClaudeConfig(name) {
                    if (Object.keys(this.claudeConfigs).length <= 1) {
                        return this.showMessage('至少保留一项', 'error');
                    }

                    if (!confirm(`确定删除配置 "${name}"?`)) return;

                    delete this.claudeConfigs[name];
                    if (this.currentClaudeConfig === name) {
                        this.currentClaudeConfig = Object.keys(this.claudeConfigs)[0];
                    }
                    this.saveClaudeConfigs();
                    this.showMessage('操作成功', 'success');
                    this.refreshClaudeModelContext();
                },

                async applyClaudeConfig(name) {
                    this.currentClaudeConfig = name;
                    this.refreshClaudeModelContext();
                    const config = this.claudeConfigs[name];

                    if (!config.apiKey) {
                        if (config.externalCredentialType) {
                            return this.showMessage('检测到外部 Claude 认证状态；当前仅支持展示，若需由 codexmate 接管请补充 API Key', 'info');
                        }
                        return this.showMessage('请先配置 API Key', 'error');
                    }

                    const res = await api('apply-claude-config', { config });
                    if (res.error || res.success === false) {
                        this.showMessage(res.error || '应用配置失败', 'error');
                    } else {
                        const targetTip = res.targetPath ? `（${res.targetPath}）` : '';
                        this.showMessage(`已应用配置到 Claude 设置: ${name}${targetTip}`, 'success');
                    }
                },

                closeClaudeConfigModal() {
                    this.showClaudeConfigModal = false;
                    this.newClaudeConfig = {
                        name: '',
                        apiKey: '',
                        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
                        model: 'glm-4.7'
                    };
                },

                getOpenclawParser() {
                    if (window.JSON5 && typeof window.JSON5.parse === 'function' && typeof window.JSON5.stringify === 'function') {
                        return {
                            parse: window.JSON5.parse,
                            stringify: window.JSON5.stringify
                        };
                    }
                    return {
                        parse: JSON.parse,
                        stringify: JSON.stringify
                    };
                },

                parseOpenclawContent(content, options = {}) {
                    const allowEmpty = !!options.allowEmpty;
                    const raw = typeof content === 'string' ? content.trim() : '';
                    if (!raw) {
                        if (allowEmpty) {
                            return { ok: true, data: {} };
                        }
                        return { ok: false, error: '配置内容为空' };
                    }
                    try {
                        const parser = this.getOpenclawParser();
                        const data = parser.parse(raw);
                        if (!data || typeof data !== 'object' || Array.isArray(data)) {
                            return { ok: false, error: '配置格式错误（根节点必须是对象）' };
                        }
                        return { ok: true, data };
                    } catch (e) {
                        return { ok: false, error: e.message || '解析失败' };
                    }
                },

                stringifyOpenclawConfig(data) {
                    const parser = this.getOpenclawParser();
                    try {
                        return parser.stringify(data, null, 2);
                    } catch (e) {
                        return JSON.stringify(data, null, 2);
                    }
                },

                resetOpenclawStructured() {
                    this.openclawStructured = {
                        agentPrimary: '',
                        agentFallbacks: [''],
                        workspace: '',
                        timeout: '',
                        contextTokens: '',
                        maxConcurrent: '',
                        envItems: [{ key: '', value: '', show: false }],
                        toolsProfile: 'default',
                        toolsAllow: [''],
                        toolsDeny: ['']
                    };
                    this.openclawAgentsList = [];
                    this.openclawProviders = [];
                    this.openclawMissingProviders = [];
                },

                getOpenclawQuickDefaults() {
                    return {
                        providerName: '',
                        baseUrl: '',
                        apiKey: '',
                        apiType: 'openai-responses',
                        modelId: '',
                        modelName: '',
                        contextWindow: '',
                        maxTokens: '',
                        setPrimary: true,
                        overrideProvider: true,
                        overrideModels: true,
                        showKey: false
                    };
                },

                resetOpenclawQuick() {
                    this.openclawQuick = this.getOpenclawQuickDefaults();
                },

                toggleOpenclawQuickKey() {
                    this.openclawQuick.showKey = !this.openclawQuick.showKey;
                },

                fillOpenclawQuickFromConfig(config) {
                    const defaults = this.getOpenclawQuickDefaults();
                    if (!config || typeof config !== 'object' || Array.isArray(config)) {
                        this.openclawQuick = defaults;
                        return;
                    }

                    const agentDefaults = config.agents && typeof config.agents === 'object' && !Array.isArray(config.agents)
                        && config.agents.defaults && typeof config.agents.defaults === 'object' && !Array.isArray(config.agents.defaults)
                        ? config.agents.defaults
                        : {};
                    const modelConfig = agentDefaults.model;
                    const legacyAgent = config.agent && typeof config.agent === 'object' && !Array.isArray(config.agent)
                        ? config.agent
                        : {};

                    let primaryRef = '';
                    if (modelConfig && typeof modelConfig === 'object' && !Array.isArray(modelConfig) && typeof modelConfig.primary === 'string') {
                        primaryRef = modelConfig.primary;
                    } else if (typeof modelConfig === 'string') {
                        primaryRef = modelConfig;
                    }
                    if (!primaryRef) {
                        if (typeof legacyAgent.model === 'string') {
                            primaryRef = legacyAgent.model;
                        } else if (legacyAgent.model && typeof legacyAgent.model === 'object' && typeof legacyAgent.model.primary === 'string') {
                            primaryRef = legacyAgent.model.primary;
                        }
                    }

                    let providerName = '';
                    let modelId = '';
                    if (primaryRef) {
                        const parts = primaryRef.split('/');
                        if (parts.length >= 2) {
                            providerName = parts.shift().trim();
                            modelId = parts.join('/').trim();
                        }
                    }

                    const providers = config.models && typeof config.models === 'object' && !Array.isArray(config.models)
                        && config.models.providers && typeof config.models.providers === 'object' && !Array.isArray(config.models.providers)
                        ? config.models.providers
                        : null;
                    let providerConfig = providerName && providers ? providers[providerName] : null;
                    if (!providerName && providers) {
                        const providerKeys = Object.keys(providers);
                        if (providerKeys.length === 1) {
                            providerName = providerKeys[0];
                            providerConfig = providers[providerName];
                        }
                    }

                    let modelEntry = null;
                    if (providerConfig && typeof providerConfig === 'object' && Array.isArray(providerConfig.models)) {
                        if (modelId) {
                            modelEntry = providerConfig.models.find(item => item && item.id === modelId);
                        }
                        if (!modelEntry && providerConfig.models.length === 1) {
                            modelEntry = providerConfig.models[0];
                            if (!modelId && modelEntry && typeof modelEntry.id === 'string') {
                                modelId = modelEntry.id;
                            }
                        }
                    }

                    const baseUrl = providerConfig && typeof providerConfig === 'object' && typeof providerConfig.baseUrl === 'string'
                        ? providerConfig.baseUrl
                        : '';
                    const apiKey = providerConfig && typeof providerConfig === 'object' && typeof providerConfig.apiKey === 'string'
                        ? providerConfig.apiKey
                        : '';
                    const apiType = providerConfig && typeof providerConfig === 'object' && typeof providerConfig.api === 'string'
                        ? providerConfig.api
                        : defaults.apiType;

                    this.openclawQuick = {
                        ...defaults,
                        providerName,
                        baseUrl,
                        apiKey,
                        apiType,
                        modelId: modelId || '',
                        modelName: modelEntry && typeof modelEntry.name === 'string' ? modelEntry.name : '',
                        contextWindow: modelEntry && typeof modelEntry.contextWindow === 'number'
                            ? String(modelEntry.contextWindow)
                            : '',
                        maxTokens: modelEntry && typeof modelEntry.maxTokens === 'number'
                            ? String(modelEntry.maxTokens)
                            : ''
                    };
                },

                syncOpenclawQuickFromText(options = {}) {
                    const silent = !!options.silent;
                    const parsed = this.parseOpenclawContent(this.openclawEditing.content, { allowEmpty: true });
                    if (!parsed.ok) {
                        this.resetOpenclawQuick();
                        if (!silent) {
                            this.showMessage('解析 OpenClaw 配置失败: ' + parsed.error, 'error');
                        }
                        return false;
                    }
                    this.fillOpenclawQuickFromConfig(parsed.data);
                    if (!silent) {
                        this.showMessage('已读取配置', 'success');
                    }
                    return true;
                },

                mergeOpenclawModelEntry(existing, incoming, overwrite = false) {
                    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
                        return { ...incoming };
                    }
                    if (overwrite) {
                        return { ...incoming };
                    }
                    const merged = { ...existing };
                    for (const [key, value] of Object.entries(incoming || {})) {
                        if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
                            merged[key] = value;
                        }
                    }
                    return merged;
                },

                fillOpenclawStructured(config) {
                    const defaults = config && config.agents && typeof config.agents === 'object' && !Array.isArray(config.agents)
                        && config.agents.defaults && typeof config.agents.defaults === 'object' && !Array.isArray(config.agents.defaults)
                        ? config.agents.defaults
                        : {};
                    const model = defaults.model && typeof defaults.model === 'object' && !Array.isArray(defaults.model)
                        ? defaults.model
                        : {};
                    const legacyAgent = config && config.agent && typeof config.agent === 'object' && !Array.isArray(config.agent)
                        ? config.agent
                        : {};
                    const fallbackList = Array.isArray(model.fallbacks)
                        ? model.fallbacks.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
                        : [];
                    const env = config && config.env && typeof config.env === 'object' && !Array.isArray(config.env)
                        ? config.env
                        : {};
                    const envItems = Object.entries(env).map(([key, value]) => ({
                        key,
                        value: value == null ? '' : String(value),
                        show: false
                    }));
                    const tools = config && config.tools && typeof config.tools === 'object' && !Array.isArray(config.tools)
                        ? config.tools
                        : {};

                    let primary = typeof model.primary === 'string' ? model.primary : '';
                    if (!primary) {
                        if (typeof legacyAgent.model === 'string') {
                            primary = legacyAgent.model;
                        } else if (legacyAgent.model && typeof legacyAgent.model === 'object' && typeof legacyAgent.model.primary === 'string') {
                            primary = legacyAgent.model.primary;
                        }
                    }

                    this.openclawStructured = {
                        agentPrimary: primary,
                        agentFallbacks: fallbackList.length ? fallbackList : [''],
                        workspace: typeof defaults.workspace === 'string' ? defaults.workspace : '',
                        timeout: typeof defaults.timeout === 'number' && Number.isFinite(defaults.timeout)
                            ? String(defaults.timeout)
                            : '',
                        contextTokens: typeof defaults.contextTokens === 'number' && Number.isFinite(defaults.contextTokens)
                            ? String(defaults.contextTokens)
                            : '',
                        maxConcurrent: typeof defaults.maxConcurrent === 'number' && Number.isFinite(defaults.maxConcurrent)
                            ? String(defaults.maxConcurrent)
                            : '',
                        envItems: envItems.length ? envItems : [{ key: '', value: '', show: false }],
                        toolsProfile: typeof tools.profile === 'string' && tools.profile.trim() ? tools.profile : 'default',
                        toolsAllow: Array.isArray(tools.allow) && tools.allow.length
                            ? tools.allow.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
                            : [''],
                        toolsDeny: Array.isArray(tools.deny) && tools.deny.length
                            ? tools.deny.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
                            : ['']
                    };
                },

                syncOpenclawStructuredFromText(options = {}) {
                    const silent = !!options.silent;
                    const parsed = this.parseOpenclawContent(this.openclawEditing.content, { allowEmpty: true });
                    if (!parsed.ok) {
                        this.resetOpenclawStructured();
                        this.resetOpenclawQuick();
                        if (!silent) {
                            this.showMessage('解析 OpenClaw 配置失败: ' + parsed.error, 'error');
                        }
                        return false;
                    }
                    this.fillOpenclawStructured(parsed.data);
                    this.fillOpenclawQuickFromConfig(parsed.data);
                    this.refreshOpenclawProviders(parsed.data);
                    this.refreshOpenclawAgentsList(parsed.data);
                    if (!silent) {
                        this.showMessage('已刷新配置', 'success');
                    }
                    return true;
                },

                getOpenclawActiveProviders(config) {
                    const active = new Set();
                    const addProvider = (ref) => {
                        if (typeof ref !== 'string') return;
                        const text = ref.trim();
                        if (!text) return;
                        const parts = text.split('/');
                        if (parts.length < 2) return;
                        const provider = parts[0].trim();
                        if (provider) active.add(provider);
                    };
                    const defaults = config && config.agents && config.agents.defaults
                        ? config.agents.defaults
                        : {};
                    const model = defaults && defaults.model;
                    if (model && typeof model === 'object' && !Array.isArray(model)) {
                        addProvider(model.primary);
                        if (Array.isArray(model.fallbacks)) {
                            for (const item of model.fallbacks) {
                                addProvider(item);
                            }
                        }
                    } else if (typeof model === 'string') {
                        addProvider(model);
                    }
                    const modelsDefaults = config && config.models && config.models.defaults
                        ? config.models.defaults
                        : {};
                    if (modelsDefaults && typeof modelsDefaults.provider === 'string' && modelsDefaults.provider.trim()) {
                        active.add(modelsDefaults.provider.trim());
                    }
                    if (modelsDefaults && typeof modelsDefaults.model === 'string') {
                        addProvider(modelsDefaults.model);
                    }
                    return active;
                },

                maskProviderValue(value) {
                    const text = value == null ? '' : String(value);
                    if (!text) return '****';
                    if (text.length <= 6) return '****';
                    return `${text.slice(0, 3)}****${text.slice(-3)}`;
                },

                formatProviderValue(key, value) {
                    if (typeof value === 'undefined' || value === null) {
                        return '';
                    }
                    let text = '';
                    if (typeof value === 'string') {
                        text = value;
                    } else if (typeof value === 'number' || typeof value === 'boolean') {
                        text = String(value);
                    } else {
                        try {
                            text = JSON.stringify(value);
                        } catch (_) {
                            text = String(value);
                        }
                    }
                    if (!text) return '';
                    if (/key|token|secret|password/i.test(key)) {
                        return this.maskProviderValue(text);
                    }
                    if (text.length > 160) {
                        return `${text.slice(0, 157)}...`;
                    }
                    return text;
                },

                collectOpenclawProviders(source, providerMap, activeProviders, entries) {
                    if (!providerMap || typeof providerMap !== 'object' || Array.isArray(providerMap)) {
                        return;
                    }
                    const keys = Object.keys(providerMap).sort();
                    for (const key of keys) {
                        const value = providerMap[key];
                        const fields = [];
                        if (value && typeof value === 'object' && !Array.isArray(value)) {
                            const fieldKeys = Object.keys(value).sort();
                            for (const fieldKey of fieldKeys) {
                                const fieldValue = this.formatProviderValue(fieldKey, value[fieldKey]);
                                if (fieldValue === '') continue;
                                fields.push({ key: fieldKey, value: fieldValue });
                            }
                        } else {
                            const fieldValue = this.formatProviderValue('value', value);
                            if (fieldValue !== '') {
                                fields.push({ key: 'value', value: fieldValue });
                            }
                        }
                        entries.push({
                            key,
                            source,
                            fields,
                            isActive: activeProviders.has(key)
                        });
                    }
                },

                refreshOpenclawProviders(config) {
                    const activeProviders = this.getOpenclawActiveProviders(config || {});
                    const entries = [];
                    const modelsProviders = config && config.models ? config.models.providers : null;
                    const rootProviders = config && config.providers ? config.providers : null;
                    this.collectOpenclawProviders('models.providers', modelsProviders, activeProviders, entries);
                    this.collectOpenclawProviders('providers', rootProviders, activeProviders, entries);
                    const existing = new Set(entries.map(item => item.key));
                    const missing = [];
                    for (const provider of activeProviders) {
                        if (!existing.has(provider)) {
                            missing.push(provider);
                        }
                    }
                    this.openclawProviders = entries;
                    this.openclawMissingProviders = missing;
                },

                refreshOpenclawAgentsList(config) {
                    const list = config && config.agents && typeof config.agents === 'object' && !Array.isArray(config.agents)
                        ? config.agents.list
                        : null;
                    if (!Array.isArray(list)) {
                        this.openclawAgentsList = [];
                        return;
                    }
                    const entries = [];
                    list.forEach((item, index) => {
                        if (!item || typeof item !== 'object') return;
                        const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `agent-${index + 1}`;
                        const identity = item.identity && typeof item.identity === 'object' && !Array.isArray(item.identity)
                            ? item.identity
                            : {};
                        const name = typeof identity.name === 'string' && identity.name.trim()
                            ? identity.name.trim()
                            : id;
                        entries.push({
                            key: `${id}-${index}`,
                            id,
                            name,
                            theme: typeof identity.theme === 'string' ? identity.theme : '',
                            emoji: typeof identity.emoji === 'string' ? identity.emoji : '',
                            avatar: typeof identity.avatar === 'string' ? identity.avatar : ''
                        });
                    });
                    this.openclawAgentsList = entries;
                },

                normalizeStringList(list) {
                    if (!Array.isArray(list)) return [];
                    const result = [];
                    const seen = new Set();
                    for (const item of list) {
                        const value = typeof item === 'string' ? item.trim() : String(item || '').trim();
                        if (!value) continue;
                        const key = value;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        result.push(value);
                    }
                    return result;
                },

                normalizeEnvItems(items) {
                    if (!Array.isArray(items)) {
                        return { ok: true, items: {} };
                    }
                    const output = {};
                    const seen = new Set();
                    for (const item of items) {
                        const key = item && typeof item.key === 'string' ? item.key.trim() : '';
                        if (!key) continue;
                        if (seen.has(key)) {
                            return { ok: false, error: `环境变量重复: ${key}` };
                        }
                        seen.add(key);
                        const value = item && typeof item.value !== 'undefined' ? String(item.value) : '';
                        output[key] = value;
                    }
                    return { ok: true, items: output };
                },

                parseOptionalNumber(value, label) {
                    const text = typeof value === 'string' ? value.trim() : String(value || '').trim();
                    if (!text) {
                        return { ok: true, value: null };
                    }
                    const num = Number(text);
                    if (!Number.isFinite(num) || num < 0) {
                        return { ok: false, error: `${label} 请输入有效数字` };
                    }
                    return { ok: true, value: num };
                },

                applyOpenclawStructuredToText() {
                    const parsed = this.parseOpenclawContent(this.openclawEditing.content, { allowEmpty: true });
                    if (!parsed.ok) {
                        this.showMessage('解析 OpenClaw 配置失败: ' + parsed.error, 'error');
                        return;
                    }

                    const config = parsed.data;
                    const agents = config.agents && typeof config.agents === 'object' && !Array.isArray(config.agents)
                        ? config.agents
                        : {};
                    const defaults = agents.defaults && typeof agents.defaults === 'object' && !Array.isArray(agents.defaults)
                        ? agents.defaults
                        : {};
                    const model = defaults.model && typeof defaults.model === 'object' && !Array.isArray(defaults.model)
                        ? defaults.model
                        : {};

                    const primary = (this.openclawStructured.agentPrimary || '').trim();
                    const fallbacks = this.normalizeStringList(this.openclawStructured.agentFallbacks);
                    if (primary) {
                        model.primary = primary;
                    }
                    if (fallbacks.length) {
                        model.fallbacks = fallbacks;
                    }
                    if (primary || fallbacks.length) {
                        defaults.model = model;
                    }
                    if (primary && config.agent && typeof config.agent === 'object' && !Array.isArray(config.agent)) {
                        config.agent.model = primary;
                    }

                    const workspace = (this.openclawStructured.workspace || '').trim();
                    if (workspace) {
                        defaults.workspace = workspace;
                    }

                    const timeout = this.parseOptionalNumber(this.openclawStructured.timeout, 'Timeout');
                    if (!timeout.ok) {
                        this.showMessage(timeout.error, 'error');
                        return;
                    }
                    if (timeout.value !== null) {
                        defaults.timeout = timeout.value;
                    }

                    const contextTokens = this.parseOptionalNumber(this.openclawStructured.contextTokens, 'Context Tokens');
                    if (!contextTokens.ok) {
                        this.showMessage(contextTokens.error, 'error');
                        return;
                    }
                    if (contextTokens.value !== null) {
                        defaults.contextTokens = contextTokens.value;
                    }

                    const maxConcurrent = this.parseOptionalNumber(this.openclawStructured.maxConcurrent, 'Max Concurrent');
                    if (!maxConcurrent.ok) {
                        this.showMessage(maxConcurrent.error, 'error');
                        return;
                    }
                    if (maxConcurrent.value !== null) {
                        defaults.maxConcurrent = maxConcurrent.value;
                    }

                    if (Object.keys(defaults).length > 0) {
                        config.agents = agents;
                        config.agents.defaults = defaults;
                    }

                    const envResult = this.normalizeEnvItems(this.openclawStructured.envItems);
                    if (!envResult.ok) {
                        this.showMessage(envResult.error, 'error');
                        return;
                    }
                    if (Object.keys(envResult.items).length > 0) {
                        config.env = envResult.items;
                    } else if (config.env) {
                        delete config.env;
                    }

                    const profile = (this.openclawStructured.toolsProfile || '').trim();
                    const allowList = this.normalizeStringList(this.openclawStructured.toolsAllow);
                    const denyList = this.normalizeStringList(this.openclawStructured.toolsDeny);
                    const hasTools = profile || allowList.length || denyList.length || (config.tools && typeof config.tools === 'object');
                    if (hasTools) {
                        const tools = config.tools && typeof config.tools === 'object' && !Array.isArray(config.tools)
                            ? config.tools
                            : {};
                        tools.profile = profile || tools.profile || 'default';
                        tools.allow = allowList;
                        tools.deny = denyList;
                        config.tools = tools;
                    }

                    this.openclawEditing.content = this.stringifyOpenclawConfig(config);
                    this.refreshOpenclawProviders(config);
                    this.refreshOpenclawAgentsList(config);
                    this.fillOpenclawQuickFromConfig(config);
                    this.showMessage('已写入', 'success');
                },

                applyOpenclawQuickToText() {
                    const parsed = this.parseOpenclawContent(this.openclawEditing.content, { allowEmpty: true });
                    if (!parsed.ok) {
                        this.showMessage('解析 OpenClaw 配置失败: ' + parsed.error, 'error');
                        return;
                    }

                    const providerName = (this.openclawQuick.providerName || '').trim();
                    const modelId = (this.openclawQuick.modelId || '').trim();
                    if (!providerName) {
                        this.showMessage('请填写名称', 'error');
                        return;
                    }
                    if (providerName.includes('/')) {
                        this.showMessage('Provider 名称不能包含 "/"', 'error');
                        return;
                    }
                    if (!modelId) {
                        this.showMessage('请填写模型', 'error');
                        return;
                    }

                    const config = parsed.data;
                    const ensureObject = (value) => (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
                    const models = ensureObject(config.models);
                    const providers = ensureObject(models.providers);
                    const provider = ensureObject(providers[providerName]);
                    const baseUrl = (this.openclawQuick.baseUrl || '').trim();
                    if (!baseUrl && !provider.baseUrl) {
                        this.showMessage('请填写 URL', 'error');
                        return;
                    }

                    const contextWindow = this.parseOptionalNumber(this.openclawQuick.contextWindow, '上下文长度');
                    if (!contextWindow.ok) {
                        this.showMessage(contextWindow.error, 'error');
                        return;
                    }
                    const maxTokens = this.parseOptionalNumber(this.openclawQuick.maxTokens, '最大输出');
                    if (!maxTokens.ok) {
                        this.showMessage(maxTokens.error, 'error');
                        return;
                    }

                    const shouldOverrideProvider = !!this.openclawQuick.overrideProvider;
                    const apiKey = (this.openclawQuick.apiKey || '').trim();
                    const apiType = (this.openclawQuick.apiType || '').trim();
                    const setProviderField = (key, value) => {
                        if (!value) return;
                        if (shouldOverrideProvider || provider[key] === undefined || provider[key] === null || provider[key] === '') {
                            provider[key] = value;
                        }
                    };
                    setProviderField('baseUrl', baseUrl);
                    setProviderField('api', apiType);
                    if (apiKey) {
                        setProviderField('apiKey', apiKey);
                    }

                    const modelName = (this.openclawQuick.modelName || '').trim() || modelId;
                    const modelEntry = {
                        id: modelId,
                        name: modelName,
                        reasoning: false,
                        input: ['text'],
                        cost: {
                            input: 0,
                            output: 0,
                            cacheRead: 0,
                            cacheWrite: 0
                        }
                    };
                    if (contextWindow.value !== null) {
                        modelEntry.contextWindow = contextWindow.value;
                    }
                    if (maxTokens.value !== null) {
                        modelEntry.maxTokens = maxTokens.value;
                    }

                    const existingModels = Array.isArray(provider.models) ? [...provider.models] : [];
                    if (this.openclawQuick.overrideModels || existingModels.length === 0) {
                        provider.models = [modelEntry];
                    } else {
                        const idx = existingModels.findIndex(item => item && item.id === modelId);
                        if (idx >= 0) {
                            existingModels[idx] = this.mergeOpenclawModelEntry(existingModels[idx], modelEntry, false);
                        } else {
                            existingModels.push(modelEntry);
                        }
                        provider.models = existingModels;
                    }

                    providers[providerName] = provider;
                    models.providers = providers;
                    config.models = models;

                    if (this.openclawQuick.setPrimary) {
                        const agents = ensureObject(config.agents);
                        const defaults = ensureObject(agents.defaults);
                        const modelConfig = defaults.model && typeof defaults.model === 'object' && !Array.isArray(defaults.model)
                            ? defaults.model
                            : {};
                        modelConfig.primary = `${providerName}/${modelId}`;
                        defaults.model = modelConfig;
                        agents.defaults = defaults;
                        config.agents = agents;
                        if (config.agent && typeof config.agent === 'object' && !Array.isArray(config.agent)) {
                            config.agent.model = modelConfig.primary;
                        }
                    }

                    this.openclawEditing.content = this.stringifyOpenclawConfig(config);
                    this.fillOpenclawStructured(config);
                    this.refreshOpenclawProviders(config);
                    this.refreshOpenclawAgentsList(config);
                    this.showMessage('配置已写入', 'success');
                },

                addOpenclawFallback() {
                    this.openclawStructured.agentFallbacks.push('');
                },

                removeOpenclawFallback(index) {
                    this.openclawStructured.agentFallbacks.splice(index, 1);
                    if (this.openclawStructured.agentFallbacks.length === 0) {
                        this.openclawStructured.agentFallbacks.push('');
                    }
                },

                addOpenclawEnvItem() {
                    this.openclawStructured.envItems.push({ key: '', value: '', show: false });
                },

                removeOpenclawEnvItem(index) {
                    this.openclawStructured.envItems.splice(index, 1);
                    if (this.openclawStructured.envItems.length === 0) {
                        this.openclawStructured.envItems.push({ key: '', value: '', show: false });
                    }
                },

                toggleOpenclawEnvItem(index) {
                    const item = this.openclawStructured.envItems[index];
                    if (item) {
                        item.show = !item.show;
                    }
                },

                addOpenclawToolsAllow() {
                    this.openclawStructured.toolsAllow.push('');
                },

                removeOpenclawToolsAllow(index) {
                    this.openclawStructured.toolsAllow.splice(index, 1);
                    if (this.openclawStructured.toolsAllow.length === 0) {
                        this.openclawStructured.toolsAllow.push('');
                    }
                },

                addOpenclawToolsDeny() {
                    this.openclawStructured.toolsDeny.push('');
                },

                removeOpenclawToolsDeny(index) {
                    this.openclawStructured.toolsDeny.splice(index, 1);
                    if (this.openclawStructured.toolsDeny.length === 0) {
                        this.openclawStructured.toolsDeny.push('');
                    }
                },

                openclawHasContent(config) {
                    return !!(config && typeof config.content === 'string' && config.content.trim());
                },

                openclawSubtitle(config) {
                    if (!this.openclawHasContent(config)) {
                        return '未设置配置';
                    }
                    const length = config.content.trim().length;
                    return `已保存 ${length} 字符`;
                },

                saveOpenclawConfigs() {
                    localStorage.setItem('openclawConfigs', JSON.stringify(this.openclawConfigs));
                },

                openOpenclawAddModal() {
                    this.openclawEditorTitle = '添加 OpenClaw 配置';
                    this.openclawEditing = {
                        name: '',
                        content: '',
                        lockName: false
                    };
                    this.openclawConfigPath = '';
                    this.openclawConfigExists = false;
                    this.openclawLineEnding = '\n';
                    void this.loadOpenclawConfigFromFile({ silent: true, force: true, fallbackToTemplate: true });
                    this.showOpenclawConfigModal = true;
                },

                openOpenclawEditModal(name) {
                    this.openclawEditorTitle = `编辑 OpenClaw 配置: ${name}`;
                    this.openclawEditing = {
                        name,
                        content: '',
                        lockName: true
                    };
                    void this.loadOpenclawConfigFromFile({ silent: true, force: true, fallbackToTemplate: true });
                    this.showOpenclawConfigModal = true;
                },

                closeOpenclawConfigModal() {
                    this.showOpenclawConfigModal = false;
                    this.openclawEditing = { name: '', content: '', lockName: false };
                    this.openclawSaving = false;
                    this.openclawApplying = false;
                    this.resetOpenclawStructured();
                    this.resetOpenclawQuick();
                },

                normalizeInstallPackageManager(value) {
                    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
                    if (normalized === 'pnpm' || normalized === 'bun' || normalized === 'npm') {
                        return normalized;
                    }
                    return 'npm';
                },

                normalizeInstallAction(value) {
                    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
                    if (normalized === 'update' || normalized === 'uninstall' || normalized === 'install') {
                        return normalized;
                    }
                    return 'install';
                },

                normalizeInstallRegistryPreset(value) {
                    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
                    if (normalized === 'default' || normalized === 'npmmirror' || normalized === 'tencent' || normalized === 'custom') {
                        return normalized;
                    }
                    return 'default';
                },

                normalizeInstallRegistryUrl(value) {
                    const normalized = typeof value === 'string' ? value.trim() : '';
                    if (!normalized) return '';
                    if (!/^https?:\/\//i.test(normalized)) {
                        return '';
                    }
                    return normalized.replace(/\/+$/, '');
                },

                resolveInstallRegistryUrl(presetValue, customValue) {
                    const preset = this.normalizeInstallRegistryPreset(presetValue);
                    if (preset === 'npmmirror') {
                        return 'https://registry.npmmirror.com';
                    }
                    if (preset === 'tencent') {
                        return 'https://mirrors.cloud.tencent.com/npm';
                    }
                    if (preset === 'custom') {
                        return this.normalizeInstallRegistryUrl(customValue);
                    }
                    return '';
                },

                appendInstallRegistryOption(command, actionName) {
                    const base = typeof command === 'string' ? command.trim() : '';
                    if (!base) return '';
                    const action = this.normalizeInstallAction(actionName);
                    if (action === 'uninstall') {
                        return base;
                    }
                    const registry = this.resolveInstallRegistryUrl(this.installRegistryPreset, this.installRegistryCustom);
                    if (!registry) {
                        return base;
                    }
                    return `${base} --registry=${registry}`;
                },

                resolveInstallPlatform() {
                    const navPlatform = typeof navigator !== 'undefined' && typeof navigator.platform === 'string'
                        ? navigator.platform.trim().toLowerCase()
                        : '';
                    if (navPlatform.includes('win')) return 'win32';
                    if (navPlatform.includes('mac')) return 'darwin';
                    return 'linux';
                },

                buildInstallCommandMatrix(packageManager) {
                    const manager = this.normalizeInstallPackageManager(packageManager);
                    const matrix = {
                        claude: {
                            install: '',
                            update: '',
                            uninstall: ''
                        },
                        codex: {
                            install: '',
                            update: '',
                            uninstall: ''
                        }
                    };
                    if (manager === 'pnpm') {
                        matrix.claude.install = 'pnpm add -g @anthropic-ai/claude-code';
                        matrix.claude.update = 'pnpm up -g @anthropic-ai/claude-code';
                        matrix.claude.uninstall = 'pnpm remove -g @anthropic-ai/claude-code';
                        matrix.codex.install = 'pnpm add -g @openai/codex';
                        matrix.codex.update = 'pnpm up -g @openai/codex';
                        matrix.codex.uninstall = 'pnpm remove -g @openai/codex';
                        return matrix;
                    }
                    if (manager === 'bun') {
                        matrix.claude.install = 'bun add -g @anthropic-ai/claude-code';
                        matrix.claude.update = 'bun update -g @anthropic-ai/claude-code';
                        matrix.claude.uninstall = 'bun remove -g @anthropic-ai/claude-code';
                        matrix.codex.install = 'bun add -g @openai/codex';
                        matrix.codex.update = 'bun update -g @openai/codex';
                        matrix.codex.uninstall = 'bun remove -g @openai/codex';
                        return matrix;
                    }
                    matrix.claude.install = 'npm install -g @anthropic-ai/claude-code';
                    matrix.claude.update = 'npm update -g @anthropic-ai/claude-code';
                    matrix.claude.uninstall = 'npm uninstall -g @anthropic-ai/claude-code';
                    matrix.codex.install = 'npm install -g @openai/codex';
                    matrix.codex.update = 'npm update -g @openai/codex';
                    matrix.codex.uninstall = 'npm uninstall -g @openai/codex';
                    return matrix;
                },

                getInstallCommand(targetId, actionName) {
                    const targetKey = typeof targetId === 'string' ? targetId.trim() : '';
                    if (!targetKey) return '';
                    const action = this.normalizeInstallAction(actionName);
                    const currentMap = this.buildInstallCommandMatrix(this.installPackageManager);
                    const current = currentMap[targetKey] && typeof currentMap[targetKey][action] === 'string'
                        ? currentMap[targetKey][action]
                        : '';
                    return this.appendInstallRegistryOption(current, action);
                },

                setInstallCommandAction(actionName) {
                    this.installCommandAction = this.normalizeInstallAction(actionName);
                },

                setInstallRegistryPreset(presetName) {
                    this.installRegistryPreset = this.normalizeInstallRegistryPreset(presetName);
                },

                openInstallModal() {
                    this.showInstallModal = true;
                },

                closeInstallModal() {
                    this.showInstallModal = false;
                },

                async loadOpenclawConfigFromFile(options = {}) {
                    const silent = !!options.silent;
                    const force = !!options.force;
                    const fallbackToTemplate = options.fallbackToTemplate !== false;
                    this.openclawFileLoading = true;
                    try {
                        const res = await api('get-openclaw-config');
                        if (res.error) {
                            if (!silent) {
                                this.showMessage(res.error, 'error');
                            }
                            return;
                        }
                        this.openclawConfigPath = res.path || '';
                        this.openclawConfigExists = !!res.exists;
                        this.openclawLineEnding = res.lineEnding === '\r\n' ? '\r\n' : '\n';
                        const hasContent = !!(res.content && res.content.trim());
                        const shouldOverride = force || !this.openclawEditing.content || !this.openclawEditing.content.trim();
                        if (hasContent && shouldOverride) {
                            this.openclawEditing.content = res.content;
                        } else if (!hasContent && shouldOverride && fallbackToTemplate) {
                            this.openclawEditing.content = DEFAULT_OPENCLAW_TEMPLATE;
                        }
                        this.syncOpenclawStructuredFromText({ silent: true });
                        if (!silent) {
                            this.showMessage('加载完成', 'success');
                        }
                    } catch (e) {
                        if (!silent) {
                            this.showMessage('加载配置失败', 'error');
                        }
                    } finally {
                        this.openclawFileLoading = false;
                    }
                },

                persistOpenclawConfig({ closeModal = true } = {}) {
                    if (!this.openclawEditing.name || !this.openclawEditing.name.trim()) {
                        this.showMessage('请输入名称', 'error');
                        return '';
                    }
                    const name = this.openclawEditing.name.trim();
                    if (!this.openclawEditing.lockName && this.openclawConfigs[name]) {
                        this.showMessage('名称已存在', 'error');
                        return '';
                    }
                    if (!this.openclawEditing.content || !this.openclawEditing.content.trim()) {
                        this.showMessage('配置内容不能为空', 'error');
                        return '';
                    }

                    this.openclawConfigs[name] = {
                        content: this.openclawEditing.content
                    };
                    this.currentOpenclawConfig = name;
                    this.saveOpenclawConfigs();
                    if (closeModal) {
                        this.closeOpenclawConfigModal();
                    }
                    return name;
                },

                async saveOpenclawConfig() {
                    this.openclawSaving = true;
                    try {
                        const name = this.persistOpenclawConfig();
                        if (!name) return;
                        this.showMessage('操作成功', 'success');
                    } finally {
                        this.openclawSaving = false;
                    }
                },

                async saveAndApplyOpenclawConfig() {
                    this.openclawApplying = true;
                    try {
                        const name = this.persistOpenclawConfig({ closeModal: false });
                        if (!name) return;
                        const config = this.openclawConfigs[name];
                        const res = await api('apply-openclaw-config', {
                            content: config.content,
                            lineEnding: this.openclawLineEnding
                        });
                        if (res.error || res.success === false) {
                            this.showMessage(res.error || '应用配置失败', 'error');
                            return;
                        }
                        this.openclawConfigPath = res.targetPath || this.openclawConfigPath;
                        this.openclawConfigExists = true;
                        const targetTip = res.targetPath ? `（${res.targetPath}）` : '';
                        this.showMessage(`已保存并应用 OpenClaw 配置${targetTip}`, 'success');
                        this.closeOpenclawConfigModal();
                    } catch (e) {
                        this.showMessage('应用配置失败', 'error');
                    } finally {
                        this.openclawApplying = false;
                    }
                },

                deleteOpenclawConfig(name) {
                    if (Object.keys(this.openclawConfigs).length <= 1) {
                        return this.showMessage('至少保留一项', 'error');
                    }
                    if (!confirm(`确定删除配置 "${name}"?`)) return;
                    delete this.openclawConfigs[name];
                    if (this.currentOpenclawConfig === name) {
                        this.currentOpenclawConfig = Object.keys(this.openclawConfigs)[0];
                    }
                    this.saveOpenclawConfigs();
                    this.showMessage('操作成功', 'success');
                },

                async applyOpenclawConfig(name) {
                    this.currentOpenclawConfig = name;
                    const config = this.openclawConfigs[name];
                    if (!this.openclawHasContent(config)) {
                        return this.showMessage('配置为空', 'error');
                    }
                    const res = await api('apply-openclaw-config', {
                        content: config.content,
                        lineEnding: this.openclawLineEnding
                    });
                    if (res.error || res.success === false) {
                        this.showMessage(res.error || '应用配置失败', 'error');
                    } else {
                        this.openclawConfigPath = res.targetPath || this.openclawConfigPath;
                        this.openclawConfigExists = true;
                        const targetTip = res.targetPath ? `（${res.targetPath}）` : '';
                        this.showMessage(`已应用 OpenClaw 配置: ${name}${targetTip}`, 'success');
                    }
                },

                formatLatency,

                buildSpeedTestIssue(name, result) {
                    return buildSpeedTestIssue(name, result);
                },

                async runSpeedTest(name, options = {}) {
                    if (!name || this.speedLoading[name]) return null;
                    const silent = !!options.silent;
                    this.speedLoading[name] = true;
                    try {
                        const res = await api('speed-test', { name });
                        if (res.error) {
                            this.speedResults[name] = { ok: false, error: res.error };
                            if (!silent) {
                                this.showMessage(res.error, 'error');
                            }
                            return { ok: false, error: res.error };
                        }
                        this.speedResults[name] = res;
                        if (!silent) {
                            const status = res.status ? ` (${res.status})` : '';
                            this.showMessage(`Speed ${name}: ${this.formatLatency(res)}${status}`, 'success');
                        }
                        return res;
                    } catch (e) {
                        const message = e && e.message ? e.message : 'Speed test failed';
                        this.speedResults[name] = { ok: false, error: message };
                        if (!silent) {
                            this.showMessage(message, 'error');
                        }
                        return { ok: false, error: message };
                    } finally {
                        this.speedLoading[name] = false;
                    }
                },

                async runClaudeSpeedTest(name, config) {
                    if (!name || this.claudeSpeedLoading[name]) return null;
                    const baseUrl = config && typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '';
                    this.claudeSpeedLoading[name] = true;
                    try {
                        if (!baseUrl) {
                            const res = { ok: false, error: 'Missing base URL' };
                            this.claudeSpeedResults[name] = res;
                            return res;
                        }
                        const res = await api('speed-test', { url: baseUrl });
                        if (res.error) {
                            this.claudeSpeedResults[name] = { ok: false, error: res.error };
                            return { ok: false, error: res.error };
                        }
                        this.claudeSpeedResults[name] = res;
                        return res;
                    } catch (e) {
                        const message = e && e.message ? e.message : 'Speed test failed';
                        const res = { ok: false, error: message };
                        this.claudeSpeedResults[name] = res;
                        return res;
                    } finally {
                        this.claudeSpeedLoading[name] = false;
                    }
                },

                async downloadClaudeDirectory() {
                    if (this.claudeDownloadLoading) return;
                    this.claudeDownloadLoading = true;
                    this.claudeDownloadProgress = 5;
                    this.claudeDownloadTimer = setInterval(() => {
                        if (this.claudeDownloadProgress < 90) {
                            this.claudeDownloadProgress += 5;
                        }
                    }, 400);
                    try {
                        const res = await api('download-claude-dir');
                        if (res && res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        if (!res || res.success !== true || !res.fileName) {
                            this.showMessage('备份失败', 'error');
                            return;
                        }
                        this.claudeDownloadProgress = 100;
                        const downloadUrl = `/download/${encodeURIComponent(res.fileName)}`;
                        const link = document.createElement('a');
                        link.href = downloadUrl;
                        link.download = res.fileName;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        this.showMessage('备份成功，开始下载', 'success');
                    } catch (e) {
                        this.showMessage('备份失败：' + (e && e.message ? e.message : '未知错误'), 'error');
                    } finally {
                        if (this.claudeDownloadTimer) {
                            clearInterval(this.claudeDownloadTimer);
                            this.claudeDownloadTimer = null;
                        }
                        this.claudeDownloadLoading = false;
                        setTimeout(() => {
                            this.claudeDownloadProgress = 0;
                        }, 800);
                    }
                },

                async downloadCodexDirectory() {
                    if (this.codexDownloadLoading) return;
                    this.codexDownloadLoading = true;
                    this.codexDownloadProgress = 5;
                    this.codexDownloadTimer = setInterval(() => {
                        if (this.codexDownloadProgress < 90) {
                            this.codexDownloadProgress += 5;
                        }
                    }, 400);
                    try {
                        const res = await api('download-codex-dir');
                        if (res && res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        if (!res || res.success !== true || !res.fileName) {
                            this.showMessage('备份失败', 'error');
                            return;
                        }
                        this.codexDownloadProgress = 100;
                        const downloadUrl = `/download/${encodeURIComponent(res.fileName)}`;
                        const link = document.createElement('a');
                        link.href = downloadUrl;
                        link.download = res.fileName;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        this.showMessage('备份成功，开始下载', 'success');
                    } catch (e) {
                        this.showMessage('备份失败：' + (e && e.message ? e.message : '未知错误'), 'error');
                    } finally {
                        if (this.codexDownloadTimer) {
                            clearInterval(this.codexDownloadTimer);
                            this.codexDownloadTimer = null;
                        }
                        this.codexDownloadLoading = false;
                        setTimeout(() => {
                            this.codexDownloadProgress = 0;
                        }, 800);
                    }
                },

                triggerClaudeImport() {
                    const input = this.$refs.claudeImportInput;
                    if (input) {
                        input.value = '';
                        input.click();
                    }
                },

                triggerCodexImport() {
                    const input = this.$refs.codexImportInput;
                    if (input) {
                        input.value = '';
                        input.click();
                    }
                },

                handleClaudeImportChange(event) {
                    const file = event && event.target && event.target.files ? event.target.files[0] : null;
                    if (file) {
                        void this.importBackupFile('claude', file);
                    }
                },

                handleCodexImportChange(event) {
                    const file = event && event.target && event.target.files ? event.target.files[0] : null;
                    if (file) {
                        void this.importBackupFile('codex', file);
                    }
                },

                async importBackupFile(type, file) {
                    const maxSize = 200 * 1024 * 1024;
                    const loadingKey = type === 'claude' ? 'claudeImportLoading' : 'codexImportLoading';
                    if (file.size > maxSize) {
                        this.showMessage('备份文件过大，限制 200MB', 'error');
                        this.resetImportInput(type);
                        return;
                    }
                    this[loadingKey] = true;
                    try {
                        const base64 = await this.readFileAsBase64(file);
                        const action = type === 'claude' ? 'restore-claude-dir' : 'restore-codex-dir';
                        const res = await api(action, {
                            fileName: file.name || `${type}-backup.zip`,
                            fileBase64: base64
                        });
                        if (res && res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        const backupTip = res && res.backupPath ? `，原配置已备份到临时文件：${res.backupPath}` : '';
                        this.showMessage(`导入成功${backupTip}`, 'success');
                        if (type === 'claude') {
                            await this.refreshClaudeSelectionFromSettings({ silent: true });
                        } else {
                            await this.loadAll();
                        }
                    } catch (e) {
                        this.showMessage('导入失败：' + (e && e.message ? e.message : '未知错误'), 'error');
                    } finally {
                        this[loadingKey] = false;
                        this.resetImportInput(type);
                    }
                },

                readFileAsBase64(file) {
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            const result = reader.result;
                            if (result instanceof ArrayBuffer) {
                                resolve(this.arrayBufferToBase64(result));
                                return;
                            }
                            if (typeof result === 'string') {
                                const idx = result.indexOf('base64,');
                                resolve(idx >= 0 ? result.slice(idx + 7) : result);
                                return;
                            }
                            reject(new Error('不支持的文件读取结果'));
                        };
                        reader.onerror = () => reject(new Error('读取文件失败'));
                        reader.readAsArrayBuffer(file);
                    });
                },

                arrayBufferToBase64(buffer) {
                    const bytes = new Uint8Array(buffer);
                    const chunkSize = 0x8000;
                    let binary = '';
                    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
                        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
                    }
                    return btoa(binary);
                },

                resetImportInput(type) {
                    const refName = type === 'claude' ? 'claudeImportInput' : 'codexImportInput';
                    const el = this.$refs[refName];
                    if (el) {
                        el.value = '';
                    }
                },

                async loadCodexAuthProfiles(options = {}) {
                    const silent = !!options.silent;
                    try {
                        const res = await api('list-auth-profiles');
                        if (res && res.error) {
                            if (!silent) {
                                this.showMessage(res.error, 'error');
                            }
                            return;
                        }
                        const list = Array.isArray(res && res.profiles) ? res.profiles : [];
                        this.codexAuthProfiles = list.sort((a, b) => {
                            if (!!a.current !== !!b.current) {
                                return a.current ? -1 : 1;
                            }
                            return String(a.name || '').localeCompare(String(b.name || ''));
                        });
                    } catch (e) {
                        if (!silent) {
                            this.showMessage('读取认证列表失败', 'error');
                        }
                    }
                },

                triggerCodexAuthUpload() {
                    const input = this.$refs.codexAuthImportInput;
                    if (input) {
                        input.value = '';
                        input.click();
                    }
                },

                handleCodexAuthImportChange(event) {
                    const file = event && event.target && event.target.files ? event.target.files[0] : null;
                    if (file) {
                        void this.importCodexAuthFile(file);
                    }
                },

                resetCodexAuthImportInput() {
                    const el = this.$refs.codexAuthImportInput;
                    if (el) {
                        el.value = '';
                    }
                },

                async importCodexAuthFile(file) {
                    this.codexAuthImportLoading = true;
                    try {
                        const base64 = await this.readFileAsBase64(file);
                        const res = await api('import-auth-profile', {
                            fileName: file.name || 'codex-auth.json',
                            fileBase64: base64,
                            activate: true
                        });
                        if (res && res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        await this.loadCodexAuthProfiles({ silent: true });
                        this.showMessage('认证文件已导入并切换', 'success');
                    } catch (e) {
                        this.showMessage('导入认证文件失败', 'error');
                    } finally {
                        this.codexAuthImportLoading = false;
                        this.resetCodexAuthImportInput();
                    }
                },

                async switchCodexAuthProfile(name) {
                    const key = String(name || '').trim();
                    if (!key || this.codexAuthSwitching[key]) return;
                    this.codexAuthSwitching[key] = true;
                    try {
                        const res = await api('switch-auth-profile', { name: key });
                        if (res && res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        await this.loadCodexAuthProfiles({ silent: true });
                        this.showMessage(`已切换认证: ${key}`, 'success');
                    } catch (e) {
                        this.showMessage('切换认证失败', 'error');
                    } finally {
                        this.codexAuthSwitching[key] = false;
                    }
                },

                async deleteCodexAuthProfile(name) {
                    const key = String(name || '').trim();
                    if (!key || this.codexAuthDeleting[key]) return;
                    this.codexAuthDeleting[key] = true;
                    try {
                        const res = await api('delete-auth-profile', { name: key });
                        if (res && res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        await this.loadCodexAuthProfiles({ silent: true });
                        const switchedTip = res && res.switchedTo ? `，已切换到 ${res.switchedTo}` : '';
                        this.showMessage(`已删除认证${switchedTip}`, 'success');
                    } catch (e) {
                        this.showMessage('删除认证失败', 'error');
                    } finally {
                        this.codexAuthDeleting[key] = false;
                    }
                },

                mergeProxySettings(nextSettings) {
                    const safe = nextSettings && typeof nextSettings === 'object' ? nextSettings : {};
                    const port = parseInt(String(safe.port), 10);
                    const timeoutMs = parseInt(String(safe.timeoutMs), 10);
                    this.proxySettings = {
                        enabled: safe.enabled !== false,
                        host: typeof safe.host === 'string' && safe.host.trim() ? safe.host.trim() : '127.0.0.1',
                        port: Number.isFinite(port) ? port : 8318,
                        provider: typeof safe.provider === 'string' ? safe.provider.trim() : '',
                        authSource: safe.authSource === 'profile' || safe.authSource === 'none' ? safe.authSource : 'provider',
                        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 30000
                    };
                },

                async loadProxyStatus(options = {}) {
                    const silent = !!options.silent;
                    this.proxyLoading = true;
                    try {
                        const res = await api('proxy-status');
                        if (res && res.error) {
                            if (!silent) {
                                this.showMessage(res.error, 'error');
                            }
                            return;
                        }
                        this.mergeProxySettings(res && res.settings ? res.settings : {});
                        this.proxyRuntime = res && res.runtime ? { running: true, ...res.runtime } : null;
                    } catch (e) {
                        if (!silent) {
                            this.showMessage('读取代理状态失败', 'error');
                        }
                    } finally {
                        this.proxyLoading = false;
                    }
                },

                async saveProxySettings(options = {}) {
                    const silent = !!options.silent;
                    this.proxySaving = true;
                    try {
                        const res = await api('proxy-save-config', this.proxySettings);
                        if (res && res.error) {
                            if (!silent) {
                                this.showMessage(res.error, 'error');
                            }
                            return;
                        }
                        if (res && res.settings) {
                            this.mergeProxySettings(res.settings);
                        }
                        if (!silent) {
                            this.showMessage('代理配置已保存', 'success');
                        }
                    } catch (e) {
                        if (!silent) {
                            this.showMessage('保存代理配置失败', 'error');
                        }
                    } finally {
                        this.proxySaving = false;
                    }
                },

                async startBuiltinProxy() {
                    this.proxyStarting = true;
                    try {
                        const res = await api('proxy-start', {
                            ...this.proxySettings,
                            enabled: true
                        });
                        if (res && res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        if (res && res.settings) {
                            this.mergeProxySettings(res.settings);
                        }
                        await this.loadProxyStatus({ silent: true });
                        const listenTip = res && res.listenUrl ? `：${res.listenUrl}` : '';
                        this.showMessage(`代理已启动${listenTip}`, 'success');
                    } catch (e) {
                        this.showMessage('启动代理失败', 'error');
                    } finally {
                        this.proxyStarting = false;
                    }
                },

                async stopBuiltinProxy() {
                    this.proxyStopping = true;
                    try {
                        const res = await api('proxy-stop');
                        if (res && res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        await this.loadProxyStatus({ silent: true });
                        this.showMessage('代理已停止', 'success');
                    } catch (e) {
                        this.showMessage('停止代理失败', 'error');
                    } finally {
                        this.proxyStopping = false;
                    }
                },

                async applyBuiltinProxyProvider() {
                    this.proxyApplying = true;
                    try {
                        const saveRes = await api('proxy-save-config', this.proxySettings);
                        if (saveRes && saveRes.error) {
                            this.showMessage(saveRes.error, 'error');
                            return;
                        }
                        const res = await api('proxy-apply-provider', { switchToProxy: true });
                        if (res && res.error) {
                            this.showMessage(res.error, 'error');
                            return;
                        }
                        await this.loadAll();
                        this.showMessage('本地代理 provider 已写入并切换', 'success');
                    } catch (e) {
                        this.showMessage('应用代理 provider 失败', 'error');
                    } finally {
                        this.proxyApplying = false;
                    }
                },

                showMessage(text, type) {
                    this.message = text;
                    this.messageType = type || 'info';
                    setTimeout(() => {
                        this.message = '';
                    }, 3000);
                }
            }
        });

        app.mount('#app');
    });
    
