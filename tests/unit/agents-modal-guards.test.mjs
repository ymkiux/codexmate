import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { createAgentsMethods } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.agents.mjs'))
);
const { createCodexConfigMethods } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.codex-config.mjs'))
);

test('closeConfigTemplateModal ignores user close attempts while template apply is busy', () => {
    const methods = createCodexConfigMethods({
        api: async () => ({}),
        getProviderConfigModeMeta() {
            return null;
        }
    });
    const context = {
        ...methods,
        showConfigTemplateModal: true,
        configTemplateApplying: true,
        configTemplateContent: 'draft-template'
    };

    methods.closeConfigTemplateModal.call(context);

    assert.strictEqual(context.showConfigTemplateModal, true);
    assert.strictEqual(context.configTemplateContent, 'draft-template');
});

test('applyConfigTemplate force closes the modal after a successful apply', async () => {
    let loadAllCalls = 0;
    const methods = createCodexConfigMethods({
        api: async () => ({ success: true }),
        getProviderConfigModeMeta() {
            return null;
        }
    });
    const context = {
        ...methods,
        showConfigTemplateModal: true,
        configTemplateApplying: false,
        configTemplateContent: 'draft-template',
        shownMessages: [],
        showMessage(message, type) {
            this.shownMessages.push({ message, type });
        },
        async loadAll() {
            loadAllCalls += 1;
        }
    };

    await methods.applyConfigTemplate.call(context);

    assert.strictEqual(context.showConfigTemplateModal, false);
    assert.strictEqual(context.configTemplateContent, '');
    assert.strictEqual(context.configTemplateApplying, false);
    assert.strictEqual(loadAllCalls, 1);
    assert.deepStrictEqual(context.shownMessages, [{
        message: '模板已应用',
        type: 'success'
    }]);
});

test('applyConfigTemplate keeps the successful apply result when only the refresh fails', async () => {
    const methods = createCodexConfigMethods({
        api: async () => ({ success: true }),
        getProviderConfigModeMeta() {
            return null;
        }
    });
    const context = {
        ...methods,
        showConfigTemplateModal: true,
        configTemplateApplying: false,
        configTemplateContent: 'draft-template',
        shownMessages: [],
        showMessage(message, type) {
            this.shownMessages.push({ message, type });
        },
        async loadAll() {
            throw new Error('refresh failed');
        }
    };

    await methods.applyConfigTemplate.call(context);

    assert.strictEqual(context.showConfigTemplateModal, false);
    assert.strictEqual(context.configTemplateContent, '');
    assert.strictEqual(context.configTemplateApplying, false);
    assert.deepStrictEqual(context.shownMessages, [{
        message: '模板已应用',
        type: 'success'
    }, {
        message: '模板已应用，但界面刷新失败，请手动刷新',
        type: 'error'
    }]);
});

test('runHealthCheck treats backend error payloads as failures', async () => {
    const methods = createCodexConfigMethods({
        api: async () => ({ error: 'health failed' }),
        getProviderConfigModeMeta() {
            return null;
        }
    });
    const context = {
        ...methods,
        providersList: ['alpha'],
        speedResults: {},
        speedLoading: {},
        healthCheckLoading: false,
        healthCheckResult: { ok: true },
        configMode: 'codex',
        shownMessages: [],
        showMessage(message, type) {
            this.shownMessages.push({ message, type });
        },
        async runSpeedTest() {
            throw new Error('speed tests should be skipped when health check already failed');
        }
    };

    await methods.runHealthCheck.call(context);

    assert.strictEqual(context.healthCheckLoading, false);
    assert.strictEqual(context.healthCheckResult, null);
    assert.deepStrictEqual(context.shownMessages, [{
        message: 'health failed',
        type: 'error'
    }]);
});

test('runHealthCheck skips Claude speed tests when the primary health check already failed', async () => {
    const methods = createCodexConfigMethods({
        api: async () => ({ error: 'health failed' }),
        getProviderConfigModeMeta() {
            return null;
        }
    });
    let claudeSpeedTestCalls = 0;
    const context = {
        ...methods,
        providersList: ['alpha'],
        speedResults: {},
        speedLoading: {},
        healthCheckLoading: false,
        healthCheckResult: { ok: true },
        configMode: 'claude',
        claudeConfigs: {
            primary: {
                baseUrl: 'https://example.com',
                apiKey: 'secret'
            }
        },
        shownMessages: [],
        showMessage(message, type) {
            this.shownMessages.push({ message, type });
        },
        async runSpeedTest() {
            throw new Error('speed tests should be skipped when health check already failed');
        },
        async runClaudeSpeedTest() {
            claudeSpeedTestCalls += 1;
        }
    };

    await methods.runHealthCheck.call(context);

    assert.strictEqual(context.healthCheckLoading, false);
    assert.strictEqual(context.healthCheckResult, null);
    assert.strictEqual(claudeSpeedTestCalls, 0);
    assert.deepStrictEqual(context.shownMessages, [{
        message: 'health failed',
        type: 'error'
    }]);
});

test('runHealthCheck preserves backend remote health result while appending speed test summaries', async () => {
    const methods = createCodexConfigMethods({
        api: async () => ({
            ok: true,
            issues: [],
            remote: {
                type: 'remote-health-check',
                provider: 'alpha',
                endpoint: 'https://example.com/v1',
                statusCode: 200,
                ok: true,
                message: 'ok'
            }
        }),
        getProviderConfigModeMeta() {
            return null;
        }
    });
    const context = {
        ...methods,
        providersList: ['alpha', 'beta'],
        speedResults: {},
        speedLoading: {},
        healthCheckLoading: false,
        healthCheckResult: null,
        configMode: 'codex',
        shownMessages: [],
        showMessage(message, type) {
            this.shownMessages.push({ message, type });
        },
        async runSpeedTest(name) {
            return { ok: true, durationMs: name === 'alpha' ? 10 : 20, status: 200 };
        },
        buildSpeedTestIssue() {
            return null;
        }
    };

    await methods.runHealthCheck.call(context);

    assert.strictEqual(context.healthCheckLoading, false);
    assert.strictEqual(context.healthCheckResult.remote.type, 'remote-health-check');
    assert.strictEqual(context.healthCheckResult.remote.statusCode, 200);
    assert.deepStrictEqual(context.healthCheckResult.remote.speedTests, {
        alpha: { ok: true, durationMs: 10, status: 200 },
        beta: { ok: true, durationMs: 20, status: 200 }
    });
});

test('openHealthCheckDialog opens unlocked selector by default and locks when provider is specified', () => {
    const methods = createCodexConfigMethods({
        api: async () => ({}),
        getProviderConfigModeMeta() {
            return null;
        }
    });
    const context = {
        ...methods,
        currentProvider: 'alpha',
        displayProvidersList: [{ name: 'alpha' }, { name: 'beta' }],
        showHealthCheckDialog: false,
        healthCheckDialogLockedProvider: '',
        healthCheckDialogSelectedProvider: '',
        healthCheckDialogPrompt: '',
        healthCheckDialogMessages: [{ id: 'stale' }],
        healthCheckDialogLastResult: { ok: false },
        shownMessages: [],
        showMessage(message, type) {
            this.shownMessages.push({ message, type });
        }
    };

    methods.openHealthCheckDialog.call(context);
    assert.strictEqual(context.showHealthCheckDialog, true);
    assert.strictEqual(context.healthCheckDialogLockedProvider, '');
    assert.strictEqual(context.healthCheckDialogSelectedProvider, 'alpha');
    assert.deepStrictEqual(context.healthCheckDialogMessages, []);

    methods.openHealthCheckDialog.call(context, { providerName: 'beta', locked: true });
    assert.strictEqual(context.healthCheckDialogLockedProvider, '');
    assert.strictEqual(context.healthCheckDialogSelectedProvider, 'alpha');
    assert.deepStrictEqual(context.shownMessages, [{
        message: '请先切换到该提供商再进行健康聊天测试',
        type: 'info'
    }]);
});

test('sendHealthCheckDialogMessage appends transcript and clears prompt after success', async () => {
    const apiCalls = [];
    const methods = createCodexConfigMethods({
        api: async (action, params) => {
            apiCalls.push({ action, params });
            return {
                ok: true,
                provider: params.name,
                model: 'alpha-model',
                status: 200,
                durationMs: 12,
                reply: 'provider is healthy'
            };
        },
        getProviderConfigModeMeta() {
            return null;
        }
    });
    const context = {
        ...methods,
        healthCheckDialogLockedProvider: '',
        healthCheckDialogSelectedProvider: 'alpha',
        healthCheckDialogPrompt: 'say ok',
        healthCheckDialogMessages: [],
        healthCheckDialogSending: false,
        healthCheckDialogLastResult: null,
        shownMessages: [],
        showMessage(message, type) {
            this.shownMessages.push({ message, type });
        }
    };

    await methods.sendHealthCheckDialogMessage.call(context);

    assert.deepStrictEqual(apiCalls, [{
        action: 'provider-chat-check',
        params: {
            name: 'alpha',
            prompt: 'say ok'
        }
    }]);
    assert.strictEqual(context.healthCheckDialogPrompt, '');
    assert.strictEqual(context.healthCheckDialogSending, false);
    assert.strictEqual(context.healthCheckDialogMessages.length, 2);
    assert.strictEqual(context.healthCheckDialogMessages[0].role, 'user');
    assert.strictEqual(context.healthCheckDialogMessages[1].text, 'provider is healthy');
});

test('applyCodexConfigDirect keeps the successful apply result when only the refresh fails', async () => {
    const apiCalls = [];
    const methods = createCodexConfigMethods({
        api: async (action) => {
            apiCalls.push(action);
            if (action === 'get-config-template') {
                return { template: 'template-body' };
            }
            if (action === 'apply-config-template') {
                return { success: true };
            }
            throw new Error(`Unexpected action: ${action}`);
        },
        getProviderConfigModeMeta() {
            return null;
        }
    });
    const context = {
        ...methods,
        codexApplying: false,
        _pendingCodexApplyOptions: null,
        currentProvider: 'alpha',
        currentModel: 'alpha-model',
        serviceTier: 'fast',
        modelReasoningEffort: 'high',
        modelContextWindowInput: '190000',
        modelAutoCompactTokenLimitInput: '185000',
        shownMessages: [],
        normalizePositiveIntegerInput(value, label, fallback = '') {
            const raw = value === undefined || value === null || value === ''
                ? String(fallback || '')
                : String(value);
            const numeric = Number.parseInt(String(raw).trim(), 10);
            if (!Number.isFinite(numeric) || numeric <= 0) {
                return { ok: false, error: `${label} invalid` };
            }
            return { ok: true, value: numeric, text: String(numeric) };
        },
        showMessage(message, type) {
            this.shownMessages.push({ message, type });
        },
        async loadAll() {
            throw new Error('refresh failed');
        }
    };

    await methods.applyCodexConfigDirect.call(context);

    assert.strictEqual(context.codexApplying, false);
    assert.deepStrictEqual(apiCalls, ['get-config-template', 'apply-config-template']);
    assert.deepStrictEqual(context.shownMessages, [{
        message: '配置已应用',
        type: 'success'
    }, {
        message: '配置已应用，但界面刷新失败，请手动刷新',
        type: 'error'
    }]);
});

test('handleBeforeUnload keeps the agents unsaved-change guard active while saving', () => {
    const methods = createAgentsMethods();
    const context = {
        ...methods,
        showAgentsModal: true,
        agentsLoading: false,
        agentsSaving: true,
        agentsDiffVisible: false,
        agentsOriginalContent: 'before',
        agentsContent: 'after'
    };
    const event = {
        returnValue: undefined,
        preventDefaultCalled: false,
        preventDefault() {
            this.preventDefaultCalled = true;
        }
    };

    const result = methods.handleBeforeUnload.call(context, event);

    assert.strictEqual(methods.hasPendingAgentsDraft.call(context), true);
    assert.strictEqual(result, '');
    assert.strictEqual(event.preventDefaultCalled, true);
    assert.strictEqual(event.returnValue, '');
});

test('openOpenclawWorkspaceEditor rejects invalid workspace filenames before loading', async () => {
    let apiCalls = 0;
    const methods = createAgentsMethods({
        api: async () => {
            apiCalls += 1;
            return {};
        }
    });
    const context = {
        ...methods,
        openclawWorkspaceFileName: '../escape.md',
        shownMessages: [],
        showMessage(message, type) {
            this.shownMessages.push({ message, type });
        }
    };

    await methods.openOpenclawWorkspaceEditor.call(context);

    assert.strictEqual(apiCalls, 0);
    assert.strictEqual(context.agentsLoading, undefined);
    assert.deepStrictEqual(context.shownMessages, [{
        message: '仅支持 OpenClaw Workspace 内的 `.md` 文件',
        type: 'error'
    }]);
});

test('latest agents editor request keeps loading state until the newest response lands', async () => {
    const resolvers = [];
    const methods = createAgentsMethods({
        api: async (action) => new Promise((resolve) => {
            resolvers.push({ action, resolve });
        })
    });
    const context = {
        ...methods,
        shownMessages: [],
        resetCalls: 0,
        showMessage(message, type) {
            this.shownMessages.push({ message, type });
        },
        resetAgentsDiffState() {
            this.resetCalls += 1;
        }
    };

    const firstOpen = methods.openAgentsEditor.call(context);
    const secondOpen = methods.openOpenclawAgentsEditor.call(context);

    assert.strictEqual(context.agentsLoading, true);
    assert.deepStrictEqual(
        resolvers.map((entry) => entry.action),
        ['get-agents-file', 'get-openclaw-agents-file']
    );

    resolvers[0].resolve({
        content: 'codex-agents',
        path: '/tmp/AGENTS.md',
        exists: true,
        lineEnding: '\n'
    });
    await firstOpen;

    assert.strictEqual(context.agentsLoading, true);
    assert.strictEqual(context.showAgentsModal, undefined);
    assert.strictEqual(context.agentsContent, undefined);
    assert.strictEqual(context.resetCalls, 0);

    resolvers[1].resolve({
        content: 'openclaw-agents',
        path: '/tmp/openclaw/AGENTS.md',
        exists: true,
        lineEnding: '\r\n'
    });
    await secondOpen;

    assert.strictEqual(context.agentsLoading, false);
    assert.strictEqual(context.showAgentsModal, true);
    assert.strictEqual(context.agentsContext, 'openclaw');
    assert.strictEqual(context.agentsContent, 'openclaw-agents');
    assert.strictEqual(context.agentsPath, '/tmp/openclaw/AGENTS.md');
    assert.strictEqual(context.agentsLineEnding, '\r\n');
    assert.strictEqual(context.resetCalls, 1);
    assert.deepStrictEqual(context.shownMessages, []);
});

test('closeAgentsModal invalidates pending open requests so late responses cannot reopen the modal', async () => {
    let resolveApi;
    const methods = createAgentsMethods({
        api: async () => await new Promise((resolve) => {
            resolveApi = resolve;
        })
    });
    const context = {
        ...methods,
        showAgentsModal: false,
        agentsContent: '',
        agentsOriginalContent: '',
        agentsPath: '',
        agentsExists: false,
        agentsLineEnding: '\n',
        shownMessages: [],
        showMessage(message, type) {
            this.shownMessages.push({ message, type });
        }
    };

    const pendingOpen = methods.openAgentsEditor.call(context);
    assert.strictEqual(context.agentsLoading, true);

    await methods.closeAgentsModal.call(context, { force: true });
    assert.strictEqual(context.agentsLoading, false);
    assert.strictEqual(context.showAgentsModal, false);

    resolveApi({
        content: 'late-agents',
        path: '/tmp/AGENTS.md',
        exists: true,
        lineEnding: '\n'
    });
    await pendingOpen;

    assert.strictEqual(context.agentsLoading, false);
    assert.strictEqual(context.showAgentsModal, false);
    assert.strictEqual(context.agentsContent, '');
    assert.strictEqual(context.agentsPath, '');
    assert.deepStrictEqual(context.shownMessages, []);
});

test('applyAgentsContent rejects invalid workspace filenames before save api', async () => {
    let apiCalls = 0;
    const methods = createAgentsMethods({
        api: async () => {
            apiCalls += 1;
            return { success: true };
        }
    });
    const context = {
        ...methods,
        agentsContext: 'openclaw-workspace',
        agentsWorkspaceFileName: '../escape.md',
        agentsDiffVisible: true,
        agentsDiffLoading: false,
        agentsDiffError: '',
        agentsDiffHasChanges: true,
        agentsDiffHasChangesValue: true,
        agentsDiffFingerprint: 'same',
        agentsContent: 'after',
        agentsOriginalContent: 'before',
        agentsLineEnding: '\n',
        shownMessages: [],
        showMessage(message, type) {
            this.shownMessages.push({ message, type });
        },
        buildAgentsDiffFingerprint() {
            return 'same';
        }
    };

    await methods.applyAgentsContent.call(context);

    assert.strictEqual(apiCalls, 0);
    assert.strictEqual(context.agentsSaving, undefined);
    assert.deepStrictEqual(context.shownMessages, [{
        message: '仅支持 OpenClaw Workspace 内的 `.md` 文件',
        type: 'error'
    }]);
});

test('applyAgentsContent ignores duplicate save attempts while a save is already running', async () => {
    const resolvers = [];
    const apiCalls = [];
    const methods = createAgentsMethods({
        api: async (action, params) => {
            apiCalls.push({ action, params });
            return new Promise((resolve) => {
                resolvers.push(resolve);
            });
        }
    });
    const closeCalls = [];
    const context = {
        ...methods,
        agentsContext: 'codex',
        agentsDiffVisible: true,
        agentsDiffLoading: false,
        agentsDiffError: '',
        agentsDiffHasChanges: true,
        agentsDiffHasChangesValue: true,
        agentsDiffFingerprint: 'same',
        agentsContent: 'after',
        agentsOriginalContent: 'before',
        agentsLineEnding: '\n',
        shownMessages: [],
        showMessage(message, type) {
            this.shownMessages.push({ message, type });
        },
        buildAgentsDiffFingerprint() {
            return 'same';
        },
        closeAgentsModal(options) {
            closeCalls.push(options);
        }
    };

    const firstApply = methods.applyAgentsContent.call(context);
    assert.strictEqual(context.agentsSaving, true);

    const secondApply = methods.applyAgentsContent.call(context);
    assert.strictEqual(apiCalls.length, 1);

    resolvers[0]({ success: true });
    if (resolvers[1]) {
        resolvers[1]({ success: true });
    }

    await firstApply;
    await secondApply;

    assert.deepStrictEqual(apiCalls, [{
        action: 'apply-agents-file',
        params: {
            content: 'after',
            lineEnding: '\n'
        }
    }]);
    assert.strictEqual(context.agentsSaving, false);
    assert.deepStrictEqual(closeCalls, [{ force: true }]);
    assert.deepStrictEqual(context.shownMessages, [{
        message: 'AGENTS.md 已保存',
        type: 'success'
    }]);
});
