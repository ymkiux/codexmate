function svnLogBrowserComputedNormalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function svnLogBrowserComputedNormalizeChangedPath(pathValue) {
    const raw = svnLogBrowserComputedNormalizeText(pathValue);
    if (!raw) return '';
    return raw.startsWith('/') ? raw : `/${raw}`;
}

function svnLogBrowserComputedMatchKeyword(item, keyword) {
    if (!keyword) return true;
    const needle = keyword.toLowerCase();
    if (String(item.revision || '').includes(needle)) return true;
    if (typeof item.author === 'string' && item.author.toLowerCase().includes(needle)) return true;
    if (typeof item.message === 'string' && item.message.toLowerCase().includes(needle)) return true;
    const paths = Array.isArray(item.paths) ? item.paths : [];
    return paths.some((p) => p && typeof p.path === 'string' && p.path.toLowerCase().includes(needle));
}

function svnLogBrowserComputedMatchPathFilter(item, pathFilter) {
    if (!pathFilter) return true;
    const needle = svnLogBrowserComputedNormalizeChangedPath(pathFilter);
    if (!needle || needle === '/') return true;
    const paths = Array.isArray(item.paths) ? item.paths : [];
    return paths.some((p) => p && typeof p.path === 'string' && (p.path === needle || p.path.startsWith(`${needle}/`)));
}

export function createSvnLogBrowserComputed() {
    return {
        svnLogBrowserFilteredItems() {
            const list = Array.isArray(this.svnLogBrowserItemsRaw) ? this.svnLogBrowserItemsRaw : [];
            const keyword = svnLogBrowserComputedNormalizeText(this.svnLogBrowserKeyword).toLowerCase();
            const pathFilter = svnLogBrowserComputedNormalizeText(this.svnLogBrowserPathFilter);
            return list.filter((item) => item && svnLogBrowserComputedMatchKeyword(item, keyword) && svnLogBrowserComputedMatchPathFilter(item, pathFilter));
        }
    };
}
