#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const lockfile = path.join(root, 'package-lock.json');
const packageJson = path.join(root, 'package.json');
const nodeModules = path.join(root, 'node_modules');

function stripUtf8Bom(text) {
  return typeof text === 'string' && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function hasRequiredDeps() {
  try {
    const raw = fs.readFileSync(packageJson, 'utf8');
    const pkg = JSON.parse(stripUtf8Bom(raw));
    const deps = Object.keys(pkg.dependencies || {});
    if (!deps.length) return true;
    return deps.every((name) => {
      try {
        require.resolve(name, { paths: [root] });
        return true;
      } catch (_) {
        return false;
      }
    });
  } catch (err) {
    console.error(`[codexmate] Failed to inspect dependencies: ${err.message || err}`);
    process.exit(1);
  }
}

if (hasRequiredDeps()) {
  process.exit(0);
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const installArgs = fs.existsSync(lockfile) ? ['ci'] : ['install'];

console.log(`[codexmate] Missing test dependencies detected under ${nodeModules}. Running \`${npmCmd} ${installArgs.join(' ')}\` before tests...`);
const result = spawnSync(npmCmd, installArgs, {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(`[codexmate] Failed to install dependencies: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status == null ? 1 : result.status);
