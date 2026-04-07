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

  console.log('[1/6] Fetch origin/main');
  run('git fetch origin main --prune');

  console.log('[2/6] Discard local changes');
  run('git reset --hard');
  run('git clean -fd');

  console.log('[3/6] Checkout main');
  run('git checkout main');

  console.log('[4/6] Reset local changes to origin/main');
  run('git reset --hard origin/main');

  console.log('[5/6] Remove untracked files');
  run('git clean -fd');

  console.log('[6/6] Final status');
  run('git status --short --branch');

  console.log('Done. Working tree synced to origin/main.');
}

main();
