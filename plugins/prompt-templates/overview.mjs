import {
    persistPromptTemplatesToStorage,
    readPromptTemplatesFromStorage
} from './storage.mjs';
import { buildBuiltinCommentPolishTemplate } from './comment-polish/index.mjs';
import { buildBuiltinRuleAckTemplate } from './rule-ack/index.mjs';

function ensureBuiltinTemplates(rawList, builtins) {
    const list = Array.isArray(rawList) ? rawList.filter(Boolean) : [];
    const builtinList = Array.isArray(builtins) ? builtins.filter(Boolean) : [];
    const rest = list.filter((item) => !(item && item.isBuiltin === true));
    const overridden = new Set(
        rest
            .map((item) => (item && typeof item.id === 'string' ? item.id.trim() : ''))
            .filter(Boolean)
    );
    const resolvedBuiltins = builtinList.filter((item) => !(item && overridden.has(item.id)));
    return [...resolvedBuiltins, ...rest];
}

export async function loadPromptTemplatesOverview(ctx, options = {}) {
    const app = ctx && typeof ctx === 'object' ? ctx : {};
    const silent = !!(options && options.silent);
    const forceRefresh = !!(options && options.forceRefresh);

    const shouldReload = forceRefresh || app.promptTemplatesLoadedOnce !== true;
    if (!shouldReload) return true;

    const t = typeof app.t === 'function' ? app.t : null;
    const rawList = readPromptTemplatesFromStorage(localStorage);
    const normalized = ensureBuiltinTemplates(rawList, [
        buildBuiltinCommentPolishTemplate(t),
        buildBuiltinRuleAckTemplate(t)
    ]);
    app.promptTemplatesListRaw = normalized;
    persistPromptTemplatesToStorage(normalized, localStorage);

    app.promptTemplatesLoadedOnce = true;

    if (!app.promptTemplatesMode) {
        app.promptTemplatesMode = 'compose';
    }
    if (app.promptTemplatesMode !== 'compose' && app.promptTemplatesMode !== 'manage') {
        app.promptTemplatesMode = 'compose';
    }
    if (app.mainTab === 'plugins') {
        app.promptTemplatesMode = 'compose';
    }

    if (app.mainTab === 'plugins' && app.promptTemplatesMode === 'compose') {
        const list = Array.isArray(app.promptTemplatesList) ? app.promptTemplatesList : [];
        const exists = list.some((item) => item && item.id === app.promptComposerSelectedTemplateId);
        if (!app.promptComposerSelectedTemplateId || !exists) {
            app.promptComposerSelectedTemplateId = 'builtin_comment_polish';
        }
        if (!app.promptComposerVarValuesRaw || typeof app.promptComposerVarValuesRaw !== 'object') {
            app.promptComposerVarValuesRaw = {};
        }
    }

    if (app.promptTemplatesMode === 'manage') {
        const currentSelected = typeof app.promptTemplateSelectedId === 'string'
            ? app.promptTemplateSelectedId
            : '';
        const first = Array.isArray(app.promptTemplatesList) && app.promptTemplatesList.length
            ? app.promptTemplatesList[0]
            : null;
        if (!currentSelected && first && typeof app.selectPromptTemplate === 'function') {
            app.selectPromptTemplate(first.id);
        }
    }

    if (app.mainTab === 'plugins' && app.promptTemplatesMode === 'compose' && typeof app.$nextTick === 'function') {
        app.$nextTick(() => {
            const input = app.$refs && app.$refs.promptComposerCodeInput
                ? app.$refs.promptComposerCodeInput
                : null;
            if (input && typeof input.focus === 'function') input.focus();
        });
    }

    return true;
}
