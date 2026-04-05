import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scriptPath = path.join(__dirname, '..', '..', 'cmd', 'reset-main.js');
const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');

// Verify script exists and includes the critical git steps.
test('reset-main script contains required git steps', () => {
    assert.ok(fs.existsSync(scriptPath), 'reset-main.js should exist');
    const content = fs.readFileSync(scriptPath, 'utf-8');
    const required = [
        'git fetch origin main --prune',
        'git checkout main',
        'git reset --hard origin/main',
        'git clean -fd',
        'git status --short --branch'
    ];
    for (const snippet of required) {
        assert.ok(content.includes(snippet), `reset-main.js should include: ${snippet}`);
    }
    assert.ok(!content.includes('git pull origin main'), 'reset-main.js should avoid git pull merges');
});

// Ensure the script is Node-executable via shebang or node command.
test('reset-main script has executable header', () => {
    const firstLine = fs.readFileSync(scriptPath, 'utf-8').split('\n')[0] || '';
    assert.ok(firstLine.startsWith('#!/usr/bin/env node'), 'script should start with node shebang');
});

test('package.json exposes reset command for reset-main workflow', () => {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8').replace(/^\uFEFF/u, ''));
    assert.strictEqual(packageJson.scripts.reset, 'node cmd/reset-main.js');
});
