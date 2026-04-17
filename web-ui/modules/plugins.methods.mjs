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
        description: 'Default template. Replace placeholders and copy the rendered prompt.',
        template: [
            'Use Skill: 御坂',
            '',
            'Goal:',
            '{{goal}}',
            '',
            'Context:',
            '{{context}}',
            '',
            'Requirements:',
            '- {{requirement_1}}',
            '- {{requirement_2}}',
            '',
            'Output format:',
            '{{output}}'
        ].join('\n'),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        isBuiltin: true
    };
}

export function createPluginsMethods() {
    return {
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
                const normalized = Array.isArray(rawList) ? rawList : [];
                if (!normalized.length) {
                    const builtins = [buildBuiltinMisakaTemplate()];
                    this.promptTemplatesListRaw = builtins;
                    persistPromptTemplatesToStorage(builtins, localStorage);
                } else {
                    this.promptTemplatesListRaw = normalized;
                }

                this.promptTemplatesLoadedOnce = true;
                if (!this.pluginsActiveId) {
                    this.pluginsActiveId = 'prompt-templates';
                }

                const currentSelected = typeof this.promptTemplateSelectedId === 'string'
                    ? this.promptTemplateSelectedId
                    : '';
                const first = Array.isArray(this.promptTemplatesList) && this.promptTemplatesList.length
                    ? this.promptTemplatesList[0]
                    : null;
                if (!currentSelected && first) {
                    this.selectPromptTemplate(first.id);
                }
                if (!silent && normalized.length === 0) {
                    this.showMessage('Initialized with a built-in template.', 'success');
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
