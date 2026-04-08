function isPlainRecord(value) {
    return !!(value && typeof value === 'object' && !Array.isArray(value));
}

function isEnvTemplateString(value) {
    return typeof value === 'string' && /^\$\{[A-Z][A-Z0-9_]{0,127}\}$/.test(value.trim());
}

function isSecretRefRecord(value) {
    return isPlainRecord(value)
        && typeof value.source === 'string'
        && typeof value.provider === 'string'
        && typeof value.id === 'string';
}

function isLegacySecretRefRecord(value) {
    return isPlainRecord(value)
        && typeof value.source === 'string'
        && typeof value.id === 'string'
        && (value.provider === undefined || value.provider === null || value.provider === '');
}

function coerceSecretRefRecord(value) {
    if (isSecretRefRecord(value)) {
        return {
            source: value.source.trim(),
            provider: value.provider.trim(),
            id: value.id.trim()
        };
    }
    if (isLegacySecretRefRecord(value)) {
        return {
            source: value.source.trim(),
            provider: 'default',
            id: value.id.trim()
        };
    }
    return null;
}

function formatSecretRefLabel(ref) {
    const normalized = coerceSecretRefRecord(ref);
    if (!normalized) return '';
    return `SecretRef(${normalized.source}:${normalized.provider}:${normalized.id})`;
}

function readFirstProviderDisplayValue(records, keys) {
    for (const record of records) {
        if (!isPlainRecord(record)) continue;
        for (const key of keys) {
            if (typeof record[key] === 'string' && record[key].trim()) {
                return {
                    value: record[key].trim(),
                    readOnly: false,
                    kind: isEnvTemplateString(record[key]) ? 'env-template' : 'string'
                };
            }
            if (coerceSecretRefRecord(record[key])) {
                return {
                    value: formatSecretRefLabel(record[key]),
                    readOnly: true,
                    kind: 'secret-ref'
                };
            }
        }
    }
    return {
        value: '',
        readOnly: false,
        kind: 'missing'
    };
}

function readPreferredProviderModels(records) {
    for (const record of records) {
        if (isPlainRecord(record) && Array.isArray(record.models) && record.models.length) {
            return record.models;
        }
    }
    return [];
}

export function createOpenclawCoreMethods() {
    return {
        getOpenclawParser() {
            const globalWindow = typeof window !== 'undefined' ? window : null;
            if (globalWindow && globalWindow.JSON5
                && typeof globalWindow.JSON5.parse === 'function'
                && typeof globalWindow.JSON5.stringify === 'function') {
                return {
                    parse: globalWindow.JSON5.parse,
                    stringify: globalWindow.JSON5.stringify
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
                baseUrlReadOnly: false,
                apiKey: '',
                apiKeyReadOnly: false,
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
            if (!isPlainRecord(config)) {
                this.openclawQuick = defaults;
                return;
            }

            const agentDefaults = isPlainRecord(config.agents) && isPlainRecord(config.agents.defaults)
                ? config.agents.defaults
                : {};
            const modelConfig = agentDefaults.model;
            const legacyAgent = isPlainRecord(config.agent)
                ? config.agent
                : {};

            let primaryRef = '';
            if (isPlainRecord(modelConfig) && typeof modelConfig.primary === 'string') {
                primaryRef = modelConfig.primary;
            } else if (typeof modelConfig === 'string') {
                primaryRef = modelConfig;
            }
            if (!primaryRef) {
                if (typeof legacyAgent.model === 'string') {
                    primaryRef = legacyAgent.model;
                } else if (isPlainRecord(legacyAgent.model) && typeof legacyAgent.model.primary === 'string') {
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

            const modelProviders = isPlainRecord(config.models) && isPlainRecord(config.models.providers)
                ? config.models.providers
                : null;
            const rootProviders = isPlainRecord(config.providers)
                ? config.providers
                : null;
            const providerKeys = Array.from(new Set([
                ...Object.keys(modelProviders || {}),
                ...Object.keys(rootProviders || {})
            ]));
            if (!providerName && providerKeys.length === 1) {
                providerName = providerKeys[0];
            }

            const buildProviderRecords = (name) => name
                ? [
                    modelProviders && modelProviders[name],
                    rootProviders && rootProviders[name]
                ]
                : [];
            let providerRecords = buildProviderRecords(providerName);
            const hasProviderConfig = providerRecords.some((item) => isPlainRecord(item));
            if (!hasProviderConfig && providerKeys.length === 1) {
                providerName = providerKeys[0];
                providerRecords = buildProviderRecords(providerName);
            }
            const providerConfig = providerRecords.find((item) => isPlainRecord(item)) || null;
            const providerModels = readPreferredProviderModels(providerRecords);

            let modelEntry = null;
            if (providerModels.length) {
                if (modelId) {
                    modelEntry = providerModels.find(item => item && (item.id === modelId || item.model === modelId));
                }
                if (!modelEntry && providerModels.length === 1) {
                    modelEntry = providerModels[0];
                    if (!modelId && modelEntry) {
                        if (typeof modelEntry.id === 'string' && modelEntry.id.trim()) {
                            modelId = modelEntry.id.trim();
                        } else if (typeof modelEntry.model === 'string' && modelEntry.model.trim()) {
                            modelId = modelEntry.model.trim();
                        }
                    }
                }
            }

            const baseUrlField = readFirstProviderDisplayValue(providerRecords, ['baseUrl', 'base_url', 'url']);
            const apiKeyField = readFirstProviderDisplayValue(providerRecords, ['apiKey', 'api_key', 'keyRef', 'key', 'authToken', 'auth_token', 'tokenRef', 'token']);
            const apiTypeField = readFirstProviderDisplayValue(providerRecords, ['api', 'apiType', 'api_type']);

            this.openclawQuick = {
                ...defaults,
                providerName,
                baseUrl: baseUrlField.value,
                baseUrlReadOnly: baseUrlField.readOnly,
                apiKey: apiKeyField.value,
                apiKeyReadOnly: apiKeyField.readOnly,
                apiType: apiTypeField.value || defaults.apiType,
                modelId: modelId || '',
                modelName: modelEntry && typeof modelEntry.name === 'string'
                    ? modelEntry.name
                    : (modelEntry && typeof modelEntry.displayName === 'string' ? modelEntry.displayName : ''),
                contextWindow: modelEntry && typeof modelEntry.contextWindow === 'number'
                    ? String(modelEntry.contextWindow)
                    : (modelEntry && typeof modelEntry.context_window === 'number' ? String(modelEntry.context_window) : ''),
                maxTokens: modelEntry && typeof modelEntry.maxTokens === 'number'
                    ? String(modelEntry.maxTokens)
                    : (modelEntry && typeof modelEntry.max_tokens === 'number' ? String(modelEntry.max_tokens) : '')
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
            const fallbackSource = Array.isArray(model.fallbacks)
                ? model.fallbacks
                : (legacyAgent.model && typeof legacyAgent.model === 'object' && !Array.isArray(legacyAgent.model) && Array.isArray(legacyAgent.model.fallbacks)
                    ? legacyAgent.model.fallbacks
                    : []);
            const fallbackList = fallbackSource
                .filter(item => typeof item === 'string' && item.trim())
                .map(item => item.trim());
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
            const legacyAgent = config && config.agent && typeof config.agent === 'object' && !Array.isArray(config.agent)
                ? config.agent
                : {};
            if (typeof legacyAgent.model === 'string') {
                addProvider(legacyAgent.model);
            } else if (legacyAgent.model && typeof legacyAgent.model === 'object' && !Array.isArray(legacyAgent.model)) {
                addProvider(legacyAgent.model.primary);
                if (Array.isArray(legacyAgent.model.fallbacks)) {
                    for (const item of legacyAgent.model.fallbacks) {
                        addProvider(item);
                    }
                }
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
            if (coerceSecretRefRecord(value)) {
                return formatSecretRefLabel(value);
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
            if (isEnvTemplateString(text)) {
                return `EnvRef(${text.trim().slice(2, -1)})`;
            }
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
            const text = typeof value === 'string'
                ? value.trim()
                : typeof value === 'number'
                    ? String(value).trim()
                    : String(value || '').trim();
            if (!text) {
                return { ok: true, value: null };
            }
            const num = Number(text);
            if (!Number.isFinite(num) || num < 0) {
                return { ok: false, error: `${label} 请输入有效数字` };
            }
            return { ok: true, value: num };
        }
    };
}
