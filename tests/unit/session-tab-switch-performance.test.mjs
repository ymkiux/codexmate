import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const fs = require('fs');

const appPath = path.join(__dirname, '..', '..', 'web-ui', 'app.js');
const appSource = fs.readFileSync(appPath, 'utf-8');

function extractBlockBySignature(source, signature) {
    const startIndex = source.indexOf(signature);
    if (startIndex === -1) {
        throw new Error(`Signature not found: ${signature}`);
    }
    const signatureBraceOffset = signature.lastIndexOf('{');
    const braceStart = signatureBraceOffset >= 0
        ? (startIndex + signatureBraceOffset)
        : source.indexOf('{', startIndex + signature.length);
    if (braceStart === -1) {
        throw new Error(`Opening brace not found for: ${signature}`);
    }
    let depth = 0;
    for (let i = braceStart; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(startIndex, i + 1);
            }
        }
    }
    throw new Error(`Closing brace not found for: ${signature}`);
}

function extractMethodAsFunction(source, signature, methodName) {
    const methodBlock = extractBlockBySignature(source, signature).trim();
    if (!methodBlock.startsWith(`${methodName}(`)) {
        throw new Error(`Method mismatch for ${methodName}`);
    }
    return `function ${methodBlock}`;
}

function instantiateFunction(funcSource, funcName) {
    return Function(`${funcSource}\nreturn ${funcName};`)();
}

function instantiateFunctionWithApi(funcSource, funcName, apiImpl) {
    return Function('api', `${funcSource}\nreturn ${funcName};`)(apiImpl);
}

function instantiateFunctionWithDeps(funcSource, funcName, deps = {}) {
    const depNames = Object.keys(deps);
    const depValues = depNames.map((name) => deps[name]);
    return Function(...depNames, `${funcSource}\nreturn ${funcName};`)(...depValues);
}

function createSwitchMainTab() {
    const switchMainTabSource = extractMethodAsFunction(
        appSource,
        'switchMainTab(tab) {',
        'switchMainTab'
    );
    return instantiateFunction(switchMainTabSource, 'switchMainTab');
}

function createLoadActiveSessionDetail(apiImpl) {
    const methodName = 'loadActiveSessionDetail';
    const methodBlock = extractBlockBySignature(
        appSource,
        'async loadActiveSessionDetail(options = {}) {'
    ).trim();
    if (!methodBlock.startsWith(`async ${methodName}(`)) {
        throw new Error(`Method mismatch for ${methodName}`);
    }
    const loadActiveSessionDetailSource = methodBlock.replace(
        `async ${methodName}(`,
        `async function ${methodName}(`
    );
    return instantiateFunctionWithApi(
        loadActiveSessionDetailSource,
        methodName,
        apiImpl
    );
}

function createLoadSessions(apiImpl) {
    const methodName = 'loadSessions';
    const methodBlock = extractBlockBySignature(
        appSource,
        'async loadSessions() {'
    ).trim();
    if (!methodBlock.startsWith(`async ${methodName}(`)) {
        throw new Error(`Method mismatch for ${methodName}`);
    }
    const funcSource = methodBlock.replace(
        `async ${methodName}(`,
        `async function ${methodName}(`
    );
    return instantiateFunctionWithDeps(funcSource, methodName, {
        api: apiImpl,
        buildSessionListParams: (params) => params
    });
}

function createLoadMoreSessionMessages() {
    const methodName = 'loadMoreSessionMessages';
    const methodBlock = extractBlockBySignature(
        appSource,
        'async loadMoreSessionMessages(stepSize) {'
    ).trim();
    if (!methodBlock.startsWith(`async ${methodName}(`)) {
        throw new Error(`Method mismatch for ${methodName}`);
    }
    const funcSource = methodBlock.replace(
        `async ${methodName}(`,
        `async function ${methodName}(`
    );
    return instantiateFunction(funcSource, methodName);
}

test('switchMainTab tears down session heavy render state when leaving sessions tab', () => {
    const switchMainTab = createSwitchMainTab();
    const calls = {
        teardown: 0,
        prepare: 0,
        loadSessions: 0,
        refreshClaude: 0
    };
    const vm = {
        mainTab: 'sessions',
        configMode: 'codex',
        sessionsList: [{ sessionId: 's1' }],
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

test('switchMainTab prepares session render and loads sessions only when list is empty', () => {
    const switchMainTab = createSwitchMainTab();
    const calls = {
        teardown: 0,
        prepare: 0,
        loadSessions: 0
    };
    const vm = {
        mainTab: 'config',
        configMode: 'codex',
        sessionsLoadedOnce: false,
        sessionsList: [],
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
    assert.strictEqual(calls.teardown, 0);
    assert.strictEqual(calls.prepare, 1);
    assert.strictEqual(calls.loadSessions, 1);

    vm.sessionsList = [{ sessionId: 'cached' }];
    switchMainTab.call(vm, 'sessions');
    assert.strictEqual(calls.prepare, 2);
    assert.strictEqual(calls.loadSessions, 1);
});

test('switchMainTab keeps claude model context refresh behavior', () => {
    const switchMainTab = createSwitchMainTab();
    let refreshCount = 0;
    const vm = {
        mainTab: 'settings',
        configMode: 'claude',
        sessionsList: [],
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
    const loadActiveSessionDetail = createLoadActiveSessionDetail(async () => ({
        messages: [{ role: 'assistant', text: 'hello', timestamp: '2026-03-27 10:00:00' }],
        clipped: false,
        totalMessages: 1
    }));

    const calls = {
        prime: 0,
        offset: 0,
        sync: 0
    };
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
        activeSessionMessages: [],
        activeSessionDetailError: '',
        activeSessionDetailClipped: false,
        sessionTimelineActiveKey: '',
        sessionMessageRefMap: Object.create(null),
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
            calls.prime += 1;
        },
        updateSessionTimelineOffset() {
            calls.offset += 1;
        },
        scheduleSessionTimelineSync() {
            calls.sync += 1;
        },
        cancelSessionTimelineSync() {},
        resetSessionPreviewMessageRender() {},
        $nextTick(callback) {
            callback();
        }
    };

    await loadActiveSessionDetail.call(vm);

    assert.strictEqual(vm.activeSessionMessages.length, 1);
    assert.strictEqual(calls.prime, 1);
    assert.strictEqual(calls.offset, 1);
    assert.strictEqual(calls.sync, 0);
    assert.strictEqual(vm.sessionDetailLoading, false);
    assert.strictEqual(vm.activeSessionDetailError, '');
});

test('loadSessions keeps sessionsLoadedOnce false when initial request fails', async () => {
    const loadSessions = createLoadSessions(async () => ({ error: 'network failed' }));
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

    await loadSessions.call(vm);

    assert.strictEqual(vm.sessionsLoadedOnce, false);
    assert.strictEqual(vm.sessionsLoading, false);
    assert.strictEqual(Array.isArray(vm.sessionsList), true);
    assert.strictEqual(vm.sessionsList.length, 0);
});

test('loadMoreSessionMessages requests older messages when local window is exhausted and session is clipped', async () => {
    const loadMoreSessionMessages = createLoadMoreSessionMessages();
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
        fetchCount: 0,
        async loadActiveSessionDetail(options) {
            this.fetchCount += 1;
            this.lastOptions = options;
        }
    };

    await loadMoreSessionMessages.call(vm);

    assert.strictEqual(vm.fetchCount, 1);
    assert.strictEqual(vm.sessionDetailMessageLimit, 160);
    assert.strictEqual(vm.sessionPreviewPendingVisibleCount, 104);
    assert.deepStrictEqual(vm.lastOptions, { preserveVisibleCount: true });
});
