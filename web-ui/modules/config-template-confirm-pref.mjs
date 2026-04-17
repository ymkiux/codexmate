export const CONFIG_TEMPLATE_DIFF_CONFIRM_STORAGE_KEY = 'codexmateConfigTemplateDiffConfirmEnabled';

export function normalizeConfigTemplateDiffConfirmEnabled(value) {
    if (value === false) return false;
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
        return false;
    }
    return true;
}

export function loadConfigTemplateDiffConfirmEnabledFromStorage(storage = null) {
    const target = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!target || typeof target.getItem !== 'function') {
        return true;
    }
    try {
        return normalizeConfigTemplateDiffConfirmEnabled(target.getItem(CONFIG_TEMPLATE_DIFF_CONFIRM_STORAGE_KEY));
    } catch (_) {
        return true;
    }
}

export function persistConfigTemplateDiffConfirmEnabledToStorage(enabled, storage = null) {
    const target = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!target || typeof target.setItem !== 'function') {
        return;
    }
    try {
        target.setItem(CONFIG_TEMPLATE_DIFF_CONFIRM_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch (_) {}
}

