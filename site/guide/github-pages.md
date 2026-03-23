# GitHub Pages 部署

项目内已提供独立 Pages 工作流：`.github/workflows/pages.yml`。

## 触发方式

- `main` 分支 push（命中 docs 相关路径）
- `main` 分支 PR（仅构建校验，不执行 deploy）
- Actions 手动触发（`workflow_dispatch`）

## 流水线步骤

1. `npm ci`
2. `npm run docs:build`
3. 上传 `site/.vitepress/dist` 产物
4. 非 PR 场景执行 `actions/deploy-pages`

## Base 路径策略

VitePress 通过环境变量控制 base：

- `VITEPRESS_BASE=/${repo-name}/`

这能保证仓库被 fork 后仍能在 GitHub Project Pages 下正常访问。

## 本地预览

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```
