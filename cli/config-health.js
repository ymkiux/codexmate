const { isValidHttpUrl, normalizeBaseUrl } = require('../lib/cli-utils');
const { buildModelProbeSpecs } = require('../lib/cli-models-utils');
const { probeJsonPost } = require('../lib/cli-network-utils');

const DEFAULT_TIMEOUT_MS = 6000;
const JSON_RESPONSE_MAX_BYTES = 256 * 1024;

function buildRemoteHealthMessage(issueCode, statusCode, detail) {
    if (!issueCode) {
        return '远程模型探测通过：endpoint、鉴权与模型均可用';
    }

    if (issueCode === 'remote-model-probe-unreachable') {
        return '远程模型接口不可达，请检查 endpoint、网络或 DNS';
    }

    if (issueCode === 'remote-model-probe-auth-failed') {
        return '远程模型探测鉴权失败（401/403），请检查 API Key、endpoint 与模型权限';
    }

    if (issueCode === 'remote-model-probe-not-found') {
        return '远程模型探测返回 404，请检查 base_url、接口路径或模型名';
    }

    if (issueCode === 'remote-model-probe-error') {
        return detail || '远程模型接口返回错误，请检查模型名与账号权限';
    }

    if (issueCode === 'remote-model-probe-http-error' && statusCode) {
        return `远程模型探测返回 HTTP ${statusCode}，请检查 endpoint 与模型`;
    }

    return '远程模型探测失败，请检查配置与远端服务状态';
}

function extractPayloadErrorMessage(payload) {
    if (!payload || typeof payload !== 'object') {
        return '';
    }
    if (typeof payload.error === 'string' && payload.error.trim()) {
        return payload.error.trim();
    }
    if (!payload.error || typeof payload.error !== 'object') {
        return '';
    }
    if (typeof payload.error.message === 'string' && payload.error.message.trim()) {
        return payload.error.message.trim();
    }
    if (typeof payload.error.code === 'string' && payload.error.code.trim()) {
        return payload.error.code.trim();
    }
    return '';
}

async function runRemoteHealthCheck(providerName, provider, modelName, options = {}) {
    const issues = [];
    const baseUrl = normalizeBaseUrl(provider && provider.base_url ? provider.base_url : '');
    const summary = {
        type: 'remote-health-check',
        provider: typeof providerName === 'string' ? providerName.trim() : '',
        endpoint: baseUrl,
        ok: false,
        statusCode: null,
        message: '',
        checks: {}
    };

    if (!baseUrl) {
        issues.push({
            code: 'remote-skip-base-url',
            message: '无法进行远程探测：base_url 为空',
            suggestion: '补全 base_url 或关闭远程探测'
        });
        summary.message = '无法进行远程探测：base_url 为空';
        return { issues, remote: summary };
    }

    if (!isValidHttpUrl(baseUrl)) {
        issues.push({
            code: 'remote-skip-base-url',
            message: '无法进行远程探测：base_url 无效',
            suggestion: '补全 base_url 或关闭远程探测'
        });
        summary.message = '无法进行远程探测：base_url 无效';
        return { issues, remote: summary };
    }

    const modelProbeSpecs = buildModelProbeSpecs(provider, modelName, baseUrl);
    if (!modelProbeSpecs.length) {
        issues.push({
            code: 'remote-skip-model',
            message: '无法进行远程探测：当前模型未设置',
            suggestion: '补全 model 后重试'
        });
        summary.message = '无法进行远程探测：当前模型未设置';
        return { issues, remote: summary };
    }

    const requiresAuth = provider && provider.requires_openai_auth !== false;
    const apiKey = typeof provider.preferred_auth_method === 'string'
        ? provider.preferred_auth_method.trim()
        : '';
    const authValue = requiresAuth ? apiKey : (apiKey || '');
    const timeoutMs = Number.isFinite(options.timeoutMs)
        ? Math.max(1000, Number(options.timeoutMs))
        : DEFAULT_TIMEOUT_MS;
    const runProbeJsonPost = typeof options.probeJsonPost === 'function' ? options.probeJsonPost : probeJsonPost;

    let modelProbeSpec = modelProbeSpecs[0];
    let modelProbe = null;
    for (let index = 0; index < modelProbeSpecs.length; index += 1) {
        const candidate = modelProbeSpecs[index];
        const probeResult = await runProbeJsonPost(candidate.url, candidate.body, {
            apiKey: authValue,
            timeoutMs,
            maxBytes: JSON_RESPONSE_MAX_BYTES
        });
        modelProbeSpec = candidate;
        modelProbe = probeResult;
        const shouldTryNextCandidate = index < modelProbeSpecs.length - 1
            && (!probeResult.ok || probeResult.status === 404);
        if (!shouldTryNextCandidate) {
            break;
        }
    }

    summary.checks.modelProbe = {
        url: modelProbeSpec.url,
        ok: !!modelProbe.ok,
        status: Number.isFinite(modelProbe.status) ? modelProbe.status : 0,
        durationMs: Number.isFinite(modelProbe.durationMs) ? modelProbe.durationMs : 0
    };

    if (!modelProbe.ok) {
        issues.push({
            code: 'remote-model-probe-unreachable',
            message: `模型可用性探测失败：${modelProbe.error || '无法连接'}`,
            suggestion: '检查 endpoint、网络或模型接口是否可用'
        });
    } else if (modelProbe.status === 401 || modelProbe.status === 403) {
        issues.push({
            code: 'remote-model-probe-auth-failed',
            message: '模型可用性探测鉴权失败（401/403）',
            suggestion: '检查 API Key 或认证方式'
        });
    } else if (modelProbe.status === 404) {
        issues.push({
            code: 'remote-model-probe-not-found',
            message: '模型可用性探测返回 404',
            suggestion: '检查 base_url、接口路径或模型名'
        });
    } else if (modelProbe.status >= 400) {
        issues.push({
            code: 'remote-model-probe-http-error',
            message: `模型可用性探测返回异常状态: ${modelProbe.status}`,
            suggestion: '检查 endpoint、模型名或服务状态'
        });
    } else {
        let payload = null;
        try {
            payload = modelProbe.body ? JSON.parse(modelProbe.body) : null;
        } catch (e) {
            payload = null;
        }
        const payloadError = extractPayloadErrorMessage(payload);
        if (payloadError) {
            issues.push({
                code: 'remote-model-probe-error',
                message: `模型可用性探测失败：${payloadError}`,
                suggestion: '检查模型名与权限'
            });
        }
    }

    const primaryIssue = issues[0] || null;
    summary.ok = issues.length === 0;
    summary.statusCode = Number.isFinite(modelProbe.status) && modelProbe.status > 0
        ? modelProbe.status
        : null;
    summary.message = buildRemoteHealthMessage(
        primaryIssue ? primaryIssue.code : '',
        summary.statusCode,
        primaryIssue ? primaryIssue.message : ''
    );

    return { issues, remote: summary };
}

async function buildConfigHealthReport(params = {}, deps = {}) {
    const issues = [];
    const {
        readConfigOrVirtualDefault,
        readModels
    } = deps;

    if (typeof readConfigOrVirtualDefault !== 'function') {
        throw new Error('buildConfigHealthReport 缺少 readConfigOrVirtualDefault 依赖');
    }
    if (typeof readModels !== 'function') {
        throw new Error('buildConfigHealthReport 缺少 readModels 依赖');
    }

    const status = readConfigOrVirtualDefault();
    const config = status.config || {};

    if (status.isVirtual) {
        const parseFailed = status.errorType === 'parse';
        const readFailed = status.errorType === 'read';
        issues.push({
            code: parseFailed ? 'config-parse-failed' : (readFailed ? 'config-read-failed' : 'config-missing'),
            message: status.reason || (parseFailed
                ? 'config.toml 解析失败'
                : (readFailed ? '读取 config.toml 失败' : '未检测到 config.toml')),
            suggestion: parseFailed
                ? '修复 config.toml 语法错误后重试'
                : (readFailed ? '检查文件权限后重试' : '在模板编辑器中确认应用配置，生成可用的 config.toml')
        });
        if (parseFailed || readFailed) {
            return {
                ok: false,
                issues,
                summary: {
                    currentProvider: '',
                    currentModel: ''
                },
                remote: null
            };
        }
    }

    const providerName = typeof config.model_provider === 'string' ? config.model_provider.trim() : '';
    const modelName = typeof config.model === 'string' ? config.model.trim() : '';
    if (!providerName) {
        issues.push({
            code: 'provider-missing',
            message: '当前 provider 未设置',
            suggestion: '在模板中设置 model_provider'
        });
    }

    if (!modelName) {
        issues.push({
            code: 'model-missing',
            message: '当前模型未设置',
            suggestion: '在模板中设置 model'
        });
    }

    const providers = config.model_providers && typeof config.model_providers === 'object'
        ? config.model_providers
        : {};
    const provider = providerName ? providers[providerName] : null;
    if (providerName && !provider) {
        issues.push({
            code: 'provider-not-found',
            message: `当前 provider 未在配置中找到: ${providerName}`,
            suggestion: '检查 model_providers 是否包含该 provider 配置块'
        });
    }

    if (provider && typeof provider === 'object') {
        const baseUrl = typeof provider.base_url === 'string' ? provider.base_url.trim() : '';
        if (!isValidHttpUrl(baseUrl)) {
            issues.push({
                code: 'base-url-invalid',
                message: '当前 provider 的 base_url 无效',
                suggestion: '请设置为 http/https 的完整 URL'
            });
        }

        const requiresAuth = provider.requires_openai_auth;
        if (requiresAuth !== false) {
            const apiKey = typeof provider.preferred_auth_method === 'string'
                ? provider.preferred_auth_method.trim()
                : '';
            if (!apiKey) {
                issues.push({
                    code: 'api-key-missing',
                    message: '当前 provider 未配置 API Key',
                    suggestion: '在模板中设置 preferred_auth_method'
                });
            }
        }
    }

    if (modelName) {
        const models = readModels();
        if (!models.includes(modelName)) {
            issues.push({
                code: 'model-unavailable',
                message: `模型未在可用列表中找到: ${modelName}`,
                suggestion: '在模型列表中添加该模型或切换到已有模型'
            });
        }
    }

    let remote = null;
    if (params.remote) {
        if (!provider) {
            issues.push({
                code: 'remote-skip-provider',
                message: '无法进行远程探测：provider 未找到',
                suggestion: '检查 model_provider 配置或关闭远程探测'
            });
            remote = {
                type: 'remote-health-check',
                provider: providerName,
                endpoint: '',
                ok: false,
                statusCode: null,
                message: '无法进行远程探测：provider 未找到',
                checks: {}
            };
        } else {
            const remoteReport = await runRemoteHealthCheck(providerName, provider, modelName, {
                timeoutMs: Number.isFinite(params.timeoutMs) ? Number(params.timeoutMs) : undefined,
                probeJsonPost: deps.probeJsonPost
            });
            issues.push(...remoteReport.issues);
            remote = remoteReport.remote;
        }
    }

    return {
        ok: issues.length === 0,
        issues,
        summary: {
            currentProvider: providerName,
            currentModel: modelName
        },
        remote
    };
}

module.exports = {
    runRemoteHealthCheck,
    buildConfigHealthReport
};
