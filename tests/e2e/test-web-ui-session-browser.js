const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { assert } = require('./helpers');

let bundledWebUiHarnessPromise = null;

function getBundledWebUiHarness() {
    if (!bundledWebUiHarnessPromise) {
        const helperPath = path.resolve(__dirname, '..', 'unit', 'helpers', 'web-ui-app-options.mjs');
        bundledWebUiHarnessPromise = import(pathToFileURL(helperPath).href)
            .then(async (mod) => ({
                appOptions: await mod.captureCurrentBundledAppOptions(),
                withGlobalOverrides: mod.withGlobalOverrides
            }));
    }
    return bundledWebUiHarnessPromise;
}

function createIso(baseMs, offsetSeconds) {
    return new Date(baseMs + (offsetSeconds * 1000)).toISOString();
}

function buildCodexSessionRecords(sessionId, messageCount, options = {}) {
    const baseMs = Date.parse(options.baseIso || '2025-04-01T00:00:00.000Z');
    const messageSize = Number.isFinite(options.messageSize)
        ? Math.max(0, Math.floor(options.messageSize))
        : 256;
    const records = [{
        type: 'session_meta',
        payload: {
            id: sessionId,
            cwd: options.cwd || `/tmp/${sessionId}`
        },
        timestamp: createIso(baseMs, 0)
    }];

    for (let i = 0; i < messageCount; i += 1) {
        records.push({
            type: 'response_item',
            payload: {
                type: 'message',
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: `${sessionId}-msg-${String(i).padStart(4, '0')}-` + 'x'.repeat(messageSize)
            },
            timestamp: createIso(baseMs, i + 1)
        });
    }

    return records;
}

function writeCodexSessionFile(sessionsDir, sessionId, records) {
    const filePath = path.join(sessionsDir, `${sessionId}.jsonl`);
    fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf-8');
    return filePath;
}

function createApiFetch(api) {
    return async function fetch(_url, init = {}) {
        const payload = init && init.body ? JSON.parse(init.body) : {};
        const result = await api(payload.action, payload.params);
        const raw = JSON.stringify(result || {});
        return {
            ok: true,
            status: 200,
            headers: {
                get(name) {
                    return String(name || '').toLowerCase() === 'content-type'
                        ? 'application/json'
                        : '';
                }
            },
            async json() {
                return result;
            },
            async text() {
                return raw;
            }
        };
    };
}

function createLocalStorage() {
    const store = new Map();
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        }
    };
}

function createWebUiVm(appOptions) {
    const vm = {
        ...(typeof appOptions.data === 'function' ? appOptions.data() : {}),
        _scheduledFrames: [],
        _idleTasks: [],
        _messages: [],
        $refs: {}
    };

    for (const [name, fn] of Object.entries(appOptions.methods || {})) {
        vm[name] = fn;
    }

    for (const [name, getter] of Object.entries(appOptions.computed || {})) {
        Object.defineProperty(vm, name, {
            configurable: true,
            enumerable: true,
            get() {
                return getter.call(vm);
            }
        });
    }

    vm.$nextTick = function $nextTick(callback) {
        if (typeof callback === 'function') {
            callback();
        }
    };
    vm.scheduleAfterFrame = function scheduleAfterFrame(task) {
        this._scheduledFrames.push(task);
    };
    vm.scheduleIdleTask = function scheduleIdleTask(task) {
        this._idleTasks.push(task);
        return task;
    };
    vm.cancelIdleTask = function cancelIdleTask(handle) {
        this._idleTasks = this._idleTasks.filter((task) => task !== handle);
    };
    vm.showMessage = function showMessage(text, type) {
        this._messages.push({ text: String(text), type: type || 'info' });
    };
    vm.updateSessionTimelineOffset = function updateSessionTimelineOffset() {};
    vm.invalidateSessionTimelineMeasurementCache = function invalidateSessionTimelineMeasurementCache() {};
    vm.scheduleSessionTimelineSync = function scheduleSessionTimelineSync() {};
    vm.cancelSessionTimelineSync = function cancelSessionTimelineSync() {
        this._cancelTimelineSyncCalls = (this._cancelTimelineSyncCalls || 0) + 1;
    };

    return vm;
}

async function flushScheduledFrames(vm) {
    let guard = 0;
    while (Array.isArray(vm._scheduledFrames) && vm._scheduledFrames.length > 0) {
        const task = vm._scheduledFrames.shift();
        await Promise.resolve(task());
        guard += 1;
        if (guard > 50) {
            throw new Error('scheduled frame queue did not settle');
        }
    }
}

async function waitForCondition(check, label) {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        if (check()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(label || 'condition not met');
}

module.exports = async function testWebUiSessionBrowser(ctx) {
    const { api, tmpHome } = ctx;
    const sessionsDir = path.join(tmpHome, '.codex', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    const denseListSessionCount = 140;
    const hotSessionId = 'session-browser-hot-large-e2e';
    const hotSessionMessageCount = 1325;
    const hugeLineSessionId = 'session-browser-huge-line-e2e';

    for (let i = 0; i < denseListSessionCount; i += 1) {
        const sessionId = `session-browser-list-${String(i).padStart(3, '0')}`;
        const records = buildCodexSessionRecords(sessionId, 4, {
            baseIso: createIso(Date.parse('2025-04-01T00:00:00.000Z'), i * 90),
            messageSize: 96,
            cwd: `/tmp/${sessionId}`
        });
        writeCodexSessionFile(sessionsDir, sessionId, records);
    }

    writeCodexSessionFile(
        sessionsDir,
        hugeLineSessionId,
        [{
            type: 'session_meta',
            payload: { id: hugeLineSessionId, cwd: '/tmp/session-browser-huge-line' },
            timestamp: '2025-04-02T00:00:00.000Z'
        }].concat(Array.from({ length: 3 }, (_, index) => ({
            type: 'response_item',
            payload: {
                type: 'message',
                role: index % 2 === 0 ? 'user' : 'assistant',
                content: `session-browser-huge-line-${index}-` + 'q'.repeat(1300000)
            },
            timestamp: createIso(Date.parse('2025-04-02T00:00:00.000Z'), index + 1)
        })))
    );

    writeCodexSessionFile(sessionsDir, hotSessionId, buildCodexSessionRecords(hotSessionId, hotSessionMessageCount, {
        baseIso: '2025-04-03T00:00:00.000Z',
        messageSize: 2048,
        cwd: '/tmp/session-browser-hot-large'
    }));

    const { appOptions, withGlobalOverrides } = await getBundledWebUiHarness();
    const vm = createWebUiVm(appOptions);
    vm.mainTab = 'sessions';
    vm.sessionFilterSource = 'codex';
    vm.prepareSessionTabRender();
    await flushScheduledFrames(vm);

    const fetch = createApiFetch(api);
    const localStorage = createLocalStorage();

    await withGlobalOverrides({ fetch, localStorage }, async () => {
        await vm.loadSessions({ forceRefresh: true, includeActiveDetail: true });
    });

    assert(vm.sessionsList.length >= denseListSessionCount + 2, 'session browser should load the large isolated codex dataset');
    assert(vm.sessionsList.every((item) => String(item.filePath || '').startsWith(sessionsDir)), 'session browser e2e should stay inside the isolated tmp HOME dataset');
    assert(vm.activeSession && vm.activeSession.sessionId === hotSessionId, 'session browser should select the newest hot session from the isolated dataset');
    assert(vm.visibleSessionsList.length === vm.sessionListInitialBatchSize, 'session browser should render only the first session list batch initially');
    assert(vm.activeSessionMessages.length === vm.sessionDetailInitialMessageLimit, 'session browser preview should hydrate only the initial detail window for huge sessions');
    assert(vm.activeSessionDetailClipped === true, 'session browser preview should stay clipped for huge sessions');
    assert(vm.activeSessionVisibleMessages.length === vm.sessionPreviewInitialBatchSize, 'session browser should render only the first preview batch initially');

    await withGlobalOverrides({ fetch, localStorage }, async () => {
        for (let i = 0; i < 4; i += 1) {
            await vm.loadMoreSessionMessages(24);
        }
    });

    assert(vm.sessionDetailMessageLimit > vm.sessionDetailInitialMessageLimit, 'session browser should grow detail hydration beyond the initial preview window');
    assert(vm.activeSessionMessages.length > vm.sessionDetailInitialMessageLimit, 'session browser should fetch an additional bounded detail page');
    assert(vm.activeSessionMessages.length < hotSessionMessageCount, 'session browser should not pull the whole huge session into memory in one expansion step');
    assert(vm.activeSessionVisibleMessages.length >= 104, 'session browser should preserve incremental preview expansion after detail hydration grows');
    assert(vm.activeSessionVisibleMessages.length < vm.activeSessionMessages.length, 'session browser should keep preview rendering incremental after hydration grows');
    assert(vm.activeSessionDetailClipped === true, 'session browser should remain clipped while more huge-session messages stay on disk');

    const hugeLineSession = vm.sessionsList.find((item) => item.sessionId === hugeLineSessionId);
    assert(hugeLineSession, 'session browser should list the huge-line regression session');

    await withGlobalOverrides({ fetch, localStorage }, async () => {
        await vm.selectSession(hugeLineSession);
        await flushScheduledFrames(vm);
        await waitForCondition(
            () => vm.activeSession && vm.activeSession.sessionId === hugeLineSessionId && vm.sessionDetailLoading === false && vm.activeSessionMessages.length > 0,
            'session browser huge-line selection did not finish loading'
        );
    });

    assert(vm.activeSession && vm.activeSession.sessionId === hugeLineSessionId, 'session browser should switch to the huge-line regression session');
    assert(vm.activeSessionMessages.length > 0, 'session browser should recover huge-line previews through the real UI->API data flow');
    assert(vm.activeSessionMessages.length <= 3, 'session browser should not duplicate huge-line fallback preview messages');
    assert(vm.activeSessionDetailClipped === false, 'session browser should mark the huge-line fallback preview as fully recovered');
    assert(vm.activeSessionVisibleMessages.length === vm.activeSessionMessages.length, 'session browser should render all recovered huge-line messages without overfetching');
};
