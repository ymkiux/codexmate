import {
    persistPluginTemplateState,
    readPluginTemplateState
} from './storage.mjs';

export function createPluginMethods() {
    return {
        loadPluginTemplateState() {
            const state = readPluginTemplateState(localStorage);
            this.pluginTemplateStateRaw = state || {};
        },

        updatePluginTemplateState(key, value) {
            const nextKey = typeof key === 'string' ? key.trim() : '';
            if (!nextKey) return;
            const current = this.pluginTemplateStateRaw && typeof this.pluginTemplateStateRaw === 'object'
                ? this.pluginTemplateStateRaw
                : {};
            const next = { ...current, [nextKey]: value };
            this.pluginTemplateStateRaw = next;
            persistPluginTemplateState(next, localStorage);
        }
    };
}
