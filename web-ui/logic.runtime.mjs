export function formatLatency(result) {
    if (!result) return '';
    if (!result.ok) return result.status ? `ERR ${result.status}` : 'ERR';
    const ms = (typeof result.durationMs === 'number' && Number.isFinite(result.durationMs))
        ? result.durationMs
        : 0;
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

export async function runLatestOnlyQueue(initialTarget, options = {}) {
    const perform = typeof options.perform === 'function'
        ? options.perform
        : async () => {};
    const consumePending = typeof options.consumePending === 'function'
        ? options.consumePending
        : () => '';
    let currentTarget = typeof initialTarget === 'string' ? initialTarget.trim() : '';
    let lastError = '';

    while (currentTarget) {
        try {
            await perform(currentTarget);
            lastError = '';
        } catch (e) {
            lastError = e && e.message ? e.message : 'queue task failed';
        }
        const queued = String(consumePending() || '').trim();
        if (!queued || queued === currentTarget) {
            break;
        }
        currentTarget = queued;
    }

    return {
        lastTarget: currentTarget,
        lastError
    };
}

export function shouldForceCompactLayoutMode(options = {}) {
    const viewportWidth = Number(options.viewportWidth || 0);
    const screenWidth = Number(options.screenWidth || 0);
    const screenHeight = Number(options.screenHeight || 0);
    const shortEdge = Number(options.shortEdge || (screenWidth > 0 && screenHeight > 0 ? Math.min(screenWidth, screenHeight) : 0));
    const maxTouchPoints = Number(options.maxTouchPoints || 0);
    const userAgent = typeof options.userAgent === 'string' ? options.userAgent : '';
    const isMobileUa = typeof options.isMobileUa === 'boolean'
        ? options.isMobileUa
        : /(Android|iPhone|iPad|iPod|Mobile)/i.test(userAgent);
    const coarsePointer = !!options.coarsePointer;
    const noHover = !!options.noHover;
    const isSmallPhysicalScreen = shortEdge > 0 && shortEdge <= 920;
    const isNarrowViewport = viewportWidth > 0 && viewportWidth <= 960;
    const pointerSuggestsTouchOnly = coarsePointer && noHover;

    if (isMobileUa) {
        return isNarrowViewport || isSmallPhysicalScreen;
    }
    if (!pointerSuggestsTouchOnly) {
        return false;
    }
    if (maxTouchPoints <= 0) {
        return false;
    }
    return isSmallPhysicalScreen;
}
