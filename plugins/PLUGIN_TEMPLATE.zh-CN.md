## 插件模板（脚手架）

本仓库把真实可用的插件原型放在 `plugins/<plugin-id>/`（例如 `plugins/prompt-templates/`）。

为避免维护第二个“假插件目录”，脚手架以文档形式提供，而不是再放一个可运行的插件文件夹。

### 推荐目录结构

```
plugins/<plugin-id>/
  manifest.mjs
  index.mjs
  methods.mjs
  computed.mjs
  storage.mjs
```

### 约定

- `manifest.mjs` 导出 `pluginMeta`：
  - `id` 必须与 `<plugin-id>` 一致
  - `title` / `description` 用于插件列表展示
- `index.mjs` 作为统一入口（re-export 所有内容）
- 仅在需要兼容旧 import 路径时，才在 `web-ui/modules/` 下保留薄封装
