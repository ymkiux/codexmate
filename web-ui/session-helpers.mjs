import { buildSessionListParams } from './logic.mjs';

export function switchMainTab(tab) {
    const previousTab = this.mainTab;
    if (previousTab === 'sessions' && tab !== 'sessions') {
        this.teardownSessionTabRender();
    }
    this.mainTab = tab;
    if (tab === 'sessions' && !this.sessionsLoadedOnce) {
        this.loadSessions();
    }
    if (tab === 'sessions') {
        this.prepareSessionTabRender();
    }
    if (tab === 'config' && this.configMode === 'claude') {
        this.refreshClaudeModelContext();
    }
}

export async function loadSessions(api) {
    if (this.sessionsLoading) return;
    this.sessionsLoading = true;
    this.activeSessionDetailError = '';
    let loadSucceeded = false;
    const params = buildSessionListParams({
        source: this.sessionFilterSource,
        pathFilter: this.sessionPathFilter,
        query: this.sessionQuery,
        roleFilter: this.sessionRoleFilter,
        timeRangePreset: this.sessionTimePreset
    });
    try {
        const res = await api('list-sessions', params);
        if (res.error) {
            this.showMessage(res.error, 'error');
            this.sessionsList = [];
            this.activeSession = null;
            this.activeSessionMessages = [];
            this.resetSessionDetailPagination();
            this.resetSessionPreviewMessageRender();
            this.activeSessionDetailClipped = false;
            this.cancelSessionTimelineSync();
            this.sessionTimelineActiveKey = '';
            this.sessionMessageRefMap = Object.create(null);
        } else {
            loadSucceeded = true;
            this.sessionsList = Array.isArray(res.sessions) ? res.sessions : [];
            this.syncSessionPathOptionsForSource(
                this.sessionFilterSource,
                this.extractPathOptionsFromSessions(this.sessionsList),
                true
            );
            if (this.sessionsList.length === 0) {
                this.activeSession = null;
                this.activeSessionMessages = [];
                this.resetSessionDetailPagination();
                this.resetSessionPreviewMessageRender();
                this.activeSessionDetailClipped = false;
                this.cancelSessionTimelineSync();
                this.sessionTimelineActiveKey = '';
                this.sessionMessageRefMap = Object.create(null);
            } else {
                const oldKey = this.activeSession ? this.getSessionExportKey(this.activeSession) : '';
                const matched = this.sessionsList.find(item => this.getSessionExportKey(item) === oldKey);
                this.activeSession = matched || this.sessionsList[0];
                this.activeSessionMessages = [];
                this.resetSessionDetailPagination();
                this.resetSessionPreviewMessageRender();
                this.activeSessionDetailError = '';
                this.activeSessionDetailClipped = false;
                this.cancelSessionTimelineSync();
                this.sessionTimelineActiveKey = '';
                this.sessionMessageRefMap = Object.create(null);
                await this.loadActiveSessionDetail();
            }
            void this.loadSessionPathOptions({ source: this.sessionFilterSource });
        }
    } catch (e) {
        this.sessionsList = [];
        this.activeSession = null;
        this.activeSessionMessages = [];
        this.resetSessionDetailPagination();
        this.resetSessionPreviewMessageRender();
        this.activeSessionDetailClipped = false;
        this.cancelSessionTimelineSync();
        this.sessionTimelineActiveKey = '';
        this.sessionMessageRefMap = Object.create(null);
        this.showMessage('加载会话失败', 'error');
    } finally {
        this.sessionsLoading = false;
        if (loadSucceeded) {
            this.sessionsLoadedOnce = true;
        }
    }
}

export async function loadActiveSessionDetail(api, options = {}) {
    if (!this.activeSession) {
        this.activeSessionMessages = [];
        this.resetSessionDetailPagination();
        this.resetSessionPreviewMessageRender();
        this.activeSessionDetailError = '';
        this.activeSessionDetailClipped = false;
        this.cancelSessionTimelineSync();
        this.sessionTimelineActiveKey = '';
        this.sessionMessageRefMap = Object.create(null);
        return;
    }

    const requestSeq = ++this.sessionDetailRequestSeq;
    this.sessionDetailLoading = true;
    this.activeSessionDetailError = '';
    const fallbackLimit = Number.isFinite(this.sessionDetailInitialMessageLimit)
        ? Math.max(1, Math.floor(this.sessionDetailInitialMessageLimit))
        : 80;
    const rawLimit = Number(this.sessionDetailMessageLimit);
    const messageLimit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.floor(rawLimit))
        : fallbackLimit;
    try {
        const res = await api('session-detail', {
            source: this.activeSession.source,
            sessionId: this.activeSession.sessionId,
            filePath: this.activeSession.filePath,
            messageLimit
        });

        if (requestSeq !== this.sessionDetailRequestSeq) {
            return;
        }

        if (res.error) {
            this.activeSessionMessages = [];
            this.resetSessionPreviewMessageRender();
            this.activeSessionDetailClipped = false;
            this.activeSessionDetailError = res.error;
            this.cancelSessionTimelineSync();
            this.sessionTimelineActiveKey = '';
            this.sessionMessageRefMap = Object.create(null);
            return;
        }

        const rawMessages = Array.isArray(res.messages) ? res.messages : [];
        const normalizedMessages = rawMessages.map((message) => Object.freeze(this.normalizeSessionMessage(message)));
        this.activeSessionMessages = Object.freeze(normalizedMessages);
        this.activeSessionDetailClipped = !!res.clipped;
        const responseLimitRaw = Number(res.messageLimit);
        this.sessionDetailMessageLimit = Number.isFinite(responseLimitRaw)
            ? Math.max(1, Math.floor(responseLimitRaw))
            : messageLimit;
        if (this.activeSession) {
            if (res.sourceLabel) {
                this.activeSession.sourceLabel = res.sourceLabel;
            }
            if (res.sessionId) {
                this.activeSession.sessionId = res.sessionId;
                if (!this.activeSession.title) {
                    this.activeSession.title = res.sessionId;
                }
            }
            if (res.filePath) {
                this.activeSession.filePath = res.filePath;
            }
        }
        if (res.updatedAt) {
            this.activeSession.updatedAt = res.updatedAt;
        }
        if (res.cwd) {
            this.activeSession.cwd = res.cwd;
        }
        if (Number.isFinite(res.totalMessages)) {
            this.syncActiveSessionMessageCount(res.totalMessages);
        }
        if (this.mainTab === 'sessions' && this.sessionPreviewRenderEnabled) {
            const preserveVisibleCount = !!options.preserveVisibleCount;
            const pendingVisibleRaw = Number(this.sessionPreviewPendingVisibleCount);
            const pendingVisible = Number.isFinite(pendingVisibleRaw)
                ? Math.max(0, Math.floor(pendingVisibleRaw))
                : 0;
            if (preserveVisibleCount && pendingVisible > 0) {
                this.sessionPreviewVisibleCount = Math.min(pendingVisible, this.activeSessionMessages.length);
            } else {
                this.primeSessionPreviewMessageRender();
            }
        }
        this.sessionPreviewPendingVisibleCount = 0;
        this.$nextTick(() => {
            if (this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) {
                return;
            }
            this.updateSessionTimelineOffset();
            if (this.sessionTimelineEnabled) {
                this.scheduleSessionTimelineSync();
            }
        });
    } catch (e) {
        if (requestSeq !== this.sessionDetailRequestSeq) {
            return;
        }
        this.activeSessionMessages = [];
        this.sessionPreviewPendingVisibleCount = 0;
        this.resetSessionPreviewMessageRender();
        this.activeSessionDetailClipped = false;
        this.activeSessionDetailError = '加载会话内容失败: ' + e.message;
        this.cancelSessionTimelineSync();
        this.sessionTimelineActiveKey = '';
        this.sessionMessageRefMap = Object.create(null);
    } finally {
        if (requestSeq === this.sessionDetailRequestSeq) {
            this.sessionDetailLoading = false;
        }
    }
}

export async function loadMoreSessionMessages(stepSize) {
    if (this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) {
        return;
    }
    const total = Array.isArray(this.activeSessionMessages)
        ? this.activeSessionMessages.length
        : 0;
    if (total <= 0) {
        this.sessionPreviewVisibleCount = 0;
        return;
    }
    const step = Number.isFinite(stepSize)
        ? Math.max(1, Math.floor(stepSize))
        : (Number.isFinite(this.sessionPreviewLoadStep)
            ? Math.max(1, Math.floor(this.sessionPreviewLoadStep))
            : 40);
    const current = Number.isFinite(this.sessionPreviewVisibleCount)
        ? Math.max(0, Math.floor(this.sessionPreviewVisibleCount))
        : 0;
    const targetVisible = current + step;
    if (targetVisible <= total) {
        this.sessionPreviewVisibleCount = Math.min(total, targetVisible);
        return;
    }

    this.sessionPreviewVisibleCount = total;
    if (this.sessionDetailLoading) {
        return;
    }

    const totalKnownRaw = Number(this.activeSession && this.activeSession.messageCount);
    const totalKnown = Number.isFinite(totalKnownRaw)
        ? Math.max(0, Math.floor(totalKnownRaw))
        : 0;
    const hasMoreOnDisk = this.activeSessionDetailClipped || (totalKnown > total);
    if (!hasMoreOnDisk) {
        return;
    }

    const currentLimitRaw = Number(this.sessionDetailMessageLimit);
    const currentLimit = Number.isFinite(currentLimitRaw)
        ? Math.max(1, Math.floor(currentLimitRaw))
        : Math.max(1, total);
    const fetchStep = Number.isFinite(this.sessionDetailFetchStep)
        ? Math.max(1, Math.floor(this.sessionDetailFetchStep))
        : 80;
    const limitCapRaw = Number(this.sessionDetailMessageLimitCap);
    const limitCap = Number.isFinite(limitCapRaw)
        ? Math.max(1, Math.floor(limitCapRaw))
        : 1000;

    let nextLimit = Math.max(currentLimit + fetchStep, targetVisible);
    if (totalKnown > 0) {
        nextLimit = Math.min(nextLimit, totalKnown);
    }
    nextLimit = Math.min(nextLimit, limitCap);
    if (nextLimit <= currentLimit) {
        return;
    }

    this.sessionPreviewPendingVisibleCount = targetVisible;
    this.sessionDetailMessageLimit = nextLimit;
    this.sessionPreviewLoadingMore = true;
    try {
        await this.loadActiveSessionDetail({ preserveVisibleCount: true });
    } finally {
        this.sessionPreviewLoadingMore = false;
    }
}
