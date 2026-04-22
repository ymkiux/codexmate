const STORAGE_KEY = 'codexmate.plugins.pluginTemplate.v1';

export function readPluginTemplateState(storage = localStorage) {
    if (!storage) return null;
    let raw = '';
    try {
        raw = storage.getItem(STORAGE_KEY) || '';
    } catch (_) {
        raw = '';
    }
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
        return null;
    }
}

export function persistPluginTemplateState(state, storage = localStorage) {
    if (!storage) return false;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(state && typeof state === 'object' ? state : {}));
        return true;
    } catch (_) {
        return false;
    }
}
