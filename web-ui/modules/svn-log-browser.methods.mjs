function svnLogBrowserMethodsNormalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function svnLogBrowserMethodsNormalizeUrlCandidate(value) {
    const raw = svnLogBrowserMethodsNormalizeText(value);
    if (!raw) return '';
    let parsed;
    try {
        parsed = new URL(raw);
    } catch (_) {
        return '';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
}

function svnLogBrowserMethodsNormalizePositiveIntegerInput(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return String(fallback);
    return String(Math.floor(num));
}

const SVN_PREFS_KEY = 'codexmate_svn_log_browser_prefs';

function svnLogBrowserMethodsLoadPrefs(storage) {
    if (!storage) return null;
    try {
        const raw = storage.getItem(SVN_PREFS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
        return null;
    }
}

function svnLogBrowserMethodsSavePrefs(storage, prefs) {
    if (!storage) return false;
    try {
        storage.setItem(SVN_PREFS_KEY, JSON.stringify(prefs || {}));
        return true;
    } catch (_) {
        return false;
    }
}

export function createSvnLogBrowserMethods({ api }) {
    const callApi = typeof api === 'function' ? api : null;
    return {
        restoreSvnLogBrowserPrefs() {
            const prefs = svnLogBrowserMethodsLoadPrefs(typeof localStorage !== 'undefined' ? localStorage : null);
            if (!prefs) return false;
            const remember = prefs.remember === true;
            this.svnLogBrowserRemember = remember;
            if (remember) {
                this.svnLogBrowserUrl = svnLogBrowserMethodsNormalizeText(prefs.url);
                this.svnLogBrowserUsername = svnLogBrowserMethodsNormalizeText(prefs.username);
                this.svnLogBrowserPassword = typeof prefs.password === 'string' ? prefs.password : '';
            }
            this.svnLogBrowserPageSizeInput = svnLogBrowserMethodsNormalizePositiveIntegerInput(prefs.pageSize, 25);
            this.svnLogBrowserPathFilter = svnLogBrowserMethodsNormalizeText(prefs.pathFilter);
            return true;
        },

        persistSvnLogBrowserPrefs() {
            const remember = this.svnLogBrowserRemember === true;
            const prefs = {
                remember,
                url: remember ? svnLogBrowserMethodsNormalizeText(this.svnLogBrowserUrl) : '',
                username: remember ? svnLogBrowserMethodsNormalizeText(this.svnLogBrowserUsername) : '',
                password: remember ? (typeof this.svnLogBrowserPassword === 'string' ? this.svnLogBrowserPassword : '') : '',
                pageSize: svnLogBrowserMethodsNormalizePositiveIntegerInput(this.svnLogBrowserPageSizeInput, 25),
                pathFilter: svnLogBrowserMethodsNormalizeText(this.svnLogBrowserPathFilter)
            };
            return svnLogBrowserMethodsSavePrefs(typeof localStorage !== 'undefined' ? localStorage : null, prefs);
        },

        normalizeSvnLogBrowserPageSize() {
            this.svnLogBrowserPageSizeInput = svnLogBrowserMethodsNormalizePositiveIntegerInput(this.svnLogBrowserPageSizeInput, 25);
            this.persistSvnLogBrowserPrefs();
        },

        clearSvnLogBrowser() {
            this.svnLogBrowserError = '';
            this.svnLogBrowserCacheHit = null;
            this.svnLogBrowserInfo = null;
            this.svnLogBrowserItemsRaw = [];
            this.svnLogBrowserHasMore = false;
            this.svnLogBrowserPage = 1;
            this.svnLogBrowserKeyword = '';
        },

        async loadSvnLogBrowserInfo() {
            const url = svnLogBrowserMethodsNormalizeUrlCandidate(this.svnLogBrowserUrl);
            if (!url) {
                this.svnLogBrowserError = typeof this.t === 'function' ? this.t('plugins.svnLogBrowser.errors.invalidUrl') : 'Invalid URL';
                return false;
            }
            if (!callApi) return false;

            this.svnLogBrowserLoading = true;
            this.svnLogBrowserError = '';
            try {
                const payload = await callApi('svn-info', {
                    url,
                    username: svnLogBrowserMethodsNormalizeText(this.svnLogBrowserUsername),
                    password: typeof this.svnLogBrowserPassword === 'string' ? this.svnLogBrowserPassword : ''
                });
                if (payload && payload.error) {
                    this.svnLogBrowserError = String(payload.error);
                    this.svnLogBrowserCacheHit = null;
                    return false;
                }
                this.svnLogBrowserInfo = payload && payload.info ? payload.info : null;
                this.svnLogBrowserCacheHit = payload && Object.prototype.hasOwnProperty.call(payload, 'cached')
                    ? !!payload.cached
                    : null;
                this.persistSvnLogBrowserPrefs();
                return true;
            } catch (err) {
                this.svnLogBrowserError = err && err.message ? String(err.message) : 'Request failed';
                this.svnLogBrowserCacheHit = null;
                return false;
            } finally {
                this.svnLogBrowserLoading = false;
            }
        },

        async loadSvnLogBrowser(options = {}) {
            const resetPage = !!(options && options.resetPage);
            const pageDelta = Number(options && options.pageDelta) || 0;
            const url = svnLogBrowserMethodsNormalizeUrlCandidate(this.svnLogBrowserUrl);
            if (!url) {
                this.svnLogBrowserError = typeof this.t === 'function' ? this.t('plugins.svnLogBrowser.errors.invalidUrl') : 'Invalid URL';
                return false;
            }
            if (!callApi) return false;

            const pageSize = Math.min(Math.max(Number(this.svnLogBrowserPageSizeInput) || 25, 1), 200);
            const currentPage = Number(this.svnLogBrowserPage) || 1;
            const nextPage = Math.min(Math.max(resetPage ? 1 : currentPage + pageDelta, 1), 10000);

            this.svnLogBrowserLoading = true;
            this.svnLogBrowserError = '';
            try {
                const payload = await callApi('svn-logs', {
                    url,
                    username: svnLogBrowserMethodsNormalizeText(this.svnLogBrowserUsername),
                    password: typeof this.svnLogBrowserPassword === 'string' ? this.svnLogBrowserPassword : '',
                    page: nextPage,
                    pageSize
                });
                if (payload && payload.error) {
                    this.svnLogBrowserError = String(payload.error);
                    this.svnLogBrowserCacheHit = null;
                    return false;
                }
                this.svnLogBrowserPage = payload && Number(payload.page) ? Number(payload.page) : nextPage;
                this.svnLogBrowserItemsRaw = payload && Array.isArray(payload.items) ? payload.items : [];
                this.svnLogBrowserHasMore = payload && Object.prototype.hasOwnProperty.call(payload, 'hasMore')
                    ? !!payload.hasMore
                    : false;
                if (payload && payload.info) {
                    this.svnLogBrowserInfo = payload.info;
                }
                this.svnLogBrowserCacheHit = payload && Object.prototype.hasOwnProperty.call(payload, 'cached')
                    ? !!payload.cached
                    : null;
                this.normalizeSvnLogBrowserPageSize();
                this.persistSvnLogBrowserPrefs();
                return true;
            } catch (err) {
                this.svnLogBrowserError = err && err.message ? String(err.message) : 'Request failed';
                this.svnLogBrowserCacheHit = null;
                return false;
            } finally {
                this.svnLogBrowserLoading = false;
            }
        }
    };
}
