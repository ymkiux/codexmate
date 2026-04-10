import {
    buildSessionTimelineNodes,
    buildUsageChartGroups,
    isSessionQueryEnabled
} from '../logic.mjs';
import { SESSION_TRASH_PAGE_SIZE } from './app.constants.mjs';

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
                : { totalSessions: 0, totalMessages: 0, activeDays: 0, avgMessagesPerSession: 0, busiestDay: null, busiestHour: null };
            return [
                { key: 'sessions', label: '总会话数', value: summary.totalSessions || 0 },
                { key: 'messages', label: '总消息数', value: summary.totalMessages || 0 },
                { key: 'days', label: '活跃天数', value: summary.activeDays || 0 },
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
