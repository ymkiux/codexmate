#!/usr/bin/env node
/**
 * Reset working tree to origin/main:
 * - fetch origin/main
 * - checkout main
 * - hard reset to origin/main
 * - clean untracked files/dirs
 * - print final status
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

  console.log('[1/5] Fetch origin/main');
  run('git fetch origin main --prune');

  console.log('[2/5] Checkout main');
  run('git checkout main');

  console.log('[3/5] Reset local changes to origin/main');
  run('git reset --hard origin/main');

  console.log('[4/5] Remove untracked files');
  run('git clean -fd');

  console.log('[5/5] Final status');
  run('git status --short --branch');

  console.log('Done. Working tree synced to origin/main.');
}

main();
