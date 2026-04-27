const STORAGE_KEY = 'codexmate.plugins.promptTemplates.v1';
const SELECTED_TEMPLATE_STORAGE_KEY = 'codexmate.plugins.promptTemplates.selectedTemplateId.v1';

export function readPromptTemplatesFromStorage(storage = localStorage) {
    if (!storage) return [];
    let raw = '';
    try {
        raw = storage.getItem(STORAGE_KEY) || '';
    } catch (_) {
        raw = '';
    }
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed;
    } catch (_) {
        return [];
    }
}

export function persistPromptTemplatesToStorage(list, storage = localStorage) {
    if (!storage) return false;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
        return true;
    } catch (_) {
        return false;
    }
}

export function clearPromptTemplatesStorage(storage = localStorage) {
    if (!storage) return;
    try {
        storage.removeItem(STORAGE_KEY);
    } catch (_) {}
}

export function readPromptTemplateSelectedIdFromStorage(storage = localStorage) {
    if (!storage) return '';
    let raw = '';
    try {
        raw = storage.getItem(SELECTED_TEMPLATE_STORAGE_KEY) || '';
    } catch (_) {
        raw = '';
    }
    const id = typeof raw === 'string' ? raw.trim() : '';
    return id;
}

export function persistPromptTemplateSelectedIdToStorage(templateId, storage = localStorage) {
    if (!storage) return false;
    const id = typeof templateId === 'string' ? templateId.trim() : '';
    try {
        if (!id) {
            storage.removeItem(SELECTED_TEMPLATE_STORAGE_KEY);
            return true;
        }
        storage.setItem(SELECTED_TEMPLATE_STORAGE_KEY, id);
        return true;
    } catch (_) {
        return false;
    }
}
