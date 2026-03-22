# GitHub Pages Deployment

This project deploys docs with a dedicated GitHub Actions workflow.

## Trigger

- Push to `main` (when docs/workflow files change)
- Manual run from Actions (`workflow_dispatch`)

## Build and Deploy

The workflow:

1. Installs dependencies with `npm ci`
2. Builds docs using `npm run docs:build`
3. Uploads `site/.vitepress/dist` as Pages artifact
4. Deploys using `actions/deploy-pages`

## Base Path

The VitePress `base` is controlled by environment variable:

- `VITEPRESS_BASE=/${repo-name}/`

This keeps the site compatible with project pages in forks.
