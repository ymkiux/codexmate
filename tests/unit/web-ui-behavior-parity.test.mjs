import assert from 'assert';
import {
    captureCurrentBundledAppOptions,
    captureHeadBundledAppOptions,
    withGlobalOverrides
} from './helpers/web-ui-app-options.mjs';

const currentAppOptions = await captureCurrentBundledAppOptions();
const headAppOptions = await captureHeadBundledAppOptions();
const currentMethods = currentAppOptions.methods;
const headMethods = headAppOptions.methods;
const currentComputed = currentAppOptions.computed;
const headComputed = headAppOptions.computed;
const ALLOWED_CURRENT_ONLY_DATA_KEYS = new Set([
    'providerSwitchDisplayTarget'
]);

function cloneJson(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createJsonFetchHarness(resolver) {
    const calls = [];
    const fetch = async (_url, init = {}) => {
        const payload = init && typeof init.body === 'string' ? JSON.parse(init.body) : {};
        const action = payload.action || '';
        const params = payload.params || {};
        calls.push({
            action,
            params: cloneJson(params)
        });
        const result = await resolver(action, params, calls.length - 1);
        return {
            ok: result && Object.prototype.hasOwnProperty.call(result, 'ok') ? result.ok : true,
            status: result && Number.isFinite(result.status) ? result.status : 200,
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
                return JSON.stringify(result);
            }
        };
    };
    return { calls, fetch };
}

async function runWithFetch(resolver, callback) {
    const harness = createJsonFetchHarness(resolver);
    const value = await withGlobalOverrides({ fetch: harness.fetch }, callback);
    return {
        calls: harness.calls,
        value
    };
}

function createMessagesRecorder() {
    const messages = [];
    return {
        messages,
        showMessage(text, type) {
            messages.push({
                text: String(text),
                type: type || 'info'
            });
        }
    };
}

function createSwitchConfigContext() {
    const calls = [];
    const scheduled = [];
    return {
        mainTab: 'config',
        configMode: 'codex',
        calls,
        scheduled,
        scheduleAfterFrame(fn) {
            scheduled.push(fn);
        },
        refreshClaudeModelContext() {
            calls.push(['refreshClaudeModelContext']);
        },
        clearMainTabSwitchIntent(tab) {
            calls.push(['clearMainTabSwitchIntent', tab]);
        },
        switchMainTab(tab) {
            calls.push(['switchMainTab', tab]);
        }
    };
}

function createLoadAllContext() {
    const messages = createMessagesRecorder();
    const calls = [];
    return {
        ...messages,
        loading: false,
        initError: 'stale',
        currentProvider: 'existing-provider',
        currentModel: 'existing-model',
        serviceTier: 'fast',
        modelReasoningEffort: 'high',
        modelContextWindowInput: 'dirty-context',
        modelAutoCompactTokenLimitInput: 'dirty-limit',
        editingCodexBudgetField: 'modelContextWindowInput',
        providersList: [],
        normalizePositiveIntegerInput(value, _label, fallback) {
            const normalized = Number.isFinite(Number(value)) && Number(value) > 0
                ? String(Math.floor(Number(value)))
                : String(fallback);
            return {
                ok: true,
                text: normalized
            };
        },
        maybeShowStarPrompt() {
            calls.push(['maybeShowStarPrompt']);
        },
        async loadModelsForProvider(name) {
            calls.push(['loadModelsForProvider', name]);
        },
        async loadCodexAuthProfiles() {
            calls.push(['loadCodexAuthProfiles']);
        },
        calls
    };
}

function createSessionTrashContext(methods) {
    const messages = createMessagesRecorder();
    const context = {
        ...messages,
        sessionTrashItems: [
            { trashId: 'old-1', title: 'old-1' },
            { trashId: 'old-2', title: 'old-2' }
        ],
        sessionTrashVisibleCount: 2,
        sessionTrashTotalCount: 2,
        sessionTrashCountLoadedOnce: false,
        sessionTrashLoadedOnce: false,
        sessionTrashLastLoadFailed: false,
        sessionTrashCountPendingOptions: null,
        sessionTrashPendingOptions: null,
        sessionTrashCountLoading: false,
        sessionTrashLoading: false,
        sessionTrashCountRequestToken: 0,
        sessionTrashListRequestToken: 0,
        sessionTrashRestoring: {},
        sessionTrashPurging: {},
        sessionTrashClearing: false
    };
    for (const name of [
        'getSessionTrashActionKey',
        'normalizeSessionTrashTotalCount',
        'issueSessionTrashListRequestToken',
        'isLatestSessionTrashListRequestToken',
        'resetSessionTrashVisibleCount',
        'loadSessionTrash'
    ]) {
        context[name] = methods[name];
    }
    return context;
}

function createOpenclawContext() {
    const messages = createMessagesRecorder();
    const syncCalls = [];
    return {
        ...messages,
        openclawEditing: {
            name: 'draft',
            content: '',
            lockName: false
        },
        openclawFileLoading: false,
        openclawConfigPath: '',
        openclawConfigExists: false,
        openclawLineEnding: '\n',
        syncCalls,
        syncOpenclawStructuredFromText(options = {}) {
            syncCalls.push(cloneJson(options));
        }
    };
}

function createClipboardEnvironment() {
    const clipboardWrites = [];
    const windowObject = {
        isSecureContext: true,
        location: {
            origin: 'http://127.0.0.1:3737',
            href: 'http://127.0.0.1:3737/web-ui',
            pathname: '/web-ui',
            search: ''
        },
        open() {}
    };
    return {
        globals: {
            navigator: {
                clipboard: {
                    async writeText(text) {
                        clipboardWrites.push(String(text));
                    }
                }
            },
            window: windowObject
        },
        clipboardWrites
    };
}

function createDownloadEnvironment() {
    const createdBlobs = [];
    const createdUrls = [];
    const revokedUrls = [];
    const linkState = {
        href: '',
        download: '',
        clicked: 0
    };

    class FakeBlob {
        constructor(parts, options = {}) {
            this.parts = parts;
            this.type = options.type || '';
            createdBlobs.push({
                parts: [...parts],
                type: this.type
            });
        }
    }

    const globals = {
        Blob: FakeBlob,
        URL: {
            createObjectURL(blob) {
                createdUrls.push(blob);
                return `blob:${createdUrls.length}`;
            },
            revokeObjectURL(url) {
                revokedUrls.push(url);
            }
        },
        document: {
            createElement(tagName) {
                assert.strictEqual(tagName, 'a');
                return {
                    set href(value) {
                        linkState.href = value;
                    },
                    get href() {
                        return linkState.href;
                    },
                    set download(value) {
                        linkState.download = value;
                    },
                    get download() {
                        return linkState.download;
                    },
                    click() {
                        linkState.clicked += 1;
                    }
                };
            }
        }
    };

    return {
        globals,
        snapshot() {
            return {
                createdBlobs: cloneJson(createdBlobs),
                createdUrls: createdUrls.length,
                revokedUrls: cloneJson(revokedUrls),
                linkState: cloneJson(linkState)
            };
        }
    };
}

function createCopyActionContext(methods) {
    const messages = createMessagesRecorder();
    return {
        ...messages,
        sessionResumeWithYolo: true,
        providerShareLoading: {},
        claudeShareLoading: {},
        claudeConfigs: {
            shared: {
                baseUrl: 'https://api.example.com',
                apiKey: 'secret',
                model: 'glm-4.7'
            }
        },
        fallbackCopyText() {
            return false;
        },
        shouldAllowProviderShare() {
            return true;
        },
        isResumeCommandAvailable: methods.isResumeCommandAvailable,
        buildResumeCommand: methods.buildResumeCommand,
        quoteResumeArg: methods.quoteResumeArg,
        quoteShellArg: methods.quoteShellArg,
        buildProviderShareCommand: methods.buildProviderShareCommand,
        buildClaudeShareCommand: methods.buildClaudeShareCommand
    };
}

test('captured bundled app skeleton still matches HEAD', () => {
    const currentDataKeys = Object.keys(currentAppOptions.data()).sort();
    const headDataKeys = Object.keys(headAppOptions.data()).sort();
    assert.deepStrictEqual(
        currentDataKeys.filter((key) => !ALLOWED_CURRENT_ONLY_DATA_KEYS.has(key)),
        headDataKeys
    );
    assert.deepStrictEqual(
        Object.keys(currentMethods).sort(),
        Object.keys(headMethods).sort()
    );
    assert.deepStrictEqual(
        Object.keys(currentComputed).sort(),
        Object.keys(headComputed).sort()
    );
    assert.strictEqual(typeof currentAppOptions.mounted, typeof headAppOptions.mounted);
    assert.strictEqual(typeof currentAppOptions.beforeUnmount, typeof headAppOptions.beforeUnmount);
});

test('switchConfigMode keeps config and navigation behavior aligned with HEAD', () => {
    const currentConfigContext = createSwitchConfigContext();
    currentMethods.switchConfigMode.call(currentConfigContext, 'claude');
    for (const task of currentConfigContext.scheduled) {
        task();
    }

    const headConfigContext = createSwitchConfigContext();
    headMethods.switchConfigMode.call(headConfigContext, 'claude');
    for (const task of headConfigContext.scheduled) {
        task();
    }

    assert.deepStrictEqual({
        configMode: currentConfigContext.configMode,
        calls: currentConfigContext.calls
    }, {
        configMode: headConfigContext.configMode,
        calls: headConfigContext.calls
    });

    const currentNavigationContext = {
        mainTab: 'sessions',
        configMode: 'claude',
        calls: [],
        switchMainTab(tab) {
            this.calls.push(['switchMainTab', tab]);
        }
    };
    currentMethods.switchConfigMode.call(currentNavigationContext, 'invalid-mode');

    const headNavigationContext = {
        mainTab: 'sessions',
        configMode: 'claude',
        calls: [],
        switchMainTab(tab) {
            this.calls.push(['switchMainTab', tab]);
        }
    };
    headMethods.switchConfigMode.call(headNavigationContext, 'invalid-mode');

    assert.deepStrictEqual({
        configMode: currentNavigationContext.configMode,
        calls: currentNavigationContext.calls
    }, {
        configMode: headNavigationContext.configMode,
        calls: headNavigationContext.calls
    });
});

test('loadAll keeps success and failure state transitions aligned with HEAD', async () => {
    const successStatus = {
        provider: 'remote-provider',
        model: 'gpt-4.1',
        serviceTier: 'standard',
        modelReasoningEffort: 'medium',
        modelContextWindow: 210000,
        modelAutoCompactTokenLimit: 180000,
        configReady: false,
        initNotice: true
    };
    const successList = {
        providers: ['remote-provider', 'backup-provider']
    };

    const currentSuccessContext = createLoadAllContext();
    const currentSuccess = await runWithFetch(async (action) => {
        if (action === 'status') return successStatus;
        if (action === 'list') return successList;
        throw new Error(`Unexpected action: ${action}`);
    }, () => currentMethods.loadAll.call(currentSuccessContext));

    const headSuccessContext = createLoadAllContext();
    const headSuccess = await runWithFetch(async (action) => {
        if (action === 'status') return successStatus;
        if (action === 'list') return successList;
        throw new Error(`Unexpected action: ${action}`);
    }, () => headMethods.loadAll.call(headSuccessContext));

    assert.deepStrictEqual({
        calls: currentSuccess.calls,
        snapshot: {
            loading: currentSuccessContext.loading,
            initError: currentSuccessContext.initError,
            currentProvider: currentSuccessContext.currentProvider,
            currentModel: currentSuccessContext.currentModel,
            serviceTier: currentSuccessContext.serviceTier,
            modelReasoningEffort: currentSuccessContext.modelReasoningEffort,
            modelContextWindowInput: currentSuccessContext.modelContextWindowInput,
            modelAutoCompactTokenLimitInput: currentSuccessContext.modelAutoCompactTokenLimitInput,
            providersList: currentSuccessContext.providersList,
            messages: currentSuccessContext.messages,
            calls: currentSuccessContext.calls
        }
    }, {
        calls: headSuccess.calls,
        snapshot: {
            loading: headSuccessContext.loading,
            initError: headSuccessContext.initError,
            currentProvider: headSuccessContext.currentProvider,
            currentModel: headSuccessContext.currentModel,
            serviceTier: headSuccessContext.serviceTier,
            modelReasoningEffort: headSuccessContext.modelReasoningEffort,
            modelContextWindowInput: headSuccessContext.modelContextWindowInput,
            modelAutoCompactTokenLimitInput: headSuccessContext.modelAutoCompactTokenLimitInput,
            providersList: headSuccessContext.providersList,
            messages: headSuccessContext.messages,
            calls: headSuccessContext.calls
        }
    });

    const currentFailureContext = createLoadAllContext();
    const currentFailure = await runWithFetch(async (action) => {
        if (action === 'status') {
            throw new Error('offline');
        }
        if (action === 'list') {
            return successList;
        }
        throw new Error(`Unexpected action: ${action}`);
    }, () => currentMethods.loadAll.call(currentFailureContext));

    const headFailureContext = createLoadAllContext();
    const headFailure = await runWithFetch(async (action) => {
        if (action === 'status') {
            throw new Error('offline');
        }
        if (action === 'list') {
            return successList;
        }
        throw new Error(`Unexpected action: ${action}`);
    }, () => headMethods.loadAll.call(headFailureContext));

    assert.deepStrictEqual({
        calls: currentFailure.calls,
        snapshot: {
            loading: currentFailureContext.loading,
            initError: currentFailureContext.initError,
            providersList: currentFailureContext.providersList,
            messages: currentFailureContext.messages,
            calls: currentFailureContext.calls
        }
    }, {
        calls: headFailure.calls,
        snapshot: {
            loading: headFailureContext.loading,
            initError: headFailureContext.initError,
            providersList: headFailureContext.providersList,
            messages: headFailureContext.messages,
            calls: headFailureContext.calls
        }
    });
});

test('session trash list helpers stay aligned with HEAD for prepend and pagination', () => {
    const newTrashItem = {
        trashId: 'fresh-1',
        title: 'fresh-1'
    };

    const currentPrependContext = createSessionTrashContext(currentMethods);
    currentMethods.prependSessionTrashItem.call(currentPrependContext, newTrashItem);

    const headPrependContext = createSessionTrashContext(headMethods);
    headMethods.prependSessionTrashItem.call(headPrependContext, newTrashItem);

    assert.deepStrictEqual({
        sessionTrashItems: currentPrependContext.sessionTrashItems,
        sessionTrashVisibleCount: currentPrependContext.sessionTrashVisibleCount,
        sessionTrashTotalCount: currentPrependContext.sessionTrashTotalCount
    }, {
        sessionTrashItems: headPrependContext.sessionTrashItems,
        sessionTrashVisibleCount: headPrependContext.sessionTrashVisibleCount,
        sessionTrashTotalCount: headPrependContext.sessionTrashTotalCount
    });

    const currentPaginationContext = createSessionTrashContext(currentMethods);
    currentPaginationContext.sessionTrashItems = Array.from({ length: 230 }, (_, index) => ({ trashId: `item-${index}` }));
    currentPaginationContext.sessionTrashVisibleCount = 0;
    currentMethods.resetSessionTrashVisibleCount.call(currentPaginationContext);
    currentMethods.loadMoreSessionTrashItems.call(currentPaginationContext);

    const headPaginationContext = createSessionTrashContext(headMethods);
    headPaginationContext.sessionTrashItems = Array.from({ length: 230 }, (_, index) => ({ trashId: `item-${index}` }));
    headPaginationContext.sessionTrashVisibleCount = 0;
    headMethods.resetSessionTrashVisibleCount.call(headPaginationContext);
    headMethods.loadMoreSessionTrashItems.call(headPaginationContext);

    assert.deepStrictEqual({
        sessionTrashVisibleCount: currentPaginationContext.sessionTrashVisibleCount
    }, {
        sessionTrashVisibleCount: headPaginationContext.sessionTrashVisibleCount
    });
});

test('loadSessionTrash keeps request queuing and failure handling aligned with HEAD', async () => {
    const currentQueueContext = createSessionTrashContext(currentMethods);
    currentQueueContext.sessionTrashLoading = true;
    await currentMethods.loadSessionTrash.call(currentQueueContext, { forceRefresh: true });

    const headQueueContext = createSessionTrashContext(headMethods);
    headQueueContext.sessionTrashLoading = true;
    await headMethods.loadSessionTrash.call(headQueueContext, { forceRefresh: true });

    assert.deepStrictEqual({
        sessionTrashPendingOptions: currentQueueContext.sessionTrashPendingOptions
    }, {
        sessionTrashPendingOptions: headQueueContext.sessionTrashPendingOptions
    });

    const successItems = [
        { trashId: 'fresh-1', title: 'fresh-1' },
        { trashId: 'fresh-2', title: 'fresh-2' },
        { trashId: 'fresh-3', title: 'fresh-3' }
    ];

    const currentSuccessContext = createSessionTrashContext(currentMethods);
    const currentSuccess = await runWithFetch(async (action) => {
        if (action !== 'list-session-trash') {
            throw new Error(`Unexpected action: ${action}`);
        }
        return {
            items: successItems,
            totalCount: 7
        };
    }, () => currentMethods.loadSessionTrash.call(currentSuccessContext, { forceRefresh: true }));

    const headSuccessContext = createSessionTrashContext(headMethods);
    const headSuccess = await runWithFetch(async (action) => {
        if (action !== 'list-session-trash') {
            throw new Error(`Unexpected action: ${action}`);
        }
        return {
            items: successItems,
            totalCount: 7
        };
    }, () => headMethods.loadSessionTrash.call(headSuccessContext, { forceRefresh: true }));

    assert.deepStrictEqual({
        calls: currentSuccess.calls,
        snapshot: {
            sessionTrashItems: currentSuccessContext.sessionTrashItems,
            sessionTrashVisibleCount: currentSuccessContext.sessionTrashVisibleCount,
            sessionTrashTotalCount: currentSuccessContext.sessionTrashTotalCount,
            sessionTrashCountLoadedOnce: currentSuccessContext.sessionTrashCountLoadedOnce,
            sessionTrashLoadedOnce: currentSuccessContext.sessionTrashLoadedOnce,
            sessionTrashLastLoadFailed: currentSuccessContext.sessionTrashLastLoadFailed,
            messages: currentSuccessContext.messages
        }
    }, {
        calls: headSuccess.calls,
        snapshot: {
            sessionTrashItems: headSuccessContext.sessionTrashItems,
            sessionTrashVisibleCount: headSuccessContext.sessionTrashVisibleCount,
            sessionTrashTotalCount: headSuccessContext.sessionTrashTotalCount,
            sessionTrashCountLoadedOnce: headSuccessContext.sessionTrashCountLoadedOnce,
            sessionTrashLoadedOnce: headSuccessContext.sessionTrashLoadedOnce,
            sessionTrashLastLoadFailed: headSuccessContext.sessionTrashLastLoadFailed,
            messages: headSuccessContext.messages
        }
    });

    const currentFailureContext = createSessionTrashContext(currentMethods);
    const currentFailure = await runWithFetch(async (action) => {
        if (action !== 'list-session-trash') {
            throw new Error(`Unexpected action: ${action}`);
        }
        return {
            error: 'trash-backend-error'
        };
    }, () => currentMethods.loadSessionTrash.call(currentFailureContext, { forceRefresh: false }));

    const headFailureContext = createSessionTrashContext(headMethods);
    const headFailure = await runWithFetch(async (action) => {
        if (action !== 'list-session-trash') {
            throw new Error(`Unexpected action: ${action}`);
        }
        return {
            error: 'trash-backend-error'
        };
    }, () => headMethods.loadSessionTrash.call(headFailureContext, { forceRefresh: false }));

    assert.deepStrictEqual({
        calls: currentFailure.calls,
        snapshot: {
            sessionTrashItems: currentFailureContext.sessionTrashItems,
            sessionTrashVisibleCount: currentFailureContext.sessionTrashVisibleCount,
            sessionTrashTotalCount: currentFailureContext.sessionTrashTotalCount,
            sessionTrashLoadedOnce: currentFailureContext.sessionTrashLoadedOnce,
            sessionTrashLastLoadFailed: currentFailureContext.sessionTrashLastLoadFailed,
            messages: currentFailureContext.messages
        }
    }, {
        calls: headFailure.calls,
        snapshot: {
            sessionTrashItems: headFailureContext.sessionTrashItems,
            sessionTrashVisibleCount: headFailureContext.sessionTrashVisibleCount,
            sessionTrashTotalCount: headFailureContext.sessionTrashTotalCount,
            sessionTrashLoadedOnce: headFailureContext.sessionTrashLoadedOnce,
            sessionTrashLastLoadFailed: headFailureContext.sessionTrashLastLoadFailed,
            messages: headFailureContext.messages
        }
    });
});

test('loadOpenclawConfigFromFile keeps fallback and draft-preservation behavior aligned with HEAD', async () => {
    const currentFallbackContext = createOpenclawContext();
    const currentFallback = await runWithFetch(async (action) => {
        if (action !== 'get-openclaw-config') {
            throw new Error(`Unexpected action: ${action}`);
        }
        return {
            path: '/tmp/openclaw.json5',
            exists: false,
            lineEnding: '\r\n',
            content: ''
        };
    }, () => currentMethods.loadOpenclawConfigFromFile.call(currentFallbackContext, {
        silent: false,
        force: true,
        fallbackToTemplate: true
    }));

    const headFallbackContext = createOpenclawContext();
    const headFallback = await runWithFetch(async (action) => {
        if (action !== 'get-openclaw-config') {
            throw new Error(`Unexpected action: ${action}`);
        }
        return {
            path: '/tmp/openclaw.json5',
            exists: false,
            lineEnding: '\r\n',
            content: ''
        };
    }, () => headMethods.loadOpenclawConfigFromFile.call(headFallbackContext, {
        silent: false,
        force: true,
        fallbackToTemplate: true
    }));

    assert.deepStrictEqual({
        calls: currentFallback.calls,
        snapshot: {
            openclawEditing: currentFallbackContext.openclawEditing,
            openclawFileLoading: currentFallbackContext.openclawFileLoading,
            openclawConfigPath: currentFallbackContext.openclawConfigPath,
            openclawConfigExists: currentFallbackContext.openclawConfigExists,
            openclawLineEnding: currentFallbackContext.openclawLineEnding,
            syncCalls: currentFallbackContext.syncCalls,
            messages: currentFallbackContext.messages
        }
    }, {
        calls: headFallback.calls,
        snapshot: {
            openclawEditing: headFallbackContext.openclawEditing,
            openclawFileLoading: headFallbackContext.openclawFileLoading,
            openclawConfigPath: headFallbackContext.openclawConfigPath,
            openclawConfigExists: headFallbackContext.openclawConfigExists,
            openclawLineEnding: headFallbackContext.openclawLineEnding,
            syncCalls: headFallbackContext.syncCalls,
            messages: headFallbackContext.messages
        }
    });

    const currentDraftContext = createOpenclawContext();
    currentDraftContext.openclawEditing.content = 'draft-content';
    await runWithFetch(async (action) => {
        if (action !== 'get-openclaw-config') {
            throw new Error(`Unexpected action: ${action}`);
        }
        return {
            path: '/tmp/openclaw.json5',
            exists: true,
            lineEnding: '\n',
            content: 'file-content'
        };
    }, () => currentMethods.loadOpenclawConfigFromFile.call(currentDraftContext, {
        silent: true,
        force: false
    }));

    const headDraftContext = createOpenclawContext();
    headDraftContext.openclawEditing.content = 'draft-content';
    await runWithFetch(async (action) => {
        if (action !== 'get-openclaw-config') {
            throw new Error(`Unexpected action: ${action}`);
        }
        return {
            path: '/tmp/openclaw.json5',
            exists: true,
            lineEnding: '\n',
            content: 'file-content'
        };
    }, () => headMethods.loadOpenclawConfigFromFile.call(headDraftContext, {
        silent: true,
        force: false
    }));

    assert.deepStrictEqual({
        openclawEditing: currentDraftContext.openclawEditing,
        messages: currentDraftContext.messages
    }, {
        openclawEditing: headDraftContext.openclawEditing,
        messages: headDraftContext.messages
    });
});

test('share, copy, and standalone helpers remain aligned with HEAD', async () => {
    assert.strictEqual(
        currentMethods.buildClaudeImportedConfigName.call({}, 'https://example.com:8443/v1'),
        headMethods.buildClaudeImportedConfigName.call({}, 'https://example.com:8443/v1')
    );
    const standaloneGlobals = {
        window: {
            location: {
                origin: 'http://127.0.0.1:3737'
            }
        }
    };
    const currentStandaloneUrl = await withGlobalOverrides(standaloneGlobals, () => currentMethods.buildSessionStandaloneUrl.call({}, {
        source: 'claude',
        sessionId: 'sess-1',
        filePath: '/tmp/chat.jsonl'
    }));
    const headStandaloneUrl = await withGlobalOverrides(standaloneGlobals, () => headMethods.buildSessionStandaloneUrl.call({}, {
        source: 'claude',
        sessionId: 'sess-1',
        filePath: '/tmp/chat.jsonl'
    }));
    assert.strictEqual(currentStandaloneUrl, headStandaloneUrl);

    const currentInstallEnv = createClipboardEnvironment();
    const currentInstallContext = createCopyActionContext(currentMethods);
    await withGlobalOverrides(currentInstallEnv.globals, () => currentMethods.copyInstallCommand.call(currentInstallContext, 'npm install codexmate'));

    const headInstallEnv = createClipboardEnvironment();
    const headInstallContext = createCopyActionContext(headMethods);
    await withGlobalOverrides(headInstallEnv.globals, () => headMethods.copyInstallCommand.call(headInstallContext, 'npm install codexmate'));

    assert.deepStrictEqual({
        clipboardWrites: currentInstallEnv.clipboardWrites,
        messages: currentInstallContext.messages
    }, {
        clipboardWrites: headInstallEnv.clipboardWrites,
        messages: headInstallContext.messages
    });

    const currentResumeEnv = createClipboardEnvironment();
    const currentResumeContext = createCopyActionContext(currentMethods);
    await withGlobalOverrides(currentResumeEnv.globals, () => currentMethods.copyResumeCommand.call(currentResumeContext, {
        source: 'codex',
        sessionId: 'sess-2'
    }));

    const headResumeEnv = createClipboardEnvironment();
    const headResumeContext = createCopyActionContext(headMethods);
    await withGlobalOverrides(headResumeEnv.globals, () => headMethods.copyResumeCommand.call(headResumeContext, {
        source: 'codex',
        sessionId: 'sess-2'
    }));

    assert.deepStrictEqual({
        clipboardWrites: currentResumeEnv.clipboardWrites,
        messages: currentResumeContext.messages
    }, {
        clipboardWrites: headResumeEnv.clipboardWrites,
        messages: headResumeContext.messages
    });

    const currentProviderContext = createCopyActionContext(currentMethods);
    const currentProviderEnv = createClipboardEnvironment();
    const currentProvider = await withGlobalOverrides({
        ...currentProviderEnv.globals,
        fetch: createJsonFetchHarness(async (action) => {
            if (action !== 'export-provider') {
                throw new Error(`Unexpected action: ${action}`);
            }
            return {
                payload: {
                    name: 'demo-provider',
                    baseUrl: 'https://provider.example.com',
                    apiKey: 'provider-secret',
                    model: 'gpt-4.1'
                }
            };
        }).fetch
    }, () => currentMethods.copyProviderShareCommand.call(currentProviderContext, {
        name: 'demo-provider'
    }));

    const headProviderContext = createCopyActionContext(headMethods);
    const headProviderEnv = createClipboardEnvironment();
    const headProvider = await withGlobalOverrides({
        ...headProviderEnv.globals,
        fetch: createJsonFetchHarness(async (action) => {
            if (action !== 'export-provider') {
                throw new Error(`Unexpected action: ${action}`);
            }
            return {
                payload: {
                    name: 'demo-provider',
                    baseUrl: 'https://provider.example.com',
                    apiKey: 'provider-secret',
                    model: 'gpt-4.1'
                }
            };
        }).fetch
    }, () => headMethods.copyProviderShareCommand.call(headProviderContext, {
        name: 'demo-provider'
    }));

    assert.deepStrictEqual({
        result: currentProvider,
        clipboardWrites: currentProviderEnv.clipboardWrites,
        loading: currentProviderContext.providerShareLoading,
        messages: currentProviderContext.messages
    }, {
        result: headProvider,
        clipboardWrites: headProviderEnv.clipboardWrites,
        loading: headProviderContext.providerShareLoading,
        messages: headProviderContext.messages
    });

    const currentClaudeContext = createCopyActionContext(currentMethods);
    const currentClaudeEnv = createClipboardEnvironment();
    await withGlobalOverrides({
        ...currentClaudeEnv.globals,
        fetch: createJsonFetchHarness(async (action) => {
            if (action !== 'export-claude-share') {
                throw new Error(`Unexpected action: ${action}`);
            }
            return {
                payload: {
                    baseUrl: 'https://claude.example.com',
                    apiKey: 'claude-secret',
                    model: 'claude-3-7'
                }
            };
        }).fetch
    }, () => currentMethods.copyClaudeShareCommand.call(currentClaudeContext, 'shared'));

    const headClaudeContext = createCopyActionContext(headMethods);
    const headClaudeEnv = createClipboardEnvironment();
    await withGlobalOverrides({
        ...headClaudeEnv.globals,
        fetch: createJsonFetchHarness(async (action) => {
            if (action !== 'export-claude-share') {
                throw new Error(`Unexpected action: ${action}`);
            }
            return {
                payload: {
                    baseUrl: 'https://claude.example.com',
                    apiKey: 'claude-secret',
                    model: 'claude-3-7'
                }
            };
        }).fetch
    }, () => headMethods.copyClaudeShareCommand.call(headClaudeContext, 'shared'));

    assert.deepStrictEqual({
        clipboardWrites: currentClaudeEnv.clipboardWrites,
        loading: currentClaudeContext.claudeShareLoading,
        messages: currentClaudeContext.messages
    }, {
        clipboardWrites: headClaudeEnv.clipboardWrites,
        loading: headClaudeContext.claudeShareLoading,
        messages: headClaudeContext.messages
    });
});

test('downloadTextFile and activeSessionVisibleMessages stay aligned with HEAD', async () => {
    const currentDownloadEnv = createDownloadEnvironment();
    await withGlobalOverrides(currentDownloadEnv.globals, () => currentMethods.downloadTextFile.call({}, 'notes.md', 'payload', 'text/plain'));

    const headDownloadEnv = createDownloadEnvironment();
    await withGlobalOverrides(headDownloadEnv.globals, () => headMethods.downloadTextFile.call({}, 'notes.md', 'payload', 'text/plain'));

    assert.deepStrictEqual(currentDownloadEnv.snapshot(), headDownloadEnv.snapshot());

    const currentVisible = currentComputed.activeSessionVisibleMessages.call({
        mainTab: 'sessions',
        sessionPreviewRenderEnabled: true,
        activeSessionMessages: Array.from({ length: 12 }, (_, index) => ({ id: index + 1 })),
        sessionPreviewVisibleCount: 0
    });
    const headVisible = headComputed.activeSessionVisibleMessages.call({
        mainTab: 'sessions',
        sessionPreviewRenderEnabled: true,
        activeSessionMessages: Array.from({ length: 12 }, (_, index) => ({ id: index + 1 })),
        sessionPreviewVisibleCount: 0
    });

    assert.deepStrictEqual(currentVisible, headVisible);
});
