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
