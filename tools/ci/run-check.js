#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const step = process.argv[2] || 'all';

const stepArgs = {
    install: ['ci'],
    lint: ['run', 'lint', '--if-present'],
    test: ['run', 'test', '--if-present']
};

const steps = step === 'all' ? ['install', 'lint', 'test'] : [step];

for (const name of steps) {
    const args = stepArgs[name];
    if (!args) {
        console.error(`[codexmate] Unsupported CI step: ${name}`);
        process.exit(1);
    }

    console.log(`[codexmate] CI ${name}: ${npmCmd} ${args.join(' ')}`);
    const result = spawnSync(npmCmd, args, {
        cwd: root,
        stdio: 'inherit',
        env: process.env
    });

    if (result.error) {
        console.error(`[codexmate] CI ${name} failed: ${result.error.message}`);
        process.exit(1);
    }
    if (typeof result.status === 'number' && result.status !== 0) {
        process.exit(result.status);
    }
    if (result.status == null) {
        process.exit(1);
    }
}
