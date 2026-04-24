import { pluginOwnership } from './ownership.mjs';

export const pluginMeta = {
    id: 'prompt-templates',
    title: 'Prompt Templates',
    description: 'Standardized, template-driven prompts with variables and copy/export helpers.',
    statusLabel: 'standard',
    tone: 'configured',
    ...pluginOwnership
};
