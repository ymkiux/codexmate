import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { createSessionBrowserMethods } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.session-browser.mjs'))
);
const { createSessionTimelineMethods } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.session-timeline.mjs'))
);

test('loadSessionPathOptions clears visible loading state when reusing cached source data', async () => {
    const methods = createSessionBrowserMethods({
        api: async () => {
            throw new Error('cached path options should not call api');
        }
    });
    const context = {
        sessionFilterSource: 'claude',
        sessionPathOptionsLoadedMap: { claude: true },
        sessionPathOptionsLoading: true
    };

    await methods.loadSessionPathOptions.call(context, { source: 'claude' });

    assert.strictEqual(context.sessionPathOptionsLoading, false);
});

test('scheduleSessionPathOptionsWarmup defers path hydration until idle and skips stale warmups', async () => {
    const methods = createSessionBrowserMethods({
        api: async () => ({})
    });
    const idleTasks = [];
    const context = {
        mainTab: 'sessions',
        sessionStandalone: false,
        __sessionPathWarmupTicketMap: {},
        __sessionPathWarmupHandleMap: {},
        scheduleIdleTask(task) {
            idleTasks.push(task);
            return {
                type: 'idle',
                id: idleTasks.length
            };
        },
        cancelIdleTask(handle) {
            this._cancelledHandle = handle;
        },
        async loadSessionPathOptions(options) {
            this._loadCalls = (this._loadCalls || 0) + 1;
            this._lastLoadOptions = options;
        }
    };

    methods.scheduleSessionPathOptionsWarmup.call(context, { source: 'codex' });
    assert.strictEqual(idleTasks.length, 1);
    assert.strictEqual(context._loadCalls || 0, 0);

    context.mainTab = 'settings';
    await idleTasks[0]();
    assert.strictEqual(context._loadCalls || 0, 0);

    context.mainTab = 'sessions';
    methods.scheduleSessionPathOptionsWarmup.call(context, { source: 'codex' });
    methods.scheduleSessionPathOptionsWarmup.call(context, { source: 'codex', forceRefresh: true });

    assert.strictEqual(idleTasks.length, 3);
    assert.deepStrictEqual(context._cancelledHandle, { type: 'idle', id: 2 });

    await idleTasks[1]();
    assert.strictEqual(context._loadCalls || 0, 0);

    await idleTasks[2]();
    assert.strictEqual(context._loadCalls, 1);
    assert.deepStrictEqual(context._lastLoadOptions, { source: 'codex', forceRefresh: true });
});

test('selectSession defers detail loading until the next frame when a scheduler is available', async () => {
    const methods = createSessionBrowserMethods({
        api: async () => ({})
    });
    const scheduled = [];
    let detailLoads = 0;
    const selected = { source: 'codex', sessionId: 's1', filePath: '/tmp/s1.jsonl' };
    const context = {
        mainTab: 'sessions',
        sessionStandalone: false,
        activeSession: null,
        activeSessionMessages: [{ text: 'stale' }],
        activeSessionDetailError: 'old',
        activeSessionDetailClipped: true,
        sessionTimelineActiveKey: 'old',
        getSessionExportKey(session) {
            return `${session.source}:${session.sessionId}:${session.filePath}`;
        },
        resetSessionDetailPagination() {},
        resetSessionPreviewMessageRender() {},
        cancelSessionTimelineSync() {},
        clearSessionTimelineRefs() {},
        scheduleAfterFrame(task) {
            scheduled.push(task);
        },
        async loadActiveSessionDetail() {
            detailLoads += 1;
        }
    };

    await methods.selectSession.call(context, selected);

    assert.strictEqual(context.activeSession, selected);
    assert.deepStrictEqual(context.activeSessionMessages, []);
    assert.strictEqual(context.activeSessionDetailError, '');
    assert.strictEqual(context.activeSessionDetailClipped, false);
    assert.strictEqual(context.sessionTimelineActiveKey, '');
    assert.strictEqual(detailLoads, 0);
    assert.strictEqual(scheduled.length, 1);

    await scheduled[0]();
    assert.strictEqual(detailLoads, 1);
});

test('selectSession coalesces same-frame rapid re-selection into one detail load', async () => {
    const methods = createSessionBrowserMethods({
        api: async () => ({})
    });
    const scheduled = [];
    let detailLoads = 0;
    const sessionA = { source: 'codex', sessionId: 's1', filePath: '/tmp/s1.jsonl' };
    const sessionB = { source: 'codex', sessionId: 's2', filePath: '/tmp/s2.jsonl' };
    const context = {
        mainTab: 'sessions',
        sessionStandalone: false,
        activeSession: null,
        activeSessionMessages: [],
        activeSessionDetailError: '',
        activeSessionDetailClipped: false,
        sessionTimelineActiveKey: '',
        getSessionExportKey(session) {
            return `${session.source}:${session.sessionId}:${session.filePath}`;
        },
        resetSessionDetailPagination() {},
        resetSessionPreviewMessageRender() {},
        cancelSessionTimelineSync() {},
        clearSessionTimelineRefs() {},
        scheduleAfterFrame(task) {
            scheduled.push(task);
        },
        async loadActiveSessionDetail() {
            detailLoads += 1;
        }
    };

    await methods.selectSession.call(context, sessionA);
    await methods.selectSession.call(context, sessionB);
    await methods.selectSession.call(context, sessionA);

    assert.strictEqual(scheduled.length, 3);
    for (const task of scheduled) {
        await task();
    }

    assert.strictEqual(detailLoads, 1);
});

test('selectSession skips deferred detail loading after leaving sessions tab', async () => {
    const methods = createSessionBrowserMethods({
        api: async () => ({})
    });
    const scheduled = [];
    let detailLoads = 0;
    const sessionA = { source: 'codex', sessionId: 's1', filePath: '/tmp/s1.jsonl' };
    const context = {
        mainTab: 'sessions',
        sessionStandalone: false,
        activeSession: null,
        activeSessionMessages: [],
        activeSessionDetailError: '',
        activeSessionDetailClipped: false,
        sessionTimelineActiveKey: '',
        getSessionExportKey(session) {
            return `${session.source}:${session.sessionId}:${session.filePath}`;
        },
        resetSessionDetailPagination() {},
        resetSessionPreviewMessageRender() {},
        cancelSessionTimelineSync() {},
        clearSessionTimelineRefs() {},
        scheduleAfterFrame(task) {
            scheduled.push(task);
        },
        async loadActiveSessionDetail() {
            detailLoads += 1;
        }
    };

    await methods.selectSession.call(context, sessionA);
    context.mainTab = 'settings';
    await scheduled[0]();

    assert.strictEqual(detailLoads, 0);
});

test('syncSessionTimelineActiveFromScroll reuses container header offset when scroll container has no header', () => {
    const methods = createSessionTimelineMethods();
    const headerEl = {
        getBoundingClientRect() {
            return { height: 40 };
        }
    };
    const context = {
        sessionTimelineEnabled: true,
        mainTab: 'sessions',
        sessionPreviewRenderEnabled: true,
        sessionTimelineNodes: [{ key: 'first' }, { key: 'second' }],
        sessionPreviewScrollEl: {
            scrollTop: 0,
            querySelector() {
                return null;
            }
        },
        sessionPreviewContainerEl: {
            querySelector(selector) {
                return selector === '.session-preview-header' ? headerEl : null;
            }
        },
        $refs: {},
        sessionTimelineActiveKey: '',
        sessionTimelineLastAnchorY: 0,
        sessionTimelineLastDirection: 0,
        sessionMessageRefMap: Object.create(null),
        getMainTabForNav() {
            return 'sessions';
        },
        pruneSessionMessageRefs() {},
        isSessionTimelineNodeKey(key) {
            return key === 'first' || key === 'second';
        },
        getCachedSessionTimelineMeasuredNodes() {
            return [
                { key: 'first', top: 0 },
                { key: 'second', top: 10 }
            ];
        }
    };

    methods.syncSessionTimelineActiveFromScroll.call(context);

    assert.strictEqual(context.sessionTimelineActiveKey, 'second');
    assert.strictEqual(context.sessionTimelineLastAnchorY, 52);
});

test('jumpToSessionTimelineNode uses the shared header offset for scroll targets', () => {
    const methods = createSessionTimelineMethods();
    const headerEl = {
        getBoundingClientRect() {
            return { height: 40 };
        }
    };
    let scrollArgs = null;
    const scrollEl = {
        scrollTop: 100,
        querySelector() {
            return null;
        },
        getBoundingClientRect() {
            return { top: 100 };
        },
        scrollTo(args) {
            scrollArgs = args;
        }
    };
    const context = {
        sessionTimelineEnabled: true,
        mainTab: 'sessions',
        sessionPreviewRenderEnabled: true,
        sessionPreviewScrollEl: scrollEl,
        sessionPreviewContainerEl: {
            querySelector(selector) {
                return selector === '.session-preview-header' ? headerEl : null;
            }
        },
        $refs: {},
        sessionTimelineActiveKey: '',
        sessionMessageRefMap: {
            second: {
                getBoundingClientRect() {
                    return { top: 200 };
                }
            }
        },
        isSessionTimelineNodeKey(key) {
            return key === 'second';
        }
    };

    methods.jumpToSessionTimelineNode.call(context, 'second');

    assert.strictEqual(context.sessionTimelineActiveKey, 'second');
    assert.deepStrictEqual(scrollArgs, {
        top: 148,
        behavior: 'smooth'
    });
});

test('timeline header offset uses sessionPreviewHeaderEl when container header is missing', () => {
    const methods = createSessionTimelineMethods();
    let lastScrollTo = null;
    const headerEl = {
        getBoundingClientRect() {
            return { height: 40 };
        }
    };
    const scrollEl = {
        scrollTop: 100,
        querySelector() {
            return null;
        },
        getBoundingClientRect() {
            return { top: 0 };
        },
        scrollTo({ top }) {
            lastScrollTo = top;
        }
    };
    const context = {
        sessionTimelineEnabled: true,
        mainTab: 'sessions',
        sessionPreviewRenderEnabled: true,
        sessionTimelineActiveKey: '',
        sessionTimelineNodes: [{ key: 'm1' }],
        sessionTimelineNodeKeyMap: { m1: true },
        sessionMessageRefMap: {
            m1: {
                getBoundingClientRect() {
                    return { top: 200 };
                }
            }
        },
        sessionPreviewHeaderEl: headerEl,
        sessionPreviewContainerEl: {
            querySelector() {
                return null;
            }
        },
        sessionPreviewScrollEl: scrollEl,
        getMainTabForNav() {
            return 'sessions';
        },
        pruneSessionMessageRefs() {},
        isSessionTimelineNodeKey() {
            return true;
        },
        getCachedSessionTimelineMeasuredNodes() {
            return [{ key: 'm1', top: 0 }];
        }
    };

    methods.syncSessionTimelineActiveFromScroll.call(context);
    assert.strictEqual(context.sessionTimelineLastAnchorY, 152);

    methods.jumpToSessionTimelineNode.call(context, 'm1');
    assert.strictEqual(lastScrollTo, 248);
});
