## Plugins

This directory hosts reusable plugin prototypes, intended as reference implementations for building additional plugins.

Suggested conventions:
- One plugin per folder: `plugins/<plugin-id>/`
- Split responsibilities inside the plugin folder: `methods.mjs` / `computed.mjs` / `storage.mjs`
- Keep thin Web UI wrappers (re-exports) for compatibility with existing import paths

Example:
- `plugins/prompt-templates/`: Prompt Templates plugin (variable extraction/rendering, storage, UI interaction helpers)
