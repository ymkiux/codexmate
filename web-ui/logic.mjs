// 逻辑纯函数：供 Web UI 与单元测试共享
export const DEFAULT_API_BODY_LIMIT_BYTES = 4 * 1024 * 1024;

function measureUtf8ByteLength(input) {
    const text = typeof input === 'string' ? input : String(input ?? '');
    if (typeof TextEncoder === 'function') {
        return new TextEncoder().encode(text).length;
    }
    if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
        return Buffer.byteLength(text, 'utf8');
    }
    return unescape(encodeURIComponent(text)).length;
}

function buildApiRequestByteLength(action, params) {
    return measureUtf8ByteLength(JSON.stringify({ action, params }));
}

function normalizeDiffText(input) {
    const safe = typeof input === 'string' ? input : '';
    const withoutBom = safe.charCodeAt(0) === 0xFEFF ? safe.slice(1) : safe;
    return withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function splitDiffLines(input) {
    let normalized = normalizeDiffText(input);
    if (!normalized) return [];
    if (normalized.endsWith('\n')) {
        normalized = normalized.slice(0, -1);
    }
    if (!normalized) return [];
    return normalized.split('\n');
}

function buildDiffLcsMatrix(beforeLines, afterLines) {
    const rows = beforeLines.length + 1;
    const cols = afterLines.length + 1;
    const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let i = 1; i < rows; i += 1) {
        const beforeLine = beforeLines[i - 1];
        for (let j = 1; j < cols; j += 1) {
            if (beforeLine === afterLines[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1] + 1;
            } else {
                const up = matrix[i - 1][j];
                const left = matrix[i][j - 1];
                matrix[i][j] = up >= left ? up : left;
            }
        }
    }
    return matrix;
}

function countDiffStats(lines) {
    let added = 0;
    let removed = 0;
    let unchanged = 0;
    for (const line of lines) {
        if (line.type === 'add') {
            added += 1;
        } else if (line.type === 'del') {
            removed += 1;
        } else {
            unchanged += 1;
        }
    }
    return { added, removed, unchanged };
}

function buildCollapsedContextLine(hiddenCount) {
    return {
        type: 'context',
        value: `... ${hiddenCount} unchanged lines ...`,
        oldNumber: null,
        newNumber: null
    };
}

function compactContextRuns(lines, contextSize = 3) {
    const compacted = [];
    const keepCount = Number.isFinite(contextSize) ? Math.max(1, Math.floor(contextSize)) : 3;
    let index = 0;
    while (index < lines.length) {
        if (!lines[index] || lines[index].type !== 'context') {
            compacted.push(lines[index]);
            index += 1;
            continue;
        }
        const start = index;
        while (index < lines.length && lines[index] && lines[index].type === 'context') {
            index += 1;
        }
        const run = lines.slice(start, index);
        if (run.length <= keepCount * 2 + 1) {
            compacted.push(...run);
            continue;
        }
        compacted.push(...run.slice(0, keepCount));
        compacted.push(buildCollapsedContextLine(run.length - keepCount * 2));
        compacted.push(...run.slice(-keepCount));
    }
    return compacted;
}

function buildExactDiffLines(beforeLines, afterLines) {
    const matrix = buildDiffLcsMatrix(beforeLines, afterLines);
    const lines = [];
    let i = beforeLines.length;
    let j = afterLines.length;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
            lines.push({
                type: 'context',
                value: beforeLines[i - 1],
                oldNumber: i,
                newNumber: j
            });
            i -= 1;
            j -= 1;
            continue;
        }
        const canAdd = j > 0;
        const canDel = i > 0;
        if (canAdd && (!canDel || matrix[i][j - 1] >= matrix[i - 1][j])) {
            lines.push({
                type: 'add',
                value: afterLines[j - 1],
                oldNumber: null,
                newNumber: j
            });
            j -= 1;
            continue;
        }
        if (canDel) {
            lines.push({
                type: 'del',
                value: beforeLines[i - 1],
                oldNumber: i,
                newNumber: null
            });
            i -= 1;
        }
    }
    lines.reverse();
    return lines;
}

function findNextSyncPoint(beforeLines, afterLines, beforeIndex, afterIndex, lookahead = 64) {
    const maxBeforeOffset = Math.min(lookahead, beforeLines.length - beforeIndex - 1);
    const maxAfterOffset = Math.min(lookahead, afterLines.length - afterIndex - 1);

    for (let offset = 1; offset <= maxAfterOffset; offset += 1) {
        if (beforeLines[beforeIndex] === afterLines[afterIndex + offset]) {
            return { beforeIndex, afterIndex: afterIndex + offset };
        }
    }
    for (let offset = 1; offset <= maxBeforeOffset; offset += 1) {
        if (beforeLines[beforeIndex + offset] === afterLines[afterIndex]) {
            return { beforeIndex: beforeIndex + offset, afterIndex };
        }
    }

    const maxDistance = maxBeforeOffset + maxAfterOffset;
    for (let distance = 2; distance <= maxDistance; distance += 1) {
        const beforeStart = Math.max(1, distance - maxAfterOffset);
        const beforeEnd = Math.min(maxBeforeOffset, distance - 1);
        for (let beforeOffset = beforeStart; beforeOffset <= beforeEnd; beforeOffset += 1) {
            const afterOffset = distance - beforeOffset;
            if (beforeLines[beforeIndex + beforeOffset] === afterLines[afterIndex + afterOffset]) {
                return {
                    beforeIndex: beforeIndex + beforeOffset,
                    afterIndex: afterIndex + afterOffset
                };
            }
        }
    }
    return null;
}

function buildLargeDiffLines(beforeLines, afterLines) {
    const rawLines = [];
    let beforeIndex = 0;
    let afterIndex = 0;

    while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
        if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
            rawLines.push({
                type: 'context',
                value: beforeLines[beforeIndex],
                oldNumber: beforeIndex + 1,
                newNumber: afterIndex + 1
            });
            beforeIndex += 1;
            afterIndex += 1;
            continue;
        }

        const syncPoint = findNextSyncPoint(beforeLines, afterLines, beforeIndex, afterIndex);
        if (!syncPoint) {
            rawLines.push({
                type: 'del',
                value: beforeLines[beforeIndex],
                oldNumber: beforeIndex + 1,
                newNumber: null
            });
            rawLines.push({
                type: 'add',
                value: afterLines[afterIndex],
                oldNumber: null,
                newNumber: afterIndex + 1
            });
            beforeIndex += 1;
            afterIndex += 1;
            continue;
        }

        while (beforeIndex < syncPoint.beforeIndex) {
            rawLines.push({
                type: 'del',
                value: beforeLines[beforeIndex],
                oldNumber: beforeIndex + 1,
                newNumber: null
            });
            beforeIndex += 1;
        }
        while (afterIndex < syncPoint.afterIndex) {
            rawLines.push({
                type: 'add',
                value: afterLines[afterIndex],
                oldNumber: null,
                newNumber: afterIndex + 1
            });
            afterIndex += 1;
        }
    }

    while (beforeIndex < beforeLines.length) {
        rawLines.push({
            type: 'del',
            value: beforeLines[beforeIndex],
            oldNumber: beforeIndex + 1,
            newNumber: null
        });
        beforeIndex += 1;
    }
    while (afterIndex < afterLines.length) {
        rawLines.push({
            type: 'add',
            value: afterLines[afterIndex],
            oldNumber: null,
            newNumber: afterIndex + 1
        });
        afterIndex += 1;
    }

    return {
        lines: compactContextRuns(rawLines),
        stats: countDiffStats(rawLines)
    };
}

export function buildLineDiff(beforeText, afterText) {
    const beforeLines = splitDiffLines(beforeText);
    const afterLines = splitDiffLines(afterText);
    const lineLimit = 3000;
    const result = (beforeLines.length > lineLimit || afterLines.length > lineLimit)
        ? buildLargeDiffLines(beforeLines, afterLines)
        : {
            lines: buildExactDiffLines(beforeLines, afterLines),
            stats: null
        };
    const stats = result.stats || countDiffStats(result.lines);
    return {
        lines: result.lines,
        stats,
        oldLineCount: beforeLines.length,
        newLineCount: afterLines.length,
        truncated: false
    };
}

export function buildAgentsDiffPreview(options = {}) {
    const beforeText = normalizeDiffText(options.baseContent);
    const afterText = normalizeDiffText(options.content);
    const diff = buildLineDiff(beforeText, afterText);
    return {
        ...diff,
        truncated: !!diff.truncated,
        hasChanges: diff.truncated
            ? beforeText !== afterText
            : (diff.stats.added > 0 || diff.stats.removed > 0)
    };
}

export function buildAgentsDiffPreviewRequest(options = {}) {
    const contextRaw = typeof options.context === 'string' ? options.context.trim() : '';
    const context = contextRaw || 'codex';
    const params = {
        content: typeof options.content === 'string' ? options.content : '',
        lineEnding: options.lineEnding === '\r\n' ? '\r\n' : '\n',
        context
    };
    if (context === 'openclaw-workspace') {
        const fileName = typeof options.fileName === 'string' ? options.fileName.trim() : '';
        if (fileName) {
            params.fileName = fileName;
        }
    }

    const maxRequestBytes = Number.isFinite(options.maxRequestBytes)
        ? Math.max(1024, Math.floor(options.maxRequestBytes))
        : DEFAULT_API_BODY_LIMIT_BYTES;
    const hasBaseContent = typeof options.baseContent === 'string';
    const paramsWithBaseContent = hasBaseContent
        ? { ...params, baseContent: options.baseContent }
        : params;
    if (!hasBaseContent) {
        return {
            params,
            omittedBaseContent: false,
            exceedsBodyLimit: buildApiRequestByteLength('preview-agents-diff', params) > maxRequestBytes
        };
    }
    if (buildApiRequestByteLength('preview-agents-diff', paramsWithBaseContent) <= maxRequestBytes) {
        return {
            params: paramsWithBaseContent,
            omittedBaseContent: false,
            exceedsBodyLimit: false
        };
    }
    return {
        params,
        omittedBaseContent: true,
        exceedsBodyLimit: buildApiRequestByteLength('preview-agents-diff', params) > maxRequestBytes
    };
}

export function normalizeClaudeValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeClaudeConfig(config) {
    const safe = config && typeof config === 'object' ? config : {};
    return {
        apiKey: normalizeClaudeValue(safe.apiKey),
        baseUrl: normalizeClaudeValue(safe.baseUrl),
        model: normalizeClaudeValue(safe.model),
        authToken: normalizeClaudeValue(safe.authToken),
        useKey: normalizeClaudeValue(safe.useKey),
        externalCredentialType: normalizeClaudeValue(safe.externalCredentialType)
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

// Session filtering helpers
export function isSessionQueryEnabled(source) {
    const normalized = normalizeSessionSource(source, '');
    return normalized === 'codex' || normalized === 'claude' || normalized === 'all';
}

export function normalizeSessionSource(source, fallback = 'all') {
    const normalized = typeof source === 'string'
        ? source.trim().toLowerCase()
        : '';
    if (normalized === 'codex' || normalized === 'claude' || normalized === 'all') {
        return normalized;
    }
    return fallback;
}

export function normalizeSessionPathFilter(pathFilter) {
    return typeof pathFilter === 'string' ? pathFilter.trim() : '';
}

export function buildSessionFilterCacheState(source, pathFilter) {
    return {
        source: normalizeSessionSource(source, 'all'),
        pathFilter: normalizeSessionPathFilter(pathFilter)
    };
}

export function buildSessionListParams(options = {}) {
    const {
        source = 'all',
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

export function normalizeSessionMessageRole(role) {
    const value = typeof role === 'string' ? role.trim().toLowerCase() : '';
    if (value === 'user' || value === 'assistant' || value === 'system') {
        return value;
    }
    return 'assistant';
}

function toRoleMeta(role) {
    if (role === 'user') {
        return { role: 'user', roleLabel: 'User', roleShort: 'U' };
    }
    if (role === 'assistant') {
        return { role: 'assistant', roleLabel: 'Assistant', roleShort: 'A' };
    }
    if (role === 'system') {
        return { role: 'system', roleLabel: 'System', roleShort: 'S' };
    }
    return { role: 'mixed', roleLabel: 'Mixed', roleShort: 'M' };
}

function clampTimelinePercent(percent) {
    return Math.max(6, Math.min(94, percent));
}

export function formatSessionTimelineTimestamp(timestamp) {
    const value = typeof timestamp === 'string' ? timestamp.trim() : '';
    if (!value) return '';

    // 优先按 ISO/常见时间串抽取，避免本地时区格式差异导致的展示抖动。
    const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (matched) {
        const second = matched[6] || '00';
        return `${matched[2]}-${matched[3]} ${matched[4]}:${matched[5]}:${second}`;
    }

    return value;
}

export function buildSessionTimelineNodes(messages = [], options = {}) {
    const list = Array.isArray(messages) ? messages : [];
    const getKey = typeof options.getKey === 'function'
        ? options.getKey
        : ((_message, index) => `msg-${index}`);
    const total = list.length;
    const rawMaxMarkers = Number(options.maxMarkers);
    const maxMarkers = Number.isFinite(rawMaxMarkers)
        ? Math.max(1, Math.min(80, Math.floor(rawMaxMarkers)))
        : 30;

    const buildSingleNode = (message, index) => {
        const role = normalizeSessionMessageRole(message && (message.normalizedRole || message.role));
        const roleMeta = toRoleMeta(role);
        const key = String(getKey(message, index) || `msg-${index}`);
        const displayTime = formatSessionTimelineTimestamp(message && message.timestamp ? message.timestamp : '');
        const title = displayTime
            ? `#${index + 1} · ${roleMeta.roleLabel} · ${displayTime}`
            : `#${index + 1} · ${roleMeta.roleLabel}`;
        const percent = total <= 1 ? 0 : (index / (total - 1)) * 100;
        return {
            key,
            role: roleMeta.role,
            roleLabel: roleMeta.roleLabel,
            roleShort: roleMeta.roleShort,
            displayTime,
            title,
            percent,
            safePercent: clampTimelinePercent(percent)
        };
    };

    if (total <= maxMarkers) {
        return list.map((message, index) => buildSingleNode(message, index));
    }

    const nodes = [];
    const bucketWidth = total / maxMarkers;
    for (let bucket = 0; bucket < maxMarkers; bucket += 1) {
        let start = Math.floor(bucket * bucketWidth);
        if (nodes.length && start <= nodes[nodes.length - 1].endIndex) {
            start = nodes[nodes.length - 1].endIndex + 1;
        }
        if (start >= total) {
            break;
        }
        let end = Math.floor((bucket + 1) * bucketWidth) - 1;
        end = Math.max(start, Math.min(total - 1, end));
        const targetIndex = Math.min(total - 1, start + Math.floor((end - start) / 2));
        const targetMessage = list[targetIndex] || null;
        const key = String(getKey(targetMessage, targetIndex) || `msg-${targetIndex}`);
        const percent = total <= 1 ? 0 : (targetIndex / (total - 1)) * 100;
        const messagesInGroup = end - start + 1;
        const roleSet = new Set();
        for (let i = start; i <= end; i += 1) {
            roleSet.add(normalizeSessionMessageRole(list[i] && (list[i].normalizedRole || list[i].role)));
        }
        const roleValue = roleSet.size === 1 ? Array.from(roleSet)[0] : 'mixed';
        const roleMeta = toRoleMeta(roleValue);
        const firstTime = formatSessionTimelineTimestamp(list[start] && list[start].timestamp ? list[start].timestamp : '');
        const lastTime = formatSessionTimelineTimestamp(list[end] && list[end].timestamp ? list[end].timestamp : '');
        let displayTime = '';
        if (firstTime && lastTime) {
            displayTime = firstTime === lastTime ? firstTime : `${firstTime} ~ ${lastTime}`;
        } else {
            displayTime = firstTime || lastTime;
        }
        const titleBase = `#${start + 1}-${end + 1} · ${messagesInGroup} msgs · ${roleMeta.roleLabel}`;
        const title = displayTime ? `${titleBase} · ${displayTime}` : titleBase;
        nodes.push({
            key,
            role: roleMeta.role,
            roleLabel: roleMeta.roleLabel,
            roleShort: roleMeta.roleShort,
            displayTime,
            title,
            percent,
            safePercent: clampTimelinePercent(percent),
            startIndex: start,
            endIndex: end,
            messageCount: messagesInGroup
        });
    }
    return nodes;
}
