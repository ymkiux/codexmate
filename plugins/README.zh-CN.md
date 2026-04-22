## Plugins

该目录用于放置可复用的插件原型实现，便于参考与二次开发。

建议约定：
- 每个插件一个子目录：`plugins/<plugin-id>/`
- 插件目录内按职责拆分：`methods.mjs` / `computed.mjs` / `storage.mjs`
- Web UI 侧保留薄封装（re-export）以兼容原有引用路径

示例：
- `plugins/prompt-templates/`：Prompt Templates 插件（变量解析、渲染、存储、UI 交互方法）

## 如何新建插件

可以从模板文档开始：
- `plugins/PLUGIN_TEMPLATE.zh-CN.md`

推荐目录结构：
- `plugins/<plugin-id>/manifest.mjs` 导出 `pluginMeta`
- `plugins/<plugin-id>/methods.mjs` 导出 `createPluginMethods`
- `plugins/<plugin-id>/computed.mjs` 导出 `createPluginComputed`
- `plugins/<plugin-id>/storage.mjs` 导出存储相关 helper
- `plugins/<plugin-id>/index.mjs` 统一入口 re-export
