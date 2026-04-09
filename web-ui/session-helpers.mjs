import { buildSessionListParams } from './logic.mjs';

const SESSION_LIST_REQUEST_TIMEOUT_MS = 20000;
const SESSION_DETAIL_REQUEST_TIMEOUT_MS = 15000;

function clearSessionTimelineRefs(vm) {
    if (typeof vm.clearSessionTimelineRefs === 'function') {
        vm.clearSessionTimelineRefs();
        return;
    }
    vm.sessionMessageRefMap = Object.create(null);
    if (vm && typeof vm === 'object' && Object.prototype.hasOwnProperty.call(vm, 'sessionMessageRefBinderMap')) {
        vm.sessionMessageRefBinderMap = Object.create(null);
    }
}

function cancelActiveSessionDetailRequest(vm) {
    if (!vm || !vm.__sessionDetailAbortController || typeof vm.__sessionDetailAbortController.abort !== 'function') {
        return;
    }
    try {
        vm.__sessionDetailAbortController.abort();
    } catch (_) {}
    vm.__sessionDetailAbortController = null;
}

function cancelActiveSessionsListRequest(vm) {
    if (!vm || !vm.__sessionsListAbortController || typeof vm.__sessionsListAbortController.abort !== 'function') {
        return;
    }
    try {
        vm.__sessionsListAbortController.abort();
    } catch (_) {}
    vm.__sessionsListAbortController = null;
}

function resolveSessionListRequestLimit(vm, options = {}) {
    const rawExplicitLimit = Number(options.limit);
    if (Number.isFinite(rawExplicitLimit)) {
        return Math.max(1, Math.floor(rawExplicitLimit));
    }

    const rawPersistedLimit = Number(vm && vm.sessionListRequestLimit);
    if (Number.isFinite(rawPersistedLimit) && rawPersistedLimit > 0 && options.resetLimit !== true) {
        return Math.max(1, Math.floor(rawPersistedLimit));
    }

    const rawInitialLimit = Number(vm && vm.sessionListInitialFetchLimit);
    if (Number.isFinite(rawInitialLimit) && rawInitialLimit > 0) {
        return Math.max(1, Math.floor(rawInitialLimit));
    }

    return 10;
}

function applySessionListRenderState(vm, options = {}) {
    if (!vm) {
        return;
    }

    if (Number.isFinite(Number(options.visibleCount))) {
        const total = Array.isArray(vm.sessionsList) ? vm.sessionsList.length : 0;
        vm.sessionListVisibleCount = Math.min(
            total,
            Math.max(0, Math.floor(Number(options.visibleCount)))
        );
        if (typeof vm.$nextTick === 'function' && typeof vm.scheduleSessionListViewportFill === 'function') {
            vm.$nextTick(() => {
                if (vm.mainTab !== 'sessions' || !vm.sessionListRenderEnabled) {
                    return;
                }
                vm.scheduleSessionListViewportFill();
            });
        }
        return;
    }

    if (typeof vm.primeSessionListRender === 'function') {
        vm.primeSessionListRender();
    }
}

function scheduleSessionDetailHydration(vm, options = {}) {
    if (!vm || typeof vm.loadActiveSessionDetail !== 'function') {
        return;
    }
    const hydrationTicket = (Number(vm.__sessionDetailHydrationTicket) || 0) + 1;
    vm.__sessionDetailHydrationTicket = hydrationTicket;
    const task = () => {
        if (hydrationTicket !== Number(vm.__sessionDetailHydrationTicket || 0)) return;
        if (!vm.activeSession) return;
        if (vm.mainTab !== 'sessions' && !vm.sessionStandalone) return;
        if (vm.sessionDetailLoading) return;
        const currentMessages = Array.isArray(vm.activeSessionMessages) ? vm.activeSessionMessages : [];
        if (!options.force && currentMessages.length > 0) {
            return;
        }
        void vm.loadActiveSessionDetail(options);
    };
    if (typeof vm.scheduleAfterFrame === 'function') {
        vm.scheduleAfterFrame(task);
        return;
    }
    task();
}

export function switchMainTab(tab) {
    const nextTab = typeof tab === 'string' ? tab : '';
    const previousTab = this.mainTab;
    const leavingSessions = previousTab === 'sessions' && nextTab !== 'sessions';
    const enteringSessionsTab = nextTab === 'sessions';
    const enteringUsageTab = nextTab === 'usage';
    this.mainTab = nextTab;

    if (leavingSessions) {
        cancelActiveSessionsListRequest(this);
        this.sessionsLoading = false;
        this.sessionListLoadingMore = false;
        cancelActiveSessionDetailRequest(this);
        this.sessionDetailLoading = false;
        const teardown = () => {
            if (this.mainTab === 'sessions') return;
            if (typeof this.finalizeSessionTabTeardown === 'function') {
                if (typeof this.suspendSessionTabRender === 'function') {
                    this.suspendSessionTabRender();
                }
                this.finalizeSessionTabTeardown();
                return;
            }
            if (typeof this.teardownSessionTabRender === 'function') {
                this.teardownSessionTabRender();
            }
        };
        if (typeof this.scheduleSessionTabDeferredTeardown === 'function') {
            this.scheduleSessionTabDeferredTeardown(teardown);
        } else if (typeof this.scheduleAfterFrame === 'function') {
            this.scheduleAfterFrame(teardown);
        } else {
            teardown();
        }
    }

    if (enteringSessionsTab && !this.sessionsLoadedOnce) {
        const canStageInitialSessionDetail = typeof this.scheduleAfterFrame === 'function';
        const loadResult = this.loadSessions({
            includeActiveDetail: !canStageInitialSessionDetail
        });
        if (canStageInitialSessionDetail) {
            void Promise.resolve(loadResult)
                .then(() => {
                    scheduleSessionDetailHydration(this);
                })
                .catch(() => {});
        }
    }
    if (enteringUsageTab && !this.sessionsUsageLoadedOnce && typeof this.loadSessionsUsage === 'function') {
        this.loadSessionsUsage();
    }
    if (nextTab === 'sessions') {
        this.prepareSessionTabRender();
    }
    const shouldLoadTrashListOnSettingsEnter = nextTab === 'settings'
        && this.settingsTab === 'trash'
        && typeof this.loadSessionTrash === 'function';
    if (shouldLoadTrashListOnSettingsEnter) {
        this.loadSessionTrash({
            forceRefresh: !!this.sessionTrashLoadedOnce
        });
    }
    const shouldPrimeTrashCountOnSettingsEnter = nextTab === 'settings'
        && this.settingsTab !== 'trash'
        && typeof this.loadSessionTrashCount === 'function';
    if (shouldPrimeTrashCountOnSettingsEnter) {
        this.sessionTrashLoadedOnce = false;
        this.loadSessionTrashCount({ silent: true });
    }
    const shouldLoadSkillsMarketOnEnter = nextTab === 'market'
        && previousTab !== 'market'
        && typeof this.loadSkillsMarketOverview === 'function';
    if (shouldLoadSkillsMarketOnEnter) {
        let marketOverviewLoad = null;
        try {
            marketOverviewLoad = this.loadSkillsMarketOverview({ silent: true });
        } catch (_) {
            marketOverviewLoad = null;
        }
        void Promise.resolve(marketOverviewLoad).catch(() => {});
    }
    if (nextTab === 'config' && this.configMode === 'claude') {
        const expectedTab = nextTab;
        const expectedConfigMode = this.configMode;
        const refresh = () => {
            if (this.mainTab !== expectedTab || this.configMode !== expectedConfigMode) return;
            this.refreshClaudeModelContext();
        };
        if (typeof this.scheduleAfterFrame === 'function') {
            this.scheduleAfterFrame(refresh);
        } else {
            refresh();
        }
    }
}

export async function loadSessions(api, options = {}) {
    const normalizedOptions = options && typeof options === 'object' && !Array.isArray(options)
        ? options
        : {};
    const requestLimit = resolveSessionListRequestLimit(this, normalizedOptions);
    const preserveExistingList = normalizedOptions.preserveExistingList === true
        && Array.isArray(this.sessionsList)
        && this.sessionsList.length > 0;
    const preserveActiveDetail = preserveExistingList && normalizedOptions.preserveActiveDetail === true;
    const preserveVisibleCount = Number.isFinite(Number(normalizedOptions.preserveVisibleCount))
        ? Math.max(0, Math.floor(Number(normalizedOptions.preserveVisibleCount)))
        : null;
    cancelActiveSessionsListRequest(this);
    const requestSeq = (Number(this.__sessionsListRequestSeq) || 0) + 1;
    this.__sessionsListRequestSeq = requestSeq;
    const requestController = typeof AbortController !== 'undefined'
        ? new AbortController()
        : null;
    this.__sessionsListAbortController = requestController;
    this.sessionsLoading = !preserveExistingList;
    this.sessionListLoadingMore = preserveExistingList;
    this.sessionsError = '';
    this.activeSessionDetailError = '';
    let loadSucceeded = false;
    const includeActiveDetail = Object.prototype.hasOwnProperty.call(normalizedOptions, 'includeActiveDetail')
        ? !!normalizedOptions.includeActiveDetail
        : (this.mainTab === 'sessions' || !!this.sessionStandalone);
    const params = buildSessionListParams({
        source: this.sessionFilterSource,
        pathFilter: this.sessionPathFilter,
        query: this.sessionQuery,
        roleFilter: this.sessionRoleFilter,
        timeRangePreset: this.sessionTimePreset,
        limit: requestLimit
    });
    try {
        const res = await api('list-sessions', params, {
            signal: requestController ? requestController.signal : undefined,
            timeoutMs: SESSION_LIST_REQUEST_TIMEOUT_MS
        });
        if (requestSeq !== Number(this.__sessionsListRequestSeq || 0)) {
            return;
        }
        if (res.error) {
            this.sessionsError = res.error;
            this.showMessage(res.error, 'error');
            if (preserveExistingList) {
                return;
            }
            this.sessionsList = [];
            this.sessionListHasMoreData = false;
            applySessionListRenderState(this);
            this.activeSession = null;
            this.activeSessionMessages = [];
            this.resetSessionDetailPagination();
            this.resetSessionPreviewMessageRender();
            this.activeSessionDetailClipped = false;
            this.cancelSessionTimelineSync();
            this.sessionTimelineActiveKey = '';
            clearSessionTimelineRefs(this);
        } else {
            loadSucceeded = true;
            this.sessionsError = '';
            this.sessionsList = Array.isArray(res.sessions) ? res.sessions : [];
            this.sessionListRequestLimit = requestLimit;
            this.sessionListHasMoreData = this.sessionsList.length >= requestLimit;
            applySessionListRenderState(this, {
                visibleCount: preserveVisibleCount
            });
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
                clearSessionTimelineRefs(this);
            } else {
                const oldKey = this.activeSession ? this.getSessionExportKey(this.activeSession) : '';
                const matched = this.sessionsList.find(item => this.getSessionExportKey(item) === oldKey);
                if (preserveActiveDetail && matched) {
                    this.activeSession = matched;
                } else {
                    this.activeSession = matched || this.sessionsList[0];
                    this.activeSessionMessages = [];
                    this.resetSessionDetailPagination();
                    this.resetSessionPreviewMessageRender();
                    this.activeSessionDetailError = '';
                    this.activeSessionDetailClipped = false;
                    this.cancelSessionTimelineSync();
                    this.sessionTimelineActiveKey = '';
                    clearSessionTimelineRefs(this);
                }
                if (!preserveActiveDetail && includeActiveDetail) {
                    await this.loadActiveSessionDetail();
                }
            }
        }
    } catch (e) {
        if (requestSeq !== Number(this.__sessionsListRequestSeq || 0)) {
            return;
        }
        if (requestController && requestController.signal && requestController.signal.aborted) {
            this.sessionsError = '';
            return;
        }
        if (preserveExistingList) {
            this.sessionsError = '加载会话失败: ' + e.message;
            this.showMessage(this.sessionsError, 'error');
            return;
        }
        this.sessionsList = [];
        this.sessionListHasMoreData = false;
        applySessionListRenderState(this);
        this.activeSession = null;
        this.activeSessionMessages = [];
        this.resetSessionDetailPagination();
        this.resetSessionPreviewMessageRender();
        this.activeSessionDetailClipped = false;
        this.cancelSessionTimelineSync();
        this.sessionTimelineActiveKey = '';
        clearSessionTimelineRefs(this);
        this.sessionsError = '加载会话失败: ' + e.message;
        this.showMessage(this.sessionsError, 'error');
    } finally {
        if (requestSeq === Number(this.__sessionsListRequestSeq || 0)) {
            if (this.__sessionsListAbortController === requestController) {
                this.__sessionsListAbortController = null;
            }
            this.sessionsLoading = false;
            this.sessionListLoadingMore = false;
            if (loadSucceeded) {
                this.sessionsLoadedOnce = true;
            }
        }
    }
}

export async function loadActiveSessionDetail(api, options = {}) {
    if (!this.activeSession) {
        cancelActiveSessionDetailRequest(this);
        this.sessionDetailLoading = false;
        this.activeSessionMessages = [];
        this.resetSessionDetailPagination();
        this.resetSessionPreviewMessageRender();
        this.activeSessionDetailError = '';
        this.activeSessionDetailClipped = false;
        this.cancelSessionTimelineSync();
        this.sessionTimelineActiveKey = '';
        clearSessionTimelineRefs(this);
        return;
    }

    this.__sessionDetailHydrationTicket = (Number(this.__sessionDetailHydrationTicket) || 0) + 1;
    const currentActiveSession = this.activeSession;
    cancelActiveSessionDetailRequest(this);
    const requestSeq = ++this.sessionDetailRequestSeq;
    const requestController = typeof AbortController !== 'undefined'
        ? new AbortController()
        : null;
    this.__sessionDetailAbortController = requestController;
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
        }, {
            signal: requestController ? requestController.signal : undefined,
            timeoutMs: SESSION_DETAIL_REQUEST_TIMEOUT_MS
        });

        if (requestSeq !== this.sessionDetailRequestSeq) {
            return;
        }
        if (!this.activeSession || this.activeSession !== currentActiveSession) {
            return;
        }

        if (res.error) {
            this.activeSessionMessages = [];
            this.resetSessionPreviewMessageRender();
            this.activeSessionDetailClipped = false;
            this.activeSessionDetailError = res.error;
            this.cancelSessionTimelineSync();
            this.sessionTimelineActiveKey = '';
            clearSessionTimelineRefs(this);
            return;
        }

        const rawMessages = Array.isArray(res.messages) ? res.messages : [];
        const normalizedMessages = rawMessages.map((message) => Object.freeze(this.normalizeSessionMessage(message)));
        this.activeSessionMessages = Object.freeze(normalizedMessages);
        if (typeof this.invalidateSessionTimelineMeasurementCache === 'function') {
            this.invalidateSessionTimelineMeasurementCache(true);
        }
        this.activeSessionDetailClipped = !!res.clipped;
        const responseLimitRaw = Number(res.messageLimit);
        this.sessionDetailMessageLimit = Number.isFinite(responseLimitRaw)
            ? Math.max(1, Math.floor(responseLimitRaw))
            : messageLimit;
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
        if (!this.activeSession || this.activeSession !== currentActiveSession) {
            return;
        }
        if (requestController && requestController.signal && requestController.signal.aborted) {
            this.activeSessionDetailError = '';
            return;
        }
        this.activeSessionMessages = [];
        this.sessionPreviewPendingVisibleCount = 0;
        this.resetSessionPreviewMessageRender();
        this.activeSessionDetailClipped = false;
        this.activeSessionDetailError = '加载会话内容失败: ' + e.message;
        this.cancelSessionTimelineSync();
        this.sessionTimelineActiveKey = '';
        clearSessionTimelineRefs(this);
    } finally {
        if (requestSeq === this.sessionDetailRequestSeq) {
            if (this.__sessionDetailAbortController === requestController) {
                this.__sessionDetailAbortController = null;
            }
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
