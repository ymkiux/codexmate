export function createOpenclawEditingMethods() {
    return {
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
        }
    };
}
