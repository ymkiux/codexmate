import {
    persistPromptTemplatesToStorage,
    persistPromptTemplateSelectedIdToStorage
} from './storage.mjs';
import {
    getFirstPluginId,
    getPluginEntry
} from '../registry.mjs';

const COMPOSER_VALUES_STORAGE_KEY = 'codexmate.plugins.promptTemplates.composerValues.v1';

function readComposerValuesFromStorage(storage = localStorage) {
    if (!storage) return {};
    let raw = '';
    try {
        raw = storage.getItem(COMPOSER_VALUES_STORAGE_KEY) || '';
    } catch (_) {
        raw = '';
    }
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        return parsed;
    } catch (_) {
        return {};
    }
}

function persistComposerValuesToStorage(map, storage = localStorage) {
    if (!storage) return false;
    try {
        storage.setItem(COMPOSER_VALUES_STORAGE_KEY, JSON.stringify(map && typeof map === 'object' && !Array.isArray(map) ? map : {}));
        return true;
    } catch (_) {
        return false;
    }
}

function readComposerValuesForTemplate(templateId) {
    const id = typeof templateId === 'string' ? templateId.trim() : '';
    if (!id) return {};
    const map = readComposerValuesFromStorage(localStorage);
    const values = map && typeof map === 'object' ? map[id] : null;
    return values && typeof values === 'object' && !Array.isArray(values) ? values : {};
}

function persistComposerValuesForTemplate(templateId, values) {
    const id = typeof templateId === 'string' ? templateId.trim() : '';
    if (!id) return false;
    const map = readComposerValuesFromStorage(localStorage);
    const next = map && typeof map === 'object' && !Array.isArray(map) ? { ...map } : {};
    const payload = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
    next[id] = payload;
    return persistComposerValuesToStorage(next, localStorage);
}

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
        isBuiltin: safe.isBuiltin === true,
        createdBy: typeof safe.createdBy === 'string' ? safe.createdBy : '',
        maintainers: Array.isArray(safe.maintainers) ? safe.maintainers : []
    };
}

export function createPluginsMethods() {
    return {
        resetPromptComposerVarValues() {
            this.promptComposerVarValuesRaw = {};
            persistComposerValuesForTemplate(this.promptComposerSelectedTemplateId, {});
            if (typeof this.$nextTick === 'function') {
                this.$nextTick(() => {
                    const first = this.$refs && this.$refs.promptComposerFirstField
                        ? this.$refs.promptComposerFirstField
                        : null;
                    if (first && typeof first.focus === 'function') first.focus();
                });
            }
        },

        focusPromptComposerFirstMissingVar() {
            const run = () => {
                const input = document.querySelector('#panel-plugins .prompt-var-input.is-missing');
                if (!input || typeof input.focus !== 'function') return;
                try {
                    if (typeof input.scrollIntoView === 'function') {
                        input.scrollIntoView({ block: 'center', inline: 'nearest' });
                    }
                } catch (_) {}
                input.focus();
            };
            if (typeof this.$nextTick === 'function') {
                this.$nextTick(run);
                return;
            }
            run();
        },

        selectPromptComposerTemplate(id) {
            const next = typeof id === 'string' ? id.trim() : '';
            if (!next) return;
            if (next === this.promptComposerSelectedTemplateId) return;
            this.promptComposerSelectedTemplateId = next;
            persistPromptTemplateSelectedIdToStorage(next, localStorage);
            this.promptComposerVarValuesRaw = readComposerValuesForTemplate(next);
            if (typeof this.$nextTick === 'function') {
                this.$nextTick(() => {
                    const first = this.$refs && this.$refs.promptComposerFirstField
                        ? this.$refs.promptComposerFirstField
                        : null;
                    if (first && typeof first.focus === 'function') first.focus();
                });
            }
        },

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
            persistPromptTemplateSelectedIdToStorage(next, localStorage);
            this.promptComposerVarValuesRaw = readComposerValuesForTemplate(next);
            this.promptComposerCommand = '';
            this.promptComposerPickerVisible = false;
            this.promptTemplatesMode = 'compose';
            if (typeof this.$nextTick === 'function') {
                this.$nextTick(() => {
                    const firstVar = this.$refs && this.$refs.promptComposerFirstField
                        ? this.$refs.promptComposerFirstField
                        : null;
                    if (firstVar && typeof firstVar.focus === 'function') firstVar.focus();
                });
            }
        },

        resetPromptComposer() {
            this.promptComposerCommand = '';
            this.promptComposerSelectedTemplateId = '';
            persistPromptTemplateSelectedIdToStorage('', localStorage);
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
            persistComposerValuesForTemplate(this.promptComposerSelectedTemplateId, next);
        },

        async copyPromptComposerRendered() {
            const text = typeof this.promptComposerRendered === 'string' ? this.promptComposerRendered.trim() : '';
            if (!text) {
                this.showMessage(typeof this.t === 'function' ? this.t('toast.copy.empty') : 'Nothing to copy', 'info');
                return;
            }
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                    this.showMessage(typeof this.t === 'function' ? this.t('toast.copy.ok') : 'Copied', 'success');
                    return;
                }
            } catch (_) {}
            const ok = typeof this.fallbackCopyText === 'function' ? this.fallbackCopyText(text) : false;
            if (ok) {
                this.showMessage(typeof this.t === 'function' ? this.t('toast.copy.ok') : 'Copied', 'success');
                return;
            }
            this.showMessage(typeof this.t === 'function' ? this.t('toast.copy.fail') : 'Copy failed', 'error');
        },

        selectPlugin(pluginId) {
            const id = typeof pluginId === 'string' ? pluginId.trim() : '';
            if (!id) return;
            if (!getPluginEntry(id)) return;
            this.pluginsActiveId = id;
        },

        async loadPluginsOverview(options = {}) {
            const silent = !!(options && options.silent);
            const forceRefresh = !!(options && options.forceRefresh);
            if (this.pluginsLoading) return false;

            this.pluginsLoading = true;
            this.pluginsError = '';
            try {
                const fallbackId = getFirstPluginId();
                const currentId = typeof this.pluginsActiveId === 'string' ? this.pluginsActiveId.trim() : '';
                const resolved = getPluginEntry(currentId) ? currentId : fallbackId;
                if (resolved && resolved !== currentId) {
                    this.pluginsActiveId = resolved;
                }

                const entry = getPluginEntry(resolved);
                if (!entry || typeof entry.loadOverview !== 'function') return true;
                return await entry.loadOverview(this, { silent, forceRefresh });
            } catch (e) {
                this.pluginsError = e && e.message ? String(e.message) : 'Failed to load plugins';
                if (!silent) {
                    this.showMessage(typeof this.t === 'function' ? this.t('toast.plugins.loadFail') : 'Failed to load plugins', 'error');
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
                isBuiltin: entry.isBuiltin === true,
                createdBy: entry.createdBy || '',
                maintainers: Array.isArray(entry.maintainers) ? entry.maintainers : []
            };
            this.promptTemplateVarValuesRaw = {};
        },

        createPromptTemplate() {
            const id = createId('prompt');
            const name = typeof this.t === 'function'
                ? this.t('plugins.promptTemplates.manage.newTemplateName')
                : 'New template';
            const draft = {
                id,
                name,
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

        addPromptTemplateVariable() {
            const draft = normalizePromptTemplateDraft(this.promptTemplateDraftRaw);
            if (!draft || !draft.id) return;
            if (draft.isBuiltin) {
                this.showMessage(typeof this.t === 'function' ? this.t('toast.templates.builtinNotEditable') : 'Built-in templates are not editable', 'error');
                return;
            }
            this.promptTemplateVarDraftName = 'var';
            this.promptTemplateVarDraftError = '';
            this.showPromptTemplateVarModal = true;
            if (typeof this.$nextTick === 'function') {
                this.$nextTick(() => {
                    const input = this.$refs && this.$refs.promptTemplateVarNameInput
                        ? this.$refs.promptTemplateVarNameInput
                        : null;
                    if (input && typeof input.focus === 'function') input.focus();
                });
            }
        },

        closePromptTemplateVarModal() {
            this.showPromptTemplateVarModal = false;
            this.promptTemplateVarDraftError = '';
        },

        confirmAddPromptTemplateVariable() {
            const draft = normalizePromptTemplateDraft(this.promptTemplateDraftRaw);
            if (!draft || !draft.id) return;
            if (draft.isBuiltin) {
                this.promptTemplateVarDraftError = typeof this.t === 'function'
                    ? this.t('toast.templates.builtinNotEditable')
                    : 'Built-in templates are not editable';
                return;
            }
            const key = typeof this.promptTemplateVarDraftName === 'string'
                ? this.promptTemplateVarDraftName.trim()
                : '';
            if (!key) {
                this.promptTemplateVarDraftError = typeof this.t === 'function'
                    ? this.t('toast.templates.varNameRequired')
                    : 'Variable name is required';
                return;
            }
            if (!/^[a-zA-Z0-9_.-]+$/.test(key)) {
                this.promptTemplateVarDraftError = typeof this.t === 'function'
                    ? this.t('toast.templates.varNameInvalid')
                    : 'Variable name may only contain letters, numbers, underscore, dash, dot';
                return;
            }
            const placeholder = `{{${key}}}`;
            const current = typeof draft.template === 'string' ? draft.template : '';
            if (current.includes(placeholder)) {
                this.promptTemplateVarDraftError = typeof this.t === 'function'
                    ? this.t('toast.templates.varExists')
                    : 'Variable already exists';
                return;
            }
            const nextText = current && !current.endsWith('\n')
                ? `${current}\n${placeholder}\n`
                : `${current}${placeholder}\n`;
            this.promptTemplateDraftRaw = { ...draft, template: nextText };
            this.showPromptTemplateVarModal = false;
            this.promptTemplateVarDraftError = '';
            this.showMessage(typeof this.t === 'function' ? this.t('toast.templates.varAdded') : 'Variable added', 'success');
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
                this.showMessage(typeof this.t === 'function' ? this.t('toast.copy.empty') : 'Nothing to copy', 'info');
                return;
            }
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                    this.showMessage(typeof this.t === 'function' ? this.t('toast.copy.ok') : 'Copied', 'success');
                    return;
                }
            } catch (_) {}
            const ok = typeof this.fallbackCopyText === 'function' ? this.fallbackCopyText(text) : false;
            if (ok) {
                this.showMessage(typeof this.t === 'function' ? this.t('toast.copy.ok') : 'Copied', 'success');
                return;
            }
            this.showMessage(typeof this.t === 'function' ? this.t('toast.copy.fail') : 'Copy failed', 'error');
        },

        async savePromptTemplate() {
            const draft = normalizePromptTemplateDraft(this.promptTemplateDraftRaw);
            if (draft.isBuiltin) {
                this.showMessage(typeof this.t === 'function' ? this.t('toast.templates.builtinNotModifiable') : 'Built-in templates are read-only. Duplicate first.', 'error');
                return false;
            }
            const name = draft.name.trim();
            if (!name) {
                this.showMessage(typeof this.t === 'function' ? this.t('toast.templates.nameRequired') : 'Template name is required', 'error');
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
            this.showMessage(typeof this.t === 'function' ? this.t('toast.save.ok') : 'Saved', 'success');
            return true;
        },

        duplicatePromptTemplate() {
            const draft = normalizePromptTemplateDraft(this.promptTemplateDraftRaw);
            if (!draft.id) return;
            if (draft.isBuiltin) {
                this.showMessage(typeof this.t === 'function' ? this.t('toast.templates.builtinNotDuplicable') : 'Built-in templates cannot be duplicated', 'error');
                return;
            }
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
                this.showMessage(typeof this.t === 'function' ? this.t('toast.templates.builtinNotDeletable') : 'Built-in templates cannot be deleted', 'error');
                return;
            }
            const t = typeof this.t === 'function' ? this.t : null;
            const confirmed = await this.requestConfirmDialog({
                title: t ? t('toast.templates.deleteTitle') : 'Delete template',
                message: t ? t('toast.templates.deleteMessage', { name: draft.name || draft.id }) : `Delete “${draft.name || draft.id}”? This action cannot be undone.`,
                confirmText: t ? t('toast.templates.deleteConfirm') : 'Delete',
                cancelText: t ? t('toast.templates.deleteCancel') : 'Cancel',
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
            this.showMessage(typeof this.t === 'function' ? this.t('toast.delete.ok') : 'Deleted', 'success');
        },

        exportPromptTemplates() {
            const list = this.promptTemplatesList;
            if (!Array.isArray(list) || !list.length) {
                this.showMessage(typeof this.t === 'function' ? this.t('toast.export.empty') : 'Nothing to export', 'info');
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
                this.showMessage(typeof this.t === 'function' ? this.t('toast.export.ok') : 'Exported', 'success');
                return;
            }
            this.showMessage(typeof this.t === 'function' ? this.t('toast.export.notSupported') : 'Export not supported', 'error');
        },

        triggerPromptTemplatesImport() {
            const input = this.$refs && this.$refs.promptTemplatesImportInput
                ? this.$refs.promptTemplatesImportInput
                : null;
            if (!input) {
                this.showMessage(typeof this.t === 'function' ? this.t('toast.import.notAvailable') : 'Import is not available', 'error');
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
                this.showMessage(typeof this.t === 'function' ? this.t('toast.import.readFileFail') : 'Failed to read file', 'error');
                return;
            }
            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch (_) {
                this.showMessage(typeof this.t === 'function' ? this.t('toast.import.invalidJson') : 'Invalid JSON', 'error');
                return;
            }
            if (!Array.isArray(parsed)) {
                this.showMessage(typeof this.t === 'function' ? this.t('toast.import.expectedArray') : 'Expected an array', 'error');
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
            this.showMessage(typeof this.t === 'function' ? this.t('toast.import.ok') : 'Imported', 'success');
        }
    };
}
