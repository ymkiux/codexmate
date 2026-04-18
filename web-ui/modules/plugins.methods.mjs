import {
    persistPromptTemplatesToStorage,
    readPromptTemplatesFromStorage
} from './plugins.storage.mjs';

function createId(prefix = 'tpl') {
    const rand = Math.random().toString(16).slice(2, 10);
    return `${prefix}_${Date.now().toString(16)}_${rand}`;
}

function nowIso() {
    return new Date().toISOString();
}

function normalizePromptTemplateDraft(draft) {
    const safe = draft && typeof draft === 'object' ? draft : {};
    return {
        id: typeof safe.id === 'string' ? safe.id : '',
        name: typeof safe.name === 'string' ? safe.name : '',
        description: typeof safe.description === 'string' ? safe.description : '',
        template: typeof safe.template === 'string' ? safe.template : '',
        createdAt: typeof safe.createdAt === 'string' ? safe.createdAt : '',
        updatedAt: typeof safe.updatedAt === 'string' ? safe.updatedAt : '',
        isBuiltin: safe.isBuiltin === true
    };
}

function buildBuiltinMisakaTemplate() {
    return {
        id: 'builtin_misaka',
        name: 'Use Skill: 御坂',
        description: '快速调用御坂技能（在 {{input}} 中填写你的需求）',
        template: [
            'Use Skill: 御坂',
            '',
            '{{input}}'
        ].join('\n'),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        isBuiltin: true
    };
}

function buildBuiltinFrontendDesignTemplate() {
    return {
        id: 'builtin_frontend_design',
        name: 'Use Skill: frontend-design',
        description: '快速调用 frontend-design（在 {{input}} 中填写 UI / 组件需求）',
        template: [
            'Use Skill: frontend-design',
            '',
            '{{input}}'
        ].join('\n'),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        isBuiltin: true
    };
}

function ensureBuiltinTemplates(rawList) {
    const list = Array.isArray(rawList) ? rawList.filter(Boolean) : [];
    const builtins = [buildBuiltinMisakaTemplate(), buildBuiltinFrontendDesignTemplate()];
    const builtinIdSet = new Set(builtins.map((tpl) => tpl.id));
    const rest = list.filter((item) => !(item && item.isBuiltin === true && builtinIdSet.has(item.id)));
    return [...builtins, ...rest];
}

export function createPluginsMethods() {
    return {
        onPromptComposerInput() {
            const raw = typeof this.promptComposerCommand === 'string' ? this.promptComposerCommand : '';
            const text = raw.trimStart();
            if (!text.startsWith('/')) {
                if (this.promptComposerPickerVisible) {
                    this.promptComposerPickerVisible = false;
                }
                return;
            }

            const lower = text.toLowerCase();
            const isPluginCommand = lower.startsWith('/pl') || lower.startsWith('/plugin') || lower.startsWith('/plugins');
            if (!isPluginCommand) return;

            // Support "/plugin foo" to prefill search keyword with "foo"
            const after = text.replace(/^\/plugins?\b/i, '').trim();
            this.promptComposerPickerKeyword = after;
            if (!this.promptComposerPickerVisible) {
                this.openPromptComposerPicker({ keepKeyword: true });
            }
        },

        onPromptComposerKeydown(event) {
            const e = event || null;
            if (!e || e.key !== 'Enter') return;
            if (e.shiftKey) return;
            e.preventDefault();

            if (this.promptComposerPickerVisible) {
                const list = Array.isArray(this.promptComposerPickerList) ? this.promptComposerPickerList : [];
                if (list.length) {
                    this.usePromptTemplateInComposer(list[0].id);
                }
                return;
            }

            const value = typeof this.promptComposerCommand === 'string' ? this.promptComposerCommand.trim() : '';
            const lower = value.toLowerCase();
            if (lower === '/plugin' || lower === '/plugins' || lower === '/pl') {
                this.openPromptComposerPicker();
                return;
            }
        },

        onPromptComposerPickerKeydown(event) {
            const e = event || null;
            if (!e) return;
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const list = Array.isArray(this.promptComposerPickerList) ? this.promptComposerPickerList : [];
                if (list.length) {
                    this.usePromptTemplateInComposer(list[0].id);
                }
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                this.closePromptComposerPicker();
            }
        },

        openPromptComposerPicker(options = {}) {
            this.promptComposerPickerVisible = true;
            if (!(options && options.keepKeyword)) {
                this.promptComposerPickerKeyword = '';
            }
            if (typeof this.$nextTick === 'function') {
                this.$nextTick(() => {
                    const input = this.$refs && this.$refs.promptComposerPickerSearch
                        ? this.$refs.promptComposerPickerSearch
                        : null;
                    if (input && typeof input.focus === 'function') input.focus();
                });
            }
        },

        closePromptComposerPicker() {
            this.promptComposerPickerVisible = false;
            if (typeof this.$nextTick === 'function') {
                this.$nextTick(() => {
                    const input = this.$refs && this.$refs.promptComposerCommandInput
                        ? this.$refs.promptComposerCommandInput
                        : null;
                    if (input && typeof input.focus === 'function') input.focus();
                });
            }
        },

        usePromptTemplateInComposer(id) {
            const next = typeof id === 'string' ? id.trim() : '';
            if (!next) return;
            this.promptComposerSelectedTemplateId = next;
            this.promptComposerVarValuesRaw = {};
            this.promptComposerCommand = '';
            this.promptComposerPickerVisible = false;
            this.promptTemplatesMode = 'compose';
            if (typeof this.$nextTick === 'function') {
                this.$nextTick(() => {
                    // Focus the first placeholder field if it exists.
                    const firstVar = this.$refs && this.$refs.promptComposerFirstVar
                        ? this.$refs.promptComposerFirstVar
                        : null;
                    if (firstVar && typeof firstVar.focus === 'function') firstVar.focus();
                });
            }
        },

        resetPromptComposer() {
            this.promptComposerCommand = '';
            this.promptComposerSelectedTemplateId = '';
            this.promptComposerVarValuesRaw = {};
            this.promptComposerPickerVisible = false;
            this.promptComposerPickerKeyword = '';
        },

        setPromptComposerVarValue(name, value) {
            const key = typeof name === 'string' ? name.trim() : '';
            if (!key) return;
            const current = this.promptComposerVarValuesRaw && typeof this.promptComposerVarValuesRaw === 'object'
                ? this.promptComposerVarValuesRaw
                : {};
            const next = { ...current };
            next[key] = value == null ? '' : String(value);
            this.promptComposerVarValuesRaw = next;
        },

        async copyPromptComposerRendered() {
            const text = typeof this.promptComposerRendered === 'string' ? this.promptComposerRendered.trim() : '';
            if (!text) {
                this.showMessage('Nothing to copy', 'info');
                return;
            }
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                    this.showMessage('Copied', 'success');
                    return;
                }
            } catch (_) {}
            const ok = typeof this.fallbackCopyText === 'function' ? this.fallbackCopyText(text) : false;
            if (ok) {
                this.showMessage('Copied', 'success');
                return;
            }
            this.showMessage('Copy failed', 'error');
        },

        selectPlugin(pluginId) {
            const id = typeof pluginId === 'string' ? pluginId.trim() : '';
            if (!id) return;
            this.pluginsActiveId = id;
        },

        async loadPluginsOverview(options = {}) {
            const silent = !!(options && options.silent);
            const forceRefresh = !!(options && options.forceRefresh);
            if (this.pluginsLoading) return false;

            const shouldReload = forceRefresh || this.promptTemplatesLoadedOnce !== true;
            if (!shouldReload) return true;

            this.pluginsLoading = true;
            try {
                const rawList = readPromptTemplatesFromStorage(localStorage);
                const normalized = ensureBuiltinTemplates(rawList);
                this.promptTemplatesListRaw = normalized;
                // Keep built-in templates in sync (and ensure they exist).
                persistPromptTemplatesToStorage(normalized, localStorage);

                this.promptTemplatesLoadedOnce = true;
                if (!this.pluginsActiveId) {
                    this.pluginsActiveId = 'prompt-templates';
                }

                if (!this.promptTemplatesMode) {
                    this.promptTemplatesMode = 'compose';
                }
                if (this.promptTemplatesMode !== 'compose' && this.promptTemplatesMode !== 'manage') {
                    this.promptTemplatesMode = 'compose';
                }
                if (this.mainTab === 'plugins') {
                    // UX default: always start from Compose when user enters Plugins.
                    this.promptTemplatesMode = 'compose';
                }

                // In Compose mode we keep the flow lightweight and do not auto-select a template.
                // In Manage mode we can auto-select the first template for convenience.
                if (this.promptTemplatesMode === 'manage') {
                    const currentSelected = typeof this.promptTemplateSelectedId === 'string'
                        ? this.promptTemplateSelectedId
                        : '';
                    const first = Array.isArray(this.promptTemplatesList) && this.promptTemplatesList.length
                        ? this.promptTemplatesList[0]
                        : null;
                    if (!currentSelected && first) {
                        this.selectPromptTemplate(first.id);
                    }
                }

                // When entering the Plugins tab, focus the command input by default (better UX).
                if (this.mainTab === 'plugins' && this.promptTemplatesMode === 'compose' && typeof this.$nextTick === 'function') {
                    this.$nextTick(() => {
                        const input = this.$refs && this.$refs.promptComposerCommandInput
                            ? this.$refs.promptComposerCommandInput
                            : null;
                        if (input && typeof input.focus === 'function') input.focus();
                    });
                }
                return true;
            } catch (e) {
                if (!silent) {
                    this.showMessage('Failed to load plugins', 'error');
                }
                return false;
            } finally {
                this.pluginsLoading = false;
            }
        },

        selectPromptTemplate(id) {
            const next = typeof id === 'string' ? id.trim() : '';
            if (!next) return;
            const list = this.promptTemplatesList;
            const entry = list.find((item) => item.id === next);
            if (!entry) return;
            this.promptTemplateSelectedId = next;
            this.promptTemplatesMode = 'manage';
            this.promptTemplateDraftRaw = {
                id: entry.id,
                name: entry.name,
                description: entry.description,
                template: entry.template,
                createdAt: entry.createdAt,
                updatedAt: entry.updatedAt,
                isBuiltin: entry.isBuiltin === true
            };
            this.promptTemplateVarValuesRaw = {};
        },

        createPromptTemplate() {
            const id = createId('prompt');
            const draft = {
                id,
                name: 'New template',
                description: '',
                template: '',
                createdAt: nowIso(),
                updatedAt: nowIso(),
                isBuiltin: false
            };
            this.promptTemplateDraftRaw = draft;
            this.promptTemplateSelectedId = id;
            this.promptTemplateVarValuesRaw = {};
        },

        resetPromptVariableValues() {
            this.promptTemplateVarValuesRaw = {};
        },

        setPromptVariableValue(name, value) {
            const key = typeof name === 'string' ? name.trim() : '';
            if (!key) return;
            const next = { ...(this.promptTemplateVarValuesRaw && typeof this.promptTemplateVarValuesRaw === 'object' ? this.promptTemplateVarValuesRaw : {}) };
            next[key] = value == null ? '' : String(value);
            this.promptTemplateVarValuesRaw = next;
        },

        async copyRenderedPrompt() {
            const text = typeof this.renderedPrompt === 'string' ? this.renderedPrompt.trim() : '';
            if (!text) {
                this.showMessage('Nothing to copy', 'info');
                return;
            }
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                    this.showMessage('Copied', 'success');
                    return;
                }
            } catch (_) {}
            const ok = typeof this.fallbackCopyText === 'function' ? this.fallbackCopyText(text) : false;
            if (ok) {
                this.showMessage('Copied', 'success');
                return;
            }
            this.showMessage('Copy failed', 'error');
        },

        async savePromptTemplate() {
            const draft = normalizePromptTemplateDraft(this.promptTemplateDraftRaw);
            const name = draft.name.trim();
            if (!name) {
                this.showMessage('Template name is required', 'error');
                return false;
            }
            const nextId = draft.id ? draft.id : createId('prompt');
            const list = Array.isArray(this.promptTemplatesListRaw) ? [...this.promptTemplatesListRaw] : [];
            const now = nowIso();
            const entry = {
                ...draft,
                id: nextId,
                name,
                updatedAt: now,
                createdAt: draft.createdAt || now,
                isBuiltin: draft.isBuiltin === true
            };
            const index = list.findIndex((item) => item && item.id === nextId);
            if (index >= 0) {
                list[index] = entry;
            } else {
                list.unshift(entry);
            }
            this.promptTemplatesListRaw = list;
            persistPromptTemplatesToStorage(list, localStorage);
            this.promptTemplateDraftRaw = entry;
            this.promptTemplateSelectedId = nextId;
            this.showMessage('Saved', 'success');
            return true;
        },

        duplicatePromptTemplate() {
            const draft = normalizePromptTemplateDraft(this.promptTemplateDraftRaw);
            if (!draft.id) return;
            const nextId = createId('prompt');
            this.promptTemplateDraftRaw = {
                ...draft,
                id: nextId,
                name: `${draft.name || 'Template'} (copy)`,
                createdAt: nowIso(),
                updatedAt: nowIso(),
                isBuiltin: false
            };
            this.promptTemplateSelectedId = nextId;
            this.promptTemplateVarValuesRaw = {};
        },

        async deletePromptTemplate() {
            const draft = normalizePromptTemplateDraft(this.promptTemplateDraftRaw);
            if (!draft.id) return;
            if (draft.isBuiltin) {
                this.showMessage('Built-in templates cannot be deleted', 'error');
                return;
            }
            const confirmed = await this.requestConfirmDialog({
                title: 'Delete template',
                message: `Delete “${draft.name || draft.id}”? This action cannot be undone.`,
                confirmText: 'Delete',
                cancelText: 'Cancel',
                danger: true
            });
            if (!confirmed) return;

            const list = Array.isArray(this.promptTemplatesListRaw) ? this.promptTemplatesListRaw : [];
            const next = list.filter((item) => !(item && item.id === draft.id));
            this.promptTemplatesListRaw = next;
            persistPromptTemplatesToStorage(next, localStorage);
            this.promptTemplateDraftRaw = null;
            this.promptTemplateSelectedId = '';
            const first = this.promptTemplatesList && this.promptTemplatesList.length ? this.promptTemplatesList[0] : null;
            if (first) this.selectPromptTemplate(first.id);
            this.showMessage('Deleted', 'success');
        },

        exportPromptTemplates() {
            const list = this.promptTemplatesList;
            if (!Array.isArray(list) || !list.length) {
                this.showMessage('Nothing to export', 'info');
                return;
            }
            const payload = JSON.stringify(list.map((item) => ({
                id: item.id,
                name: item.name,
                description: item.description,
                template: item.template,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
                isBuiltin: item.isBuiltin
            })), null, 2);
            if (typeof this.downloadTextFile === 'function') {
                this.downloadTextFile(`prompt-templates-${Date.now()}.json`, payload, 'application/json;charset=utf-8');
                this.showMessage('Exported', 'success');
                return;
            }
            this.showMessage('Export not supported', 'error');
        },

        triggerPromptTemplatesImport() {
            const input = this.$refs && this.$refs.promptTemplatesImportInput
                ? this.$refs.promptTemplatesImportInput
                : null;
            if (!input) {
                this.showMessage('Import is not available', 'error');
                return;
            }
            input.value = '';
            input.click();
        },

        async handlePromptTemplatesImportChange(event) {
            const input = event && event.target ? event.target : null;
            const file = input && input.files && input.files[0] ? input.files[0] : null;
            if (!file) return;
            let text = '';
            try {
                text = await file.text();
            } catch (_) {
                this.showMessage('Failed to read file', 'error');
                return;
            }
            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch (_) {
                this.showMessage('Invalid JSON', 'error');
                return;
            }
            if (!Array.isArray(parsed)) {
                this.showMessage('Expected an array', 'error');
                return;
            }
            const list = Array.isArray(this.promptTemplatesListRaw) ? [...this.promptTemplatesListRaw] : [];
            for (const item of parsed) {
                const draft = normalizePromptTemplateDraft(item);
                if (!draft.name || !draft.template) continue;
                const id = draft.id ? draft.id : createId('prompt');
                const now = nowIso();
                const entry = {
                    ...draft,
                    id,
                    createdAt: draft.createdAt || now,
                    updatedAt: now,
                    isBuiltin: false
                };
                const index = list.findIndex((existing) => existing && existing.id === id);
                if (index >= 0) list[index] = entry;
                else list.unshift(entry);
            }
            this.promptTemplatesListRaw = list;
            persistPromptTemplatesToStorage(list, localStorage);
            this.showMessage('Imported', 'success');
        }
    };
}
