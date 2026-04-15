#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function findRepoRoot() {
    // tools/release/publish-npm.js -> repo root
    return path.resolve(__dirname, '..', '..');
}

function readNpmTokenFromNpmrc(npmrcPath) {
    if (!npmrcPath || !fs.existsSync(npmrcPath)) return '';
    const content = fs.readFileSync(npmrcPath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

        // Supports:
        // - //registry.npmjs.org/:_authToken=XXXX
        // - _authToken=XXXX
        const m = trimmed.match(/(?:^|\/\/registry\.npmjs\.org\/:_authToken=|_authToken=)\s*([^=].*)$/i);
        if (!m) continue;
        const value = (m[1] || '').trim();
        if (value) return value;
    }
    return '';
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: options.env || process.env
    });
    return Number.isFinite(result.status) ? result.status : 1;
}

function main() {
    const registry = 'https://registry.npmjs.org/';
    const otp = process.argv[2] || process.env.NPM_OTP || '';
    const repoRoot = findRepoRoot();
    const localNpmrc = path.join(repoRoot, '.npmrc');

    const token = (process.env.NPM_TOKEN || '').trim() || readNpmTokenFromNpmrc(localNpmrc);
    if (!token) {
        console.error(`NPM_TOKEN 未设置，且未在 ${localNpmrc} 中找到 _authToken。`);
        process.exit(1);
    }

    const tmpNpmrc = path.join(os.tmpdir(), `npmrc-codexmate-publish-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(tmpNpmrc, `//registry.npmjs.org/:_authToken=${token}\n`, 'utf8');

    const env = {
        ...process.env,
        NPM_CONFIG_USERCONFIG: tmpNpmrc,
        NPM_CONFIG_REGISTRY: registry
    };

    let rc = 1;
    try {
        rc = run('npm', ['whoami', '--registry', registry], { env });
        if (rc) return process.exit(rc);

        console.log('[step] npm pack --dry-run');
        rc = run('npm', ['pack', '--dry-run', '--registry', registry], { env });
        if (rc) return process.exit(rc);

        console.log('[step] npm publish');
        const publishArgs = ['publish', '--registry', registry];
        if (otp) publishArgs.push('--otp', otp);
        rc = run('npm', publishArgs, { env });
        return process.exit(rc);
    } finally {
        try { fs.unlinkSync(tmpNpmrc); } catch (_) {}
    }
}

main();

