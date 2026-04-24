import {
    persistPromptTemplatesToStorage,
    readPromptTemplatesFromStorage
} from './storage.mjs';

function nowIsoPromptTemplatesOverview() {
    return new Date().toISOString();
}

function buildBuiltinCommentPolishTemplate(t) {
    const tr = (key, fallback, params = null) => (typeof t === 'function' ? t(key, params) : fallback);
    const line1 = tr('plugins.builtin.commentPolish.line1', '轻微收敛以下代码注释');
    return {
        id: 'builtin_comment_polish',
        name: tr('plugins.builtin.commentPolish.name', '代码注释润色'),
        description: tr('plugins.builtin.commentPolish.desc', '轻微收敛以下代码注释 {{code}}'),
        template: [
            line1,
            '',
            '{{code}}'
        ].join('\n'),
        createdAt: nowIsoPromptTemplatesOverview(),
        updatedAt: nowIsoPromptTemplatesOverview(),
        isBuiltin: true
    };
}

function buildBuiltinRuleAckTemplate(t) {
    const tr = (key, fallback, params = null) => (typeof t === 'function' ? t(key, params) : fallback);
    const line1 = tr('plugins.builtin.ruleAck.line1', '请根据【{{rule}}】，收到请回复');
    return {
        id: 'builtin_rule_ack',
        name: tr('plugins.builtin.ruleAck.name', '规则确认回复'),
        description: tr('plugins.builtin.ruleAck.desc', '请根据【{{rule}}】，收到请回复'),
        template: line1,
        createdAt: nowIsoPromptTemplatesOverview(),
        updatedAt: nowIsoPromptTemplatesOverview(),
        isBuiltin: true
    };
}

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
