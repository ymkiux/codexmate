import { promptTemplatesPluginMeta as promptTemplatesMeta } from './prompt-templates/manifest.mjs';
import { loadPromptTemplatesOverview } from './prompt-templates/overview.mjs';

export const pluginsRegistry = [
    { id: promptTemplatesMeta.id, meta: promptTemplatesMeta, loadOverview: loadPromptTemplatesOverview }
];

export function getFirstPluginId() {
    return pluginsRegistry.length ? pluginsRegistry[0].id : '';
}

export function getPluginEntry(id) {
    const key = typeof id === 'string' ? id.trim() : '';
    if (!key) return null;
    return pluginsRegistry.find((item) => item && item.id === key) || null;
}
