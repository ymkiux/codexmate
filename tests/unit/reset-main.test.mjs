import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const scriptPath = path.join(__dirname, '..', '..', 'cmd', 'reset-main.js');
const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
const {
    normalizePrNumberInput,
    buildResetPlan,
    resolveArgPrNumber
} = require(path.join(__dirname, '..', '..', 'cmd', 'reset-main.js'));

test('reset-main workflow plans preserve critical git steps without git pull merges', () => {
    assert.ok(fs.existsSync(scriptPath), 'reset-main.js should exist');
    const content = fs.readFileSync(scriptPath, 'utf-8');
    assert.ok(!content.includes('git pull origin main'), 'reset-main.js should avoid git pull merges');

    const mainPlan = buildResetPlan({ prNumber: '' });
    const prPlan = buildResetPlan({ prNumber: '79' });
    const commands = [...mainPlan.steps, ...prPlan.steps]
        .map((step) => step.command)
        .filter(Boolean);

    const required = [
        'git fetch origin main --prune',
        'git checkout main',
        'git reset --hard origin/main',
        'git clean -fd',
        'git status --short --branch',
        'git fetch origin pull/79/head:refs/remotes/origin/pr/79 --force',
        'git checkout -B pr-79 refs/remotes/origin/pr/79'
    ];
    for (const snippet of required) {
        assert.ok(commands.includes(snippet), `reset workflow should include: ${snippet}`);
    }
});

// Ensure the script is Node-executable via shebang or node command.
test('reset-main script has executable header', () => {
    const firstLine = fs.readFileSync(scriptPath, 'utf-8').split('\n')[0] || '';
    assert.ok(firstLine.startsWith('#!/usr/bin/env node'), 'script should start with node shebang');
});

test('normalizePrNumberInput trims blank and numeric values', () => {
    assert.strictEqual(normalizePrNumberInput(''), '');
    assert.strictEqual(normalizePrNumberInput('   '), '');
    assert.strictEqual(normalizePrNumberInput('79'), '79');
    assert.strictEqual(normalizePrNumberInput('0079'), '79');
});

test('normalizePrNumberInput rejects non-numeric values', () => {
    assert.throws(() => normalizePrNumberInput('abc'), /Invalid PR number/);
    assert.throws(() => normalizePrNumberInput('79a'), /Invalid PR number/);
    assert.throws(() => normalizePrNumberInput('-1'), /Invalid PR number/);
});

test('buildResetPlan keeps blank selection on origin/main workflow', () => {
    const plan = buildResetPlan({ prNumber: '' });

    assert.strictEqual(plan.mode, 'main');
    assert.strictEqual(plan.expectedBranch, 'main');
    assert.strictEqual(plan.expectedRef, 'origin/main');
    assert.deepStrictEqual(
        plan.steps.map((step) => step.command || step.kind),
        [
            'git fetch origin main --prune',
            'git reset --hard',
            'git clean -fd',
            'git checkout main',
            'git reset --hard origin/main',
            'git clean -fd',
            'validate',
            'git status --short --branch'
        ]
    );
});

test('buildResetPlan switches to PR snapshot workflow when PR number is provided', () => {
    const plan = buildResetPlan({ prNumber: '79' });

    assert.strictEqual(plan.mode, 'pr');
    assert.strictEqual(plan.prNumber, '79');
    assert.strictEqual(plan.expectedBranch, 'pr-79');
    assert.strictEqual(plan.expectedRef, 'refs/remotes/origin/pr/79');
    assert.deepStrictEqual(
        plan.steps.map((step) => step.command || step.kind),
        [
            'git fetch origin pull/79/head:refs/remotes/origin/pr/79 --force',
            'git reset --hard',
            'git clean -fd',
            'git checkout -B pr-79 refs/remotes/origin/pr/79',
            'git reset --hard refs/remotes/origin/pr/79',
            'git clean -fd',
            'validate',
            'git status --short --branch'
        ]
    );
});

test('resolveArgPrNumber reads the first non-empty CLI arg', () => {
    assert.strictEqual(resolveArgPrNumber([]), '');
    assert.strictEqual(resolveArgPrNumber(['', '  ', '79']), '79');
    assert.strictEqual(resolveArgPrNumber(['0079']), '79');
    assert.throws(() => resolveArgPrNumber(['abc']), /Invalid PR number/);
});

test('package.json exposes reset command for reset-main workflow', () => {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8').replace(/^\uFEFF/u, ''));
    assert.strictEqual(packageJson.scripts.reset, 'node cmd/reset-main.js');
});
