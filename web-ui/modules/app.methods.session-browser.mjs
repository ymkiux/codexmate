import {
    buildSessionFilterCacheState,
    isSessionQueryEnabled,
    normalizeSessionMessageRole,
    normalizeSessionPathFilter
} from '../logic.mjs';

function isSessionLoadNativeDialogEnabled(vm) {
    if (vm && typeof vm.isSessionLoadNativeDialogEnabled === 'function' && vm.isSessionLoadNativeDialogEnabled !== isSessionLoadNativeDialogEnabled) {
        try {
            return !!vm.isSessionLoadNativeDialogEnabled();
        } catch (_) {
            // fall through to shared detection
        }
    }

    try {
        if (globalThis && globalThis.__CODEXMATE_SESSION_LOAD_NATIVE_DIALOG__ === true) {
            return true;
        }
    } catch (_) {
        // ignore global flag lookup failures
    }

    try {
        if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
            const stored = String(localStorage.getItem('codexmateSessionLoadNativeDialog') || '').trim().toLowerCase();
            if (stored === '1' || stored === 'true' || stored === 'yes' || stored === 'on') {
                return true;
            }
        }
    } catch (_) {
        // ignore storage lookup failures
    }

    try {
        const search = typeof location !== 'undefined' && location && typeof location.search === 'string'
            ? location.search
            : (typeof window !== 'undefined' && window.location && typeof window.location.search === 'string'
                ? window.location.search
                : '');
        if (!search) {
            return false;
        }
        const params = new URLSearchParams(search);
        const value = String(params.get('sessionLoadNativeDialog') || '').trim().toLowerCase();
        return value === '1' || value === 'true' || value === 'yes' || value === 'on';
    } catch (_) {
        return false;
    }
}

function emitSessionLoadNativeDialog(vm, step, details = '') {
    if (!isSessionLoadNativeDialogEnabled(vm)) {
        return;
    }
    const alertFn = typeof globalThis.alert === 'function'
        ? globalThis.alert.bind(globalThis)
        : (typeof window !== 'undefined' && typeof window.alert === 'function'
            ? window.alert.bind(window)
            : null);
    if (!alertFn) {
        return;
    }
    const message = details
        ? `[codexmate][session-load] ${step}\n${details}`
        : `[codexmate][session-load] ${step}`;
    alertFn(message);
}

export function createSessionBrowserMethods(options = {}) {
    const {
        api,
        loadSessionsHelper,
        loadActiveSessionDetailHelper
    } = options;

    return {
        normalizeSessionPathValue(value) {
            return normalizeSessionPathFilter(value);
        },

        mergeSessionPathOptions(baseList = [], incomingList = []) {
            const merged = [];
            const seen = new Set();
            const append = (items) => {
                if (!Array.isArray(items)) return;
                for (const item of items) {
                    const value = this.normalizeSessionPathValue(item);
                    if (!value) continue;
                    const key = value.toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    merged.push(value);
                }
            };

            append(baseList);
            append(incomingList);
            return merged;
        },

        extractPathOptionsFromSessions(sessions) {
            const paths = [];
            if (!Array.isArray(sessions)) {
                return paths;
            }

            const seen = new Set();
            for (const session of sessions) {
                const value = this.normalizeSessionPathValue(session && session.cwd ? session.cwd : '');
                if (!value) continue;
                const key = value.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                paths.push(value);
            }
            return paths;
        },

        syncSessionPathOptionsForSource(source, nextOptions, mergeWithExisting = false) {
            const targetSource = source === 'claude' ? 'claude' : (source === 'all' ? 'all' : 'codex');
            const current = Array.isArray(this.sessionPathOptionsMap[targetSource])
                ? this.sessionPathOptionsMap[targetSource]
                : [];
            const merged = mergeWithExisting
                ? this.mergeSessionPathOptions(current, nextOptions)
                : this.mergeSessionPathOptions([], nextOptions);
            this.sessionPathOptionsMap = {
                ...this.sessionPathOptionsMap,
                [targetSource]: merged
            };
            this.refreshSessionPathOptions(targetSource);
        },

        refreshSessionPathOptions(source) {
            const targetSource = source === 'claude' ? 'claude' : (source === 'all' ? 'all' : 'codex');
            const base = Array.isArray(this.sessionPathOptionsMap[targetSource])
                ? [...this.sessionPathOptionsMap[targetSource]]
                : [];
            const selected = this.normalizeSessionPathValue(this.sessionPathFilter);
            if (selected && !base.some(item => item.toLowerCase() === selected.toLowerCase())) {
                base.unshift(selected);
            }
            if (targetSource === this.sessionFilterSource) {
                this.sessionPathOptions = base;
            }
        },

        isSessionLoadNativeDialogEnabled() {
            return isSessionLoadNativeDialogEnabled(this);
        },

        emitSessionLoadNativeDialog(step, details = '') {
            emitSessionLoadNativeDialog(this, step, details);
        },

        async loadSessionPathOptions(options = {}) {
            const source = options.source === 'claude' ? 'claude' : (options.source === 'all' ? 'all' : 'codex');
            const forceRefresh = !!options.forceRefresh;
            const loaded = !!this.sessionPathOptionsLoadedMap[source];
            if (!forceRefresh && loaded) {
                emitSessionLoadNativeDialog(this, 'loadSessionPathOptions:cache-hit', `source=${source}`);
                if (source === this.sessionFilterSource) {
                    this.sessionPathOptionsLoading = false;
                }
                return;
            }

            const nextSeqMap = {
                ...(this.sessionPathRequestSeqMap || {})
            };
            const requestSeq = (Number(nextSeqMap[source]) || 0) + 1;
            nextSeqMap[source] = requestSeq;
            this.sessionPathRequestSeqMap = nextSeqMap;
            emitSessionLoadNativeDialog(
                this,
                'loadSessionPathOptions:start',
                `source=${source}\nforceRefresh=${forceRefresh}\nrequestSeq=${requestSeq}`
            );
            if (source === this.sessionFilterSource) {
                this.sessionPathOptionsLoading = true;
            }
            try {
                const res = await api('list-session-paths', {
                    source,
                    limit: 500,
                    forceRefresh
                });
                if (requestSeq !== Number(((this.sessionPathRequestSeqMap || {})[source]) || 0)) {
                    emitSessionLoadNativeDialog(
                        this,
                        'loadSessionPathOptions:stale-response',
                        `source=${source}\nrequestSeq=${requestSeq}`
                    );
                    return;
                }
                if (res && !res.error && Array.isArray(res.paths)) {
                    this.syncSessionPathOptionsForSource(source, res.paths, true);
                    this.sessionPathOptionsLoadedMap = {
                        ...this.sessionPathOptionsLoadedMap,
                        [source]: true
                    };
                    emitSessionLoadNativeDialog(
                        this,
                        'loadSessionPathOptions:success',
                        `source=${source}\npaths=${res.paths.length}`
                    );
                } else if (res && res.error) {
                    emitSessionLoadNativeDialog(
                        this,
                        'loadSessionPathOptions:error',
                        `source=${source}\nerror=${res.error}`
                    );
                }
            } catch (error) {
                emitSessionLoadNativeDialog(
                    this,
                    'loadSessionPathOptions:exception',
                    `source=${source}\nerror=${error && error.message ? error.message : String(error)}`
                );
                // 路径补全失败不影响会话主流程
            } finally {
                if (
                    source === this.sessionFilterSource
                    && requestSeq === Number(((this.sessionPathRequestSeqMap || {})[source]) || 0)
                ) {
                    this.sessionPathOptionsLoading = false;
                }
                emitSessionLoadNativeDialog(
                    this,
                    'loadSessionPathOptions:complete',
                    `source=${source}\nrequestSeq=${requestSeq}`
                );
            }
        },

        onSessionResumeYoloChange() {
            const value = this.sessionResumeWithYolo ? '1' : '0';
            localStorage.setItem('codexmateSessionResumeYolo', value);
        },

        restoreSessionFilterCache() {
            const sourceCache = localStorage.getItem('codexmateSessionFilterSource');
            const pathCache = localStorage.getItem('codexmateSessionPathFilter');
            const cached = buildSessionFilterCacheState(sourceCache, pathCache);
            this.sessionFilterSource = cached.source;
            this.sessionPathFilter = cached.pathFilter;
            this.refreshSessionPathOptions(this.sessionFilterSource);
        },

        persistSessionFilterCache() {
            const cached = buildSessionFilterCacheState(this.sessionFilterSource, this.sessionPathFilter);
            localStorage.setItem('codexmateSessionFilterSource', cached.source);
            if (cached.pathFilter) {
                localStorage.setItem('codexmateSessionPathFilter', cached.pathFilter);
            } else {
                localStorage.removeItem('codexmateSessionPathFilter');
            }
        },

        normalizeSessionPinnedMap(raw) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                return {};
            }
            const next = {};
            for (const [key, value] of Object.entries(raw)) {
                if (!key) continue;
                const numeric = Number(value);
                if (!Number.isFinite(numeric) || numeric <= 0) continue;
                next[key] = Math.floor(numeric);
            }
            return next;
        },

        restoreSessionPinnedMap() {
            const cached = localStorage.getItem('codexmateSessionPinnedMap');
            if (!cached) {
                this.sessionPinnedMap = {};
                return;
            }
            try {
                const parsed = JSON.parse(cached);
                this.sessionPinnedMap = this.normalizeSessionPinnedMap(parsed);
            } catch (_) {
                this.sessionPinnedMap = {};
                localStorage.removeItem('codexmateSessionPinnedMap');
            }
        },

        persistSessionPinnedMap() {
            const payload = (this.sessionPinnedMap && typeof this.sessionPinnedMap === 'object')
                ? this.sessionPinnedMap
                : {};
            localStorage.setItem('codexmateSessionPinnedMap', JSON.stringify(payload));
        },

        shouldPruneSessionPinnedMap(sessions = this.sessionsList) {
            if (!Array.isArray(sessions) || sessions.length === 0) {
                return false;
            }
            if (this.sessionFilterSource !== 'all') {
                return false;
            }
            if (this.sessionPathFilter) {
                return false;
            }
            if (this.sessionQuery && isSessionQueryEnabled(this.sessionFilterSource)) {
                return false;
            }
            if (this.sessionRoleFilter && this.sessionRoleFilter !== 'all') {
                return false;
            }
            if (this.sessionTimePreset && this.sessionTimePreset !== 'all') {
                return false;
            }
            return true;
        },

        pruneSessionPinnedMap(sessions = this.sessionsList) {
            const current = (this.sessionPinnedMap && typeof this.sessionPinnedMap === 'object')
                ? this.sessionPinnedMap
                : {};
            const list = Array.isArray(sessions) ? sessions : [];
            if (Object.keys(current).length === 0 || !this.shouldPruneSessionPinnedMap(list)) {
                return;
            }
            const validKeys = new Set(list.map((session) => this.getSessionExportKey(session)).filter(Boolean));
            const next = {};
            let changed = false;
            for (const [key, value] of Object.entries(current)) {
                if (!validKeys.has(key)) {
                    changed = true;
                    continue;
                }
                next[key] = value;
            }
            if (!changed) {
                return;
            }
            this.sessionPinnedMap = next;
            this.persistSessionPinnedMap();
        },

        getSessionPinTimestamp(session) {
            if (!session) return 0;
            const key = this.getSessionExportKey(session);
            if (!key) return 0;
            const raw = this.sessionPinnedMap && this.sessionPinnedMap[key];
            const numeric = Number(raw);
            return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
        },

        isSessionPinned(session) {
            return this.getSessionPinTimestamp(session) > 0;
        },

        toggleSessionPin(session) {
            if (!session) return;
            const key = this.getSessionExportKey(session);
            if (!key) return;
            const current = (this.sessionPinnedMap && typeof this.sessionPinnedMap === 'object')
                ? this.sessionPinnedMap
                : {};
            const next = { ...current };
            if (next[key]) {
                delete next[key];
            } else {
                next[key] = Date.now();
            }
            this.sessionPinnedMap = next;
            this.persistSessionPinnedMap();
        },

        removeSessionPin(session) {
            if (!session) return;
            const key = this.getSessionExportKey(session);
            if (!key) return;
            const current = (this.sessionPinnedMap && typeof this.sessionPinnedMap === 'object')
                ? this.sessionPinnedMap
                : {};
            if (!current[key]) return;
            const next = { ...current };
            delete next[key];
            this.sessionPinnedMap = next;
            this.persistSessionPinnedMap();
        },

        async onSessionSourceChange() {
            this.refreshSessionPathOptions(this.sessionFilterSource);
            this.persistSessionFilterCache();
            await this.loadSessions();
        },

        async onSessionPathFilterChange() {
            this.persistSessionFilterCache();
            await this.loadSessions();
        },

        async onSessionFilterChange() {
            await this.loadSessions();
        },

        async clearSessionFilters() {
            this.sessionFilterSource = 'all';
            this.sessionPathFilter = '';
            this.sessionQuery = '';
            this.sessionRoleFilter = 'all';
            this.sessionTimePreset = 'all';
            this.persistSessionFilterCache();
            await this.onSessionSourceChange();
        },

        normalizeSessionMessage(message) {
            const fallback = {
                role: 'assistant',
                normalizedRole: 'assistant',
                roleLabel: 'Assistant',
                text: typeof message === 'string' ? message : '',
                timestamp: ''
            };
            const safeMessage = message && typeof message === 'object' ? message : fallback;
            const normalizedRole = normalizeSessionMessageRole(
                safeMessage.normalizedRole || safeMessage.role
            );
            const roleLabel = normalizedRole === 'user'
                ? 'User'
                : (normalizedRole === 'system' ? 'System' : 'Assistant');
            return {
                ...safeMessage,
                role: normalizedRole,
                normalizedRole,
                roleLabel
            };
        },

        getRecordKey(message) {
            if (!message || !Number.isInteger(message.recordLineIndex) || message.recordLineIndex < 0) {
                return '';
            }
            return String(message.recordLineIndex);
        },

        getRecordRenderKey(message, idx) {
            const recordKey = this.getRecordKey(message);
            if (recordKey) {
                return `record-${recordKey}`;
            }
            return `record-fallback-${idx}-${message && message.timestamp ? message.timestamp : ''}`;
        },

        syncActiveSessionMessageCount(messageCount) {
            if (!Number.isFinite(messageCount) || messageCount < 0) return;
            if (this.activeSession) {
                this.activeSession.messageCount = messageCount;
            }
            const activeKey = this.activeSession ? this.getSessionExportKey(this.activeSession) : '';
            if (!activeKey) return;
            const matched = this.sessionsList.find(item => this.getSessionExportKey(item) === activeKey);
            if (matched) {
                matched.messageCount = messageCount;
            }
        },

        invalidateSessionsUsageData(options = {}) {
            this.sessionsUsageLoadedOnce = false;
            this.sessionsUsageError = '';
            if (options.preserveList !== true) {
                this.sessionsUsageList = [];
            }
        },

        async loadSessionsUsage(options = {}) {
            if (this.sessionsUsageLoading) return;
            this.sessionsUsageLoading = true;
            this.sessionsUsageError = '';
            let loadSucceeded = false;
            try {
                const res = await api('list-sessions-usage', {
                    source: 'all',
                    limit: 2000,
                    forceRefresh: !!options.forceRefresh
                });
                if (res.error) {
                    this.sessionsUsageError = res.error;
                    this.showMessage(res.error, 'error');
                    return;
                }
                this.sessionsUsageList = Array.isArray(res.sessions) ? res.sessions : [];
                loadSucceeded = true;
            } catch (e) {
                this.sessionsUsageError = '加载 usage 统计失败';
                this.showMessage('加载 usage 统计失败', 'error');
            } finally {
                this.sessionsUsageLoading = false;
                if (loadSucceeded) {
                    this.sessionsUsageLoadedOnce = true;
                }
            }
        },

        async loadSessions(options = {}) {
            const result = await loadSessionsHelper.call(this, api, options || {});
            this.pruneSessionPinnedMap(this.sessionsList);
            return result;
        },

        async selectSession(session) {
            if (!session) {
                emitSessionLoadNativeDialog(this, 'selectSession:skip-empty');
                return;
            }
            emitSessionLoadNativeDialog(
                this,
                'selectSession:start',
                `sessionId=${session.sessionId || ''}\nsource=${session.source || ''}`
            );
            const isSameSession = this.activeSession
                && this.getSessionExportKey(this.activeSession) === this.getSessionExportKey(session);
            if (isSameSession) {
                emitSessionLoadNativeDialog(this, 'selectSession:same-session', `sessionId=${session.sessionId || ''}`);
                if (this.sessionDetailLoading) {
                    emitSessionLoadNativeDialog(this, 'selectSession:skip-detail-loading', `sessionId=${session.sessionId || ''}`);
                    return;
                }
                const currentMessages = Array.isArray(this.activeSessionMessages) ? this.activeSessionMessages : [];
                if (currentMessages.length > 0) {
                    emitSessionLoadNativeDialog(
                        this,
                        'selectSession:skip-existing-messages',
                        `sessionId=${session.sessionId || ''}\nmessages=${currentMessages.length}`
                    );
                    return;
                }
                if (typeof this.scheduleAfterFrame === 'function') {
                    const selectedSession = this.activeSession;
                    emitSessionLoadNativeDialog(this, 'selectSession:schedule-detail', `sessionId=${session.sessionId || ''}`);
                    this.scheduleAfterFrame(() => {
                        if (this.activeSession !== selectedSession) return;
                        void this.loadActiveSessionDetail();
                    });
                    return;
                }
                emitSessionLoadNativeDialog(this, 'selectSession:load-detail-now', `sessionId=${session.sessionId || ''}`);
                await this.loadActiveSessionDetail();
                return;
            }
            this.activeSession = session;
            emitSessionLoadNativeDialog(this, 'selectSession:activate', `sessionId=${session.sessionId || ''}`);
            if (typeof this.expandVisibleSessionList === 'function') {
                this.expandVisibleSessionList(0, { ensureActive: true });
            }
            this.activeSessionMessages = [];
            this.resetSessionDetailPagination();
            this.resetSessionPreviewMessageRender();
            this.activeSessionDetailError = '';
            this.activeSessionDetailClipped = false;
            this.cancelSessionTimelineSync();
            this.sessionTimelineActiveKey = '';
            this.clearSessionTimelineRefs();
            if (typeof this.scheduleAfterFrame === 'function') {
                const selectedSession = this.activeSession;
                emitSessionLoadNativeDialog(this, 'selectSession:schedule-detail', `sessionId=${session.sessionId || ''}`);
                this.scheduleAfterFrame(() => {
                    if (this.activeSession !== selectedSession) return;
                    void this.loadActiveSessionDetail();
                });
                return;
            }
            emitSessionLoadNativeDialog(this, 'selectSession:load-detail-now', `sessionId=${session.sessionId || ''}`);
            await this.loadActiveSessionDetail();
        },

        async loadSessionStandalonePlain() {
            if (!this.activeSession) {
                this.sessionStandaloneRequestSeq += 1;
                this.sessionStandaloneLoading = false;
                this.sessionStandaloneText = '';
                this.sessionStandaloneTitle = '会话';
                this.sessionStandaloneSourceLabel = '';
                this.sessionStandaloneError = '';
                return;
            }

            const requestSeq = ++this.sessionStandaloneRequestSeq;
            const sessionSnapshot = this.activeSession;
            this.sessionStandaloneLoading = true;
            this.sessionStandaloneError = '';
            try {
                const res = await api('session-plain', {
                    source: sessionSnapshot.source,
                    sessionId: sessionSnapshot.sessionId,
                    filePath: sessionSnapshot.filePath
                });

                if (requestSeq !== this.sessionStandaloneRequestSeq) {
                    return;
                }

                if (res.error) {
                    this.sessionStandaloneText = '';
                    this.sessionStandaloneError = res.error;
                    return;
                }

                this.sessionStandaloneSourceLabel = res.sourceLabel || sessionSnapshot.sourceLabel || '';
                this.sessionStandaloneTitle = res.sessionId || sessionSnapshot.title || '会话';
                this.sessionStandaloneText = typeof res.text === 'string' ? res.text : '';
            } catch (e) {
                if (requestSeq !== this.sessionStandaloneRequestSeq) {
                    return;
                }
                this.sessionStandaloneText = '';
                this.sessionStandaloneError = '加载会话内容失败: ' + e.message;
            } finally {
                if (requestSeq === this.sessionStandaloneRequestSeq) {
                    this.sessionStandaloneLoading = false;
                }
            }
        },

        async loadActiveSessionDetail(options = {}) {
            return loadActiveSessionDetailHelper.call(this, api, options);
        }
    };
}
