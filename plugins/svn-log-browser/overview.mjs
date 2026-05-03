export async function loadSvnLogBrowserOverview(ctx, options = {}) {
    const app = ctx && typeof ctx === 'object' ? ctx : {};
    const silent = !!(options && options.silent);
    if (!silent && app.mainTab === 'plugins' && app.pluginsActiveId === 'svn-log-browser') {
        if (typeof app.restoreSvnLogBrowserPrefs === 'function') {
            app.restoreSvnLogBrowserPrefs();
        }
        if (typeof app.$nextTick === 'function') {
            app.$nextTick(() => {
                const input = app.$refs && app.$refs.svnLogBrowserUrlInput
                    ? app.$refs.svnLogBrowserUrlInput
                    : null;
                if (input && typeof input.focus === 'function') input.focus();
            });
        }
    }
    return true;
}
