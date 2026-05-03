import { buildSessionListParams } from './logic.mjs';
import { getPluginEntry } from '../plugins/registry.mjs';

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

function hasOwnOption(options, key) {
    return !!options && typeof options === 'object' && Object.prototype.hasOwnProperty.call(options, key);
}

function normalizeSessionLoadOptions(options = {}) {
    const normalized = options && typeof options === 'object' ? options : {};
    const hasIncludeActiveDetail = hasOwnOption(normalized, 'includeActiveDetail');
    return {
        hasIncludeActiveDetail,
        includeActiveDetail: hasIncludeActiveDetail
            ? normalized.includeActiveDetail !== false
            : false,
        forceRefresh: !!normalized.forceRefresh
    };
}

function mergeSessionLoadOptions(baseOptions = {}, nextOptions = {}) {
    const base = normalizeSessionLoadOptions(baseOptions);
    const next = normalizeSessionLoadOptions(nextOptions);
    return {
        hasIncludeActiveDetail: base.hasIncludeActiveDetail || next.hasIncludeActiveDetail,
        includeActiveDetail: (base.hasIncludeActiveDetail && base.includeActiveDetail)
            || (next.hasIncludeActiveDetail && next.includeActiveDetail),
        forceRefresh: base.forceRefresh || next.forceRefresh
    };
}

function shouldIncludeActiveSessionDetail(vm, options = {}) {
    if (options.hasIncludeActiveDetail) {
        return options.includeActiveDetail;
    }
    return vm.mainTab === 'sessions' || !!vm.sessionStandalone;
}

function emitSessionLoadDebug(vm, step, details = '') {
    if (!vm || typeof vm.emitSessionLoadNativeDialog !== 'function') {
        return;
    }
    vm.emitSessionLoadNativeDialog(step, details);
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
            emitSessionLoadDebug(vm, 'scheduleSessionDetailHydration:skip-existing-messages', `messages=${currentMessages.length}`);
            return;
        }
        emitSessionLoadDebug(vm, 'scheduleSessionDetailHydration:run', `sessionId=${vm.activeSession && vm.activeSession.sessionId ? vm.activeSession.sessionId : ''}`);
        void vm.loadActiveSessionDetail(options);
    };
    if (typeof vm.scheduleAfterFrame === 'function') {
        emitSessionLoadDebug(vm, 'scheduleSessionDetailHydration:queued');
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
    const enteringOrchestrationTab = nextTab === 'orchestration';
    const enteringPluginsTab = nextTab === 'plugins';
    emitSessionLoadDebug(this, 'switchMainTab:start', `from=${previousTab}\nto=${nextTab}`);
    this.mainTab = nextTab;

    if (leavingSessions) {
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
        emitSessionLoadDebug(
            this,
            'switchMainTab:enter-sessions',
            `sessionsLoadedOnce=${!!this.sessionsLoadedOnce}\nstagedDetail=${canStageInitialSessionDetail}`
        );
        const loadResult = this.loadSessions({
            includeActiveDetail: !canStageInitialSessionDetail
        });
        if (canStageInitialSessionDetail) {
            void Promise.resolve(loadResult)
                .then(() => {
                    emitSessionLoadDebug(this, 'switchMainTab:loadSessions-resolved');
                    scheduleSessionDetailHydration(this);
                })
                .catch((error) => {
                    emitSessionLoadDebug(
                        this,
                        'switchMainTab:loadSessions-rejected',
                        error && error.message ? error.message : String(error)
                    );
                });
        }
    }
    if (enteringUsageTab && !this.sessionsUsageLoadedOnce && typeof this.loadSessionsUsage === 'function') {
        this.loadSessionsUsage();
    }
    if (enteringOrchestrationTab && typeof this.loadTaskOrchestrationOverview === 'function') {
        let orchestrationOverviewLoad = null;
        try {
            orchestrationOverviewLoad = this.loadTaskOrchestrationOverview({
                silent: true,
                includeDetail: true
            });
        } catch (_) {
            orchestrationOverviewLoad = null;
        }
        void Promise.resolve(orchestrationOverviewLoad).catch(() => {});
    }
    if (nextTab !== 'orchestration' && typeof this.stopTaskOrchestrationPolling === 'function') {
        this.stopTaskOrchestrationPolling();
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
    if (enteringPluginsTab && typeof this.loadPluginsOverview === 'function') {
        const requested = typeof this.pluginsRequestedId === 'string' ? this.pluginsRequestedId.trim() : '';
        this.pluginsRequestedId = '';
        const requestedEntry = requested ? getPluginEntry(requested) : null;
        const targetPluginId = requestedEntry ? requested : 'prompt-templates';
        this.pluginsActiveId = targetPluginId;
        this.promptComposerPickerVisible = false;
        if (targetPluginId === 'prompt-templates') {
            this.promptTemplatesMode = 'compose';
        }
        let pluginsLoad = null;
        try {
            pluginsLoad = this.loadPluginsOverview({ silent: true });
        } catch (_) {
            pluginsLoad = null;
        }
        void Promise.resolve(pluginsLoad).catch(() => {});
    }
    if (nextTab === 'svn') {
        if (typeof this.restoreSvnLogBrowserPrefs === 'function') {
            this.restoreSvnLogBrowserPrefs();
        }
        if (typeof this.$nextTick === 'function') {
            this.$nextTick(() => {
                const input = this.$refs && this.$refs.svnLogBrowserUrlInput
                    ? this.$refs.svnLogBrowserUrlInput
                    : null;
                if (input && typeof input.focus === 'function') input.focus();
            });
        }
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
    if (this.sessionsLoading) {
        this.__sessionPendingLoadOptions = mergeSessionLoadOptions(
            this.__sessionPendingLoadOptions,
            options
        );
        emitSessionLoadDebug(this, 'loadSessions:queued-while-busy');
        return;
    }
    const normalizedOptions = normalizeSessionLoadOptions(options);
    const includeActiveDetail = shouldIncludeActiveSessionDetail(this, normalizedOptions);
    this.sessionsLoading = true;
    this.activeSessionDetailError = '';
    let loadSucceeded = false;
    const params = buildSessionListParams({
        source: this.sessionFilterSource,
        pathFilter: this.sessionPathFilter,
        query: this.sessionQuery,
        roleFilter: this.sessionRoleFilter,
        timeRangePreset: this.sessionTimePreset,
        forceRefresh: normalizedOptions.forceRefresh
    });
    emitSessionLoadDebug(
        this,
        'loadSessions:start',
        `source=${params.source || ''}\nforceRefresh=${!!params.forceRefresh}\nincludeActiveDetail=${includeActiveDetail}`
    );
    let pendingOptions = null;
    try {
        const res = await api('list-sessions', params);
        if (res.error) {
            emitSessionLoadDebug(this, 'loadSessions:error-response', `error=${res.error}`);
            this.showMessage(res.error, 'error');
            this.sessionsList = [];
            if (typeof this.primeSessionListRender === 'function') {
                this.primeSessionListRender();
            }
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
            this.sessionsList = Array.isArray(res.sessions) ? res.sessions : [];
            emitSessionLoadDebug(this, 'loadSessions:response', `sessions=${this.sessionsList.length}`);
            if (typeof this.primeSessionListRender === 'function') {
                this.primeSessionListRender();
            }
            this.syncSessionPathOptionsForSource(
                this.sessionFilterSource,
                this.extractPathOptionsFromSessions(this.sessionsList),
                true
            );
            if (this.sessionsList.length === 0) {
                emitSessionLoadDebug(this, 'loadSessions:empty');
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
                this.activeSession = matched || this.sessionsList[0];
                emitSessionLoadDebug(
                    this,
                    'loadSessions:active-session-selected',
                    `sessionId=${this.activeSession && this.activeSession.sessionId ? this.activeSession.sessionId : ''}`
                );
                this.activeSessionMessages = [];
                this.resetSessionDetailPagination();
                this.resetSessionPreviewMessageRender();
                this.activeSessionDetailError = '';
                this.activeSessionDetailClipped = false;
                this.cancelSessionTimelineSync();
                this.sessionTimelineActiveKey = '';
                clearSessionTimelineRefs(this);
                if (includeActiveDetail) {
                    emitSessionLoadDebug(
                        this,
                        'loadSessions:hydrate-active-detail',
                        `sessionId=${this.activeSession && this.activeSession.sessionId ? this.activeSession.sessionId : ''}`
                    );
                    await this.loadActiveSessionDetail();
                }
            }
        }
    } catch (e) {
        emitSessionLoadDebug(this, 'loadSessions:exception', e && e.message ? e.message : String(e));
        this.sessionsList = [];
        if (typeof this.primeSessionListRender === 'function') {
            this.primeSessionListRender();
        }
        this.activeSession = null;
        this.activeSessionMessages = [];
        this.resetSessionDetailPagination();
        this.resetSessionPreviewMessageRender();
        this.activeSessionDetailClipped = false;
        this.cancelSessionTimelineSync();
        this.sessionTimelineActiveKey = '';
        clearSessionTimelineRefs(this);
        this.showMessage('加载会话失败', 'error');
    } finally {
        this.sessionsLoading = false;
        if (loadSucceeded) {
            this.sessionsLoadedOnce = true;
        }
        pendingOptions = this.__sessionPendingLoadOptions || null;
        this.__sessionPendingLoadOptions = null;
        emitSessionLoadDebug(
            this,
            'loadSessions:complete',
            `loadSucceeded=${loadSucceeded}\npendingReload=${!!pendingOptions}`
        );
    }
    if (pendingOptions) {
        emitSessionLoadDebug(this, 'loadSessions:replay-pending-request');
        return loadSessions.call(this, api, pendingOptions);
    }
}

export async function loadActiveSessionDetail(api, options = {}) {
    if (!this.activeSession) {
        emitSessionLoadDebug(this, 'loadActiveSessionDetail:skip-no-active-session');
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

    const currentActiveSession = this.activeSession;
    const requestSeq = ++this.sessionDetailRequestSeq;
    this.sessionDetailLoading = true;
    this.activeSessionDetailError = '';
    emitSessionLoadDebug(
        this,
        'loadActiveSessionDetail:start',
        `sessionId=${currentActiveSession && currentActiveSession.sessionId ? currentActiveSession.sessionId : ''}\nrequestSeq=${requestSeq}`
    );
    const fallbackLimit = Number.isFinite(this.sessionDetailInitialMessageLimit)
        ? Math.max(1, Math.floor(this.sessionDetailInitialMessageLimit))
        : 80;
    const rawLimit = Number(this.sessionDetailMessageLimit);
    const messageLimit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.floor(rawLimit))
        : fallbackLimit;
    const preview = this.mainTab === 'sessions' && !this.sessionStandalone;
    try {
        const res = await api('session-detail', {
            source: this.activeSession.source,
            sessionId: this.activeSession.sessionId,
            filePath: this.activeSession.filePath,
            messageLimit,
            preview
        });

        if (requestSeq !== this.sessionDetailRequestSeq) {
            emitSessionLoadDebug(this, 'loadActiveSessionDetail:stale-request-seq', `requestSeq=${requestSeq}`);
            return;
        }
        if (!this.activeSession || this.activeSession !== currentActiveSession) {
            emitSessionLoadDebug(this, 'loadActiveSessionDetail:active-session-changed', `requestSeq=${requestSeq}`);
            return;
        }

        if (res.error) {
            emitSessionLoadDebug(this, 'loadActiveSessionDetail:error-response', `error=${res.error}`);
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
        emitSessionLoadDebug(
            this,
            'loadActiveSessionDetail:messages-ready',
            `sessionId=${currentActiveSession && currentActiveSession.sessionId ? currentActiveSession.sessionId : ''}\nmessages=${normalizedMessages.length}\nclipped=${!!res.clipped}`
        );
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
        if (typeof res.derived === 'boolean') {
            this.activeSession.derived = res.derived;
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
                const currentSession = this.activeSession;
                const syncTask = () => {
                    if (this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) {
                        return;
                    }
                    if (!this.activeSession || this.activeSession !== currentSession) {
                        return;
                    }
                    this.scheduleSessionTimelineSync();
                };
                if (typeof this.scheduleAfterFrame === 'function') {
                    this.scheduleAfterFrame(syncTask);
                    return;
                }
                syncTask();
            }
        });
    } catch (e) {
        if (requestSeq !== this.sessionDetailRequestSeq) {
            emitSessionLoadDebug(this, 'loadActiveSessionDetail:ignore-exception-stale-request', `requestSeq=${requestSeq}`);
            return;
        }
        if (!this.activeSession || this.activeSession !== currentActiveSession) {
            emitSessionLoadDebug(this, 'loadActiveSessionDetail:ignore-exception-session-changed', `requestSeq=${requestSeq}`);
            return;
        }
        emitSessionLoadDebug(this, 'loadActiveSessionDetail:exception', e && e.message ? e.message : String(e));
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
            this.sessionDetailLoading = false;
        }
        emitSessionLoadDebug(this, 'loadActiveSessionDetail:complete', `requestSeq=${requestSeq}`);
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
    if (totalKnown > total) {
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
