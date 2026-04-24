import { pluginOwnership } from './plugin-ownership.mjs';

const baseMeta = {
    id: 'prompt-templates',
    title: 'Prompt Templates',
    description: 'Standardized, template-driven prompts with variables and copy/export helpers.',
    statusLabel: 'standard',
    tone: 'configured'
};

if (pluginOwnership && pluginOwnership.pluginId && pluginOwnership.pluginId !== baseMeta.id) {
    throw new Error(`ownership.mjs pluginId mismatch: expected ${baseMeta.id}, got ${pluginOwnership.pluginId}`);
}

export const pluginMeta = {
    ...baseMeta,
    createdBy: pluginOwnership && typeof pluginOwnership.createdBy === 'string' ? pluginOwnership.createdBy : '',
    maintainers: pluginOwnership && Array.isArray(pluginOwnership.maintainers) ? pluginOwnership.maintainers : []
};
