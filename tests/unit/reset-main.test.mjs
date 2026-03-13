import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scriptPath = path.join(__dirname, '..', '..', 'cmd', 'reset-main.js');

// Verify script exists and includes the critical git steps.
test('reset-main script contains required git steps', () => {
    assert.ok(fs.existsSync(scriptPath), 'reset-main.js should exist');
    const content = fs.readFileSync(scriptPath, 'utf-8');
    const required = [
        'git checkout main',
        'git reset --hard HEAD',
        'git clean -fd',
        'git pull origin main'
    ];
    for (const snippet of required) {
        assert.ok(content.includes(snippet), `reset-main.js should include: ${snippet}`);
    }
});

// Ensure the script is Node-executable via shebang or node command.
test('reset-main script has executable header', () => {
    const firstLine = fs.readFileSync(scriptPath, 'utf-8').split('\n')[0] || '';
    assert.ok(firstLine.startsWith('#!/usr/bin/env node'), 'script should start with node shebang');
});
