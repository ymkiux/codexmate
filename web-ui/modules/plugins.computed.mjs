function normalizePromptTemplateEntry(item) {
    const safe = item && typeof item === 'object' ? item : {};
    const id = typeof safe.id === 'string' ? safe.id.trim() : '';
    const name = typeof safe.name === 'string' ? safe.name.trim() : '';
    const description = typeof safe.description === 'string' ? safe.description.trim() : '';
    const template = typeof safe.template === 'string' ? safe.template : '';
    const updatedAt = typeof safe.updatedAt === 'string' ? safe.updatedAt : '';
    const createdAt = typeof safe.createdAt === 'string' ? safe.createdAt : updatedAt;
    const isBuiltin = safe.isBuiltin === true;
    return {
        id,
        name,
        description,
        template,
        createdAt,
        updatedAt,
        isBuiltin
    };
}

function parseTemplateVariables(templateText) {
    const text = typeof templateText === 'string' ? templateText : '';
    const vars = new Set();
    const re = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
    for (;;) {
        const match = re.exec(text);
        if (!match) break;
        const name = String(match[1] || '').trim();
        if (name) vars.add(name);
    }
    return Array.from(vars).sort((a, b) => a.localeCompare(b, 'en-US'));
}

function formatIsoDateLabel(iso) {
    if (!iso) return '';
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    const date = new Date(ms);
    const y = String(date.getFullYear());
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function renderTemplate(templateText, values = {}) {
    const text = typeof templateText === 'string' ? templateText : '';
    const map = values && typeof values === 'object' ? values : {};
    return text.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_whole, key) => {
        const name = String(key || '').trim();
        if (!name) return '';
        const value = map[name];
        return value == null ? '' : String(value);
    });
}

export function createPluginsComputed() {
    return {
        pluginsCatalog() {
            return [
                {
                    id: 'prompt-templates',
                    title: 'Prompt Templates',
                    description: 'Standardized, template-driven prompts with variables and copy/export helpers.',
                    statusLabel: 'standard',
                    tone: 'configured'
                }
            ];
        },

        promptTemplatesList() {
            const list = Array.isArray(this.promptTemplatesListRaw) ? this.promptTemplatesListRaw : [];
            return list
                .map((item) => normalizePromptTemplateEntry(item))
                .filter((item) => item.id && item.name)
                .map((item) => {
                    const vars = parseTemplateVariables(item.template);
                    const updatedLabel = formatIsoDateLabel(item.updatedAt || item.createdAt);
                    return {
                        ...item,
                        vars,
                        varCount: vars.length,
                        updatedLabel: updatedLabel || '—'
                    };
                })
                .sort((a, b) => {
                    const aTime = Date.parse(a.updatedAt || a.createdAt || '') || 0;
                    const bTime = Date.parse(b.updatedAt || b.createdAt || '') || 0;
                    if (bTime !== aTime) return bTime - aTime;
                    return a.name.localeCompare(b.name, 'en-US');
                });
        },

        filteredPromptTemplates() {
            const keyword = typeof this.promptTemplatesKeyword === 'string'
                ? this.promptTemplatesKeyword.trim().toLowerCase()
                : '';
            const list = this.promptTemplatesList;
            if (!keyword) return list;
            return list.filter((item) => {
                return (
                    item.name.toLowerCase().includes(keyword)
                    || (item.description && item.description.toLowerCase().includes(keyword))
                    || item.vars.some((v) => v.toLowerCase().includes(keyword))
                );
            });
        },

        promptTemplateDraft() {
            const draft = this.promptTemplateDraftRaw;
            if (!draft || typeof draft !== 'object') return null;
            const id = typeof draft.id === 'string' ? draft.id : '';
            const name = typeof draft.name === 'string' ? draft.name : '';
            if (!id && !name) return null;
            return normalizePromptTemplateEntry(draft);
        },

        promptTemplateVars() {
            const draft = this.promptTemplateDraft;
            if (!draft) return [];
            return parseTemplateVariables(draft.template);
        },

        promptTemplateVarValues() {
            const values = this.promptTemplateVarValuesRaw;
            return values && typeof values === 'object' ? values : {};
        },

        renderedPrompt() {
            const draft = this.promptTemplateDraft;
            if (!draft) return '';
            return renderTemplate(draft.template, this.promptTemplateVarValues);
        }
    };
}

