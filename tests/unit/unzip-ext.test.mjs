import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const zipLib = require('zip-lib');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.join(__dirname, '..', '..', 'cli.js');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath, content) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf-8');
}

function listTimestampDirs(parentDir) {
    if (!fs.existsSync(parentDir)) return [];
    const entries = fs.readdirSync(parentDir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory() && /^\d{14}$/.test(entry.name))
        .map((entry) => entry.name)
        .sort();
}

function runCli(args, cwd) {
    return spawnSync(process.execPath, [cliPath, ...args], {
        cwd,
        encoding: 'utf-8'
    });
}

test('unzip-ext extracts default json suffix recursively into timestamp dir', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-unzip-ext-default-'));
    try {
        const zipRoot = path.join(tempRoot, 'zips');
        const nestedZipDir = path.join(zipRoot, 'nested');
        const workspaceDir = path.join(tempRoot, 'workspace');
        const currentDir = path.join(workspaceDir, 'current');
        ensureDir(nestedZipDir);
        ensureDir(currentDir);

        const zip1Src = path.join(tempRoot, 'zip-src-1');
        writeText(path.join(zip1Src, 'same.json'), '{"src":"one"}\n');
        writeText(path.join(zip1Src, 'note.txt'), 'not-json\n');
        writeText(path.join(zip1Src, 'inner', 'case.JSON'), '{"src":"upper"}\n');

        const zip2Src = path.join(tempRoot, 'zip-src-2');
        writeText(path.join(zip2Src, 'same.json'), '{"src":"two"}\n');
        writeText(path.join(zip2Src, 'skip.md'), 'ignored\n');

        const zip1Path = path.join(zipRoot, 'a.zip');
        const zip2Path = path.join(nestedZipDir, 'b.zip');
        await zipLib.archiveFolder(zip1Src, zip1Path);
        await zipLib.archiveFolder(zip2Src, zip2Path);

        const beforeDirs = listTimestampDirs(workspaceDir);
        const result = runCli(['unzip-ext', zipRoot], currentDir);
        assert.strictEqual(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

        const afterDirs = listTimestampDirs(workspaceDir);
        const added = afterDirs.filter((name) => !beforeDirs.includes(name));
        assert.strictEqual(added.length, 1, 'should create one timestamp output directory under parent of cwd');
        const outputDir = path.join(workspaceDir, added[0]);

        const extractedFiles = fs.readdirSync(outputDir).sort();
        const jsonFiles = extractedFiles.filter((fileName) => fileName.toLowerCase().endsWith('.json'));
        assert.strictEqual(jsonFiles.length, 3, 'should extract all json entries from all zip files');
        assert.ok(!extractedFiles.some((fileName) => fileName.toLowerCase().endsWith('.txt')), 'txt should not be extracted by default');

        const jsonContents = jsonFiles
            .map((fileName) => fs.readFileSync(path.join(outputDir, fileName), 'utf-8').trim())
            .sort();
        assert.ok(jsonContents.includes('{"src":"one"}'), 'first same.json should exist');
        assert.ok(jsonContents.includes('{"src":"two"}'), 'duplicate same.json should be preserved with renamed file');
        assert.ok(jsonContents.includes('{"src":"upper"}'), 'uppercase .JSON suffix should be matched');

        const duplicateCandidates = jsonFiles.filter((fileName) => fileName.startsWith('same'));
        assert.ok(duplicateCandidates.length >= 2, 'duplicate same.json files should both be present');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('unzip-ext honors custom multi suffix and explicit output directory', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-unzip-ext-custom-'));
    try {
        const zipRoot = path.join(tempRoot, 'archives');
        const srcDir = path.join(tempRoot, 'zip-src');
        const outputDir = path.join(tempRoot, 'picked');
        ensureDir(zipRoot);
        writeText(path.join(srcDir, 'data.json'), '{"v":1}\n');
        writeText(path.join(srcDir, 'notes.txt'), 'hello\n');
        writeText(path.join(srcDir, 'ignore.md'), 'skip\n');

        const zipPath = path.join(zipRoot, 'sample.zip');
        await zipLib.archiveFolder(srcDir, zipPath);

        const result = runCli(['unzip-ext', zipRoot, outputDir, '--ext:txt,json'], tempRoot);
        assert.strictEqual(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

        const outputFiles = fs.readdirSync(outputDir).sort();
        assert.deepStrictEqual(outputFiles, ['data.json', 'notes.txt'], 'custom txt,json suffix should extract both types');
        assert.strictEqual(fs.readFileSync(path.join(outputDir, 'notes.txt'), 'utf-8').trim(), 'hello');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('unzip-ext supports --no-recursive to skip nested zip files', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-unzip-ext-norec-'));
    try {
        const zipRoot = path.join(tempRoot, 'zip-root');
        const nestedDir = path.join(zipRoot, 'nested');
        const outputDir = path.join(tempRoot, 'out');
        const topSrc = path.join(tempRoot, 'top-src');
        const nestedSrc = path.join(tempRoot, 'nested-src');
        ensureDir(nestedDir);

        writeText(path.join(topSrc, 'top.json'), '{"k":"top"}\n');
        writeText(path.join(nestedSrc, 'nested.json'), '{"k":"nested"}\n');

        await zipLib.archiveFolder(topSrc, path.join(zipRoot, 'top.zip'));
        await zipLib.archiveFolder(nestedSrc, path.join(nestedDir, 'nested.zip'));

        const result = runCli(['unzip-ext', zipRoot, outputDir, '--no-recursive'], tempRoot);
        assert.strictEqual(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

        const outputFiles = fs.readdirSync(outputDir).sort();
        assert.deepStrictEqual(outputFiles, ['top.json'], 'non-recursive mode should only process top-level zip files');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('unzip-ext merges repeated --ext flags', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-unzip-ext-repeat-'));
    try {
        const zipRoot = path.join(tempRoot, 'zip-root');
        const outputDir = path.join(tempRoot, 'out');
        const srcDir = path.join(tempRoot, 'src');
        ensureDir(zipRoot);

        writeText(path.join(srcDir, 'a.json'), '{"a":1}\n');
        writeText(path.join(srcDir, 'b.txt'), 'b\n');
        writeText(path.join(srcDir, 'c.log'), 'c\n');
        await zipLib.archiveFolder(srcDir, path.join(zipRoot, 'mix.zip'));

        const result = runCli(['unzip-ext', zipRoot, outputDir, '--ext', 'json', '--ext=txt'], tempRoot);
        assert.strictEqual(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

        const outputFiles = fs.readdirSync(outputDir).sort();
        assert.deepStrictEqual(outputFiles, ['a.json', 'b.txt'], 'repeated --ext flags should merge suffix filters');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
