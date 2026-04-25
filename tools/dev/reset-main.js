#!/usr/bin/env node
/**
 * Reset workflow:
 * - no args => reset working tree to origin/main
 * - PR number arg => fetch PR snapshot and reset local branch to that PR head
 */

const { execSync } = require('child_process');

const DEFAULT_REMOTE = 'origin';
const DEFAULT_MAIN_BRANCH = 'main';
const DEFAULT_PR_BRANCH_PREFIX = 'pr';

function run(cmd, options = {}) {
  const execOptions = {
    stdio: 'inherit',
    ...options
  };
  return execSync(cmd, execOptions);
}

function runCapture(cmd) {
  return String(run(cmd, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8'
  }) || '').trim();
}

function normalizePrNumberInput(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Invalid PR number: ${normalized}`);
  }
  return String(Number.parseInt(normalized, 10));
}

function buildResetPlan({
  prNumber = '',
  remote = DEFAULT_REMOTE,
  mainBranch = DEFAULT_MAIN_BRANCH,
  prBranchPrefix = DEFAULT_PR_BRANCH_PREFIX
} = {}) {
  const normalizedPrNumber = normalizePrNumberInput(prNumber);

  if (!normalizedPrNumber) {
    const targetRef = `${remote}/${mainBranch}`;
    return {
      mode: 'main',
      title: `Reset working tree to ${targetRef}`,
      targetRef,
      expectedBranch: mainBranch,
      expectedRef: targetRef,
      steps: [
        { title: `Fetch ${targetRef}`, command: `git fetch ${remote} ${mainBranch} --prune` },
        { title: 'Discard local changes', command: 'git reset --hard' },
        { title: 'Remove untracked files', command: 'git clean -fd' },
        { title: `Checkout ${mainBranch}`, command: `git checkout ${mainBranch}` },
        { title: `Reset local branch to ${targetRef}`, command: `git reset --hard ${targetRef}` },
        { title: 'Remove untracked files', command: 'git clean -fd' },
        { title: `Validate final state against ${targetRef}`, kind: 'validate' },
        { title: 'Final status', command: 'git status --short --branch' }
      ],
      doneMessage: `Done. Working tree synced to ${targetRef}.`
    };
  }

  const localBranch = `${prBranchPrefix}-${normalizedPrNumber}`;
  const snapshotRef = `refs/remotes/${remote}/${prBranchPrefix}/${normalizedPrNumber}`;
  return {
    mode: 'pr',
    prNumber: normalizedPrNumber,
    title: `Reset working tree to PR #${normalizedPrNumber}`,
    targetRef: `PR #${normalizedPrNumber}`,
    expectedBranch: localBranch,
    expectedRef: snapshotRef,
    snapshotRef,
    steps: [
      { title: `Fetch PR #${normalizedPrNumber} snapshot`, command: `git fetch ${remote} pull/${normalizedPrNumber}/head:${snapshotRef} --force` },
      { title: 'Discard local changes', command: 'git reset --hard' },
      { title: 'Remove untracked files', command: 'git clean -fd' },
      { title: `Checkout ${localBranch}`, command: `git checkout -B ${localBranch} ${snapshotRef}` },
      { title: `Reset local branch to PR #${normalizedPrNumber} snapshot`, command: `git reset --hard ${snapshotRef}` },
      { title: 'Remove untracked files', command: 'git clean -fd' },
      { title: `Validate final state against PR #${normalizedPrNumber}`, kind: 'validate' },
      { title: 'Final status', command: 'git status --short --branch' }
    ],
    doneMessage: `Done. Working tree synced to PR #${normalizedPrNumber} on local branch ${localBranch}.`
  };
}

function validateFinalState(plan) {
  const currentBranch = runCapture('git rev-parse --abbrev-ref HEAD');
  if (currentBranch !== plan.expectedBranch) {
    throw new Error(`Expected current branch ${plan.expectedBranch}, got ${currentBranch || '(unknown)'}.`);
  }

  const currentHead = runCapture('git rev-parse HEAD');
  const expectedHead = runCapture(`git rev-parse ${plan.expectedRef}`);
  if (currentHead !== expectedHead) {
    throw new Error(`Expected HEAD ${expectedHead} from ${plan.expectedRef}, got ${currentHead}.`);
  }

  try {
    run('git diff --quiet HEAD --', { stdio: 'ignore' });
    run('git diff --cached --quiet HEAD --', { stdio: 'ignore' });
  } catch (err) {
    throw new Error('Working tree is not clean after reset.');
  }

  const untracked = runCapture('git ls-files --others --exclude-standard');
  if (untracked) {
    throw new Error(`Untracked files remain after reset:\n${untracked}`);
  }
}

function executeResetPlan(plan) {
  console.log(plan.title);
  const totalSteps = plan.steps.length;
  plan.steps.forEach((step, index) => {
    console.log(`[${index + 1}/${totalSteps}] ${step.title}`);
    if (step.kind === 'validate') {
      validateFinalState(plan);
      return;
    }
    run(step.command);
  });
  console.log(plan.doneMessage);
}

function resolveArgPrNumber(argv = process.argv.slice(2)) {
  const first = Array.isArray(argv) ? argv.find((item) => String(item ?? '').trim()) : '';
  return normalizePrNumberInput(first || '');
}

async function main({ argv = process.argv.slice(2) } = {}) {
  try {
    run('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  } catch (err) {
    console.error('Not inside a git repository.');
    process.exit(1);
  }

  const argPrNumber = resolveArgPrNumber(argv);
  const plan = buildResetPlan({ prNumber: argPrNumber });
  executeResetPlan(plan);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_REMOTE,
  DEFAULT_MAIN_BRANCH,
  DEFAULT_PR_BRANCH_PREFIX,
  normalizePrNumberInput,
  buildResetPlan,
  validateFinalState,
  executeResetPlan,
  resolveArgPrNumber,
  main
};
