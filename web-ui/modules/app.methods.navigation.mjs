export function createNavigationMethods(options = {}) {
    const {
        configModeSet,
        switchMainTabHelper,
        loadMoreSessionMessagesHelper
    } = options;
    const NAV_STATE_STORAGE_KEY = 'codexmateNavState.v1';
    const MAIN_TAB_SET = new Set([
        'dashboard',
        'config',
        'sessions',
        'usage',
        'orchestration',
        'market',
        'plugins',
        'svn',
        'docs',
        'settings'
    ]);
    const loadDoctorOverview = async (vm, options = {}) => {
        if (!vm || typeof vm !== 'object') return false;
        if (vm.__doctorLoading) return false;
        const forceRefresh = !!(options && options.forceRefresh);
        vm.__doctorLoading = true;
        let ok = true;
        try {
            if (typeof vm.runHealthCheck === 'function') {
                await vm.runHealthCheck({ doctor: true, silent: true, forceRefresh });
            }
            vm.__doctorLoadedOnce = true;
            return true;
        } catch (_) {
            ok = false;
            vm.__doctorLoadedOnce = true;
            return false;
        } finally {
            vm.__doctorLoading = false;
            if (!ok) {
                vm.__doctorLoadedOnce = true;
            }
        }
    };
    const readNavState = () => {
        if (typeof localStorage === 'undefined') return null;
        let raw = '';
        try {
            raw = localStorage.getItem(NAV_STATE_STORAGE_KEY) || '';
        } catch (_) {
            raw = '';
        }
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (_) {
            return null;
        }
    };
    const persistNavState = (vm) => {
        if (!vm || vm.__navStateRestoring) return;
        if (typeof localStorage === 'undefined') return;
        const mainTab = typeof vm.mainTab === 'string' ? vm.mainTab.trim().toLowerCase() : '';
        const configMode = typeof vm.configMode === 'string' ? vm.configMode.trim().toLowerCase() : '';
        const snapshot = {
            mainTab: MAIN_TAB_SET.has(mainTab) ? mainTab : 'dashboard',
            configMode: configModeSet && configModeSet.has(configMode) ? configMode : 'codex'
        };
        try {
            localStorage.setItem(NAV_STATE_STORAGE_KEY, JSON.stringify(snapshot));
        } catch (_) {}
    };

    return {
        switchConfigMode(mode) {
            const normalizedMode = typeof mode === 'string'
                ? mode.trim().toLowerCase()
                : '';
            this.cancelTouchNavIntentReset();
            if (typeof this.ensureMainTabSwitchState === 'function') {
                this.ensureMainTabSwitchState().pendingConfigMode = '';
            }
            this.configMode = configModeSet.has(normalizedMode) ? normalizedMode : 'codex';
            if (this.mainTab === 'config') {
                if (this.configMode === 'claude') {
                    const expectedMainTab = 'config';
                    const expectedConfigMode = 'claude';
                    const refresh = () => {
                        if (this.mainTab !== expectedMainTab || this.configMode !== expectedConfigMode) {
                            return;
                        }
                        this.refreshClaudeModelContext();
                    };
                    if (typeof this.scheduleAfterFrame === 'function') {
                        this.scheduleAfterFrame(refresh);
                    } else {
                        refresh();
                    }
                }
                this.scheduleAfterFrame(() => {
                    this.clearMainTabSwitchIntent('config');
                });
                persistNavState(this);
                return;
            }
            this.switchMainTab('config');
        },

        ensureMainTabSwitchState() {
            if (this.__mainTabSwitchState) {
                return this.__mainTabSwitchState;
            }
            this.__mainTabSwitchState = {
                intent: '',
                pendingTarget: '',
                pendingConfigMode: '',
                ticket: 0
            };
            return this.__mainTabSwitchState;
        },
        ensureImmediateNavDomState() {
            if (typeof document === 'undefined') {
                return {
                    navNodes: [],
                    sessionPanelEl: null
                };
            }
            if (!this.__immediateNavDomState) {
                this.__immediateNavDomState = {
                    navNodes: [],
                    sessionPanelEl: null
                };
            }
            const state = this.__immediateNavDomState;
            const needsNavRefresh = !Array.isArray(state.navNodes)
                || !state.navNodes.length
                || state.navNodes.some((node) => !node || !node.isConnected);
            if (needsNavRefresh) {
                state.navNodes = Array.from(document.querySelectorAll('[data-main-tab]'));
            }
            if (!state.sessionPanelEl || !state.sessionPanelEl.isConnected) {
                state.sessionPanelEl = document.getElementById('panel-sessions');
            }
            return state;
        },
        setMainTabSwitchIntent(tab) {
            const normalizedTab = typeof tab === 'string'
                ? tab.trim().toLowerCase()
                : '';
            if (!normalizedTab) return;
            const state = this.ensureMainTabSwitchState();
            state.intent = normalizedTab;
        },
        cancelTouchNavIntentReset() {
            if (this.__touchNavIntentResetTimer) {
                clearTimeout(this.__touchNavIntentResetTimer);
                this.__touchNavIntentResetTimer = null;
            }
            this.__touchNavIntentResetToken = 0;
        },
        scheduleTouchNavIntentReset(kind, value) {
            const normalizedKind = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
            const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : '';
            if (!normalizedKind || !normalizedValue) {
                return;
            }
            const expectedIntent = normalizedKind === 'config' ? 'config' : normalizedValue;
            this.cancelTouchNavIntentReset();
            const token = (Number(this.__touchNavIntentResetToken) || 0) + 1;
            this.__touchNavIntentResetToken = token;
            this.__touchNavIntentResetTimer = setTimeout(() => {
                if (this.__touchNavIntentResetToken !== token) {
                    return;
                }
                this.__touchNavIntentResetTimer = null;
                this.__touchNavIntentResetToken = 0;
                const liveIntent = String(this.ensureMainTabSwitchState().intent || '').trim().toLowerCase();
                if (liveIntent !== expectedIntent) {
                    return;
                }
                this.clearMainTabSwitchIntent(expectedIntent);
            }, 1000);
        },
        applyImmediateNavIntent(tab, configMode = '') {
            if (typeof document === 'undefined') return;
            const normalizedTab = typeof tab === 'string' ? tab.trim().toLowerCase() : '';
            if (!normalizedTab) return;
            const normalizedMode = typeof configMode === 'string' ? configMode.trim().toLowerCase() : '';
            const domState = this.ensureImmediateNavDomState();
            const nodes = Array.isArray(domState.navNodes) ? domState.navNodes : [];
            for (const node of nodes) {
                if (!node || !node.classList) continue;
                const nodeTab = String(node.getAttribute('data-main-tab') || '').trim().toLowerCase();
                const nodeMode = String(node.getAttribute('data-config-mode') || '').trim().toLowerCase();
                let shouldActivate = nodeTab === normalizedTab;
                if (shouldActivate && normalizedTab === 'config') {
                    shouldActivate = nodeMode ? nodeMode === normalizedMode : false;
                }
                node.classList.toggle('nav-intent-active', !!shouldActivate);
                node.classList.toggle('nav-intent-inactive', !shouldActivate);
            }
        },
        clearImmediateNavIntent() {
            if (typeof document === 'undefined') return;
            const domState = this.ensureImmediateNavDomState();
            const nodes = Array.isArray(domState.navNodes) ? domState.navNodes : [];
            for (const node of nodes) {
                if (!node || !node.classList) continue;
                node.classList.remove('nav-intent-active');
                node.classList.remove('nav-intent-inactive');
            }
        },
        setSessionPanelFastHidden(hidden) {
            if (typeof document === 'undefined') return;
            const domState = this.ensureImmediateNavDomState();
            const panel = domState.sessionPanelEl;
            if (!panel || !panel.classList) return;
            panel.classList.toggle('session-panel-fast-hidden', !!hidden);
        },
        isSessionPanelFastHidden() {
            if (typeof document === 'undefined') return false;
            const domState = this.ensureImmediateNavDomState();
            const panel = domState.sessionPanelEl;
            return !!(panel && panel.classList && panel.classList.contains('session-panel-fast-hidden'));
        },
        recordPointerNavCommit(kind, value) {
            const normalizedKind = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
            const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : '';
            if (!normalizedKind || !normalizedValue) {
                this.__pointerNavCommitState = null;
                return;
            }
            this.__pointerNavCommitState = {
                kind: normalizedKind,
                value: normalizedValue,
                at: Date.now()
            };
        },
        consumePointerNavCommit(kind, value) {
            const normalizedKind = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
            const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : '';
            const state = this.__pointerNavCommitState;
            this.__pointerNavCommitState = null;
            if (!state || !normalizedKind || !normalizedValue) {
                return false;
            }
            if (state.kind !== normalizedKind || state.value !== normalizedValue) {
                return false;
            }
            return (Date.now() - Number(state.at || 0)) <= 1000;
        },
        onMainTabPointerDown(tab) {
            const event = arguments.length > 1 ? arguments[1] : null;
            if (event && typeof event.button === 'number' && event.button !== 0) {
                return;
            }
            const normalizedTab = typeof tab === 'string' ? tab.trim().toLowerCase() : '';
            if (!normalizedTab) return;
            this.setMainTabSwitchIntent(normalizedTab);
            this.applyImmediateNavIntent(normalizedTab);
            const shouldHideSessionPanel = this.mainTab === 'sessions' && normalizedTab !== 'sessions';
            this.setSessionPanelFastHidden(shouldHideSessionPanel);
            const pointerType = event && typeof event.pointerType === 'string'
                ? event.pointerType.trim().toLowerCase()
                : '';
            if (pointerType === 'touch') {
                this.scheduleTouchNavIntentReset('main', normalizedTab);
                return;
            }
            this.recordPointerNavCommit('main', normalizedTab);
            this.switchMainTab(normalizedTab);
        },
        onConfigTabPointerDown(mode) {
            const event = arguments.length > 1 ? arguments[1] : null;
            if (event && typeof event.button === 'number' && event.button !== 0) {
                return;
            }
            const normalizedMode = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
            if (!normalizedMode) return;
            this.setMainTabSwitchIntent('config');
            if (typeof this.ensureMainTabSwitchState === 'function') {
                this.ensureMainTabSwitchState().pendingConfigMode = normalizedMode;
            }
            this.applyImmediateNavIntent('config', normalizedMode);
            const shouldHideSessionPanel = this.mainTab === 'sessions';
            this.setSessionPanelFastHidden(shouldHideSessionPanel);
            const pointerType = event && typeof event.pointerType === 'string'
                ? event.pointerType.trim().toLowerCase()
                : '';
            if (pointerType === 'touch') {
                this.scheduleTouchNavIntentReset('config', normalizedMode);
                return;
            }
            this.recordPointerNavCommit('config', normalizedMode);
            this.switchConfigMode(normalizedMode);
        },
        onMainTabClick(tab) {
            const normalizedTab = typeof tab === 'string' ? tab.trim().toLowerCase() : '';
            if (!normalizedTab) return;
            if (this.consumePointerNavCommit('main', normalizedTab)) return;
            this.switchMainTab(normalizedTab);
        },
        onConfigTabClick(mode) {
            const normalizedMode = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
            if (!normalizedMode) return;
            if (this.consumePointerNavCommit('config', normalizedMode)) return;
            this.switchConfigMode(normalizedMode);
        },
        clearMainTabSwitchIntent(expectedTab = '') {
            const state = this.ensureMainTabSwitchState();
            if (expectedTab && state.intent && state.intent !== expectedTab) {
                return;
            }
            this.cancelTouchNavIntentReset();
            state.intent = '';
            state.pendingTarget = '';
            state.pendingConfigMode = '';
            this.clearImmediateNavIntent();
            this.setSessionPanelFastHidden(false);
        },
        getMainTabForNav() {
            const state = this.ensureMainTabSwitchState();
            return state.intent || this.mainTab;
        },
        isMainTabNavActive(tab) {
            return this.getMainTabForNav() === tab;
        },
        isConfigModeNavActive(mode) {
            if (!this.isMainTabNavActive('config')) {
                return false;
            }
            const state = this.ensureMainTabSwitchState();
            const pendingMode = typeof state.pendingConfigMode === 'string'
                ? state.pendingConfigMode.trim().toLowerCase()
                : '';
            if (state.intent === 'config' && pendingMode) {
                return pendingMode === mode;
            }
            return this.configMode === mode;
        },
        switchMainTab(tab) {
            const normalizedTab = typeof tab === 'string'
                ? tab.trim().toLowerCase()
                : '';
            const targetTab = normalizedTab || tab;
            if (!targetTab) return;
            if (targetTab === 'orchestration' && this.taskOrchestrationTabEnabled !== true) {
                return this.switchMainTab('config');
            }
            this.cancelTouchNavIntentReset();
            if (targetTab === 'sessions') {
                this.cancelScheduledSessionTabDeferredTeardown();
            }

            this.setMainTabSwitchIntent(targetTab);
            if (targetTab === 'config') {
                this.applyImmediateNavIntent('config', this.configMode);
            } else {
                this.applyImmediateNavIntent(targetTab);
            }

            const previousTab = this.mainTab;
            const switchState = this.ensureMainTabSwitchState();
            if (targetTab !== 'config') {
                switchState.pendingConfigMode = '';
            }
            if (targetTab === previousTab) {
                switchState.ticket += 1;
                switchState.pendingTarget = '';
                if (targetTab === 'dashboard' && !this.__doctorLoadedOnce) {
                    void loadDoctorOverview(this);
                }
                if (
                    targetTab === 'sessions'
                    && typeof this.prepareSessionTabRender === 'function'
                    && (!this.sessionListRenderEnabled || !this.sessionPreviewRenderEnabled)
                ) {
                    this.prepareSessionTabRender();
                }
                this.scheduleAfterFrame(() => {
                    this.clearMainTabSwitchIntent(normalizedTab);
                });
                return;
            }
            const isLeavingSessions = previousTab === 'sessions' && targetTab !== 'sessions';
            const shouldDeferApply = isLeavingSessions;
            if (isLeavingSessions && !this.isSessionPanelFastHidden()) {
                this.setSessionPanelFastHidden(true);
            }
            if (shouldDeferApply && typeof this.suspendSessionTabRender === 'function') {
                this.suspendSessionTabRender();
            }
            if (!shouldDeferApply) {
                switchState.ticket += 1;
                switchState.pendingTarget = '';
                const result = switchMainTabHelper.call(this, targetTab);
                persistNavState(this);
                if (targetTab === 'dashboard') {
                    void loadDoctorOverview(this);
                }
                this.scheduleAfterFrame(() => {
                    this.clearMainTabSwitchIntent(normalizedTab);
                });
                return result;
            }

            const ticket = ++switchState.ticket;
            switchState.pendingTarget = targetTab;
            this.scheduleAfterFrame(() => {
                const liveState = this.ensureMainTabSwitchState();
                if (ticket !== liveState.ticket) return;
                const pendingTarget = liveState.pendingTarget || targetTab;
                liveState.pendingTarget = '';
                switchMainTabHelper.call(this, pendingTarget);
                persistNavState(this);
                if (pendingTarget === 'dashboard') {
                    void loadDoctorOverview(this);
                }
                this.clearMainTabSwitchIntent(normalizedTab);
            });
        },

        scheduleAfterFrame(task) {
            const callback = typeof task === 'function' ? task : () => {};
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(callback);
                return;
            }
            setTimeout(callback, 16);
        },
        scheduleIdleTask(task, timeoutMs = 160) {
            const callback = typeof task === 'function' ? task : () => {};
            const timeout = Number.isFinite(timeoutMs)
                ? Math.max(16, Math.floor(timeoutMs))
                : 160;
            if (typeof requestIdleCallback === 'function') {
                const id = requestIdleCallback(callback, { timeout });
                return {
                    type: 'idle',
                    id
                };
            }
            const id = setTimeout(callback, timeout);
            return {
                type: 'timeout',
                id
            };
        },
        cancelIdleTask(handle) {
            if (!handle || typeof handle !== 'object') return;
            const type = handle.type;
            const id = handle.id;
            if (type === 'idle') {
                if (typeof cancelIdleCallback === 'function') {
                    cancelIdleCallback(id);
                } else {
                    clearTimeout(id);
                }
                return;
            }
            if (type === 'timeout') {
                clearTimeout(id);
            }
        },
        scheduleSessionTabDeferredTeardown(task) {
            const callback = typeof task === 'function' ? task : () => {};
            this.cancelScheduledSessionTabDeferredTeardown();
            this.__sessionTabDeferredTeardownHandle = this.scheduleIdleTask(() => {
                this.__sessionTabDeferredTeardownHandle = null;
                callback();
            }, 180);
        },
        cancelScheduledSessionTabDeferredTeardown() {
            const handle = this.__sessionTabDeferredTeardownHandle || null;
            if (!handle) return;
            this.cancelIdleTask(handle);
            this.__sessionTabDeferredTeardownHandle = null;
        },

        setSessionListRef(element) {
            this.__sessionListRef = element || null;
            if (this.__sessionListRef && this.mainTab === 'sessions' && this.sessionListRenderEnabled) {
                this.scheduleSessionListViewportFill();
            }
        },
        getSessionListRenderSource() {
            return Array.isArray(this.sortedSessionsList) ? this.sortedSessionsList : [];
        },
        cancelScheduledSessionListViewportFill() {
            const handle = this.__sessionListViewportFillHandle || null;
            if (!handle) return;
            this.cancelIdleTask(handle);
            this.__sessionListViewportFillHandle = null;
        },
        resetSessionListRender() {
            this.cancelScheduledSessionListViewportFill();
            this.sessionListVisibleCount = 0;
        },
        expandVisibleSessionList(stepSize, options = {}) {
            const list = this.getSessionListRenderSource();
            const total = list.length;
            if (total <= 0) {
                this.sessionListVisibleCount = 0;
                return false;
            }
            const rawVisibleCount = Number(this.sessionListVisibleCount);
            const currentCount = Number.isFinite(rawVisibleCount)
                ? Math.max(0, Math.floor(rawVisibleCount))
                : 0;
            const initialBatchSize = Number.isFinite(this.sessionListInitialBatchSize)
                ? Math.max(1, Math.floor(this.sessionListInitialBatchSize))
                : 80;
            const loadStep = Number.isFinite(stepSize)
                ? Math.max(0, Math.floor(stepSize))
                : (Number.isFinite(this.sessionListLoadStep)
                    ? Math.max(1, Math.floor(this.sessionListLoadStep))
                    : 120);
            let nextCount = currentCount > 0
                ? Math.min(total, currentCount + loadStep)
                : Math.min(total, initialBatchSize);
            if (options && options.ensureActive !== false) {
                const activeKey = this.activeSession ? this.getSessionExportKey(this.activeSession) : '';
                if (activeKey) {
                    const activeIndex = list.findIndex((session) => this.getSessionExportKey(session) === activeKey);
                    if (activeIndex >= 0) {
                        nextCount = Math.max(nextCount, activeIndex + 1);
                    }
                }
            }
            nextCount = Math.min(total, nextCount);
            if (nextCount <= currentCount) {
                return false;
            }
            this.sessionListVisibleCount = nextCount;
            return true;
        },
        scheduleSessionListViewportFill() {
            this.cancelScheduledSessionListViewportFill();
            if (this.mainTab !== 'sessions' || !this.sessionListRenderEnabled) {
                return;
            }
            const run = () => {
                this.__sessionListViewportFillHandle = null;
                if (this.mainTab !== 'sessions' || !this.sessionListRenderEnabled) {
                    return;
                }
                const list = this.getSessionListRenderSource();
                const total = list.length;
                const visibleCount = Number(this.sessionListVisibleCount);
                const normalizedVisibleCount = Number.isFinite(visibleCount)
                    ? Math.max(0, Math.floor(visibleCount))
                    : 0;
                if (total <= 0 || normalizedVisibleCount >= total) {
                    return;
                }
                const listEl = this.__sessionListRef || null;
                if (!listEl) {
                    return;
                }
                const clientHeight = Number(listEl.clientHeight) || 0;
                const scrollHeight = Number(listEl.scrollHeight) || 0;
                const scrollTop = Number(listEl.scrollTop) || 0;
                const remaining = Math.max(0, scrollHeight - scrollTop - clientHeight);
                const shouldGrow = scrollHeight <= (clientHeight + 160) || remaining <= Math.max(160, clientHeight);
                if (!shouldGrow) {
                    return;
                }
                if (this.expandVisibleSessionList(undefined, { ensureActive: true })) {
                    this.scheduleSessionListViewportFill();
                }
            };
            this.__sessionListViewportFillHandle = this.scheduleIdleTask(run, 120);
        },
        primeSessionListRender() {
            this.resetSessionListRender();
            if (this.mainTab !== 'sessions' || !this.sessionListRenderEnabled) {
                return;
            }
            this.expandVisibleSessionList(undefined, { ensureActive: true });
            this.scheduleSessionListViewportFill();
        },
        onSessionListScroll(event) {
            const nextRef = event && event.currentTarget ? event.currentTarget : this.__sessionListRef;
            if (nextRef) {
                this.__sessionListRef = nextRef;
            }
            this.scheduleSessionListViewportFill();
        },

        resetSessionPreviewMessageRender() {
            this.sessionPreviewVisibleCount = 0;
            this.invalidateSessionTimelineMeasurementCache();
        },

        resetSessionDetailPagination() {
            const initialLimit = Number.isFinite(this.sessionDetailInitialMessageLimit)
                ? Math.max(1, Math.floor(this.sessionDetailInitialMessageLimit))
                : 80;
            this.sessionDetailMessageLimit = initialLimit;
            this.sessionPreviewPendingVisibleCount = 0;
        },

        primeSessionPreviewMessageRender() {
            this.sessionPreviewVisibleCount = 0;
            this.invalidateSessionTimelineMeasurementCache();
            if (this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) {
                return;
            }
            const total = Array.isArray(this.activeSessionMessages)
                ? this.activeSessionMessages.length
                : 0;
            if (total <= 0) return;
            const baseSize = Number.isFinite(this.sessionPreviewInitialBatchSize)
                ? Math.max(1, Math.floor(this.sessionPreviewInitialBatchSize))
                : 40;
            this.sessionPreviewVisibleCount = Math.min(baseSize, total);
            this.invalidateSessionTimelineMeasurementCache();
        },

        async loadMoreSessionMessages(stepSize) {
            return loadMoreSessionMessagesHelper.call(this, stepSize);
        },

        suspendSessionTabRender() {
            this.sessionTabRenderTicket += 1;
            this.sessionListRenderEnabled = false;
            this.sessionPreviewRenderEnabled = false;
            this.cancelScheduledSessionListViewportFill();
            this.cancelSessionTimelineSync();
            this.sessionTimelineActiveKey = '';
            this.sessionTimelineLastSyncAt = 0;
            this.sessionTimelineLastScrollTop = 0;
            this.sessionTimelineLastAnchorY = 0;
            this.sessionTimelineLastDirection = 0;
            this.__sessionListRef = null;
            this.sessionPreviewScrollEl = null;
            this.sessionPreviewContainerEl = null;
            this.sessionPreviewHeaderEl = null;
        },

        finalizeSessionTabTeardown() {
            this.resetSessionListRender();
            this.resetSessionPreviewMessageRender();
            this.sessionPreviewPendingVisibleCount = 0;
            this.clearSessionTimelineRefs();
        },

        teardownSessionTabRender() {
            this.suspendSessionTabRender();
            this.finalizeSessionTabTeardown();
        },

        prepareSessionTabRender() {
            const ticket = ++this.sessionTabRenderTicket;
            this.sessionListRenderEnabled = false;
            this.sessionPreviewRenderEnabled = false;
            this.resetSessionListRender();
            this.resetSessionPreviewMessageRender();

            this.scheduleAfterFrame(() => {
                if (ticket !== this.sessionTabRenderTicket || this.mainTab !== 'sessions') {
                    return;
                }
                this.sessionListRenderEnabled = true;
                this.primeSessionListRender();

                this.scheduleAfterFrame(() => {
                    if (ticket !== this.sessionTabRenderTicket || this.mainTab !== 'sessions') {
                        return;
                    }
                    this.sessionPreviewRenderEnabled = true;
                    this.$nextTick(() => {
                        if (ticket !== this.sessionTabRenderTicket || this.mainTab !== 'sessions') {
                            return;
                        }
                        this.primeSessionPreviewMessageRender();
                        this.updateSessionTimelineOffset();
                        if (!this.sessionTimelineEnabled) {
                            return;
                        }
                        const syncTask = () => {
                            if (ticket !== this.sessionTabRenderTicket || this.mainTab !== 'sessions') {
                                return;
                            }
                            this.scheduleSessionTimelineSync();
                        };
                        if (typeof this.scheduleAfterFrame === 'function') {
                            this.scheduleAfterFrame(syncTask);
                            return;
                        }
                        syncTask();
                    });
                });
            });
        }
    };
}
