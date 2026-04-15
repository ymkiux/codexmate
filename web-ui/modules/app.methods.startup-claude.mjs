import {
    findDuplicateClaudeConfigName,
    getClaudeModelCatalogForBaseUrl,
    matchClaudeConfigFromSettings,
    normalizeClaudeConfig,
    normalizeClaudeSettingsEnv,
    normalizeClaudeValue
} from '../logic.mjs';

export function createStartupClaudeMethods(options = {}) {
    const {
        api,
        defaultModelContextWindow = 190000,
        defaultModelAutoCompactTokenLimit = 185000
    } = options;

    return {
        async loadAll(options = {}) {
            const preserveLoading = !!options.preserveLoading;
            let startupOk = false;
            if (!preserveLoading) {
                this.loading = true;
            }
            this.initError = '';
            try {
                const statusRes = await api('status');
                if (statusRes && statusRes.error) {
                    this.initError = statusRes.error;
                } else {
                    const listRes = await api('list');
                    if (listRes && listRes.error) {
                        this.initError = listRes.error;
                    } else {
                        startupOk = true;
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
                            const allowedReasoningEfforts = new Set(['low', 'medium', 'high', 'xhigh']);
                            this.modelReasoningEffort = allowedReasoningEfforts.has(effort) ? effort : 'medium';
                        }
                        {
                            const contextWindow = this.normalizePositiveIntegerInput(
                                statusRes.modelContextWindow,
                                'model_context_window',
                                defaultModelContextWindow
                            );
                            if (this.editingCodexBudgetField !== 'modelContextWindowInput') {
                                this.modelContextWindowInput = contextWindow.ok && contextWindow.text
                                    ? contextWindow.text
                                    : String(defaultModelContextWindow);
                            }
                        }
                        {
                            const autoCompactTokenLimit = this.normalizePositiveIntegerInput(
                                statusRes.modelAutoCompactTokenLimit,
                                'model_auto_compact_token_limit',
                                defaultModelAutoCompactTokenLimit
                            );
                            if (this.editingCodexBudgetField !== 'modelAutoCompactTokenLimitInput') {
                                this.modelAutoCompactTokenLimitInput = autoCompactTokenLimit.ok && autoCompactTokenLimit.text
                                    ? autoCompactTokenLimit.text
                                    : String(defaultModelAutoCompactTokenLimit);
                            }
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
                }
            } catch (e) {
                this.initError = '连接失败: ' + e.message;
            } finally {
                if (!preserveLoading) {
                    this.loading = false;
                }
            }

            if (startupOk) {
                try {
                    await this.loadModelsForProvider(this.currentProvider);
                } catch (_) {}
                try {
                    await this.loadCodexAuthProfiles();
                } catch (_) {}
            }

            return startupOk;
        },

        async loadModelsForProvider(providerName, options = {}) {
            const silentError = !!options.silentError;
            const targetProvider = typeof providerName === 'string' ? providerName.trim() : '';
            const requestSeq = (Number(this.codexModelsRequestSeq) || 0) + 1;
            this.codexModelsRequestSeq = requestSeq;
            this.codexModelsLoading = true;
            if (!targetProvider) {
                this.models = [];
                this.modelsSource = 'unlimited';
                this.modelsHasCurrent = true;
                this.codexModelsLoading = false;
                return;
            }
            const isLatestRequest = () => {
                const currentProvider = typeof this.currentProvider === 'string' ? this.currentProvider.trim() : '';
                return requestSeq === Number(this.codexModelsRequestSeq || 0)
                    && (!currentProvider || currentProvider === targetProvider);
            };
            try {
                const res = await api('models', { provider: targetProvider });
                if (!isLatestRequest()) {
                    return;
                }
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
            } catch (_) {
                if (!isLatestRequest()) {
                    return;
                }
                if (!silentError) {
                    this.showMessage('获取模型列表失败', 'error');
                }
                this.models = [];
                this.modelsSource = 'error';
                this.modelsHasCurrent = true;
            } finally {
                if (requestSeq === Number(this.codexModelsRequestSeq || 0)) {
                    this.codexModelsLoading = false;
                }
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

            const preset = next.preset || '';
            const isBedrock = preset === 'aws-bedrock-aksk' || preset === 'aws-bedrock-api-key';
            const awsRegion = next.awsRegion || previous.awsRegion || '';
            const awsAccessKeyId = next.awsAccessKeyId || previous.awsAccessKeyId || '';
            const awsSecretAccessKey = next.awsSecretAccessKey || previous.awsSecretAccessKey || '';

            const baseUrl = isBedrock && awsRegion
                ? `https://bedrock-runtime.${awsRegion}.amazonaws.com`
                : next.baseUrl;

            const model = next.model
                || previous.model
                || (isBedrock ? 'global.anthropic.claude-opus-4-6-v1' : 'glm-4.7');

            const hasKey = !!(
                next.apiKey
                || externalCredentialType
                || (preset === 'aws-bedrock-aksk' && awsRegion && awsAccessKeyId && awsSecretAccessKey)
            );
            const merged = {
                apiKey: next.apiKey,
                baseUrl,
                model,
                hasKey,
                externalCredentialType
            };
            // 为兼容历史本地存储与单测：仅在字段有值时写入新字段。
            if (preset) merged.preset = preset;
            if (awsRegion) merged.awsRegion = awsRegion;
            if (awsAccessKeyId) merged.awsAccessKeyId = awsAccessKeyId;
            if (awsSecretAccessKey) merged.awsSecretAccessKey = awsSecretAccessKey;
            return merged;
        },

        buildClaudeImportedConfigName(baseUrl) {
            const normalizedUrl = typeof baseUrl === 'string' ? baseUrl.trim() : '';
            if (!normalizedUrl) return '导入配置';
            try {
                const parsed = new URL(normalizedUrl);
                const host = typeof parsed.host === 'string' ? parsed.host.trim() : '';
                if (host) return `导入-${host}`;
            } catch (_) {}
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
            const maxAttempts = 1000;
            while (this.claudeConfigs[candidateName] && suffix <= maxAttempts) {
                candidateName = `${preferredName}-${suffix}`;
                suffix += 1;
            }
            if (this.claudeConfigs[candidateName]) {
                return '';
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
            } catch (_) {
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
            const requestSeq = (Number(this.claudeModelsRequestSeq) || 0) + 1;
            this.claudeModelsRequestSeq = requestSeq;
            if (!config) {
                this.resetClaudeModelsState();
                return;
            }
            const currentConfigName = typeof this.currentClaudeConfig === 'string' ? this.currentClaudeConfig.trim() : '';
            const baseUrl = (config.baseUrl || '').trim();
            const apiKey = (config.apiKey || '').trim();
            const externalCredentialType = typeof config.externalCredentialType === 'string'
                ? config.externalCredentialType.trim()
                : '';

            if (!baseUrl) {
                this.resetClaudeModelsState();
                return;
            }
            const localCatalog = getClaudeModelCatalogForBaseUrl(baseUrl);
            if (!apiKey && externalCredentialType) {
                this.claudeModels = localCatalog;
                this.claudeModelsSource = localCatalog.length ? 'catalog' : 'unlimited';
                if (localCatalog.length) {
                    this.updateClaudeModelsCurrent();
                } else {
                    this.claudeModelsHasCurrent = true;
                }
                this.claudeModelsLoading = false;
                return;
            }

            this.claudeModelsLoading = true;
            const isLatestRequest = () => {
                if (requestSeq !== Number(this.claudeModelsRequestSeq || 0)) {
                    return false;
                }
                const liveConfigName = typeof this.currentClaudeConfig === 'string' ? this.currentClaudeConfig.trim() : '';
                if (currentConfigName && liveConfigName && liveConfigName !== currentConfigName) {
                    return false;
                }
                const latestConfig = this.getCurrentClaudeConfig();
                if (!latestConfig) {
                    return false;
                }
                return (latestConfig.baseUrl || '').trim() === baseUrl
                    && (latestConfig.apiKey || '').trim() === apiKey
                    && (typeof latestConfig.externalCredentialType === 'string' ? latestConfig.externalCredentialType.trim() : '') === externalCredentialType;
            };
            try {
                const res = await api('models-by-url', { baseUrl, apiKey });
                if (!isLatestRequest()) {
                    return;
                }
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
            } catch (_) {
                if (!isLatestRequest()) {
                    return;
                }
                if (!silentError) {
                    this.showMessage('获取模型列表失败', 'error');
                }
                this.claudeModels = [];
                this.claudeModelsSource = 'error';
                this.claudeModelsHasCurrent = true;
            } finally {
                if (requestSeq === Number(this.claudeModelsRequestSeq || 0)) {
                    this.claudeModelsLoading = false;
                }
            }
        },

        openClaudeConfigModal() {
            this.showClaudeConfigModal = true;
        },

        maybeShowStarPrompt() {
            const storageKey = 'codexmateStarPrompted';
            try {
                if (!localStorage.getItem(storageKey)) {
                    localStorage.setItem(storageKey, '1');
                }
            } catch (_) {
                // Ignore storage failures silently. The startup UI should not show
                // promotional prompts or block normal configuration work.
            }
        }
    };
}
