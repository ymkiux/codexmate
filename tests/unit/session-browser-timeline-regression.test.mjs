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
