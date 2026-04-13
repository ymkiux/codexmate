#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const nodeCmd = process.execPath;
const sourceExtensions = new Set(['.js', '.mjs', '.cjs']);
const jsonExtensions = new Set(['.json']);
const ignoreDirs = new Set(['.git', 'node_modules', '.tmp']);

function stripUtf8Bom(text) {
    return typeof text === 'string' && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function walk(dirPath, files) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        if (ignoreDirs.has(entry.name)) continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, files);
            continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (sourceExtensions.has(ext) || jsonExtensions.has(ext)) {
            files.push(fullPath);
        }
    }
}

function lintJson(filePath) {
    try {
        JSON.parse(stripUtf8Bom(fs.readFileSync(filePath, 'utf8')));
    } catch (err) {
        throw new Error(`${path.relative(root, filePath)}: invalid JSON (${err.message || err})`);
    }
}

function lintSource(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const sourceText = fs.readFileSync(filePath, 'utf8');
    const normalized = stripUtf8Bom(sourceText);
    const treatsAsModule = ext === '.mjs'
        || (ext === '.js' && /\b(?:import|export)\b|import\.meta/.test(normalized));
    const args = treatsAsModule
        ? ['--input-type=module', '--check']
        : ['--check', filePath];
    const result = spawnSync(nodeCmd, args, {
        cwd: root,
        input: treatsAsModule ? normalized : undefined,
        encoding: 'utf8',
        env: process.env
    });
    if (result.error) {
        throw new Error(`${path.relative(root, filePath)}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const detail = String(result.stderr || result.stdout || '').trim();
        throw new Error(`${path.relative(root, filePath)}: ${detail || 'syntax check failed'}`);
    }
}

function main() {
    const files = [];
    walk(root, files);
    files.sort((a, b) => a.localeCompare(b));

    let checked = 0;
    for (const filePath of files) {
        const ext = path.extname(filePath).toLowerCase();
        if (jsonExtensions.has(ext)) {
            lintJson(filePath);
        } else if (sourceExtensions.has(ext)) {
            lintSource(filePath);
        }
        checked += 1;
    }

    console.log(`[codexmate] Lint passed for ${checked} file(s).`);
}

try {
    main();
} catch (err) {
    console.error(`[codexmate] Lint failed: ${err.message || err}`);
    process.exit(1);
}
