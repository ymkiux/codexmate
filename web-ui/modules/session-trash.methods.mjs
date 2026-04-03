export function createSessionTrashMethods({ api, constants = {} } = {}) {
    const sessionTrashListLimit = Number(constants.sessionTrashListLimit) || 500;
    const sessionTrashPageSize = Number(constants.sessionTrashPageSize) || 200;

    return {
        normalizeSettingsTab(tab) {
            return tab === 'trash' ? 'trash' : 'backup';
        },

        async onSettingsTabClick(tab) {
            await this.switchSettingsTab(tab);
        },

        async switchSettingsTab(tab, options = {}) {
            const nextTab = this.normalizeSettingsTab(tab);
            this.settingsTab = nextTab;
            if (nextTab !== 'trash') {
                return;
            }
            const forceRefresh = options.forceRefresh === true;
            if (forceRefresh || !this.sessionTrashLoadedOnce) {
                await this.loadSessionTrash({ forceRefresh });
            }
        },

        async loadSessionTrashCount(options = {}) {
            if (this.sessionTrashCountLoading) {
                this.sessionTrashCountPendingOptions = {
                    ...(this.sessionTrashCountPendingOptions || {}),
                    ...(options || {})
                };
                return;
            }
            const requestToken = this.issueSessionTrashCountRequestToken();
            this.sessionTrashCountLoading = true;
            try {
                const res = await api('list-session-trash', { countOnly: true });
                if (!this.isLatestSessionTrashCountRequestToken(requestToken)) {
                    return;
                }
                if (res.error) {
                    if (options.silent !== true) {
                        this.showMessage(res.error, 'error');
                    }
                    return;
                }
                this.sessionTrashTotalCount = this.normalizeSessionTrashTotalCount(
                    res.totalCount,
                    this.sessionTrashItems
                );
                this.sessionTrashCountLoadedOnce = true;
            } catch (e) {
                if (this.isLatestSessionTrashCountRequestToken(requestToken) && options.silent !== true) {
                    this.showMessage('加载回收站数量失败', 'error');
                }
            } finally {
                this.sessionTrashCountLoading = false;
                const pendingOptions = this.sessionTrashCountPendingOptions;
                this.sessionTrashCountPendingOptions = null;
                if (pendingOptions) {
                    await this.loadSessionTrashCount(pendingOptions);
                }
            }
        },

        getSessionTrashActionKey(item) {
            return item && typeof item.trashId === 'string' ? item.trashId : '';
        },

        isSessionTrashActionBusy(item) {
            const key = typeof item === 'string' ? item : this.getSessionTrashActionKey(item);
            return !!(key && (this.sessionTrashRestoring[key] || this.sessionTrashPurging[key]));
        },

        async loadSessionTrash(options = {}) {
            if (this.sessionTrashLoading) {
                this.sessionTrashPendingOptions = {
                    ...(this.sessionTrashPendingOptions || {}),
                    ...(options || {})
                };
                return;
            }
            const requestToken = this.issueSessionTrashListRequestToken();
            this.sessionTrashLoading = true;
            this.sessionTrashLastLoadFailed = false;
            let loadSucceeded = false;
            try {
                const res = await api('list-session-trash', {
                    limit: sessionTrashListLimit,
                    forceRefresh: !!options.forceRefresh
                });
                if (!this.isLatestSessionTrashListRequestToken(requestToken)) {
                    return;
                }
                if (res.error) {
                    this.sessionTrashLastLoadFailed = true;
                    this.showMessage(res.error, 'error');
                    return;
                }
                const nextItems = Array.isArray(res.items) ? res.items : [];
                this.sessionTrashItems = nextItems;
                this.resetSessionTrashVisibleCount();
                this.sessionTrashTotalCount = this.normalizeSessionTrashTotalCount(res.totalCount, nextItems);
                this.sessionTrashCountLoadedOnce = true;
                this.sessionTrashLastLoadFailed = false;
                loadSucceeded = true;
            } catch (e) {
                if (this.isLatestSessionTrashListRequestToken(requestToken)) {
                    this.sessionTrashLastLoadFailed = true;
                    this.showMessage('加载回收站失败', 'error');
                }
            } finally {
                this.sessionTrashLoading = false;
                if (loadSucceeded) {
                    this.sessionTrashLoadedOnce = true;
                }
                const pendingOptions = this.sessionTrashPendingOptions;
                this.sessionTrashPendingOptions = null;
                if (pendingOptions) {
                    await this.loadSessionTrash(pendingOptions);
                }
            }
        },

        async restoreSessionTrash(item) {
            const key = this.getSessionTrashActionKey(item);
            if (!key || this.isSessionTrashActionBusy(key) || this.sessionTrashClearing) {
                return;
            }
            this.sessionTrashRestoring[key] = true;
            try {
                const res = await api('restore-session-trash', { trashId: key });
                if (res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                this.showMessage('会话已恢复', 'success');
                this.invalidateSessionTrashRequests();
                await this.loadSessionTrash({ forceRefresh: true });
                if (this.sessionsLoadedOnce) {
                    await this.loadSessions();
                }
            } catch (e) {
                this.showMessage('恢复失败', 'error');
            } finally {
                this.sessionTrashRestoring[key] = false;
            }
        },

        async purgeSessionTrash(item) {
            const key = this.getSessionTrashActionKey(item);
            if (!key || this.isSessionTrashActionBusy(key) || this.sessionTrashClearing) {
                return;
            }
            const confirmed = await this.requestConfirmDialog({
                title: '彻底删除回收站记录',
                message: '该会话将从回收站永久删除，且无法恢复。',
                confirmText: '彻底删除',
                cancelText: '取消',
                danger: true
            });
            if (!confirmed) {
                return;
            }
            this.sessionTrashPurging[key] = true;
            try {
                const res = await api('purge-session-trash', { trashId: key });
                if (res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                this.showMessage('已彻底删除', 'success');
                this.invalidateSessionTrashRequests();
                await this.loadSessionTrash({ forceRefresh: true });
            } catch (e) {
                this.showMessage('彻底删除失败', 'error');
            } finally {
                this.sessionTrashPurging[key] = false;
            }
        },

        async clearSessionTrash() {
            const normalizedCount = Number(this.sessionTrashCount);
            if (this.sessionTrashClearing || !Number.isFinite(normalizedCount) || normalizedCount <= 0) {
                return;
            }
            const confirmed = await this.requestConfirmDialog({
                title: '清空回收站',
                message: '该操作会永久删除回收站中的全部会话，且无法恢复。',
                confirmText: '全部清空',
                cancelText: '取消',
                danger: true
            });
            if (!confirmed) {
                return;
            }
            this.sessionTrashClearing = true;
            try {
                const res = await api('purge-session-trash', { all: true });
                if (res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                this.showMessage('回收站已清空', 'success');
                this.invalidateSessionTrashRequests();
                await this.loadSessionTrash({ forceRefresh: true });
            } catch (e) {
                this.showMessage('清空回收站失败', 'error');
            } finally {
                this.sessionTrashClearing = false;
            }
        },

        buildSessionTrashItemFromSession(session, result = {}) {
            const deletedAt = typeof result.deletedAt === 'string' && result.deletedAt
                ? result.deletedAt
                : new Date().toISOString();
            const source = session && session.source === 'claude' ? 'claude' : 'codex';
            return {
                trashId: typeof result.trashId === 'string' ? result.trashId : '',
                source,
                sourceLabel: session && typeof session.sourceLabel === 'string' && session.sourceLabel
                    ? session.sourceLabel
                    : (source === 'claude' ? 'Claude Code' : 'Codex'),
                sessionId: session && typeof session.sessionId === 'string' ? session.sessionId : '',
                title: session && typeof session.title === 'string' && session.title
                    ? session.title
                    : (session && typeof session.sessionId === 'string' ? session.sessionId : ''),
                cwd: session && typeof session.cwd === 'string' ? session.cwd : '',
                createdAt: session && typeof session.createdAt === 'string' ? session.createdAt : '',
                updatedAt: session && typeof session.updatedAt === 'string' ? session.updatedAt : '',
                deletedAt,
                messageCount: Number.isFinite(Number(result && result.messageCount))
                    ? Math.max(0, Math.floor(Number(result.messageCount)))
                    : (Number.isFinite(Number(session && session.messageCount))
                        ? Math.max(0, Math.floor(Number(session.messageCount)))
                        : 0),
                originalFilePath: session && typeof session.filePath === 'string' ? session.filePath : '',
                provider: session && typeof session.provider === 'string' ? session.provider : source,
                keywords: Array.isArray(session && session.keywords) ? session.keywords : [],
                capabilities: session && typeof session.capabilities === 'object' && session.capabilities
                    ? session.capabilities
                    : {},
                claudeIndexPath: '',
                claudeIndexEntry: null,
                trashFilePath: ''
            };
        },

        prependSessionTrashItem(item, options = {}) {
            if (!item || !item.trashId) {
                return;
            }
            const existing = Array.isArray(this.sessionTrashItems) ? this.sessionTrashItems : [];
            const filtered = existing.filter((entry) => this.getSessionTrashActionKey(entry) !== item.trashId);
            const nextItems = [item, ...filtered].slice(0, sessionTrashListLimit);
            const previousTotalCount = Number(this.sessionTrashTotalCount);
            const normalizedPreviousTotal = Number.isFinite(previousTotalCount) && previousTotalCount >= 0
                ? Math.max(existing.length, Math.floor(previousTotalCount))
                : existing.length;
            this.sessionTrashItems = nextItems;
            const previousVisibleCount = Number(this.sessionTrashVisibleCount);
            const normalizedPreviousVisibleCount = Number.isFinite(previousVisibleCount) && previousVisibleCount > 0
                ? Math.floor(previousVisibleCount)
                : sessionTrashPageSize;
            const wasFullyExpanded = normalizedPreviousVisibleCount >= existing.length
                || normalizedPreviousVisibleCount >= normalizedPreviousTotal;
            if (wasFullyExpanded) {
                this.sessionTrashVisibleCount = Math.min(
                    normalizedPreviousVisibleCount + 1,
                    nextItems.length || (normalizedPreviousVisibleCount + 1)
                );
            }
            const fallbackTotalCount = filtered.length === existing.length
                ? normalizedPreviousTotal + 1
                : normalizedPreviousTotal;
            this.sessionTrashTotalCount = this.normalizeSessionTrashTotalCount(
                options && options.totalCount !== undefined
                    ? options.totalCount
                    : fallbackTotalCount,
                nextItems
            );
        },

        normalizeSessionTrashTotalCount(totalCount, fallbackItems = this.sessionTrashItems) {
            const fallbackCount = Array.isArray(fallbackItems) ? fallbackItems.length : 0;
            const numericTotal = Number(totalCount);
            if (!Number.isFinite(numericTotal) || numericTotal < 0) {
                return fallbackCount;
            }
            return Math.floor(numericTotal);
        },

        getSessionTrashViewState() {
            if (this.sessionTrashLoading && !this.sessionTrashLoadedOnce) {
                return 'loading';
            }
            const totalCount = Number(this.sessionTrashCount);
            const normalizedTotalCount = Number.isFinite(totalCount) && totalCount >= 0
                ? Math.floor(totalCount)
                : 0;
            const hasVisibleItems = Array.isArray(this.sessionTrashItems) && this.sessionTrashItems.length > 0;
            if (this.sessionTrashLastLoadFailed && (!this.sessionTrashLoadedOnce || !hasVisibleItems)) {
                return 'retry';
            }
            if (!this.sessionTrashLoadedOnce) {
                return normalizedTotalCount > 0 ? 'retry' : 'empty';
            }
            if (normalizedTotalCount === 0) {
                return 'empty';
            }
            return hasVisibleItems ? 'list' : 'retry';
        },

        issueSessionTrashCountRequestToken() {
            const currentToken = Number(this.sessionTrashCountRequestToken);
            const nextToken = Number.isFinite(currentToken) && currentToken >= 0
                ? Math.floor(currentToken) + 1
                : 1;
            this.sessionTrashCountRequestToken = nextToken;
            return nextToken;
        },

        issueSessionTrashListRequestToken() {
            const currentToken = Number(this.sessionTrashListRequestToken);
            const nextToken = Number.isFinite(currentToken) && currentToken >= 0
                ? Math.floor(currentToken) + 1
                : 1;
            this.sessionTrashListRequestToken = nextToken;
            return nextToken;
        },

        invalidateSessionTrashRequests() {
            this.issueSessionTrashCountRequestToken();
            return this.issueSessionTrashListRequestToken();
        },

        isLatestSessionTrashCountRequestToken(token) {
            return Number(token) === Number(this.sessionTrashCountRequestToken);
        },

        isLatestSessionTrashListRequestToken(token) {
            return Number(token) === Number(this.sessionTrashListRequestToken);
        },

        resetSessionTrashVisibleCount() {
            const totalItems = Array.isArray(this.sessionTrashItems) ? this.sessionTrashItems.length : 0;
            this.sessionTrashVisibleCount = Math.min(totalItems, sessionTrashPageSize) || sessionTrashPageSize;
        },

        loadMoreSessionTrashItems() {
            const totalItems = Array.isArray(this.sessionTrashItems) ? this.sessionTrashItems.length : 0;
            const visibleCount = Number(this.sessionTrashVisibleCount);
            const safeVisibleCount = Number.isFinite(visibleCount) && visibleCount > 0
                ? Math.floor(visibleCount)
                : sessionTrashPageSize;
            this.sessionTrashVisibleCount = Math.min(totalItems, safeVisibleCount + sessionTrashPageSize);
        }
    };
}
