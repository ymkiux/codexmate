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
