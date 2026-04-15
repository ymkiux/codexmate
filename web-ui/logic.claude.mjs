const DEFAULT_CLAUDE_MODEL_CATALOG = Object.freeze([
    'claude-opus-4-6',
    'claude-opus-4-1',
    'claude-opus-4',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5',
    'claude-sonnet-4',
    'claude-haiku-4-5',
    'claude-3-7-sonnet',
    'claude-3-5-sonnet',
    'claude-3-5-haiku',
    'claude-3-opus',
    'claude-3-sonnet',
    'claude-3-haiku'
]);

const BIGMODEL_CLAUDE_EXTRA_MODELS = Object.freeze([
    'glm-3-turbo',
    'glm-4',
    'glm-4-0520',
    'glm-4-plus',
    'glm-4-air',
    'glm-4-airx',
    'glm-4-flash',
    'glm-4-flashx',
    'glm-4v',
    'glm-4v-flash',
    'glm-4v-plus',
    'glm-4v-plus-0111',
    'glm-4.5',
    'glm-4.5-air',
    'glm-4.5v',
    'glm-4.6',
    'glm-4.6v',
    'glm-4.7',
    'glm-4.7-flash',
    'glm-4.7-flashx',
    'glm-5',
    'glm-5-turbo',
    'glm-5.1',
    'glm-5v',
    'glm-5v-turbo',
    'glm-z1',
    'glm-z1-air',
    'glm-coding'
]);

export function normalizeClaudeValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function getClaudeModelCatalogForBaseUrl(baseUrl) {
    const normalized = normalizeClaudeValue(baseUrl).toLowerCase().replace(/\/+$/g, '');
    const models = [...DEFAULT_CLAUDE_MODEL_CATALOG];
    if (normalized.includes('bigmodel.cn') && normalized.includes('/anthropic')) {
        for (const model of BIGMODEL_CLAUDE_EXTRA_MODELS) {
            if (!models.includes(model)) {
                models.push(model);
            }
        }
    }
    return models;
}

export function normalizeClaudeConfig(config) {
    const safe = config && typeof config === 'object' ? config : {};
    const apiKey = normalizeClaudeValue(safe.apiKey);
    const authToken = normalizeClaudeValue(safe.authToken);
    const useKey = normalizeClaudeValue(safe.useKey);
    const externalCredentialType = normalizeClaudeValue(safe.externalCredentialType)
        || (apiKey ? '' : (authToken ? 'auth-token' : (useKey ? 'claude-code-use-key' : '')));
    const normalized = {
        apiKey,
        baseUrl: normalizeClaudeValue(safe.baseUrl),
        model: normalizeClaudeValue(safe.model),
        authToken,
        useKey,
        externalCredentialType
    };
    // 兼容既有单测与历史数据：仅在字段有值时追加新字段。
    const preset = normalizeClaudeValue(safe.preset);
    if (preset) normalized.preset = preset;
    const awsRegion = normalizeClaudeValue(safe.awsRegion);
    if (awsRegion) normalized.awsRegion = awsRegion;
    const awsAccessKeyId = normalizeClaudeValue(safe.awsAccessKeyId);
    if (awsAccessKeyId) normalized.awsAccessKeyId = awsAccessKeyId;
    const awsSecretAccessKey = normalizeClaudeValue(safe.awsSecretAccessKey);
    if (awsSecretAccessKey) normalized.awsSecretAccessKey = awsSecretAccessKey;
    return normalized;
}

export function normalizeClaudeSettingsEnv(env) {
    const safe = env && typeof env === 'object' ? env : {};
    const apiKey = normalizeClaudeValue(safe.ANTHROPIC_API_KEY);
    const authToken = normalizeClaudeValue(safe.ANTHROPIC_AUTH_TOKEN);
    const useKey = normalizeClaudeValue(safe.CLAUDE_CODE_USE_KEY);
    const normalized = {
        apiKey,
        baseUrl: normalizeClaudeValue(safe.ANTHROPIC_BASE_URL),
        model: normalizeClaudeValue(safe.ANTHROPIC_MODEL) || 'glm-4.7',
        authToken,
        useKey,
        externalCredentialType: apiKey
            ? ''
            : (authToken ? 'auth-token' : (useKey ? 'claude-code-use-key' : '')),
    };
    const useBedrock = normalizeClaudeValue(safe.CLAUDE_CODE_USE_BEDROCK);
    const awsRegion = normalizeClaudeValue(safe.AWS_REGION);
    const awsAccessKeyId = normalizeClaudeValue(safe.AWS_ACCESS_KEY_ID);
    const awsSecretAccessKey = normalizeClaudeValue(safe.AWS_SECRET_ACCESS_KEY);
    if (useBedrock) {
        normalized.preset = awsAccessKeyId || awsSecretAccessKey ? 'aws-bedrock-aksk' : 'aws-bedrock-api-key';
    }
    if (awsRegion) normalized.awsRegion = awsRegion;
    if (awsAccessKeyId) normalized.awsAccessKeyId = awsAccessKeyId;
    if (awsSecretAccessKey) normalized.awsSecretAccessKey = awsSecretAccessKey;
    return normalized;
}

function normalizeClaudeComparableUrl(value) {
    const trimmed = normalizeClaudeValue(value);
    if (!trimmed) return '';
    return trimmed.replace(/\/+$/g, '');
}

function hasClaudeCredential(config = {}) {
    if (config.preset === 'aws-bedrock-aksk') {
        return !!(config.awsRegion && config.awsAccessKeyId && config.awsSecretAccessKey);
    }
    if (config.preset === 'aws-bedrock-api-key') {
        return !!(config.awsRegion && config.apiKey);
    }
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
    const isBedrock = normalized.preset === 'aws-bedrock-aksk' || normalized.preset === 'aws-bedrock-api-key';
    const isExternal = !normalized.apiKey && !!normalized.externalCredentialType;
    if (!normalized.apiKey && !isExternal && !isBedrock) {
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
        if (isBedrock && normalizedExisting.preset === normalized.preset) {
            if (normalized.preset === 'aws-bedrock-aksk') {
                if (normalizedExisting.awsRegion === normalized.awsRegion
                    && normalizedExisting.awsAccessKeyId === normalized.awsAccessKeyId) {
                    return name;
                }
            } else if (normalized.preset === 'aws-bedrock-api-key') {
                if (normalizedExisting.awsRegion === normalized.awsRegion
                    && normalizedExisting.apiKey === normalized.apiKey) {
                    return name;
                }
            }
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
