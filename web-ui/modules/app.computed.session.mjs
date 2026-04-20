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

function formatUsageEstimatedCost(value, options = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return '$0.00';
    }
    const precise = options && options.precise === true;
    if (numeric < 0.0001) {
        return '<$0.0001';
    }
    let fractionDigits = 2;
    if (numeric < 1) {
        fractionDigits = precise ? 6 : 4;
    } else if (numeric >= 100) {
        fractionDigits = 0;
    }
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits
    }).format(numeric);
}

function formatUsageRangeLabel(range, t) {
    const normalized = typeof range === 'string' ? range.trim().toLowerCase() : '7d';
    if (typeof t === 'function') {
        if (normalized === '30d') return t('usage.range.30d');
        if (normalized === 'all') return t('usage.range.all');
        return t('usage.range.7d');
    }
    if (normalized === '30d') return '近 30 天';
    if (normalized === 'all') return '全部';
    return '近 7 天';
}

function formatUsageDuration(value, options = {}) {
    const normalizedLang = typeof options.lang === 'string' ? options.lang.trim().toLowerCase() : '';
    const isEn = normalizedLang === 'en';
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return isEn ? '0m' : '0分';
    }
    const totalMinutes = Math.floor(numeric / 60000);
    if (totalMinutes <= 0) {
        return isEn ? '<1m' : '<1分';
    }
    const maxParts = Number.isFinite(Number(options.maxParts))
        ? Math.max(1, Math.floor(Number(options.maxParts)))
        : 2;
    const compact = options.compact !== false;
    const units = compact
        ? (
            isEn
                ? [
                    { label: 'd', value: 24 * 60 },
                    { label: 'h', value: 60 },
                    { label: 'm', value: 1 }
                ]
                : [
                    { label: '天', value: 24 * 60 },
                    { label: '时', value: 60 },
                    { label: '分', value: 1 }
                ]
        )
        : (
            isEn
                ? [
                    { label: 'day', value: 24 * 60 },
                    { label: 'hr', value: 60 },
                    { label: 'min', value: 1 }
                ]
                : [
                    { label: '天', value: 24 * 60 },
                    { label: '小时', value: 60 },
                    { label: '分', value: 1 }
                ]
        );
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
        parts.push(compact ? `${count}${unit.label}` : (isEn ? `${count} ${unit.label}` : `${count}${unit.label}`));
        remainingMinutes -= count * unit.value;
        if (parts.length >= maxParts) {
            break;
        }
    }
    return parts.length ? parts.join(compact ? '' : ' ') : (isEn ? '0m' : '0分');
}

const KNOWN_USAGE_MODEL_PRICING = Object.freeze({
    'gpt-5.4': Object.freeze({ input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 }),
    'gpt-5.4-mini': Object.freeze({ input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 }),
    'gpt-5.3-codex': Object.freeze({ input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }),
    'gpt-5.2-codex': Object.freeze({ input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 })
});

function createUsagePricingEntry(pricing, source) {
    const resolvedSource = typeof source === 'string' && source.trim() ? source.trim() : 'provider-config';
    return {
        input: readUsageCostNumber(pricing && pricing.input),
        output: readUsageCostNumber(pricing && pricing.output),
        reasoningOutput: readUsageCostNumber(
            pricing && (pricing.reasoningOutput != null ? pricing.reasoningOutput : pricing.reasoning)
        ),
        cacheRead: readUsageCostNumber(pricing && pricing.cacheRead),
        cacheWrite: readUsageCostNumber(pricing && pricing.cacheWrite),
        source: resolvedSource
    };
}

function buildUsagePricingIndex(providersList = []) {
    const byProvider = new Map();
    const byModel = new Map();
    const knownByModel = new Map();
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
            const pricing = createUsagePricingEntry(
                model.cost && typeof model.cost === 'object' && !Array.isArray(model.cost)
                    ? model.cost
                    : null,
                'provider-config'
            );
            const hasKnownRate = [pricing.input, pricing.output, pricing.reasoningOutput, pricing.cacheRead, pricing.cacheWrite]
                .some((value) => value !== null);
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
    for (const [modelId, pricing] of Object.entries(KNOWN_USAGE_MODEL_PRICING)) {
        const normalizedModelId = typeof modelId === 'string' ? modelId.trim() : '';
        if (!normalizedModelId || byModel.has(normalizedModelId)) {
            continue;
        }
        knownByModel.set(normalizedModelId, createUsagePricingEntry(pricing, 'public-catalog'));
    }
    return { byProvider, byModel, knownByModel };
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
    const knownPricing = pricingIndex.knownByModel instanceof Map ? pricingIndex.knownByModel.get(model) : null;
    if (knownPricing) {
        return knownPricing;
    }
    return null;
}

function shouldEstimateUsageCostForSession(session) {
    if (!session || typeof session !== 'object') {
        return false;
    }
    const source = typeof session.source === 'string' ? session.source.trim().toLowerCase() : '';
    const provider = typeof session.provider === 'string' ? session.provider.trim().toLowerCase() : '';
    const model = typeof session.model === 'string' ? session.model.trim().toLowerCase() : '';
    if (source === 'claude' || provider === 'claude') {
        return false;
    }
    if (/^claude(?:[-_]|$)/.test(model)) {
        return false;
    }
    return true;
}

function estimateUsageCostSummary(sessions, providersList, currentProvider) {
    const list = Array.isArray(sessions) ? sessions : [];
    const pricingIndex = buildUsagePricingIndex(providersList);
    let totalCostUsd = 0;
    let estimatedSessions = 0;
    let totalTokens = 0;
    let estimatedTokens = 0;
    let configuredSessions = 0;
    let catalogSessions = 0;
    let missingPricingSessions = 0;
    let missingTokenSessions = 0;
    let supportedSessions = 0;
    let skippedUnsupportedSessions = 0;

    for (const session of list) {
        if (!session || typeof session !== 'object') continue;
        if (!shouldEstimateUsageCostForSession(session)) {
            skippedUnsupportedSessions += 1;
            continue;
        }
        supportedSessions += 1;
        const cost = estimateUsageCostForSession(session, pricingIndex, currentProvider);
        totalTokens += cost.totalSessionTokens;
        if (!cost.pricing) {
            missingPricingSessions += 1;
            continue;
        }
        if (!cost.hasTokenBreakdown) {
            missingTokenSessions += 1;
            continue;
        }
        totalCostUsd += cost.estimatedUsd;
        estimatedSessions += 1;
        estimatedTokens += cost.totalSessionTokens;
        if (cost.pricing.source === 'public-catalog') catalogSessions += 1;
        else configuredSessions += 1;
    }

    const coveragePercent = totalTokens > 0
        ? Math.round((estimatedTokens / totalTokens) * 100)
        : (estimatedSessions > 0 ? 100 : 0);
    return {
        totalCostUsd,
        estimatedSessions,
        totalSessions: supportedSessions,
        estimatedTokens,
        totalTokens,
        coveragePercent,
        hasEstimate: estimatedSessions > 0,
        configuredSessions,
        catalogSessions,
        missingPricingSessions,
        missingTokenSessions,
        skippedUnsupportedSessions
    };
}

function estimateUsageCostForSession(session, pricingIndex, currentProvider) {
    const inputTokens = Number.isFinite(Number(session.inputTokens)) ? Math.max(0, Math.floor(Number(session.inputTokens))) : null;
    const cachedInputTokens = Number.isFinite(Number(session.cachedInputTokens)) ? Math.max(0, Math.floor(Number(session.cachedInputTokens))) : 0;
    const outputTokens = Number.isFinite(Number(session.outputTokens)) ? Math.max(0, Math.floor(Number(session.outputTokens))) : null;
    const reasoningOutputTokens = Number.isFinite(Number(session.reasoningOutputTokens)) ? Math.max(0, Math.floor(Number(session.reasoningOutputTokens))) : 0;
    const billableInputTokens = Math.max(0, (inputTokens || 0) - cachedInputTokens);
    const fallbackSessionTokens = billableInputTokens + cachedInputTokens + (outputTokens || 0) + reasoningOutputTokens;
    const totalSessionTokens = Number.isFinite(Number(session.totalTokens))
        ? Math.max(0, Math.floor(Number(session.totalTokens)))
        : fallbackSessionTokens;
    const pricing = resolveUsagePricingForSession(session, pricingIndex, currentProvider);
    const hasTokenBreakdown = !(inputTokens === null && outputTokens === null && reasoningOutputTokens === 0);
    const reasoningRate = pricing
        ? ((pricing.reasoningOutput != null ? pricing.reasoningOutput : pricing.output) || 0)
        : 0;
    const estimatedUsd = pricing && hasTokenBreakdown
        ? (
            ((pricing.input || 0) * billableInputTokens)
            + ((pricing.cacheRead || 0) * cachedInputTokens)
            + (reasoningRate * reasoningOutputTokens)
            + ((pricing.output || 0) * (outputTokens || 0))
        ) / 1000000
        : 0;
    return {
        pricing,
        hasTokenBreakdown,
        totalSessionTokens,
        estimatedUsd
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
                return typeof this.t === 'function'
                    ? this.t('sessions.query.placeholder.enabled')
                    : '关键词检索（支持 Codex/Claude，例：claude code）';
            }
            return typeof this.t === 'function'
                ? this.t('sessions.query.placeholder.disabled')
                : '当前来源暂不支持关键词检索';
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
            const filteredUsageSessions = this.sessionUsageCharts && Array.isArray(this.sessionUsageCharts.filteredSessions)
                ? this.sessionUsageCharts.filteredSessions
                : this.sessionsUsageList;
            const t = typeof this.t === 'function' ? this.t : null;
            const usageRangeLabel = formatUsageRangeLabel(this.sessionsUsageTimeRange, t);
            const estimatedCost = estimateUsageCostSummary(
                filteredUsageSessions,
                this.providersList,
                this.currentProvider
            );
            const noneLabel = t ? t('common.none') : '暂无';
            const estimatedCostPrefix = estimatedCost.skippedUnsupportedSessions > 0
                ? (t ? t('usage.estimatedCost.note.excludesClaudePrefix') : '暂不含 Claude，')
                : '';
            const estimatedCostMethod = estimatedCost.catalogSessions > 0
                ? (estimatedCost.configuredSessions > 0
                    ? (t ? t('usage.estimatedCost.method.configuredAndCatalog') : '按已配置单价 + 公开模型目录估算')
                    : (t ? t('usage.estimatedCost.method.catalog') : '按公开模型目录估算'))
                : (t ? t('usage.estimatedCost.method.configured') : '按已配置单价估算');
            const estimatedCostTitle = estimatedCost.hasEstimate
                ? (t ? t('usage.estimatedCost.detail.estimate', {
                    prefix: estimatedCostPrefix,
                    method: estimatedCostMethod,
                    estimate: formatUsageEstimatedCost(estimatedCost.totalCostUsd, { precise: true }),
                    covered: estimatedCost.estimatedSessions,
                    total: estimatedCost.totalSessions,
                    percent: estimatedCost.coveragePercent
                }) : `${estimatedCostPrefix}${estimatedCostMethod}，估算 ${formatUsageEstimatedCost(estimatedCost.totalCostUsd, { precise: true })}，覆盖 ${estimatedCost.estimatedSessions}/${estimatedCost.totalSessions} 个会话，约 ${estimatedCost.coveragePercent}% token`)
                : (t ? t('usage.estimatedCost.detail.missing', { prefix: estimatedCostPrefix }) : `${estimatedCostPrefix}缺少可匹配的模型单价或 token 拆分。请先补 models.cost，或确认会话已记录 input/output token。`);
            return [
                { key: 'sessions', label: t ? t('usage.summary.sessions') : '总会话数', value: formatUsageSummaryNumber(summary.totalSessions || 0) },
                { key: 'messages', label: t ? t('usage.summary.messages') : '总消息数', value: formatUsageSummaryNumber(summary.totalMessages || 0) },
                {
                    key: 'tokens',
                    label: t ? t('usage.summary.tokens') : '总 token 数',
                    value: formatCompactUsageSummaryNumber(summary.totalTokens || 0),
                    title: formatUsageSummaryNumber(summary.totalTokens || 0)
                },
                {
                    key: 'context-window',
                    label: t ? t('usage.summary.contextWindow') : '总上下文数',
                    value: formatCompactUsageSummaryNumber(summary.totalContextWindow || 0),
                    title: formatUsageSummaryNumber(summary.totalContextWindow || 0)
                },
                {
                    key: 'estimated-cost',
                    label: t ? t('usage.summary.estimatedCost', { range: usageRangeLabel }) : `预估费用 · ${usageRangeLabel}`,
                    value: estimatedCost.hasEstimate ? formatUsageEstimatedCost(estimatedCost.totalCostUsd) : '0',
                    title: estimatedCostTitle
                },
                {
                    key: 'active-duration',
                    label: t ? t('usage.summary.activeDuration') : '活跃时长',
                    value: formatUsageDuration(summary.activeDurationMs || 0, { compact: true, lang: this.lang }),
                    title: t
                        ? t('usage.summary.activeDuration.title', {
                            value: formatUsageDuration(summary.activeDurationMs || 0, { maxParts: 3, compact: false, lang: this.lang })
                        })
                        : `累计会话跨度 ${formatUsageDuration(summary.activeDurationMs || 0, { maxParts: 3, compact: false, lang: this.lang })}`
                },
                {
                    key: 'total-duration',
                    label: t ? t('usage.summary.totalDuration') : '总时长',
                    value: formatUsageDuration(summary.totalDurationMs || 0, { compact: true, lang: this.lang }),
                    title: t
                        ? t('usage.summary.totalDuration.title', {
                            value: formatUsageDuration(summary.totalDurationMs || 0, { maxParts: 3, compact: false, lang: this.lang })
                        })
                        : `整体时间跨度 ${formatUsageDuration(summary.totalDurationMs || 0, { maxParts: 3, compact: false, lang: this.lang })}`
                },
                { key: 'days', label: t ? t('usage.summary.activeDays') : '活跃天数', value: formatUsageSummaryNumber(summary.activeDays || 0) },
                { key: 'avg-messages', label: t ? t('usage.summary.avgMessagesPerSession') : '平均每会话消息', value: summary.avgMessagesPerSession || 0 },
                {
                    key: 'busiest-day',
                    label: t ? t('usage.summary.busiestDay') : '最忙日',
                    value: summary.busiestDay && summary.busiestDay.totalSessions > 0
                        ? `${summary.busiestDay.label} · ${summary.busiestDay.totalSessions}`
                        : noneLabel
                },
                {
                    key: 'busiest-hour',
                    label: t ? t('usage.summary.busiestHour') : '高峰时段',
                    value: summary.busiestHour && summary.busiestHour.count > 0
                        ? `${summary.busiestHour.label} · ${summary.busiestHour.count}`
                        : noneLabel
                }
            ];
        },

        sessionUsageDaily() {
            const baseBuckets = this.sessionUsageCharts && Array.isArray(this.sessionUsageCharts.buckets)
                ? this.sessionUsageCharts.buckets
                : [];
            const sessions = this.sessionUsageCharts && Array.isArray(this.sessionUsageCharts.filteredSessions)
                ? this.sessionUsageCharts.filteredSessions
                : this.sessionsUsageList;
            const pricingIndex = buildUsagePricingIndex(this.providersList);
            const byDay = new Map();

            for (const bucket of baseBuckets) {
                if (!bucket || !bucket.key) continue;
                byDay.set(bucket.key, {
                    key: bucket.key,
                    label: bucket.label || bucket.key.slice(5),
                    sessionCount: 0,
                    messageCount: 0,
                    tokenTotal: 0,
                    estimatedCostUsd: 0,
                    estimatedSessions: 0,
                    hasCostEstimate: false
                });
            }

            for (const session of (Array.isArray(sessions) ? sessions : [])) {
                if (!session || typeof session !== 'object') continue;
                const updatedAtMs = Date.parse(session.updatedAt || '');
                if (!Number.isFinite(updatedAtMs)) continue;
                const dayKey = new Date(updatedAtMs).toISOString().slice(0, 10);
                const row = byDay.get(dayKey);
                if (!row) continue;

                const messageCount = Number.isFinite(Number(session.messageCount))
                    ? Math.max(0, Math.floor(Number(session.messageCount)))
                    : 0;
                const tokenTotal = Number.isFinite(Number(session.totalTokens))
                    ? Math.max(0, Math.floor(Number(session.totalTokens)))
                    : 0;
                row.sessionCount += 1;
                row.messageCount += messageCount;
                row.tokenTotal += tokenTotal;

                if (shouldEstimateUsageCostForSession(session)) {
                    const cost = estimateUsageCostForSession(session, pricingIndex, this.currentProvider);
                    if (cost.pricing && cost.hasTokenBreakdown) {
                        row.estimatedCostUsd += cost.estimatedUsd;
                        row.estimatedSessions += 1;
                        row.hasCostEstimate = true;
                    }
                }
            }

            // UI 展示：当天在最上面（倒序）。
            const rows = [...byDay.values()].sort((a, b) => b.key.localeCompare(a.key, 'en-US'));
            const maxTokens = rows.reduce((max, item) => Math.max(max, item.tokenTotal), 0);
            const maxCost = rows.reduce((max, item) => Math.max(max, item.estimatedCostUsd), 0);

            return {
                rows: rows.map((row) => ({
                    ...row,
                    tokenLabel: formatCompactUsageSummaryNumber(row.tokenTotal),
                    tokenTitle: formatUsageSummaryNumber(row.tokenTotal),
                    tokenPercent: maxTokens > 0 ? Math.round((row.tokenTotal / maxTokens) * 1000) / 10 : 0,
                    costLabel: row.hasCostEstimate ? formatUsageEstimatedCost(row.estimatedCostUsd) : '0',
                    costTitle: row.hasCostEstimate ? formatUsageEstimatedCost(row.estimatedCostUsd, { precise: true }) : '0',
                    costPercent: maxCost > 0 ? Math.round((row.estimatedCostUsd / maxCost) * 1000) / 10 : 0
                })),
                maxTokens,
                maxCost
            };
        },

        sessionUsageDailyTableRows() {
            const daily = this.sessionUsageDaily && typeof this.sessionUsageDaily === 'object'
                ? this.sessionUsageDaily
                : null;
            return daily && Array.isArray(daily.rows) ? daily.rows : [];
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
