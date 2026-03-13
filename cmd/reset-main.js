#!/usr/bin/env node
/**
 * Reset working tree to origin/main:
 * - checkout main
 * - hard reset to HEAD
 * - clean untracked files/dirs
 * - pull latest
 *
 * Cross-platform: requires Node.js and git in PATH.
 */

const { execSync } = require('child_process');

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function main() {
  try {
    run('git rev-parse --is-inside-work-tree');
  } catch (err) {
    console.error('Not inside a git repository.');
    process.exit(1);
  }

  console.log('[1/4] Checkout main');
  run('git checkout main');

  console.log('[2/4] Reset local changes');
  run('git reset --hard HEAD');
  run('git clean -fd');

  console.log('[3/4] Fetch & pull origin/main');
  run('git pull origin main');

  console.log('[4/4] Done. Working tree synced to origin/main.');
}

main();
