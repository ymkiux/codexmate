// 逻辑纯函数：供 Web UI 与单元测试共享
export function normalizeClaudeValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeClaudeConfig(config) {
    const safe = config && typeof config === 'object' ? config : {};
    return {
        apiKey: normalizeClaudeValue(safe.apiKey),
        baseUrl: normalizeClaudeValue(safe.baseUrl),
        model: normalizeClaudeValue(safe.model)
    };
}

export function normalizeClaudeSettingsEnv(env) {
    const safe = env && typeof env === 'object' ? env : {};
    return {
        apiKey: normalizeClaudeValue(safe.ANTHROPIC_API_KEY),
        baseUrl: normalizeClaudeValue(safe.ANTHROPIC_BASE_URL),
        model: normalizeClaudeValue(safe.ANTHROPIC_MODEL)
    };
}

export function matchClaudeConfigFromSettings(claudeConfigs = {}, env = {}) {
    const normalizedSettings = normalizeClaudeSettingsEnv(env);
    if (!normalizedSettings.apiKey || !normalizedSettings.baseUrl || !normalizedSettings.model) {
        return '';
    }
    const entries = Object.entries(claudeConfigs || {});
    for (const [name, config] of entries) {
        const normalizedConfig = normalizeClaudeConfig(config);
        if (!normalizedConfig.apiKey || !normalizedConfig.baseUrl || !normalizedConfig.model) {
            continue;
        }
        if (normalizedConfig.apiKey === normalizedSettings.apiKey
            && normalizedConfig.baseUrl === normalizedSettings.baseUrl
            && normalizedConfig.model === normalizedSettings.model) {
            return name;
        }
    }
    return '';
}

export function findDuplicateClaudeConfigName(claudeConfigs = {}, config) {
    const normalized = normalizeClaudeConfig(config);
    if (!normalized.apiKey || !normalized.baseUrl || !normalized.model) {
        return '';
    }
    const entries = Object.entries(claudeConfigs || {});
    for (const [name, existing] of entries) {
        const normalizedExisting = normalizeClaudeConfig(existing);
        if (!normalizedExisting.apiKey || !normalizedExisting.baseUrl || !normalizedExisting.model) {
            continue;
        }
        if (normalizedExisting.apiKey === normalized.apiKey
            && normalizedExisting.baseUrl === normalized.baseUrl
            && normalizedExisting.model === normalized.model) {
            return name;
        }
    }
    return '';
}

export function formatLatency(result) {
    if (!result) return '';
    if (!result.ok) return result.status ? `ERR ${result.status}` : 'ERR';
    const ms = typeof result.durationMs === 'number' ? result.durationMs : 0;
    return `${ms}ms`;
}

export function buildSpeedTestIssue(name, result) {
    if (!name || !result) return null;
    if (result.error) {
        const error = String(result.error || '');
        const errorLower = error.toLowerCase();
        if (error === 'Provider not found') {
            return {
                code: 'remote-speedtest-provider-missing',
                message: `提供商 ${name} 未找到，无法测速`,
                suggestion: '检查配置是否存在该 provider'
            };
        }
        if (error === 'Provider missing URL' || error === 'Missing name or url') {
            return {
                code: 'remote-speedtest-baseurl-missing',
                message: `提供商 ${name} 缺少 base_url`,
                suggestion: '补全 base_url 后重试'
            };
        }
        if (errorLower.includes('invalid url')) {
            return {
                code: 'remote-speedtest-invalid-url',
                message: `提供商 ${name} 的 base_url 无效`,
                suggestion: '请设置为 http/https 的完整 URL'
            };
        }
        if (errorLower.includes('timeout')) {
            return {
                code: 'remote-speedtest-timeout',
                message: `提供商 ${name} 远程测速超时`,
                suggestion: '检查网络或 base_url 是否可达'
            };
        }
        return {
            code: 'remote-speedtest-unreachable',
            message: `提供商 ${name} 远程测速失败：${error || '无法连接'}`,
            suggestion: '检查网络或 base_url 是否可用'
        };
    }

    const status = typeof result.status === 'number' ? result.status : 0;
    if (status === 401 || status === 403) {
        return {
            code: 'remote-speedtest-auth-failed',
            message: `提供商 ${name} 远程测速鉴权失败（401/403）`,
            suggestion: '检查 API Key 或认证方式'
        };
    }
    if (status >= 400) {
        return {
            code: 'remote-speedtest-http-error',
            message: `提供商 ${name} 远程测速返回异常状态: ${status}`,
            suggestion: '检查 base_url 或服务状态'
        };
    }
    return null;
}

// Session filtering helpers
export function isSessionQueryEnabled(source) {
    const normalized = (source || '').toLowerCase();
    return normalized === 'codex' || normalized === 'claude';
}

export function buildSessionListParams(options = {}) {
    const {
        source = 'codex',
        pathFilter = '',
        query = '',
        roleFilter = 'all',
        timeRangePreset = 'all',
        limit = 200
    } = options;
    const queryValue = isSessionQueryEnabled(source) ? query : '';
    return {
        source,
        pathFilter,
        query: queryValue,
        queryMode: 'and',
        queryScope: 'content',
        contentScanLimit: 50,
        roleFilter,
        timeRangePreset,
        limit,
        forceRefresh: true
    };
}
