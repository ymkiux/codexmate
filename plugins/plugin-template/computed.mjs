export function createPluginComputed() {
    return {
        pluginTemplateSummary() {
            const state = this.pluginTemplateStateRaw && typeof this.pluginTemplateStateRaw === 'object'
                ? this.pluginTemplateStateRaw
                : null;
            if (!state) return '—';
            const keys = Object.keys(state);
            if (!keys.length) return '—';
            return keys.slice(0, 3).join(', ');
        }
    };
}
