export function createNavigationMethods(options = {}) {
    const {
        configModeSet,
        switchMainTabHelper,
        loadMoreSessionMessagesHelper
    } = options;

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
            if (!shouldDeferApply) {
                switchState.ticket += 1;
                switchState.pendingTarget = '';
                const result = switchMainTabHelper.call(this, targetTab);
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

        getSessionListRenderSource() {
            if (Array.isArray(this.sortedSessionsList)) {
                return this.sortedSessionsList;
            }
            return Array.isArray(this.sessionsList) ? this.sessionsList : [];
        },
        setSessionListRef(el) {
            this.sessionListEl = el || null;
            if (this.sessionListEl && this.mainTab === 'sessions' && this.sessionListRenderEnabled) {
                this.scheduleSessionListViewportFill();
            }
        },
        cancelScheduledSessionListViewportFill() {
            if (this.__sessionListViewportFillRafId) {
                const rafId = this.__sessionListViewportFillRafId;
                this.__sessionListViewportFillRafId = 0;
                if (typeof cancelAnimationFrame === 'function') {
                    cancelAnimationFrame(rafId);
                } else {
                    clearTimeout(rafId);
                }
            }
        },
        resetSessionListRender() {
            this.cancelScheduledSessionListViewportFill();
            this.sessionListVisibleCount = 0;
        },
        expandVisibleSessionList(stepSize) {
            const source = this.getSessionListRenderSource();
            const total = source.length;
            if (total <= 0) {
                this.sessionListVisibleCount = 0;
                return 0;
            }
            const current = Number.isFinite(this.sessionListVisibleCount)
                ? Math.max(0, Math.floor(this.sessionListVisibleCount))
                : 0;
            const fallbackStep = Number.isFinite(this.sessionListLoadStep)
                ? Math.max(1, Math.floor(this.sessionListLoadStep))
                : 160;
            const amount = Number.isFinite(stepSize)
                ? Math.max(1, Math.floor(stepSize))
                : fallbackStep;
            const nextCount = Math.min(total, Math.max(current, 0) + amount);
            this.sessionListVisibleCount = nextCount;
            return nextCount;
        },
        scheduleSessionListViewportFill() {
            this.cancelScheduledSessionListViewportFill();
            if (this.mainTab !== 'sessions' || !this.sessionListRenderEnabled) {
                return;
            }
            const source = this.getSessionListRenderSource();
            if (!source.length || this.sessionListVisibleCount >= source.length) {
                return;
            }
            const schedule = typeof requestAnimationFrame === 'function'
                ? requestAnimationFrame
                : (callback) => setTimeout(callback, 16);
            this.__sessionListViewportFillRafId = schedule(() => {
                this.__sessionListViewportFillRafId = 0;
                if (this.mainTab !== 'sessions' || !this.sessionListRenderEnabled) {
                    return;
                }
                const listEl = this.sessionListEl || (this.$refs && this.$refs.sessionList) || null;
                if (!listEl) {
                    return;
                }
                const needsMore = listEl.scrollHeight <= (listEl.clientHeight + 24);
                if (!needsMore) {
                    return;
                }
                const previousCount = this.sessionListVisibleCount;
                this.expandVisibleSessionList();
                if (this.sessionListVisibleCount > previousCount) {
                    this.scheduleSessionListViewportFill();
                }
            });
        },
        primeSessionListRender() {
            this.resetSessionListRender();
            if (this.mainTab !== 'sessions' || !this.sessionListRenderEnabled) {
                return;
            }
            const source = this.getSessionListRenderSource();
            const total = source.length;
            if (total <= 0) return;
            const baseSize = Number.isFinite(this.sessionListInitialBatchSize)
                ? Math.max(1, Math.floor(this.sessionListInitialBatchSize))
                : 120;
            this.sessionListVisibleCount = Math.min(baseSize, total);
            this.$nextTick(() => {
                if (this.mainTab !== 'sessions' || !this.sessionListRenderEnabled) {
                    return;
                }
                this.scheduleSessionListViewportFill();
            });
        },
        onSessionListScroll() {
            if (this.mainTab !== 'sessions' || !this.sessionListRenderEnabled) {
                return;
            }
            const listEl = this.sessionListEl || (this.$refs && this.$refs.sessionList) || null;
            if (!listEl) return;
            const remaining = Number(this.sessionListRemainingCount || 0);
            const distanceToBottom = listEl.scrollHeight - (listEl.scrollTop + listEl.clientHeight);
            if (distanceToBottom > 240) return;
            if (remaining > 0) {
                this.expandVisibleSessionList();
                this.scheduleSessionListViewportFill();
                return;
            }
            if (
                this.sessionListHasMoreData
                && !this.sessionsLoading
                && !this.sessionListLoadingMore
                && typeof this.loadMoreSessions === 'function'
            ) {
                void this.loadMoreSessions();
            }
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
            this.resetSessionListRender();
            this.cancelSessionTimelineSync();
            this.sessionTimelineActiveKey = '';
            this.sessionTimelineLastSyncAt = 0;
            this.sessionTimelineLastScrollTop = 0;
            this.sessionTimelineLastAnchorY = 0;
            this.sessionTimelineLastDirection = 0;
            this.sessionListEl = null;
            this.sessionPreviewScrollEl = null;
            this.sessionPreviewContainerEl = null;
            this.sessionPreviewHeaderEl = null;
        },

        finalizeSessionTabTeardown() {
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
                        this.scheduleSessionTimelineSync();
                    });
                });
            });
        }
    };
}
