export function normalizeClaudeValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeClaudeConfig(config) {
    const safe = config && typeof config === 'object' ? config : {};
    const apiKey = normalizeClaudeValue(safe.apiKey);
    const authToken = normalizeClaudeValue(safe.authToken);
    const useKey = normalizeClaudeValue(safe.useKey);
    const externalCredentialType = normalizeClaudeValue(safe.externalCredentialType)
        || (apiKey ? '' : (authToken ? 'auth-token' : (useKey ? 'claude-code-use-key' : '')));
    return {
        apiKey,
        baseUrl: normalizeClaudeValue(safe.baseUrl),
        model: normalizeClaudeValue(safe.model),
        authToken,
        useKey,
        externalCredentialType
    };
}

export function normalizeClaudeSettingsEnv(env) {
    const safe = env && typeof env === 'object' ? env : {};
    const apiKey = normalizeClaudeValue(safe.ANTHROPIC_API_KEY);
    const authToken = normalizeClaudeValue(safe.ANTHROPIC_AUTH_TOKEN);
    const useKey = normalizeClaudeValue(safe.CLAUDE_CODE_USE_KEY);
    return {
        apiKey,
        baseUrl: normalizeClaudeValue(safe.ANTHROPIC_BASE_URL),
        model: normalizeClaudeValue(safe.ANTHROPIC_MODEL) || 'glm-4.7',
        authToken,
        useKey,
        externalCredentialType: apiKey
            ? ''
            : (authToken ? 'auth-token' : (useKey ? 'claude-code-use-key' : ''))
    };
}

function normalizeClaudeComparableUrl(value) {
    const trimmed = normalizeClaudeValue(value);
    if (!trimmed) return '';
    return trimmed.replace(/\/+$/g, '');
}

function hasClaudeCredential(config = {}) {
    return !!(config.apiKey || config.authToken || config.useKey);
}

export function matchClaudeConfigFromSettings(claudeConfigs = {}, env = {}) {
    const normalizedSettings = normalizeClaudeSettingsEnv(env);
    if (!normalizedSettings.baseUrl || !normalizedSettings.model || !hasClaudeCredential(normalizedSettings)) {
        return '';
    }
    const comparableSettingsUrl = normalizeClaudeComparableUrl(normalizedSettings.baseUrl);
    const entries = Object.entries(claudeConfigs || {});
    for (const [name, config] of entries) {
        const normalizedConfig = normalizeClaudeConfig(config);
        if (!normalizedConfig.baseUrl || !normalizedConfig.model) {
            continue;
        }
        if (normalizeClaudeComparableUrl(normalizedConfig.baseUrl) !== comparableSettingsUrl
            || normalizedConfig.model !== normalizedSettings.model) {
            continue;
        }
        if (normalizedSettings.apiKey && normalizedConfig.apiKey === normalizedSettings.apiKey) {
            return name;
        }
        if (!normalizedSettings.apiKey
            && normalizedConfig.apiKey === ''
            && normalizedConfig.externalCredentialType
            && normalizedConfig.externalCredentialType === normalizedSettings.externalCredentialType) {
            return name;
        }
    }
    return '';
}

export function findDuplicateClaudeConfigName(claudeConfigs = {}, config) {
    const normalized = normalizeClaudeConfig(config);
    if (!normalized.baseUrl || !normalized.model) {
        return '';
    }
    const comparableUrl = normalizeClaudeComparableUrl(normalized.baseUrl);
    const isExternal = !normalized.apiKey && !!normalized.externalCredentialType;
    if (!normalized.apiKey && !isExternal) {
        return '';
    }
    const entries = Object.entries(claudeConfigs || {});
    for (const [name, existing] of entries) {
        const normalizedExisting = normalizeClaudeConfig(existing);
        if (!normalizedExisting.baseUrl || !normalizedExisting.model) {
            continue;
        }
        if (normalizeClaudeComparableUrl(normalizedExisting.baseUrl) !== comparableUrl
            || normalizedExisting.model !== normalized.model) {
            continue;
        }
        if (normalized.apiKey && normalizedExisting.apiKey === normalized.apiKey) {
            return name;
        }
        if (isExternal
            && !normalizedExisting.apiKey
            && normalizedExisting.externalCredentialType === normalized.externalCredentialType) {
            return name;
        }
    }
    return '';
}
