export const DEFAULT_SESSION_LIST_LIMIT = 200;
export const DEFAULT_SESSION_LIST_FAST_LIMIT = 20;

function shouldUseFastSessionBrowseLimit(options = {}) {
    if (options.forceRefresh) {
        return false;
    }
    const normalizedSource = normalizeSessionSource(options.source, 'all');
    if (normalizedSource !== 'all') {
        return false;
    }
    const pathFilter = normalizeSessionPathFilter(options.pathFilter);
    if (pathFilter) {
        return false;
    }
    const query = typeof options.query === 'string' ? options.query.trim() : '';
    if (query) {
        return false;
    }
    const roleFilter = typeof options.roleFilter === 'string' ? options.roleFilter.trim().toLowerCase() : 'all';
    if (roleFilter && roleFilter !== 'all') {
        return false;
    }
    const timeRangePreset = typeof options.timeRangePreset === 'string'
        ? options.timeRangePreset.trim().toLowerCase()
        : 'all';
    return !timeRangePreset || timeRangePreset === 'all';
}

export function isSessionQueryEnabled(source) {
    const normalized = normalizeSessionSource(source, '');
    return normalized === 'codex' || normalized === 'claude' || normalized === 'gemini' || normalized === 'codebuddy' || normalized === 'all';
}

export function normalizeSessionSource(source, fallback = 'all') {
    const normalized = typeof source === 'string'
        ? source.trim().toLowerCase()
        : '';
    if (normalized === 'codex' || normalized === 'claude' || normalized === 'gemini' || normalized === 'codebuddy' || normalized === 'all') {
        return normalized;
    }
    return fallback;
}

export function normalizeSessionPathFilter(pathFilter) {
    return typeof pathFilter === 'string' ? pathFilter.trim() : '';
}

function isConcreteSessionModelName(value) {
    if (typeof value !== 'string') {
        return false;
    }
    const normalized = value.trim();
    if (!normalized) {
        return false;
    }
    return normalized.toLowerCase() !== '<synthetic>';
}

function collectSessionModelNames(session) {
    if (!session || typeof session !== 'object') {
        return [];
    }
    const values = Array.isArray(session.models)
        ? [...session.models, session.model, session.modelName, session.modelId]
        : [session.model, session.modelName, session.modelId];
    const models = [];
    for (const value of values) {
        if (!isConcreteSessionModelName(value)) {
            continue;
        }
        const normalized = value.trim();
        if (models.includes(normalized)) {
            continue;
        }
        models.push(normalized);
    }
    return models;
}

function readSessionTotalTokens(session) {
    if (!session || typeof session !== 'object') {
        return 0;
    }

    const rawTotalTokens = Number(session.totalTokens);
    const hasExplicitTotal = Number.isFinite(rawTotalTokens) && rawTotalTokens >= 0;
    const explicitTotal = hasExplicitTotal ? Math.max(0, Math.floor(rawTotalTokens)) : null;

    const inputTokens = Number.isFinite(Number(session.inputTokens))
        ? Math.max(0, Math.floor(Number(session.inputTokens)))
        : null;
    const outputTokens = Number.isFinite(Number(session.outputTokens))
        ? Math.max(0, Math.floor(Number(session.outputTokens)))
        : null;
    const reasoningOutputTokens = Number.isFinite(Number(session.reasoningOutputTokens))
        ? Math.max(0, Math.floor(Number(session.reasoningOutputTokens)))
        : 0;

    // 对齐 usage 口径：当总 token 缺失时，使用拆分字段回填（input + output + reasoning）。
    // cachedInputTokens 一般包含在 inputTokens 中，因此不在此重复相加。
    const hasBreakdown = !(inputTokens === null && outputTokens === null && reasoningOutputTokens === 0);
    const breakdownTotal = hasBreakdown
        ? (inputTokens || 0) + (outputTokens || 0) + reasoningOutputTokens
        : 0;

    if (breakdownTotal > 0) {
        return breakdownTotal;
    }
    if (explicitTotal !== null) {
        return explicitTotal;
    }
    return 0;
}

export function buildSessionFilterCacheState(source, pathFilter) {
    return {
        source: normalizeSessionSource(source, 'all'),
        pathFilter: normalizeSessionPathFilter(pathFilter)
    };
}

export function buildSessionListParams(options = {}) {
    const fallbackLimit = shouldUseFastSessionBrowseLimit(options)
        ? DEFAULT_SESSION_LIST_FAST_LIMIT
        : DEFAULT_SESSION_LIST_LIMIT;
    const {
        source = 'all',
        pathFilter = '',
        query = '',
        roleFilter = 'all',
        timeRangePreset = 'all',
        limit = fallbackLimit,
        forceRefresh = false
    } = options;
    const normalizedSource = normalizeSessionSource(source, 'all');
    const normalizedPathFilter = normalizeSessionPathFilter(pathFilter);
    const queryValue = isSessionQueryEnabled(normalizedSource) ? query : '';
    return {
        source: normalizedSource,
        pathFilter: normalizedPathFilter,
        query: queryValue,
        queryMode: 'and',
        queryScope: 'content',
        contentScanLimit: 50,
        roleFilter,
        timeRangePreset,
        limit,
        forceRefresh: !!forceRefresh
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

    const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (matched) {
        const second = matched[6] || '00';
        return `${matched[2]}-${matched[3]} ${matched[4]}:${matched[5]}:${second}`;
    }

    return value;
}

function normalizeUsageRange(range) {
    const normalized = typeof range === 'string' ? range.trim().toLowerCase() : '7d';
    if (normalized === '30d' || normalized === 'all') {
        return normalized;
    }
    return '7d';
}

function toUtcDayStartMs(value) {
    const stamp = new Date(value);
    return Date.UTC(stamp.getUTCFullYear(), stamp.getUTCMonth(), stamp.getUTCDate());
}

function formatUtcDayKey(value) {
    const stamp = new Date(value);
    return `${stamp.getUTCFullYear()}-${String(stamp.getUTCMonth() + 1).padStart(2, '0')}-${String(stamp.getUTCDate()).padStart(2, '0')}`;
}

export function buildUsageHeatmap(sessions = [], options = {}) {
    const list = Array.isArray(sessions) ? sessions : [];
    const normalized = [];
    for (const session of list) {
        if (!session || typeof session !== 'object') continue;
        const source = normalizeSessionSource(session.source, '');
        if (source !== 'codex' && source !== 'claude') continue;
        const updatedAtMs = Date.parse(session.updatedAt || '');
        if (!Number.isFinite(updatedAtMs)) continue;
        normalized.push({
            updatedAtMs,
            messageCount: Number.isFinite(Number(session.messageCount))
                ? Math.max(0, Math.floor(Number(session.messageCount)))
                : 0,
            tokenTotal: readSessionTotalTokens(session)
        });
    }

    const range = normalizeUsageRange(options.range);
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const todayStart = toUtcDayStartMs(now);
    let startDay = todayStart;
    let endDay = todayStart;
    if (range === 'all') {
        const dayStarts = normalized.map((item) => toUtcDayStartMs(item.updatedAtMs)).filter((value) => Number.isFinite(value));
        if (dayStarts.length) {
            startDay = Math.min(...dayStarts);
            endDay = Math.max(...dayStarts);
        }
    } else {
        const rangeDays = range === '30d' ? 30 : 7;
        endDay = todayStart;
        startDay = todayStart - ((rangeDays - 1) * dayMs);
    }

    const startDow = new Date(startDay).getUTCDay();
    const startShift = (startDow + 6) % 7;
    const alignedStart = startDay - (startShift * dayMs);
    const endDow = new Date(endDay).getUTCDay();
    const endShift = (6 - ((endDow + 6) % 7));
    const alignedEnd = endDay + (endShift * dayMs);
    const totalDays = Math.floor((alignedEnd - alignedStart) / dayMs) + 1;
    const weekCount = Math.max(1, Math.ceil(totalDays / 7));

    const byDay = new Map();
    for (const item of normalized) {
        const dayKey = formatUtcDayKey(item.updatedAtMs);
        const existing = byDay.get(dayKey) || { sessionCount: 0, messageCount: 0, tokenTotal: 0 };
        existing.sessionCount += 1;
        existing.messageCount += item.messageCount;
        existing.tokenTotal += item.tokenTotal;
        byDay.set(dayKey, existing);
    }

    const weeks = Array.from({ length: weekCount }, (_, idx) => ({
        key: `w-${idx}`,
        days: Array.from({ length: 7 }, () => null)
    }));

    let maxSessionCount = 0;
    for (let dayIndex = 0; dayIndex < totalDays; dayIndex += 1) {
        const dateMs = alignedStart + (dayIndex * dayMs);
        const dateKey = formatUtcDayKey(dateMs);
        const isInRange = dateMs >= startDay && dateMs <= endDay;
        const weekIndex = Math.floor(dayIndex / 7);
        const dow = new Date(dateMs).getUTCDay();
        const rowIndex = (dow + 6) % 7;
        const totals = isInRange ? (byDay.get(dateKey) || { sessionCount: 0, messageCount: 0, tokenTotal: 0 }) : null;
        const sessionCount = totals ? totals.sessionCount : 0;
        if (isInRange) {
            maxSessionCount = Math.max(maxSessionCount, sessionCount);
        }
        weeks[weekIndex].days[rowIndex] = {
            dateKey,
            dateMs,
            isInRange,
            sessionCount,
            messageCount: totals ? totals.messageCount : 0,
            tokenTotal: totals ? totals.tokenTotal : 0
        };
    }

    return {
        range,
        startDay,
        endDay,
        alignedStart,
        alignedEnd,
        maxSessionCount,
        weeks
    };
}

function buildUsageBuckets(normalizedSessions, options = {}) {
    const range = normalizeUsageRange(options.range);
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const buckets = [];

    if (range === 'all') {
        const validDayStarts = normalizedSessions
            .map((session) => toUtcDayStartMs(session.updatedAtMs))
            .filter((value) => Number.isFinite(value));
        const firstDayStart = validDayStarts.length ? Math.min(...validDayStarts) : toUtcDayStartMs(now);
        const lastDayStart = validDayStarts.length ? Math.max(...validDayStarts) : toUtcDayStartMs(now);
        for (let stamp = firstDayStart; stamp <= lastDayStart; stamp += dayMs) {
            const key = formatUtcDayKey(stamp);
            buckets.push({
                key,
                label: key.slice(5),
                codex: 0,
                claude: 0,
                totalMessages: 0,
                totalSessions: 0
            });
        }
        return { range, buckets };
    }

    const rangeDays = range === '30d' ? 30 : 7;
    for (let i = rangeDays - 1; i >= 0; i -= 1) {
        const stamp = new Date(now - (i * dayMs));
        const key = formatUtcDayKey(stamp);
        buckets.push({
            key,
            label: key.slice(5),
            codex: 0,
            claude: 0,
            totalMessages: 0,
            totalSessions: 0
        });
    }
    return { range, buckets };
}

export function buildUsageChartGroups(sessions = [], options = {}) {
    const list = Array.isArray(sessions) ? sessions : [];
    const normalizedSessions = [];
    for (const [sessionIndex, session] of list.entries()) {
        if (!session || typeof session !== 'object') continue;
        const source = normalizeSessionSource(session.source, '');
        if (source !== 'codex' && source !== 'claude') continue;
        const updatedAtMs = Date.parse(session.updatedAt || '');
        if (!Number.isFinite(updatedAtMs)) continue;
        const createdAtMs = Date.parse(session.createdAt || '');
        const sessionStartedAtMs = Number.isFinite(createdAtMs) ? createdAtMs : updatedAtMs;
        const sessionEndedAtMs = Math.max(updatedAtMs, sessionStartedAtMs);
        normalizedSessions.push({
            session,
            sessionIndex,
            source,
            updatedAtMs,
            createdAtMs,
            sessionStartedAtMs,
            sessionEndedAtMs,
            bucketKey: formatUtcDayKey(updatedAtMs)
        });
    }
    const { range, buckets } = buildUsageBuckets(normalizedSessions, options);
    const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    let codexTotal = 0;
    let claudeTotal = 0;
    let messageTotal = 0;
    let totalTokens = 0;
    let totalContextWindow = 0;
    let activeDurationMs = 0;
    let earliestSessionMs = Number.POSITIVE_INFINITY;
    let latestSessionMs = 0;
    const pathMap = new Map();
    const modelMap = new Map();
    const missingModelProviderMap = new Map();
    const missingModelSessionMap = new Map();
    const sourceMessageTotals = { codex: 0, claude: 0 };
    const missingModelSourceTotals = { codex: 0, claude: 0 };
    let missingModelSessions = 0;
    let providerOnlySessions = 0;
    const hourCounts = Array.from({ length: 24 }, (_, hour) => ({
        key: String(hour).padStart(2, '0'),
        label: String(hour).padStart(2, '0'),
        count: 0
    }));
    const weekdayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const weekdayCounts = Array.from({ length: 7 }, (_, index) => ({
        key: String(index),
        label: weekdayLabels[index],
        count: 0
    }));
    const recentSessions = [];
    const topSessionsByMessages = [];
    const filteredSessions = [];

    for (const normalized of normalizedSessions) {
        const { session, sessionIndex, source, updatedAtMs, sessionStartedAtMs, sessionEndedAtMs, bucketKey } = normalized;
        const stamp = new Date(updatedAtMs);
        const bucket = bucketMap.get(bucketKey);
        if (!bucket) continue;
        const sessionModels = collectSessionModelNames(session);
        if (sessionModels.length === 0) continue;
        filteredSessions.push(session);
        const messageCount = Number.isFinite(Number(session.messageCount))
            ? Math.max(0, Math.floor(Number(session.messageCount)))
            : 0;
        const sessionTotalTokens = readSessionTotalTokens(session);
        const sessionContextWindow = Number.isFinite(Number(session.contextWindow))
            ? Math.max(0, Math.floor(Number(session.contextWindow)))
            : 0;
        bucket.totalSessions += 1;
        bucket.totalMessages += messageCount;
        if (source === 'codex') {
            bucket.codex += 1;
            codexTotal += 1;
        } else {
            bucket.claude += 1;
            claudeTotal += 1;
        }
        messageTotal += messageCount;
        totalTokens += sessionTotalTokens;
        totalContextWindow += sessionContextWindow;
        sourceMessageTotals[source] += messageCount;
        activeDurationMs += Math.max(0, sessionEndedAtMs - sessionStartedAtMs);
        earliestSessionMs = Math.min(earliestSessionMs, sessionStartedAtMs);
        latestSessionMs = Math.max(latestSessionMs, sessionEndedAtMs);

        const utcHour = stamp.getUTCHours();
        if (hourCounts[utcHour]) {
            hourCounts[utcHour].count += 1;
        }
        const dayIndex = (stamp.getUTCDay() + 6) % 7;
        if (weekdayCounts[dayIndex]) {
            weekdayCounts[dayIndex].count += 1;
        }

        const cwd = normalizeSessionPathFilter(session.cwd);
        if (cwd) {
            const prev = pathMap.get(cwd) || { count: 0, messageTotal: 0, updatedAtMs: 0 };
            pathMap.set(cwd, {
                count: prev.count + 1,
                messageTotal: prev.messageTotal + messageCount,
                updatedAtMs: Math.max(prev.updatedAtMs, updatedAtMs)
            });
        }

        const sourceLabel = source === 'codex' ? 'Codex' : 'Claude Code';
        const normalizedTitle = typeof session.title === 'string' && session.title.trim()
            ? session.title.trim()
            : (typeof session.sessionId === 'string' && session.sessionId.trim() ? session.sessionId.trim() : '未命名会话');
        for (const modelId of sessionModels) {
            const prev = modelMap.get(modelId) || {
                count: 0,
                messageTotal: 0,
                tokenTotal: 0,
                sources: new Set()
            };
            prev.count += 1;
            prev.messageTotal += messageCount;
            prev.tokenTotal += sessionTotalTokens;
            prev.sources.add(source);
            modelMap.set(modelId, prev);
        }

        const sessionEntry = {
            key: [
                source,
                session.sessionId || '',
                session.filePath || normalizedTitle,
                String(updatedAtMs),
                String(messageCount),
                String(sessionIndex)
            ].join(':'),
            title: normalizedTitle,
            source,
            sourceLabel,
            cwd,
            messageCount,
            updatedAt: session.updatedAt || '',
            updatedAtMs,
            updatedAtLabel: formatSessionTimelineTimestamp(session.updatedAt || ''),
            hasExactMessageCount: session.__messageCountExact === true
        };
        recentSessions.push(sessionEntry);
        topSessionsByMessages.push({ ...sessionEntry });
    }

    const totalSessions = codexTotal + claudeTotal;
    const sourceShare = [
        { key: 'codex', label: 'Codex', value: codexTotal },
        { key: 'claude', label: 'Claude', value: claudeTotal }
    ].map((item) => ({
        ...item,
        percent: totalSessions > 0 ? Math.round((item.value / totalSessions) * 100) : 0,
        messageTotal: sourceMessageTotals[item.key] || 0,
        messagePercent: messageTotal > 0 ? Math.round(((sourceMessageTotals[item.key] || 0) / messageTotal) * 100) : 0,
        avgMessages: item.value > 0 ? Math.round(((sourceMessageTotals[item.key] || 0) / item.value) * 10) / 10 : 0
    }));

    const topPaths = [...pathMap.entries()]
        .sort((a, b) => b[1].count - a[1].count || b[1].messageTotal - a[1].messageTotal || a[0].localeCompare(b[0], 'zh-Hans-CN'))
        .slice(0, 5)
        .map(([pathValue, meta]) => ({
            path: pathValue,
            count: meta.count,
            messageTotal: meta.messageTotal,
            updatedAtLabel: meta.updatedAtMs ? formatSessionTimelineTimestamp(new Date(meta.updatedAtMs).toISOString()) : ''
        }));

    const usedModels = [...modelMap.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([modelId, meta]) => {
            const sourceLabels = [...meta.sources]
                .sort((a, b) => a.localeCompare(b, 'en-US'))
                .map((source) => (source === 'codex' ? 'Codex' : 'Claude Code'));
            return {
                key: modelId,
                model: modelId,
                count: meta.count,
                messageTotal: meta.messageTotal,
                tokenTotal: meta.tokenTotal,
                sourceLabels
            };
        });

    const sortedRecentSessions = recentSessions
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs || b.messageCount - a.messageCount || a.title.localeCompare(b.title, 'zh-Hans-CN'))
        .slice(0, 6);

    const missingModelProviders = [...missingModelProviderMap.values()]
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hans-CN'));
    const missingModelSessionsPreview = [...missingModelSessionMap.values()]
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.title.localeCompare(b.title, 'zh-Hans-CN'))
        .slice(0, 5);

    const modelCoverage = {
        totalSessions,
        modeledSessions: Math.max(0, totalSessions - missingModelSessions),
        missingModelSessions,
        providerOnlySessions,
        missingModelSourceTotals,
        missingModelProviders,
        missingModelSessionsPreview,
        coveragePercent: totalSessions > 0 ? Math.round(((totalSessions - missingModelSessions) / totalSessions) * 100) : 0
    };

    const sortedTopSessionsByMessages = topSessionsByMessages
        .sort((a, b) => b.messageCount - a.messageCount || b.updatedAtMs - a.updatedAtMs || a.title.localeCompare(b.title, 'zh-Hans-CN'))
        .slice(0, 6);

    const maxSessionBucket = buckets.reduce((max, item) => Math.max(max, item.totalSessions), 0);
    const maxMessageBucket = buckets.reduce((max, item) => Math.max(max, item.totalMessages), 0);
    const maxHourCount = hourCounts.reduce((max, item) => Math.max(max, item.count), 0);
    const maxWeekdayCount = weekdayCounts.reduce((max, item) => Math.max(max, item.count), 0);
    const busiestDay = [...buckets]
        .sort((a, b) => b.totalSessions - a.totalSessions || b.totalMessages - a.totalMessages || a.key.localeCompare(b.key, 'zh-Hans-CN'))[0] || null;
    const busiestHour = [...hourCounts]
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'zh-Hans-CN'))[0] || null;
    const activeDays = buckets.filter((item) => item.totalSessions > 0).length;
    const avgMessagesPerSession = totalSessions > 0 ? Math.round((messageTotal / totalSessions) * 10) / 10 : 0;
    const avgSessionsPerActiveDay = activeDays > 0 ? Math.round((totalSessions / activeDays) * 10) / 10 : 0;
    const totalDurationMs = Number.isFinite(earliestSessionMs) && latestSessionMs > 0
        ? Math.max(0, latestSessionMs - earliestSessionMs)
        : 0;

    return {
        range,
        buckets,
        filteredSessions,
        summary: {
            totalSessions,
            totalMessages: messageTotal,
            totalTokens,
            totalContextWindow,
            activeDurationMs,
            totalDurationMs,
            codexTotal,
            claudeTotal,
            activeDays,
            avgMessagesPerSession,
            avgSessionsPerActiveDay,
            busiestDay: busiestDay
                ? {
                    key: busiestDay.key,
                    label: busiestDay.label,
                    totalSessions: busiestDay.totalSessions,
                    totalMessages: busiestDay.totalMessages
                }
                : null,
            busiestHour: busiestHour
                ? {
                    key: busiestHour.key,
                    label: `${busiestHour.label}:00`,
                    count: busiestHour.count
                }
                : null
        },
        sourceShare,
        usedModels,
        modelCoverage,
        topPaths,
        recentSessions: sortedRecentSessions,
        topSessionsByMessages: sortedTopSessionsByMessages,
        hourActivity: hourCounts.map((item) => ({
            ...item,
            percent: maxHourCount > 0 ? Math.round((item.count / maxHourCount) * 100) : 0
        })),
        weekdayActivity: weekdayCounts.map((item) => ({
            ...item,
            percent: maxWeekdayCount > 0 ? Math.round((item.count / maxWeekdayCount) * 100) : 0
        })),
        maxSessionBucket,
        maxMessageBucket,
        maxHourCount,
        maxWeekdayCount
    };
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
