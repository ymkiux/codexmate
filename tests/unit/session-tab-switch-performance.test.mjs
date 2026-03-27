import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const helpers = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'session-helpers.mjs')));
const {
    switchMainTab,
    loadSessions,
    loadActiveSessionDetail,
    loadMoreSessionMessages
} = helpers;

test('switchMainTab tears down session heavy render state when leaving sessions tab', () => {
    const calls = {
        teardown: 0,
        prepare: 0,
        loadSessions: 0,
        refreshClaude: 0
    };
    const vm = {
        mainTab: 'sessions',
        configMode: 'codex',
        sessionsLoadedOnce: true,
        teardownSessionTabRender() {
            calls.teardown += 1;
        },
        prepareSessionTabRender() {
            calls.prepare += 1;
        },
        loadSessions() {
            calls.loadSessions += 1;
        },
        refreshClaudeModelContext() {
            calls.refreshClaude += 1;
        }
    };

    switchMainTab.call(vm, 'settings');

    assert.strictEqual(vm.mainTab, 'settings');
    assert.strictEqual(calls.teardown, 1);
    assert.strictEqual(calls.prepare, 0);
    assert.strictEqual(calls.loadSessions, 0);
    assert.strictEqual(calls.refreshClaude, 0);
});

test('switchMainTab prepares session render and loads sessions only when not loaded yet', () => {
    const calls = {
        teardown: 0,
        prepare: 0,
        loadSessions: 0
    };
    const vm = {
        mainTab: 'config',
        configMode: 'codex',
        sessionsLoadedOnce: false,
        teardownSessionTabRender() {
            calls.teardown += 1;
        },
        prepareSessionTabRender() {
            calls.prepare += 1;
        },
        loadSessions() {
            calls.loadSessions += 1;
            this.sessionsLoadedOnce = true;
        },
        refreshClaudeModelContext() {}
    };

    switchMainTab.call(vm, 'sessions');
    assert.strictEqual(vm.mainTab, 'sessions');
    assert.strictEqual(calls.prepare, 1);
    assert.strictEqual(calls.loadSessions, 1);

    switchMainTab.call(vm, 'sessions');
    assert.strictEqual(calls.prepare, 2);
    assert.strictEqual(calls.loadSessions, 1);
});

test('switchMainTab keeps claude model context refresh behavior', () => {
    let refreshCount = 0;
    const vm = {
        mainTab: 'settings',
        configMode: 'claude',
        sessionsLoadedOnce: true,
        teardownSessionTabRender() {},
        prepareSessionTabRender() {},
        loadSessions() {},
        refreshClaudeModelContext() {
            refreshCount += 1;
        }
    };

    switchMainTab.call(vm, 'config');
    assert.strictEqual(refreshCount, 1);
});

test('loadActiveSessionDetail primes visible messages even when timeline is disabled', async () => {
    const vm = {
        activeSession: {
            source: 'codex',
            sessionId: 's1',
            filePath: 'session.jsonl',
            sourceLabel: 'Codex'
        },
        mainTab: 'sessions',
        sessionPreviewRenderEnabled: true,
        sessionTimelineEnabled: false,
        sessionDetailRequestSeq: 0,
        sessionDetailLoading: false,
        sessionDetailInitialMessageLimit: 80,
        sessionDetailMessageLimit: 80,
        activeSessionMessages: [],
        activeSessionDetailError: '',
        activeSessionDetailClipped: false,
        sessionTimelineActiveKey: '',
        sessionMessageRefMap: Object.create(null),
        sessionPreviewPendingVisibleCount: 0,
        normalizeSessionMessage(message) {
            return {
                role: message.role || 'assistant',
                roleLabel: 'Assistant',
                normalizedRole: message.role || 'assistant',
                timestamp: message.timestamp || '',
                text: message.text || ''
            };
        },
        syncActiveSessionMessageCount() {},
        primeSessionPreviewMessageRender() {
            this._primeCount = (this._primeCount || 0) + 1;
        },
        updateSessionTimelineOffset() {
            this._offsetCount = (this._offsetCount || 0) + 1;
        },
        scheduleSessionTimelineSync() {
            this._syncCount = (this._syncCount || 0) + 1;
        },
        cancelSessionTimelineSync() {},
        resetSessionPreviewMessageRender() {},
        resetSessionDetailPagination() {},
        $nextTick(callback) {
            callback();
        }
    };

    await loadActiveSessionDetail.call(vm, async () => ({
        messages: [{ role: 'assistant', text: 'hello', timestamp: '2026-03-27 10:00:00' }],
        clipped: false,
        totalMessages: 1,
        messageLimit: 80
    }));

    assert.strictEqual(vm.activeSessionMessages.length, 1);
    assert.strictEqual(vm._primeCount, 1);
    assert.strictEqual(vm._offsetCount, 1);
    assert.strictEqual(vm._syncCount || 0, 0);
    assert.strictEqual(vm.sessionDetailLoading, false);
    assert.strictEqual(vm.activeSessionDetailError, '');
});

test('loadSessions keeps sessionsLoadedOnce false when initial request fails', async () => {
    const vm = {
        sessionsLoading: false,
        sessionsLoadedOnce: false,
        activeSessionDetailError: '',
        sessionFilterSource: 'all',
        sessionPathFilter: '',
        sessionQuery: '',
        sessionRoleFilter: 'all',
        sessionTimePreset: 'all',
        sessionsList: [{ sessionId: 'old' }],
        activeSession: { sessionId: 'old' },
        activeSessionMessages: [{ text: 'old' }],
        activeSessionDetailClipped: false,
        sessionTimelineActiveKey: '',
        sessionMessageRefMap: Object.create(null),
        showMessage() {},
        resetSessionDetailPagination() {},
        resetSessionPreviewMessageRender() {},
        cancelSessionTimelineSync() {},
        syncSessionPathOptionsForSource() {},
        extractPathOptionsFromSessions() {
            return [];
        },
        getSessionExportKey(session) {
            return session && session.sessionId ? session.sessionId : '';
        },
        async loadActiveSessionDetail() {},
        loadSessionPathOptions() {
            return Promise.resolve();
        }
    };

    await loadSessions.call(vm, async () => ({ error: 'network failed' }));

    assert.strictEqual(vm.sessionsLoadedOnce, false);
    assert.strictEqual(vm.sessionsLoading, false);
    assert.strictEqual(Array.isArray(vm.sessionsList), true);
    assert.strictEqual(vm.sessionsList.length, 0);
});

test('loadMoreSessionMessages requests older messages and toggles loading flag', async () => {
    const vm = {
        mainTab: 'sessions',
        sessionPreviewRenderEnabled: true,
        activeSessionMessages: Array.from({ length: 80 }, (_, idx) => ({ id: idx })),
        sessionPreviewVisibleCount: 80,
        sessionPreviewLoadStep: 24,
        sessionDetailLoading: false,
        activeSessionDetailClipped: true,
        activeSession: { messageCount: 200 },
        sessionDetailMessageLimit: 80,
        sessionDetailFetchStep: 80,
        sessionDetailMessageLimitCap: 1000,
        sessionPreviewPendingVisibleCount: 0,
        sessionPreviewLoadingMore: false,
        fetchCount: 0,
        async loadActiveSessionDetail(options) {
            this.fetchCount += 1;
            this.lastOptions = options;
            assert.strictEqual(this.sessionPreviewLoadingMore, true);
        }
    };

    await loadMoreSessionMessages.call(vm);

    assert.strictEqual(vm.fetchCount, 1);
    assert.strictEqual(vm.sessionDetailMessageLimit, 160);
    assert.strictEqual(vm.sessionPreviewPendingVisibleCount, 104);
    assert.deepStrictEqual(vm.lastOptions, { preserveVisibleCount: true });
    assert.strictEqual(vm.sessionPreviewLoadingMore, false);
});
