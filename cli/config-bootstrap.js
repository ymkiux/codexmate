const toml = require('@iarna/toml');

function createConfigBootstrapController(deps = {}) {
    const {
        fs,
        path,
        readJsonFile,
        readJsonArrayFile,
        writeJsonAtomic,
        formatTimestampForFileName,
        isPlainObject,
        ensureConfigDir,
        readConfig,
        removePersistedBuiltinProxyProviderFromConfig,
        writeConfig,
        readModels,
        writeModels,
        readCurrentModels,
        writeCurrentModels,
        updateAuthJson,
        CONFIG_DIR,
        CONFIG_FILE,
        AUTH_FILE,
        MODELS_FILE,
        RECENT_CONFIGS_FILE,
        INIT_MARK_FILE,
        MAX_RECENT_CONFIGS,
        DEFAULT_MODELS,
        DEFAULT_MODEL_CONTEXT_WINDOW,
        DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT,
        CODEXMATE_MANAGED_MARKER,
        BUILTIN_PROXY_PROVIDER_NAME,
        EMPTY_CONFIG_FALLBACK_TEMPLATE
    } = deps;

    if (!fs) throw new Error('createConfigBootstrapController 缺少 fs');
    if (!path) throw new Error('createConfigBootstrapController 缺少 path');
    if (typeof readJsonFile !== 'function') throw new Error('createConfigBootstrapController 缺少 readJsonFile');
    if (typeof readJsonArrayFile !== 'function') throw new Error('createConfigBootstrapController 缺少 readJsonArrayFile');
    if (typeof writeJsonAtomic !== 'function') throw new Error('createConfigBootstrapController 缺少 writeJsonAtomic');
    if (typeof formatTimestampForFileName !== 'function') throw new Error('createConfigBootstrapController 缺少 formatTimestampForFileName');
    if (typeof isPlainObject !== 'function') throw new Error('createConfigBootstrapController 缺少 isPlainObject');
    if (typeof ensureConfigDir !== 'function') throw new Error('createConfigBootstrapController 缺少 ensureConfigDir');
    if (typeof readConfig !== 'function') throw new Error('createConfigBootstrapController 缺少 readConfig');
    if (typeof removePersistedBuiltinProxyProviderFromConfig !== 'function') throw new Error('createConfigBootstrapController 缺少 removePersistedBuiltinProxyProviderFromConfig');
    if (typeof writeConfig !== 'function') throw new Error('createConfigBootstrapController 缺少 writeConfig');
    if (typeof readModels !== 'function') throw new Error('createConfigBootstrapController 缺少 readModels');
    if (typeof writeModels !== 'function') throw new Error('createConfigBootstrapController 缺少 writeModels');
    if (typeof readCurrentModels !== 'function') throw new Error('createConfigBootstrapController 缺少 readCurrentModels');
    if (typeof writeCurrentModels !== 'function') throw new Error('createConfigBootstrapController 缺少 writeCurrentModels');
    if (typeof updateAuthJson !== 'function') throw new Error('createConfigBootstrapController 缺少 updateAuthJson');
    if (!CONFIG_DIR) throw new Error('createConfigBootstrapController 缺少 CONFIG_DIR');
    if (!CONFIG_FILE) throw new Error('createConfigBootstrapController 缺少 CONFIG_FILE');
    if (!AUTH_FILE) throw new Error('createConfigBootstrapController 缺少 AUTH_FILE');
    if (!MODELS_FILE) throw new Error('createConfigBootstrapController 缺少 MODELS_FILE');
    if (!RECENT_CONFIGS_FILE) throw new Error('createConfigBootstrapController 缺少 RECENT_CONFIGS_FILE');
    if (!INIT_MARK_FILE) throw new Error('createConfigBootstrapController 缺少 INIT_MARK_FILE');
    if (!Array.isArray(DEFAULT_MODELS)) throw new Error('createConfigBootstrapController 缺少 DEFAULT_MODELS');
    if (!CODEXMATE_MANAGED_MARKER) throw new Error('createConfigBootstrapController 缺少 CODEXMATE_MANAGED_MARKER');
    if (!BUILTIN_PROXY_PROVIDER_NAME) throw new Error('createConfigBootstrapController 缺少 BUILTIN_PROXY_PROVIDER_NAME');
    if (typeof EMPTY_CONFIG_FALLBACK_TEMPLATE !== 'string') throw new Error('createConfigBootstrapController 缺少 EMPTY_CONFIG_FALLBACK_TEMPLATE');

    let initNotice = '';

    function normalizeRecentConfigs(items) {
        if (!Array.isArray(items)) return [];
        const output = [];
        const seen = new Set();
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const provider = typeof item.provider === 'string' ? item.provider.trim() : '';
            const model = typeof item.model === 'string' ? item.model.trim() : '';
            if (!provider || !model) continue;
            const key = `${provider}::${model}`;
            if (seen.has(key)) continue;
            seen.add(key);
            output.push({
                provider,
                model,
                usedAt: typeof item.usedAt === 'string' ? item.usedAt : ''
            });
        }
        return output;
    }

    function readRecentConfigs() {
        return normalizeRecentConfigs(readJsonArrayFile(RECENT_CONFIGS_FILE, []));
    }

    function writeRecentConfigs(items) {
        writeJsonAtomic(RECENT_CONFIGS_FILE, items);
    }

    function recordRecentConfig(provider, model) {
        const providerName = typeof provider === 'string' ? provider.trim() : '';
        const modelName = typeof model === 'string' ? model.trim() : '';
        if (!providerName || !modelName) return;

        const now = new Date().toISOString();
        const current = readRecentConfigs();
        const next = [{
            provider: providerName,
            model: modelName,
            usedAt: now
        }];

        for (const item of current) {
            if (item.provider === providerName && item.model === modelName) continue;
            next.push(item);
        }

        const trimmed = next.slice(0, MAX_RECENT_CONFIGS);
        writeRecentConfigs(trimmed);
    }

    function buildDefaultConfigContent(initializedAt) {
        const defaultModel = DEFAULT_MODELS[0] || 'gpt-4';
        return `${CODEXMATE_MANAGED_MARKER}
# codexmate-initialized-at: ${initializedAt}

model_provider = "openai"
model = "${defaultModel}"
model_context_window = ${DEFAULT_MODEL_CONTEXT_WINDOW}
model_auto_compact_token_limit = ${DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT}

[model_providers.openai]
name = "openai"
base_url = "https://api.openai.com/v1"
wire_api = "responses"
requires_openai_auth = false
preferred_auth_method = ""
request_max_retries = 4
stream_max_retries = 10
stream_idle_timeout_ms = 300000
`;
    }

    function buildVirtualDefaultConfig() {
        return toml.parse(EMPTY_CONFIG_FALLBACK_TEMPLATE);
    }

    function sanitizeRemovedBuiltinProxyProvider(config) {
        const safeConfig = isPlainObject(config) ? config : {};
        const providers = isPlainObject(safeConfig.model_providers) ? safeConfig.model_providers : null;
        const currentProvider = typeof safeConfig.model_provider === 'string' ? safeConfig.model_provider.trim() : '';
        const hasRemovedBuiltin = !!(providers && providers[BUILTIN_PROXY_PROVIDER_NAME]);
        const currentIsRemovedBuiltin = currentProvider === BUILTIN_PROXY_PROVIDER_NAME;
        const currentIsRemovedVirtualLocal = currentProvider === 'local' && !(providers && isPlainObject(providers.local));

        if (!hasRemovedBuiltin && !currentIsRemovedBuiltin && !currentIsRemovedVirtualLocal) {
            return safeConfig;
        }

        const nextProviders = providers ? { ...providers } : {};
        delete nextProviders[BUILTIN_PROXY_PROVIDER_NAME];
        const providerNames = Object.keys(nextProviders);
        const fallbackProvider = providerNames[0] || '';
        const currentModels = readCurrentModels();
        const fallbackModel = fallbackProvider
            ? (currentModels[fallbackProvider] || (typeof safeConfig.model === 'string' ? safeConfig.model : ''))
            : '';

        return {
            ...safeConfig,
            model_providers: nextProviders,
            model_provider: (currentIsRemovedBuiltin || currentIsRemovedVirtualLocal) ? fallbackProvider : safeConfig.model_provider,
            model: (currentIsRemovedBuiltin || currentIsRemovedVirtualLocal) ? fallbackModel : safeConfig.model
        };
    }

    function readConfigOrVirtualDefault() {
        if (fs.existsSync(CONFIG_FILE)) {
            try {
                removePersistedBuiltinProxyProviderFromConfig();
                return {
                    config: sanitizeRemovedBuiltinProxyProvider(readConfig()),
                    isVirtual: false,
                    reason: '',
                    detail: '',
                    errorType: ''
                };
            } catch (e) {
                const errorType = typeof e.configErrorType === 'string' && e.configErrorType.trim()
                    ? e.configErrorType.trim()
                    : 'read';
                const publicReason = typeof e.configPublicReason === 'string' && e.configPublicReason.trim()
                    ? e.configPublicReason.trim()
                    : (errorType === 'parse' ? 'config.toml 解析失败' : '读取 config.toml 失败');
                const detail = typeof e.configDetail === 'string' && e.configDetail.trim()
                    ? e.configDetail.trim()
                    : (e && e.message ? e.message : publicReason);
                return {
                    config: errorType === 'missing'
                        ? sanitizeRemovedBuiltinProxyProvider(buildVirtualDefaultConfig())
                        : {},
                    isVirtual: true,
                    reason: publicReason,
                    detail,
                    errorType
                };
            }
        }

        return {
            config: sanitizeRemovedBuiltinProxyProvider(buildVirtualDefaultConfig()),
            isVirtual: true,
            reason: '未检测到 config.toml',
            detail: `配置文件不存在: ${CONFIG_FILE}`,
            errorType: 'missing'
        };
    }

    function printConfigLoadErrorAndMarkExit(result) {
        const isReadError = result && result.errorType === 'read';
        const detail = result && typeof result.detail === 'string' && result.detail.trim()
            ? result.detail.trim()
            : (isReadError ? '读取配置文件失败' : '配置文件解析失败');
        console.error(`\n错误: ${isReadError ? '读取 config.toml 失败' : '配置文件解析失败'}`);
        console.error(`  详情: ${detail}`);
        console.error(`  路径: ${CONFIG_FILE}`);
        console.error(`  建议: ${isReadError ? '检查文件权限后重试' : '修复 config.toml 语法后重试'}`);
        console.error();
        process.exitCode = 1;
    }

    function ensureSupportFiles(defaultProvider, defaultModel) {
        if (!fs.existsSync(MODELS_FILE)) {
            writeModels([...DEFAULT_MODELS]);
        } else {
            const existingModels = readModels();
            const mergedModels = Array.isArray(existingModels) ? [...existingModels] : [];
            let hasNewDefaultModel = false;
            for (const model of DEFAULT_MODELS) {
                if (!mergedModels.includes(model)) {
                    mergedModels.push(model);
                    hasNewDefaultModel = true;
                }
            }
            if (hasNewDefaultModel) {
                writeModels(mergedModels);
            }
        }

        const currentModels = readCurrentModels();
        if (!currentModels[defaultProvider]) {
            currentModels[defaultProvider] = defaultModel;
            writeCurrentModels(currentModels);
        }

        if (!fs.existsSync(AUTH_FILE)) {
            updateAuthJson('');
        }
    }

    function writeInitMark(payload) {
        fs.writeFileSync(INIT_MARK_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    }

    function ensureManagedConfigBootstrap() {
        ensureConfigDir();

        const initializedAt = new Date().toISOString();
        const defaultProvider = 'openai';
        const defaultModel = DEFAULT_MODELS[0] || 'gpt-4';
        const forceResetExistingConfig = process.env.CODEXMATE_FORCE_RESET_EXISTING_CONFIG === '1';
        const mark = readJsonFile(INIT_MARK_FILE, null);
        const hasConfig = fs.existsSync(CONFIG_FILE);

        if (mark) {
            if (!hasConfig) {
                writeConfig(buildDefaultConfigContent(initializedAt));
                ensureSupportFiles(defaultProvider, defaultModel);
                initNotice = '检测到配置缺失，已自动重建默认配置。';
                return { notice: initNotice };
            }
            ensureSupportFiles(defaultProvider, defaultModel);
            return { notice: '' };
        }

        if (hasConfig) {
            let existingContent = '';
            try {
                existingContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
            } catch (e) {}

            if (existingContent.includes(CODEXMATE_MANAGED_MARKER)) {
                writeInitMark({
                    version: 1,
                    initializedAt,
                    mode: 'managed-config-detected',
                    backupFile: ''
                });
                ensureSupportFiles(defaultProvider, defaultModel);
                return { notice: '' };
            }

            const backupFile = `config.toml.codexmate-backup-${formatTimestampForFileName(initializedAt)}.bak`;
            const backupPath = path.join(CONFIG_DIR, backupFile);
            fs.copyFileSync(CONFIG_FILE, backupPath);

            if (forceResetExistingConfig) {
                writeConfig(buildDefaultConfigContent(initializedAt));
                ensureSupportFiles(defaultProvider, defaultModel);
                writeInitMark({
                    version: 1,
                    initializedAt,
                    mode: 'first-run-reset',
                    backupFile
                });

                initNotice = `首次使用已备份原配置到 ${backupFile}，并重建默认配置。`;
                return { notice: initNotice, backupFile };
            }

            ensureSupportFiles(defaultProvider, defaultModel);
            writeInitMark({
                version: 1,
                initializedAt,
                mode: 'legacy-config-preserved',
                backupFile
            });
            initNotice = `检测到已有配置，已备份到 ${backupFile}，并保留原配置不覆盖。`;
            return { notice: initNotice, backupFile };
        }

        writeConfig(buildDefaultConfigContent(initializedAt));
        ensureSupportFiles(defaultProvider, defaultModel);
        writeInitMark({
            version: 1,
            initializedAt,
            mode: 'fresh-install',
            backupFile: ''
        });
        initNotice = '首次使用已创建默认配置。';
        return { notice: initNotice };
    }

    function resetConfigToDefault() {
        ensureConfigDir();
        const initializedAt = new Date().toISOString();
        const defaultProvider = 'openai';
        const defaultModel = DEFAULT_MODELS[0] || 'gpt-4';

        let backupFile = '';
        if (fs.existsSync(CONFIG_FILE)) {
            backupFile = `config.toml.reset-${formatTimestampForFileName(initializedAt)}.bak`;
            fs.copyFileSync(CONFIG_FILE, path.join(CONFIG_DIR, backupFile));
        }

        writeConfig(buildDefaultConfigContent(initializedAt));
        ensureSupportFiles(defaultProvider, defaultModel);
        writeInitMark({
            version: 1,
            initializedAt,
            mode: 'manual-reset',
            backupFile
        });

        return { success: true, backupFile };
    }

    function consumeInitNotice() {
        const notice = initNotice;
        initNotice = '';
        return notice;
    }

    return {
        normalizeRecentConfigs,
        readRecentConfigs,
        writeRecentConfigs,
        recordRecentConfig,
        sanitizeRemovedBuiltinProxyProvider,
        readConfigOrVirtualDefault,
        printConfigLoadErrorAndMarkExit,
        ensureManagedConfigBootstrap,
        resetConfigToDefault,
        consumeInitNotice
    };
}

module.exports = {
    createConfigBootstrapController
};
