import {
    normalizeClaudeValue,
    normalizeClaudeConfig,
    normalizeClaudeSettingsEnv,
    matchClaudeConfigFromSettings,
    findDuplicateClaudeConfigName,
    formatLatency,
    buildSpeedTestIssue,
    isSessionQueryEnabled,
    buildSessionListParams
} from './logic.mjs';

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
                    agentsContext: 'codex',
                    agentsModalTitle: 'AGENTS.md 编辑器',
                    agentsModalHint: '保存后会写入目标 AGENTS.md（与 config.toml 同级）。',
                    sessionsList: [],
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
                    installCommands: [
                        'npm install -g @anthropic-ai/claude-code',
                        'npm i -g @openai/codex'
                    ],
                    newProvider: { name: '', url: '', key: '' },
                    resetConfigLoading: false,
                    editingProvider: { name: '', url: '', key: '' },
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
                    healthCheckRemote: false
                }
            },
            mounted() {
                this.initSessionStandalone();
                const savedSessionYolo = localStorage.getItem('codexmateSessionResumeYolo');
                if (savedSessionYolo === '0' || savedSessionYolo === 'false') {
                    this.sessionResumeWithYolo = false;
                } else if (savedSessionYolo === '1' || savedSessionYolo === 'true') {
                    this.sessionResumeWithYolo = true;
                }
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

            computed: {
                isSessionQueryEnabled() {
                    return isSessionQueryEnabled(this.sessionFilterSource);
                },
                sessionQueryPlaceholder() {
                    if (this.isSessionQueryEnabled) {
                        return '关键词检索（支持 Codex/Claude，例：claude code）';
                    }
                    return '当前来源暂不支持关键词检索';
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
                            this.providersList = listRes.providers;
                            if (statusRes.configReady === false) {
                                this.showMessage(statusRes.configNotice || '未检测到 config.toml，已加载默认模板。请在模板编辑器确认后创建。', 'info');
                            }
                            if (statusRes.initNotice) {
                                this.showMessage(statusRes.initNotice, 'info');
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
                },

                async loadModelsForProvider(providerName) {
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
                            this.showMessage('模型列表获取失败: ' + res.error, 'error');
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
                        this.showMessage('模型列表获取失败: ' + e.message, 'error');
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

                async refreshClaudeSelectionFromSettings(options = {}) {
                    const configNames = Object.keys(this.claudeConfigs || {});
                    if (configNames.length === 0) {
                        this.currentClaudeConfig = '';
                        this.currentClaudeModel = '';
                        this.resetClaudeModelsState();
                        return;
                    }
                    const silent = !!options.silent;
                    try {
                        const res = await api('get-claude-settings');
                        if (res && res.error) {
                            if (!silent) {
                                this.showMessage('读取 Claude 配置失败: ' + res.error, 'error');
                            }
                            return;
                        }
                        const matchName = this.matchClaudeConfigFromSettings((res && res.env) || {});
                        if (matchName) {
                            if (this.currentClaudeConfig !== matchName) {
                                this.currentClaudeConfig = matchName;
                            }
                            this.refreshClaudeModelContext();
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
                            this.showMessage('读取 Claude 配置失败: ' + e.message, 'error');
                        }
                    }
                },

                syncClaudeModelFromConfig() {
                    const config = this.getCurrentClaudeConfig();
                    this.currentClaudeModel = config && config.model ? config.model : '';
                },

                refreshClaudeModelContext() {
                    this.syncClaudeModelFromConfig();
                    this.loadClaudeModels();
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

                async loadClaudeModels() {
                    const config = this.getCurrentClaudeConfig();
                    if (!config) {
                        this.resetClaudeModelsState();
                        return;
                    }
                    const baseUrl = (config.baseUrl || '').trim();
                    const apiKey = (config.apiKey || '').trim();

                    if (!baseUrl) {
                        this.resetClaudeModelsState();
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
                            this.showMessage('模型列表获取失败: ' + res.error, 'error');
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
                        this.showMessage('模型列表获取失败: ' + e.message, 'error');
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
                    this.showMessage('如果 Codex Mate 对你有帮助，欢迎到 GitHub 点个 Star。', 'info');
                    localStorage.setItem(storageKey, '1');
                },

                switchConfigMode(mode) {
                    this.mainTab = 'config';
                    this.configMode = mode;
                    if (mode === 'claude') {
                        this.refreshClaudeModelContext();
                    }
                },

                switchMainTab(tab) {
                    this.mainTab = tab;
                    if (tab === 'sessions' && this.sessionsList.length === 0) {
                        this.loadSessions();
                    }
                    if (tab === 'config' && this.configMode === 'claude') {
                        this.refreshClaudeModelContext();
                    }
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
                        this.showMessage('当前会话无法生成新页链接', 'error');
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
                        this.showMessage('没有可复制的内容', 'info');
                        return;
                    }
                    const ok = this.fallbackCopyText(text);
                    if (ok) {
                        this.showMessage('已复制 AGENTS.md 内容', 'success');
                        return;
                    }
                    this.showMessage('复制失败，请手动复制内容', 'error');
                },

                copyInstallCommand(cmd) {
                    const text = typeof cmd === 'string' ? cmd.trim() : '';
                    if (!text) {
                        this.showMessage('没有可复制的命令', 'info');
                        return;
                    }
                    const ok = this.fallbackCopyText(text);
                    if (ok) {
                        this.showMessage('已复制命令', 'success');
                        return;
                    }
                    this.showMessage('复制失败，请手动复制命令', 'error');
                },

                async copyResumeCommand(session) {
                    if (!this.isResumeCommandAvailable(session)) {
                        this.showMessage('当前会话不支持生成恢复命令', 'error');
                        return;
                    }
                    const command = this.buildResumeCommand(session);
                    const ok = this.fallbackCopyText(command);
                    if (ok) {
                        this.showMessage('已复制恢复命令', 'success');
                        return;
                    }
                    try {
                        if (navigator.clipboard && window.isSecureContext) {
                            await navigator.clipboard.writeText(command);
                            this.showMessage('已复制恢复命令', 'success');
                            return;
                        }
                    } catch (e) {
                        // keep fallback failure message
                    }
                    this.showMessage('复制失败，请手动复制命令', 'error');
                },

                buildProviderShareCommand(payload) {
                    if (!payload || typeof payload !== 'object') return '';
                    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
                    const baseUrl = typeof payload.baseUrl === 'string' ? payload.baseUrl.trim() : '';
                    const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey : '';
                    if (!name || !baseUrl) return '';

                    const nameArg = this.quoteShellArg(name);
                    const urlArg = this.quoteShellArg(baseUrl);
                    const keyArg = apiKey ? this.quoteShellArg(apiKey) : '';
                    const switchCmd = `codexmate switch ${nameArg}`;
                    const addCmd = apiKey
                        ? `codexmate add ${nameArg} ${urlArg} ${keyArg}`
                        : `codexmate add ${nameArg} ${urlArg}`;
                    return `${addCmd} && ${switchCmd}`;
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
                        this.showMessage('提供商名称无效', 'error');
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
                            this.showMessage('分享命令生成失败', 'error');
                            return;
                        }
                        const ok = this.fallbackCopyText(command);
                        if (ok) {
                            this.showMessage('已复制分享命令', 'success');
                            return;
                        }
                        try {
                            if (navigator.clipboard && window.isSecureContext) {
                                await navigator.clipboard.writeText(command);
                                this.showMessage('已复制分享命令', 'success');
                                return;
                            }
                        } catch (e) {
                            // keep fallback failure message
                        }
                        this.showMessage('复制失败，请手动复制命令', 'error');
                    } catch (e) {
                        this.showMessage('生成分享命令失败: ' + e.message, 'error');
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
                            this.showMessage('分享命令生成失败', 'error');
                            return;
                        }
                        const ok = this.fallbackCopyText(command);
                        if (ok) {
                            this.showMessage('已复制分享命令', 'success');
                            return;
                        }
                        try {
                            if (navigator.clipboard && window.isSecureContext) {
                                await navigator.clipboard.writeText(command);
                                this.showMessage('已复制分享命令', 'success');
                                return;
                            }
                        } catch (e) {
                            // fall through
                        }
                        this.showMessage('复制失败，请手动复制命令', 'error');
                    } catch (e) {
                        this.showMessage('生成分享命令失败: ' + e.message, 'error');
                    } finally {
                        this.claudeShareLoading[name] = false;
                    }
                },

                async cloneSession(session) {
                    if (!this.isCloneAvailable(session)) {
                        this.showMessage('当前会话不支持克隆', 'error');
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

                        this.showMessage('会话已克隆', 'success');
                        await this.loadSessions();
                        if (res.sessionId) {
                            const matched = this.sessionsList.find(item => item.source === 'codex' && item.sessionId === res.sessionId);
                            if (matched) {
                                await this.selectSession(matched);
                            }
                        }
                    } catch (e) {
                        this.showMessage('克隆失败: ' + e.message, 'error');
                    } finally {
                        this.sessionCloning[key] = false;
                    }
                },

                async deleteSession(session) {
                    if (!this.isDeleteAvailable(session)) {
                        this.showMessage('当前会话不支持删除', 'error');
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
                        this.showMessage('会话已删除', 'success');
                        await this.loadSessions();
                    } catch (e) {
                        this.showMessage('删除失败: ' + e.message, 'error');
                    } finally {
                        this.sessionDeleting[key] = false;
                    }
                },

                normalizeSessionPathValue(value) {
                    if (typeof value !== 'string') return '';
                    return value.trim();
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

                async onSessionSourceChange() {
                    this.refreshSessionPathOptions(this.sessionFilterSource);
                    await this.loadSessions();
                },

                async onSessionPathFilterChange() {
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
                    await this.onSessionSourceChange();
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
                    if (this.sessionsLoading) return;
                    this.sessionsLoading = true;
                    this.activeSessionDetailError = '';
                    const params = buildSessionListParams({
                        source: this.sessionFilterSource,
                        pathFilter: this.sessionPathFilter,
                        query: this.sessionQuery,
                        roleFilter: this.sessionRoleFilter,
                        timeRangePreset: this.sessionTimePreset
                    });
                    try {
                        const res = await api('list-sessions', params);
                        if (res.error) {
                            this.showMessage(res.error, 'error');
                            this.sessionsList = [];
                            this.activeSession = null;
                            this.activeSessionMessages = [];
                            this.activeSessionDetailClipped = false;
                        } else {
                            this.sessionsList = Array.isArray(res.sessions) ? res.sessions : [];
                            this.syncSessionPathOptionsForSource(
                                this.sessionFilterSource,
                                this.extractPathOptionsFromSessions(this.sessionsList),
                                true
                            );
                            if (this.sessionsList.length === 0) {
                                this.activeSession = null;
                                this.activeSessionMessages = [];
                                this.activeSessionDetailClipped = false;
                            } else {
                                const oldKey = this.activeSession ? this.getSessionExportKey(this.activeSession) : '';
                                const matched = this.sessionsList.find(item => this.getSessionExportKey(item) === oldKey);
                                this.activeSession = matched || this.sessionsList[0];
                                await this.loadActiveSessionDetail();
                            }
                            void this.loadSessionPathOptions({ source: this.sessionFilterSource });
                        }
                    } catch (e) {
                        this.sessionsList = [];
                        this.activeSession = null;
                        this.activeSessionMessages = [];
                        this.activeSessionDetailClipped = false;
                        this.showMessage('加载会话失败: ' + e.message, 'error');
                    } finally {
                        this.sessionsLoading = false;
                    }
                },

                async selectSession(session) {
                    if (!session) return;
                    if (this.activeSession && this.getSessionExportKey(this.activeSession) === this.getSessionExportKey(session)) return;
                    this.activeSession = session;
                    this.activeSessionMessages = [];
                    this.activeSessionDetailError = '';
                    this.activeSessionDetailClipped = false;
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

                async loadActiveSessionDetail() {
                    if (!this.activeSession) {
                        this.activeSessionMessages = [];
                        this.activeSessionDetailError = '';
                        this.activeSessionDetailClipped = false;
                        return;
                    }

                    const requestSeq = ++this.sessionDetailRequestSeq;
                    this.sessionDetailLoading = true;
                    this.activeSessionDetailError = '';
                    try {
                        const res = await api('session-detail', {
                            source: this.activeSession.source,
                            sessionId: this.activeSession.sessionId,
                            filePath: this.activeSession.filePath,
                            messageLimit: 300
                        });

                        if (requestSeq !== this.sessionDetailRequestSeq) {
                            return;
                        }

                        if (res.error) {
                            this.activeSessionMessages = [];
                            this.activeSessionDetailClipped = false;
                            this.activeSessionDetailError = res.error;
                            return;
                        }

                        this.activeSessionMessages = Array.isArray(res.messages) ? res.messages : [];
                        this.activeSessionDetailClipped = !!res.clipped;
                        if (this.activeSession) {
                            if (res.sourceLabel) {
                                this.activeSession.sourceLabel = res.sourceLabel;
                            }
                            if (res.sessionId) {
                                this.activeSession.sessionId = res.sessionId;
                                if (!this.activeSession.title) {
                                    this.activeSession.title = res.sessionId;
                                }
                            }
                            if (res.filePath) {
                                this.activeSession.filePath = res.filePath;
                            }
                        }
                        if (res.updatedAt) {
                            this.activeSession.updatedAt = res.updatedAt;
                        }
                        if (res.cwd) {
                            this.activeSession.cwd = res.cwd;
                        }
                        if (Number.isFinite(res.totalMessages)) {
                            this.syncActiveSessionMessageCount(res.totalMessages);
                        }
                    } catch (e) {
                        if (requestSeq !== this.sessionDetailRequestSeq) {
                            return;
                        }
                        this.activeSessionMessages = [];
                        this.activeSessionDetailClipped = false;
                        this.activeSessionDetailError = '加载会话内容失败: ' + e.message;
                    } finally {
                        if (requestSeq === this.sessionDetailRequestSeq) {
                            this.sessionDetailLoading = false;
                        }
                    }
                },

                downloadTextFile(fileName, content) {
                    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
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
                            this.showMessage('会话导出完成', 'success');
                        }
                    } catch (e) {
                        this.showMessage('导出失败: ' + e.message, 'error');
                    } finally {
                        this.sessionExporting[key] = false;
                    }
                },

                async switchProvider(name) {
                    this.currentProvider = name;
                    await this.loadModelsForProvider(name);
                    if (this.modelsSource === 'remote' && this.models.length > 0 && !this.models.includes(this.currentModel)) {
                        this.currentModel = this.models[0];
                    }
                    await this.applyCodexConfigDirect({ silent: true });
                },

                async onModelChange() {
                    await this.applyCodexConfigDirect();
                },

                async onServiceTierChange() {
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
                                this.showMessage('健康检查通过', 'success');
                            }
                        } else {
                            this.healthCheckResult = null;
                            this.showMessage('健康检查失败：返回数据异常', 'error');
                        }
                    } catch (e) {
                        this.healthCheckResult = null;
                        this.showMessage('健康检查失败: ' + e.message, 'error');
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
                        this.showMessage('加载模板失败: ' + e.message, 'error');
                    }
                },

                async applyCodexConfigDirect(options = {}) {
                    if (this.codexApplying) return;

                    const provider = (this.currentProvider || '').trim();
                    const model = (this.currentModel || '').trim();
                    if (!provider || !model) {
                        this.showMessage('请选择提供商和模型后再应用。', 'error');
                        return;
                    }

                    this.codexApplying = true;
                    try {
                        const tplRes = await api('get-config-template', {
                            provider,
                            model,
                            serviceTier: this.serviceTier
                        });
                        if (tplRes.error) {
                            this.showMessage('获取模板失败: ' + tplRes.error, 'error');
                            return;
                        }

                        const applyRes = await api('apply-config-template', {
                            template: tplRes.template
                        });
                        if (applyRes.error) {
                            this.showMessage('应用模板失败: ' + applyRes.error, 'error');
                            return;
                        }

                        if (options.silent !== true) {
                            this.showMessage('Codex 配置已自动应用', 'success');
                        }

                        await this.loadAll();
                    } catch (e) {
                        this.showMessage('应用失败: ' + e.message, 'error');
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
                        this.showMessage('模板内容不能为空', 'error');
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
                        this.showMessage('模板已应用到 config.toml', 'success');
                        this.closeConfigTemplateModal();
                        await this.loadAll();
                    } catch (e) {
                        this.showMessage('应用模板失败: ' + e.message, 'error');
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
                        this.agentsPath = res.path || '';
                        this.agentsExists = !!res.exists;
                        this.agentsLineEnding = res.lineEnding === '\r\n' ? '\r\n' : '\n';
                        this.showAgentsModal = true;
                    } catch (e) {
                        this.showMessage('加载 AGENTS.md 失败: ' + e.message, 'error');
                    } finally {
                        this.agentsLoading = false;
                    }
                },

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
                        this.agentsPath = res.path || '';
                        this.agentsExists = !!res.exists;
                        this.agentsLineEnding = res.lineEnding === '\r\n' ? '\r\n' : '\n';
                        this.showAgentsModal = true;
                    } catch (e) {
                        this.showMessage('加载 OpenClaw AGENTS.md 失败: ' + e.message, 'error');
                    } finally {
                        this.agentsLoading = false;
                    }
                },

                async openOpenclawWorkspaceEditor() {
                    const fileName = (this.openclawWorkspaceFileName || '').trim();
                    if (!fileName) {
                        this.showMessage('请输入工作区文件名', 'error');
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
                        this.agentsPath = res.path || '';
                        this.agentsExists = !!res.exists;
                        this.agentsLineEnding = res.lineEnding === '\r\n' ? '\r\n' : '\n';
                        this.showAgentsModal = true;
                    } catch (e) {
                        this.showMessage('加载 OpenClaw 工作区文件失败: ' + e.message, 'error');
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

                closeAgentsModal() {
                    this.showAgentsModal = false;
                    this.agentsContent = '';
                    this.agentsPath = '';
                    this.agentsExists = false;
                    this.agentsLineEnding = '\n';
                    this.agentsSaving = false;
                    this.agentsWorkspaceFileName = '';
                    this.setAgentsModalContext('codex');
                },

                async applyAgentsContent() {
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
                        this.showMessage('保存文件失败: ' + e.message, 'error');
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
                    if (this.providersList.some(item => item.name === name)) {
                        return this.showMessage('提供商已存在', 'error');
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

                        this.showMessage('提供商已添加', 'success');
                        this.closeAddModal();
                        await this.loadAll();
                    } catch (e) {
                        this.showMessage('添加提供商失败: ' + e.message, 'error');
                    }
                },

                async deleteProvider(name) {
                    const res = await api('delete-provider', { name });
                    if (res.error) {
                        this.showMessage(res.error, 'error');
                        return;
                    }
                    if (res.switched && res.provider) {
                        this.showMessage(`已删除提供商，自动切换到 ${res.provider}${res.model ? ` / ${res.model}` : ''}`, 'success');
                    } else {
                        this.showMessage('提供商已删除', 'success');
                    }
                    await this.loadAll();
                },

                openEditModal(provider) {
                    this.editingProvider = {
                        name: provider.name,
                        url: provider.url || '',
                        key: ''
                    };
                    this.showEditModal = true;
                },

                async updateProvider() {
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
                        this.showMessage('提供商已更新', 'success');
                        await this.loadAll();
                    } catch (e) {
                        this.showMessage('更新失败: ' + e.message, 'error');
                    }
                },

                closeEditModal() {
                    this.showEditModal = false;
                    this.editingProvider = { name: '', url: '', key: '' };
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
                        this.showMessage('重装失败: ' + e.message, 'error');
                    } finally {
                        this.resetConfigLoading = false;
                    }
                },

                async addModel() {
                    if (!this.newModelName || !this.newModelName.trim()) {
                        return this.showMessage('请输入模型名称', 'error');
                    }
                    const res = await api('add-model', { model: this.newModelName.trim() });
                    if (res.error) {
                        this.showMessage(res.error, 'error');
                    } else {
                        this.showMessage('已添加', 'success');
                        this.closeModelModal();
                        await this.loadAll();
                    }
                },

                async removeModel(model) {
                    const res = await api('delete-model', { model });
                    if (res.error) {
                        this.showMessage(res.error, 'error');
                    } else {
                        this.showMessage('已删除', 'success');
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
                    this.claudeConfigs[name] = {
                        apiKey: existing.apiKey || '',
                        baseUrl: existing.baseUrl || '',
                        model: model,
                        hasKey: !!existing.apiKey
                    };
                    this.saveClaudeConfigs();
                    this.updateClaudeModelsCurrent();
                    if (!this.claudeConfigs[name].apiKey) {
                        this.showMessage('该配置未设置 API Key，请先编辑', 'error');
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
                    this.claudeConfigs[name] = {
                        apiKey: this.editingConfig.apiKey,
                        baseUrl: this.editingConfig.baseUrl,
                        model: this.editingConfig.model,
                        hasKey: !!this.editingConfig.apiKey
                    };
                    this.saveClaudeConfigs();
                    this.showMessage('配置已更新', 'success');
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
                    this.claudeConfigs[name] = {
                        apiKey: this.editingConfig.apiKey,
                        baseUrl: this.editingConfig.baseUrl,
                        model: this.editingConfig.model,
                        hasKey: !!this.editingConfig.apiKey
                    };
                    this.saveClaudeConfigs();

                    const config = this.claudeConfigs[name];
                    if (!config.apiKey) {
                        this.showMessage('已保存，未应用：请先输入 API Key', 'info');
                        this.closeEditConfigModal();
                        if (name === this.currentClaudeConfig) {
                            this.refreshClaudeModelContext();
                        }
                        return;
                    }

                    const res = await api('apply-claude-config', { config });
                    if (res.error || res.success === false) {
                        this.showMessage(res.error || '应用 Claude 配置失败', 'error');
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
                        return this.showMessage('请输入配置名称', 'error');
                    }
                    const name = this.newClaudeConfig.name.trim();
                    if (this.claudeConfigs[name]) {
                        return this.showMessage('配置名称已存在', 'error');
                    }
                    const duplicateName = this.findDuplicateClaudeConfigName(this.newClaudeConfig);
                    if (duplicateName) {
                        return this.showMessage('已存在相同配置，已忽略添加', 'info');
                    }

                    this.claudeConfigs[name] = {
                        apiKey: this.newClaudeConfig.apiKey,
                        baseUrl: this.newClaudeConfig.baseUrl,
                        model: this.newClaudeConfig.model,
                        hasKey: !!this.newClaudeConfig.apiKey
                    };

                    this.currentClaudeConfig = name;
                    this.saveClaudeConfigs();
                    this.showMessage('配置已添加', 'success');
                    this.closeClaudeConfigModal();
                    this.refreshClaudeModelContext();
                },

                deleteClaudeConfig(name) {
                    if (Object.keys(this.claudeConfigs).length <= 1) {
                        return this.showMessage('至少保留一个配置', 'error');
                    }

                    if (!confirm(`确定删除配置 "${name}"?`)) return;

                    delete this.claudeConfigs[name];
                    if (this.currentClaudeConfig === name) {
                        this.currentClaudeConfig = Object.keys(this.claudeConfigs)[0];
                    }
                    this.saveClaudeConfigs();
                    this.showMessage('配置已删除', 'success');
                    this.refreshClaudeModelContext();
                },

                async applyClaudeConfig(name) {
                    this.currentClaudeConfig = name;
                    this.refreshClaudeModelContext();
                    const config = this.claudeConfigs[name];

                    if (!config.apiKey) {
                        return this.showMessage('该配置未设置 API Key，请先编辑', 'error');
                    }

                    const res = await api('apply-claude-config', { config });
                    if (res.error || res.success === false) {
                        this.showMessage(res.error || '应用 Claude 配置失败', 'error');
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
                        this.showMessage('已从编辑器读取快速配置', 'success');
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
                        this.showMessage('已从文本刷新结构化配置', 'success');
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
                    this.showMessage('已写入编辑器', 'success');
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
                        this.showMessage('请填写 Provider 名称', 'error');
                        return;
                    }
                    if (providerName.includes('/')) {
                        this.showMessage('Provider 名称不能包含 "/"', 'error');
                        return;
                    }
                    if (!modelId) {
                        this.showMessage('请填写模型 ID', 'error');
                        return;
                    }

                    const config = parsed.data;
                    const ensureObject = (value) => (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
                    const models = ensureObject(config.models);
                    const providers = ensureObject(models.providers);
                    const provider = ensureObject(providers[providerName]);
                    const baseUrl = (this.openclawQuick.baseUrl || '').trim();
                    if (!baseUrl && !provider.baseUrl) {
                        this.showMessage('请填写 Base URL', 'error');
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
                    this.showMessage('快速配置已写入编辑器', 'success');
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
                            this.showMessage('已加载当前 OpenClaw 配置', 'success');
                        }
                    } catch (e) {
                        if (!silent) {
                            this.showMessage('加载 OpenClaw 配置失败: ' + e.message, 'error');
                        }
                    } finally {
                        this.openclawFileLoading = false;
                    }
                },

                persistOpenclawConfig({ closeModal = true } = {}) {
                    if (!this.openclawEditing.name || !this.openclawEditing.name.trim()) {
                        this.showMessage('请输入配置名称', 'error');
                        return '';
                    }
                    const name = this.openclawEditing.name.trim();
                    if (!this.openclawEditing.lockName && this.openclawConfigs[name]) {
                        this.showMessage('配置名称已存在', 'error');
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
                        this.showMessage('OpenClaw 配置已保存', 'success');
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
                            this.showMessage(res.error || '应用 OpenClaw 配置失败', 'error');
                            return;
                        }
                        this.openclawConfigPath = res.targetPath || this.openclawConfigPath;
                        this.openclawConfigExists = true;
                        const targetTip = res.targetPath ? `（${res.targetPath}）` : '';
                        this.showMessage(`已保存并应用 OpenClaw 配置${targetTip}`, 'success');
                        this.closeOpenclawConfigModal();
                    } catch (e) {
                        this.showMessage('应用 OpenClaw 配置失败: ' + e.message, 'error');
                    } finally {
                        this.openclawApplying = false;
                    }
                },

                deleteOpenclawConfig(name) {
                    if (Object.keys(this.openclawConfigs).length <= 1) {
                        return this.showMessage('至少保留一个配置', 'error');
                    }
                    if (!confirm(`确定删除配置 "${name}"?`)) return;
                    delete this.openclawConfigs[name];
                    if (this.currentOpenclawConfig === name) {
                        this.currentOpenclawConfig = Object.keys(this.openclawConfigs)[0];
                    }
                    this.saveOpenclawConfigs();
                    this.showMessage('OpenClaw 配置已删除', 'success');
                },

                async applyOpenclawConfig(name) {
                    this.currentOpenclawConfig = name;
                    const config = this.openclawConfigs[name];
                    if (!this.openclawHasContent(config)) {
                        return this.showMessage('该配置为空，请先编辑', 'error');
                    }
                    const res = await api('apply-openclaw-config', {
                        content: config.content,
                        lineEnding: this.openclawLineEnding
                    });
                    if (res.error || res.success === false) {
                        this.showMessage(res.error || '应用 OpenClaw 配置失败', 'error');
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
    
