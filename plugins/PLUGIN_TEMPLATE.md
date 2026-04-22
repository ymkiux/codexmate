## Plugin Template (Scaffold)

This repository keeps real plugin prototypes under `plugins/<plugin-id>/` (for example, `plugins/prompt-templates/`).

To avoid maintaining a second “fake plugin” folder, the scaffold lives as a document instead of a runnable plugin.

### Recommended structure

```
plugins/<plugin-id>/
  manifest.mjs
  index.mjs
  methods.mjs
  computed.mjs
  storage.mjs
```

### Conventions

- `manifest.mjs` exports `pluginMeta`:
  - `id` must match `<plugin-id>`
  - `title` / `description` are displayed in the plugin catalog
- `index.mjs` is the single entry (re-export everything)
- Keep “thin wrappers” under `web-ui/modules/` only when you need backward-compatible import paths
