const STORAGE_KEY = 'codexmate.plugins.promptTemplates.v1';

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
