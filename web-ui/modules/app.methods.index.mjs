import {
    API_BASE,
    api,
    apiWithMeta
} from './api.mjs';
import {
    DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT,
    DEFAULT_MODEL_CONTEXT_WINDOW,
    DEFAULT_OPENCLAW_TEMPLATE,
    SESSION_TRASH_LIST_LIMIT,
    SESSION_TRASH_PAGE_SIZE
} from './app.constants.mjs';
import { createAgentsMethods } from './app.methods.agents.mjs';
import { createClaudeConfigMethods } from './app.methods.claude-config.mjs';
import { createCodexConfigMethods } from './app.methods.codex-config.mjs';
import { createInstallMethods } from './app.methods.install.mjs';
import { createNavigationMethods } from './app.methods.navigation.mjs';
import { createOpenclawCoreMethods } from './app.methods.openclaw-core.mjs';
import { createOpenclawEditingMethods } from './app.methods.openclaw-editing.mjs';
import { createOpenclawPersistMethods } from './app.methods.openclaw-persist.mjs';
import { createProvidersMethods } from './app.methods.providers.mjs';
import { createRuntimeMethods } from './app.methods.runtime.mjs';
import { createTaskOrchestrationMethods } from './app.methods.task-orchestration.mjs';
import { createSessionActionMethods } from './app.methods.session-actions.mjs';
import { createSessionBrowserMethods } from './app.methods.session-browser.mjs';
import { createSessionTimelineMethods } from './app.methods.session-timeline.mjs';
import { createSessionTrashMethods } from './app.methods.session-trash.mjs';
import { createStartupClaudeMethods } from './app.methods.startup-claude.mjs';
import { createSkillsMethods } from './skills.methods.mjs';
import {
    CONFIG_MODE_SET,
    getProviderConfigModeMeta
} from './config-mode.computed.mjs';
import {
    loadActiveSessionDetail as loadActiveSessionDetailHelper,
    loadMoreSessionMessages as loadMoreSessionMessagesHelper,
    loadSessions as loadSessionsHelper,
    switchMainTab as switchMainTabHelper
} from '../session-helpers.mjs';

export function createAppMethods() {
    return {
        ...createStartupClaudeMethods({
            api,
            defaultModelContextWindow: DEFAULT_MODEL_CONTEXT_WINDOW,
            defaultModelAutoCompactTokenLimit: DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT
        }),
        ...createNavigationMethods({
            configModeSet: CONFIG_MODE_SET,
            switchMainTabHelper,
            loadMoreSessionMessagesHelper
        }),
        ...createSessionActionMethods({
            api,
            apiBase: API_BASE
        }),
        ...createSessionTrashMethods({
            api,
            sessionTrashListLimit: SESSION_TRASH_LIST_LIMIT,
            sessionTrashPageSize: SESSION_TRASH_PAGE_SIZE
        }),
        ...createSessionBrowserMethods({
            api,
            loadSessionsHelper,
            loadActiveSessionDetailHelper
        }),
        ...createSessionTimelineMethods(),
        ...createCodexConfigMethods({
            api,
            defaultModelContextWindow: DEFAULT_MODEL_CONTEXT_WINDOW,
            defaultModelAutoCompactTokenLimit: DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT,
            getProviderConfigModeMeta
        }),
        ...createSkillsMethods({ api }),
        ...createAgentsMethods({ api, apiWithMeta }),
        ...createProvidersMethods({ api }),
        ...createClaudeConfigMethods({ api }),
        ...createOpenclawCoreMethods(),
        ...createOpenclawEditingMethods(),
        ...createOpenclawPersistMethods({
            api,
            defaultOpenclawTemplate: DEFAULT_OPENCLAW_TEMPLATE
        }),
        ...createInstallMethods(),
        ...createRuntimeMethods({ api }),
        ...createTaskOrchestrationMethods({ api })
    };
}
