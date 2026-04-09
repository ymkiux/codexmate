const path = require('path');
const { pathToFileURL } = require('url');
const { assert } = require('./helpers');

let bundledAppOptionsPromise = null;

function getBundledAppOptions() {
    if (!bundledAppOptionsPromise) {
        const helperPath = path.resolve(__dirname, '..', 'unit', 'helpers', 'web-ui-app-options.mjs');
        bundledAppOptionsPromise = import(pathToFileURL(helperPath).href)
            .then((mod) => mod.captureCurrentBundledAppOptions());
    }
    return bundledAppOptionsPromise;
}

function createBundledNavigationContext(appOptions) {
    const vm = {
        ...(typeof appOptions.data === 'function' ? appOptions.data() : {}),
        fastHidden: false,
        _scheduled: [],
        _cancelTimelineSyncCalls: 0,
        $refs: {},
        sortedSessionsList: Array.from({ length: 400 }, (_, index) => ({ sessionId: `sess-${index}` })),
        $nextTick(callback) {
            callback();
        },
        scheduleAfterFrame(task) {
            this._scheduled.push(task);
        },
        cancelSessionTimelineSync() {
            this._cancelTimelineSyncCalls += 1;
        },
        invalidateSessionTimelineMeasurementCache() {},
        clearSessionTimelineRefs() {},
        updateSessionTimelineOffset() {},
        scheduleSessionTimelineSync() {},
        showMessage() {}
    };

    for (const [name, fn] of Object.entries(appOptions.methods || {})) {
        vm[name] = fn;
    }

    vm.setSessionPanelFastHidden = function setSessionPanelFastHidden(hidden) {
        this.fastHidden = !!hidden;
    };
    vm.isSessionPanelFastHidden = function isSessionPanelFastHidden() {
        return !!this.fastHidden;
    };
    vm.scheduleAfterFrame = function scheduleAfterFrame(task) {
        this._scheduled.push(task);
    };
    vm.cancelSessionTimelineSync = function cancelSessionTimelineSync() {
        this._cancelTimelineSyncCalls += 1;
    };

    return vm;
}

function flushScheduledFrames(vm) {
    let guard = 0;
    while (Array.isArray(vm._scheduled) && vm._scheduled.length > 0) {
        const task = vm._scheduled.shift();
        task();
        guard += 1;
        if (guard > 20) {
            throw new Error('scheduled frame queue did not settle');
        }
    }
}

module.exports = async function testWebUiSessionTab() {
    const appOptions = await getBundledAppOptions();
    const vm = createBundledNavigationContext(appOptions);

    vm.mainTab = 'sessions';
    vm.sessionListRenderEnabled = true;
    vm.sessionPreviewRenderEnabled = true;
    vm.sessionTabRenderTicket = 5;
    vm.sessionTimelineActiveKey = 'node-1';
    vm.sessionPreviewScrollEl = {};
    vm.sessionPreviewContainerEl = {};
    vm.sessionPreviewHeaderEl = {};

    vm.onMainTabPointerDown('settings', {
        button: 0,
        pointerType: 'mouse'
    });

    assert(vm.fastHidden === true, 'pointerdown should hide the sessions panel immediately');
    assert(vm.mainTab === 'sessions', 'tab commit should stay deferred until the next frame');
    assert(vm.sessionListRenderEnabled === false, 'leaving sessions should suspend list rendering immediately');
    assert(vm.sessionPreviewRenderEnabled === false, 'leaving sessions should suspend preview rendering immediately');
    assert(vm._cancelTimelineSyncCalls === 1, 'leaving sessions should cancel pending timeline sync work');
    assert(vm.sessionPreviewScrollEl === null, 'leaving sessions should clear preview scroll refs');
    assert(vm.sessionPreviewContainerEl === null, 'leaving sessions should clear preview container refs');
    assert(vm.sessionPreviewHeaderEl === null, 'leaving sessions should clear preview header refs');

    vm.prepareSessionTabRender = function prepareSessionTabRender() {
        this._prepareCalls = (this._prepareCalls || 0) + 1;
        this.sessionListRenderEnabled = true;
        this.sessionPreviewRenderEnabled = true;
    };

    vm.onMainTabPointerDown('sessions', {
        button: 0,
        pointerType: 'mouse'
    });

    assert(vm.fastHidden === false, 'returning to sessions should reveal the panel immediately');
    assert(vm._prepareCalls === 1, 'returning to sessions should re-prime suspended session rendering');

    flushScheduledFrames(vm);

    assert(vm.mainTab === 'sessions', 'a canceled deferred leave should keep the bundled app on sessions');
    assert(vm.sessionListRenderEnabled === true, 'session list rendering should recover after canceling the leave');
    assert(vm.sessionPreviewRenderEnabled === true, 'session preview rendering should recover after canceling the leave');
};
