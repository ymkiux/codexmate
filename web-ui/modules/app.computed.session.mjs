import {
    buildSessionTimelineNodes,
    buildUsageChartGroups,
    isSessionQueryEnabled
} from '../logic.mjs';
import { SESSION_TRASH_PAGE_SIZE } from './app.constants.mjs';

function formatUsageSummaryNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        return '0';
    }
    return Math.floor(numeric).toLocaleString('en-US');
}

function formatCompactUsageSummaryNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        return '0';
    }
    return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        compactDisplay: 'short',
        maximumFractionDigits: 1
    }).format(Math.floor(numeric));
}

function readUsageCostNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        return null;
    }
    return numeric;
}

function formatUsageEstimatedCost(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return '$0.00';
    }
    if (numeric < 0.01) {
        return '<$0.01';
    }
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: numeric >= 100 ? 0 : 2,
        maximumFractionDigits: numeric >= 100 ? 0 : 2
    }).format(numeric);
}

function formatUsageDuration(value, options = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return '0分';
    }
    const totalMinutes = Math.floor(numeric / 60000);
    if (totalMinutes <= 0) {
        return '<1分';
    }
    const maxParts = Number.isFinite(Number(options.maxParts))
        ? Math.max(1, Math.floor(Number(options.maxParts)))
        : 2;
    const units = [
        { label: '天', value: 24 * 60 },
        { label: '小时', value: 60 },
        { label: '分', value: 1 }
    ];
    let remainingMinutes = totalMinutes;
    const parts = [];
    for (const unit of units) {
        if (remainingMinutes < unit.value && unit.value !== 1) {
            continue;
        }
        const count = unit.value === 1 ? remainingMinutes : Math.floor(remainingMinutes / unit.value);
        if (count <= 0) {
            continue;
        }
        parts.push(`${count}${unit.label}`);
        remainingMinutes -= count * unit.value;
        if (parts.length >= maxParts) {
            break;
        }
    }
    return parts.length ? parts.join(' ') : '0分';
}

function buildUsagePricingIndex(providersList = []) {
    const byProvider = new Map();
    const byModel = new Map();
    const list = Array.isArray(providersList) ? providersList : [];
    for (const provider of list) {
        if (!provider || typeof provider !== 'object') continue;
        const providerName = typeof provider.name === 'string' ? provider.name.trim() : '';
        const models = Array.isArray(provider.models) ? provider.models : [];
        const providerMap = new Map();
        for (const model of models) {
            if (!model || typeof model !== 'object') continue;
            const modelId = typeof model.id === 'string' ? model.id.trim() : '';
            if (!modelId) continue;
            const cost = model.cost && typeof model.cost === 'object' && !Array.isArray(model.cost)
                ? model.cost
                : null;
            const pricing = {
                input: readUsageCostNumber(cost && cost.input),
                output: readUsageCostNumber(cost && cost.output),
                cacheRead: readUsageCostNumber(cost && cost.cacheRead),
                cacheWrite: readUsageCostNumber(cost && cost.cacheWrite)
            };
            const hasKnownRate = Object.values(pricing).some((value) => value !== null && value > 0);
            if (!hasKnownRate) continue;
            providerMap.set(modelId, pricing);
            const modelMatches = byModel.get(modelId) || [];
            modelMatches.push({ provider: providerName, pricing });
            byModel.set(modelId, modelMatches);
        }
        if (providerName && providerMap.size) {
            byProvider.set(providerName, providerMap);
        }
    }
    return { byProvider, byModel };
}

function resolveUsagePricingForSession(session, pricingIndex, fallbackProvider = '') {
    if (!session || typeof session !== 'object' || !pricingIndex || typeof pricingIndex !== 'object') {
        return null;
    }
    const model = typeof session.model === 'string' ? session.model.trim() : '';
    if (!model) return null;
    const provider = typeof session.provider === 'string' ? session.provider.trim() : '';
    const effectiveProvider = provider || fallbackProvider;
    if (effectiveProvider) {
        const providerMap = pricingIndex.byProvider instanceof Map ? pricingIndex.byProvider.get(effectiveProvider) : null;
        if (providerMap instanceof Map && providerMap.has(model)) {
            return providerMap.get(model);
        }
    }
    const modelMatches = pricingIndex.byModel instanceof Map ? pricingIndex.byModel.get(model) : null;
    if (Array.isArray(modelMatches) && modelMatches.length === 1) {
        return modelMatches[0].pricing;
    }
    return null;
}

function estimateUsageCostSummary(sessions, providersList, currentProvider) {
    const list = Array.isArray(sessions) ? sessions : [];
    const pricingIndex = buildUsagePricingIndex(providersList);
    let totalCostUsd = 0;
    let estimatedSessions = 0;
    let totalTokens = 0;
    let estimatedTokens = 0;

    for (const session of list) {
        if (!session || typeof session !== 'object') continue;
        const pricing = resolveUsagePricingForSession(session, pricingIndex, currentProvider);
        const totalSessionTokens = Number.isFinite(Number(session.totalTokens))
            ? Math.max(0, Math.floor(Number(session.totalTokens)))
            : 0;
        totalTokens += totalSessionTokens;
        if (!pricing) {
            continue;
        }
        const inputTokens = Number.isFinite(Number(session.inputTokens)) ? Math.max(0, Math.floor(Number(session.inputTokens))) : null;
        const cachedInputTokens = Number.isFinite(Number(session.cachedInputTokens)) ? Math.max(0, Math.floor(Number(session.cachedInputTokens))) : 0;
        const outputTokens = Number.isFinite(Number(session.outputTokens)) ? Math.max(0, Math.floor(Number(session.outputTokens))) : null;
        const reasoningOutputTokens = Number.isFinite(Number(session.reasoningOutputTokens)) ? Math.max(0, Math.floor(Number(session.reasoningOutputTokens))) : 0;
        if (inputTokens === null && outputTokens === null && reasoningOutputTokens === 0) {
            continue;
        }
        const billableInputTokens = Math.max(0, (inputTokens || 0) - cachedInputTokens);
        const estimatedUsd = (
            ((pricing.input || 0) * billableInputTokens)
            + ((pricing.cacheRead || 0) * cachedInputTokens)
            + ((pricing.output || 0) * ((outputTokens || 0) + reasoningOutputTokens))
        ) / 1000000;
        totalCostUsd += estimatedUsd;
        estimatedSessions += 1;
        estimatedTokens += totalSessionTokens || (billableInputTokens + cachedInputTokens + (outputTokens || 0) + reasoningOutputTokens);
    }

    const coveragePercent = totalTokens > 0
        ? Math.round((estimatedTokens / totalTokens) * 100)
        : (estimatedSessions > 0 ? 100 : 0);
    return {
        totalCostUsd,
        estimatedSessions,
        totalSessions: list.length,
        estimatedTokens,
        totalTokens,
        coveragePercent,
        hasEstimate: estimatedSessions > 0
    };
}

export function createSessionComputed() {
    return {
        isSessionQueryEnabled() {
            return isSessionQueryEnabled(this.sessionFilterSource);
        },
        activeSessionExportKey() {
            return this.activeSession ? this.getSessionExportKey(this.activeSession) : '';
        },
        sortedSessionsList() {
            const list = Array.isArray(this.sessionsList) ? this.sessionsList : [];
            if (list.length === 0) return [];
            const pinnedMap = (this.sessionPinnedMap && typeof this.sessionPinnedMap === 'object')
                ? this.sessionPinnedMap
                : {};
            if (Object.keys(pinnedMap).length === 0) {
                return list;
            }
            let hasPinned = false;
            const decorated = list.map((session, index) => {
                const key = session ? this.getSessionExportKey(session) : '';
                const rawPinnedAt = key ? pinnedMap[key] : 0;
                const pinnedAt = Number.isFinite(Number(rawPinnedAt))
                    ? Math.floor(Number(rawPinnedAt))
                    : 0;
                const isPinned = pinnedAt > 0;
                if (isPinned) {
                    hasPinned = true;
                }
                return { session, index, pinnedAt, isPinned };
            });
            if (!hasPinned) return list;
            decorated.sort((a, b) => {
                if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
                if (a.isPinned && a.pinnedAt !== b.pinnedAt) return b.pinnedAt - a.pinnedAt;
                return a.index - b.index;
            });
            return decorated.map(item => item.session);
        },
        visibleSessionsList() {
            if (!this.sessionListRenderEnabled) {
                return [];
            }
            const list = Array.isArray(this.sortedSessionsList) ? this.sortedSessionsList : [];
            if (list.length === 0) {
                return [];
            }
            const rawVisibleCount = Number(this.sessionListVisibleCount);
            const visibleCount = Number.isFinite(rawVisibleCount)
                ? Math.max(0, Math.floor(rawVisibleCount))
                : 0;
            let targetCount = visibleCount > 0 ? Math.min(visibleCount, list.length) : Math.min(list.length, 1);
            const activeKey = this.activeSession ? this.getSessionExportKey(this.activeSession) : '';
            if (activeKey) {
                const activeIndex = list.findIndex((session) => this.getSessionExportKey(session) === activeKey);
                if (activeIndex >= 0) {
                    targetCount = Math.max(targetCount, activeIndex + 1);
                }
            }
            if (targetCount >= list.length) {
                return list;
            }
            return list.slice(0, targetCount);
        },
        activeSessionVisibleMessages() {
            if (this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) {
                return [];
            }
            const list = Array.isArray(this.activeSessionMessages) ? this.activeSessionMessages : [];
            const rawCount = Number(this.sessionPreviewVisibleCount);
            const visibleCount = Number.isFinite(rawCount)
                ? Math.max(0, Math.floor(rawCount))
                : 0;
            if (visibleCount <= 0) {
                const initialBatchSize = Number.isFinite(this.sessionPreviewInitialBatchSize)
                    ? Math.max(1, Math.floor(this.sessionPreviewInitialBatchSize))
                    : 12;
                return list.slice(0, Math.min(initialBatchSize, list.length));
            }
            if (visibleCount >= list.length) return list;
            return list.slice(0, visibleCount);
        },
        canLoadMoreSessionMessages() {
            if (this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) {
                return false;
            }
            const total = Array.isArray(this.activeSessionMessages) ? this.activeSessionMessages.length : 0;
            const visible = Array.isArray(this.activeSessionVisibleMessages) ? this.activeSessionVisibleMessages.length : 0;
            return total > visible;
        },
        sessionPreviewRemainingCount() {
            const total = Array.isArray(this.activeSessionMessages) ? this.activeSessionMessages.length : 0;
            const visible = Array.isArray(this.activeSessionVisibleMessages) ? this.activeSessionVisibleMessages.length : 0;
            return Math.max(0, total - visible);
        },
        sessionTimelineNodes() {
            if (this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) {
                return [];
            }
            return buildSessionTimelineNodes(this.activeSessionVisibleMessages, {
                getKey: (message, index) => this.getRecordRenderKey(message, index)
            });
        },
        sessionTimelineNodeKeyMap() {
            const nodes = Array.isArray(this.sessionTimelineNodes) ? this.sessionTimelineNodes : [];
            if (!nodes.length) {
                return Object.create(null);
            }
            const map = Object.create(null);
            for (const node of nodes) {
                if (!node || !node.key) continue;
                map[node.key] = true;
            }
            return map;
        },
        sessionTimelineActiveTitle() {
            if (!this.sessionTimelineActiveKey) return '';
            const nodes = Array.isArray(this.sessionTimelineNodes) ? this.sessionTimelineNodes : [];
            const matched = nodes.find(node => node.key === this.sessionTimelineActiveKey);
            return matched ? matched.title : '';
        },
        sessionQueryPlaceholder() {
            if (this.isSessionQueryEnabled) {
                return '关键词检索（支持 Codex/Claude，例：claude code）';
            }
            return '当前来源暂不支持关键词检索';
        },
        sessionUsageCharts() {
            return buildUsageChartGroups(this.sessionsUsageList, {
                range: this.sessionsUsageTimeRange
            });
        },
        sessionUsageSummaryCards() {
            const summary = this.sessionUsageCharts && this.sessionUsageCharts.summary
                ? this.sessionUsageCharts.summary
                : { totalSessions: 0, totalMessages: 0, totalTokens: 0, totalContextWindow: 0, activeDurationMs: 0, totalDurationMs: 0, activeDays: 0, avgMessagesPerSession: 0, busiestDay: null, busiestHour: null };
            const estimatedCost = estimateUsageCostSummary(
                this.sessionsUsageList,
                this.providersList,
                this.currentProvider
            );
            return [
                { key: 'sessions', label: '总会话数', value: formatUsageSummaryNumber(summary.totalSessions || 0) },
                { key: 'messages', label: '总消息数', value: formatUsageSummaryNumber(summary.totalMessages || 0) },
                {
                    key: 'tokens',
                    label: '总 token 数',
                    value: formatCompactUsageSummaryNumber(summary.totalTokens || 0),
                    title: formatUsageSummaryNumber(summary.totalTokens || 0)
                },
                {
                    key: 'context-window',
                    label: '总上下文数',
                    value: formatCompactUsageSummaryNumber(summary.totalContextWindow || 0),
                    title: formatUsageSummaryNumber(summary.totalContextWindow || 0)
                },
                {
                    key: 'estimated-cost',
                    label: '预估费用',
                    value: estimatedCost.hasEstimate ? formatUsageEstimatedCost(estimatedCost.totalCostUsd) : '暂无',
                    title: estimatedCost.hasEstimate
                        ? `按已知模型单价估算，覆盖 ${estimatedCost.estimatedSessions}/${estimatedCost.totalSessions} 个会话，约 ${estimatedCost.coveragePercent}% token`
                        : '缺少可匹配的模型单价或 token 拆分。请先在 Provider 配置里补 models.cost，或确认 session 已记录 input/output token。'
                },
                {
                    key: 'active-duration',
                    label: '活跃时长',
                    value: formatUsageDuration(summary.activeDurationMs || 0),
                    title: `累计会话跨度 ${formatUsageDuration(summary.activeDurationMs || 0, { maxParts: 3 })}`
                },
                {
                    key: 'total-duration',
                    label: '总时长',
                    value: formatUsageDuration(summary.totalDurationMs || 0),
                    title: `整体时间跨度 ${formatUsageDuration(summary.totalDurationMs || 0, { maxParts: 3 })}`
                },
                { key: 'days', label: '活跃天数', value: formatUsageSummaryNumber(summary.activeDays || 0) },
                { key: 'avg-messages', label: '平均每会话消息', value: summary.avgMessagesPerSession || 0 },
                {
                    key: 'busiest-day',
                    label: '最忙日',
                    value: summary.busiestDay && summary.busiestDay.totalSessions > 0
                        ? `${summary.busiestDay.label} · ${summary.busiestDay.totalSessions}`
                        : '暂无'
                },
                {
                    key: 'busiest-hour',
                    label: '高峰时段',
                    value: summary.busiestHour && summary.busiestHour.count > 0
                        ? `${summary.busiestHour.label} · ${summary.busiestHour.count}`
                        : '暂无'
                }
            ];
        },
        visibleSessionTrashItems() {
            const items = Array.isArray(this.sessionTrashItems) ? this.sessionTrashItems : [];
            const visibleCount = Number(this.sessionTrashVisibleCount);
            const safeVisibleCount = Number.isFinite(visibleCount) && visibleCount > 0
                ? Math.floor(visibleCount)
                : SESSION_TRASH_PAGE_SIZE;
            return items.slice(0, safeVisibleCount);
        },
        sessionTrashHasMoreItems() {
            return this.visibleSessionTrashItems.length < this.sessionTrashCount;
        },
        sessionTrashHiddenCount() {
            return Math.max(0, this.sessionTrashCount - this.visibleSessionTrashItems.length);
        },
        sessionTrashCount() {
            const totalCount = Number(this.sessionTrashTotalCount);
            if (Number.isFinite(totalCount) && totalCount >= 0) {
                return Math.max(0, Math.floor(totalCount));
            }
            return Array.isArray(this.sessionTrashItems) ? this.sessionTrashItems.length : 0;
        }
    };
}
