## Plugin Template

This folder is a minimal prototype scaffold to help you build a new plugin in `plugins/<plugin-id>/`.

Suggested structure:
- `manifest.mjs`: `pluginMeta` describing the plugin (id/title/description)
- `methods.mjs`: Vue `methods` factory (export `createPluginMethods`)
- `computed.mjs`: Vue `computed` factory (export `createPluginComputed`)
- `storage.mjs`: local persistence helpers (localStorage / other)
- `index.mjs`: single entry that re-exports everything

How to start:
1. Copy this folder to `plugins/<your-plugin-id>/`
2. Update `manifest.mjs` (`pluginMeta.id` must match the folder/plugin id)
3. Implement your computed/methods/storage
4. Add a thin Web UI wrapper under `web-ui/modules/` if you need legacy import paths
