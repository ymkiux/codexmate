## Plugins

This directory hosts reusable plugin prototypes, intended as reference implementations for building additional plugins.

Suggested conventions:
- One plugin per folder: `plugins/<plugin-id>/`
- Split responsibilities inside the plugin folder: `methods.mjs` / `computed.mjs` / `storage.mjs`
- Keep thin Web UI wrappers (re-exports) for compatibility with existing import paths

Example:
- `plugins/prompt-templates/`: Prompt Templates plugin (variable extraction/rendering, storage, UI interaction helpers)

## Creating a new plugin

Recommended layout:
- `plugins/<plugin-id>/manifest.mjs` exports `pluginMeta`
- `plugins/<plugin-id>/methods.mjs` exports method factories
- `plugins/<plugin-id>/computed.mjs` exports computed factories
- `plugins/<plugin-id>/storage.mjs` exports persistence helpers
- `plugins/<plugin-id>/index.mjs` re-exports everything as a single entry
