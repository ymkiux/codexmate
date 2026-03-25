#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(os.homedir(), '.cache', 'codexmate-docs-build');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function removePath(targetPath) {
  if (!fs.existsSync(targetPath)) return;

  if (typeof fs.rmSync === 'function') {
    fs.rmSync(targetPath, { recursive: true, force: true });
    return;
  }

  const stat = fs.lstatSync(targetPath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(targetPath)) {
      removePath(path.join(targetPath, entry));
    }
    fs.rmdirSync(targetPath);
    return;
  }
  fs.unlinkSync(targetPath);
}

function copyRecursive(sourcePath, targetPath) {
  const stat = fs.lstatSync(sourcePath);

  if (stat.isSymbolicLink()) {
    const linkTarget = fs.readlinkSync(sourcePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    try {
      fs.symlinkSync(linkTarget, targetPath);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw error;
      }
    }
    return;
  }

  if (stat.isDirectory()) {
    fs.mkdirSync(targetPath, { recursive: true });
    for (const entry of fs.readdirSync(sourcePath)) {
      copyRecursive(path.join(sourcePath, entry), path.join(targetPath, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function ensureEsbuildExecutable(targetRoot) {
  const esbuildPkgRoot = path.join(targetRoot, 'node_modules', '@esbuild');
  if (!fs.existsSync(esbuildPkgRoot)) return;

  for (const packageName of fs.readdirSync(esbuildPkgRoot)) {
    const binaryPath = path.join(esbuildPkgRoot, packageName, 'bin', 'esbuild');
    if (!fs.existsSync(binaryPath)) continue;
    try {
      fs.chmodSync(binaryPath, 0o755);
    } catch (_) {
      // Best-effort permission fix for copied noexec binaries.
    }
  }
}

function flushOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function runCommand(cmd, args, cwd, options = {}) {
  const { echo = true } = options;
  const result = spawnSync(cmd, args, {
    cwd,
    env: process.env,
    encoding: 'utf8',
  });

  if (echo) {
    flushOutput(result);
  }
  if (result.error) {
    console.error(result.error.message || result.error);
  }
  return result;
}

function runDocsBuild(cwd, options = {}) {
  const vitepressCli = path.join(cwd, 'node_modules', 'vitepress', 'dist', 'node', 'cli.js');
  return runCommand(process.execPath, [vitepressCli, 'build', 'site'], cwd, options);
}

function ensureVitepress(cwd) {
  const vitepressCli = path.join(cwd, 'node_modules', 'vitepress', 'dist', 'node', 'cli.js');
  if (fs.existsSync(vitepressCli)) return true;

  const installResult = runCommand(npmCmd, ['install', '--include=dev'], cwd);
  if (installResult.status !== 0) {
    process.exit(installResult.status == null ? 1 : installResult.status);
  }
  return fs.existsSync(vitepressCli);
}

function isNoexecFailure(result) {
  const errorDetails = result.error
    ? [result.error.message || String(result.error), result.error.stack || ''].join('\n')
    : '';
  const payload = `${result.stdout || ''}\n${result.stderr || ''}\n${errorDetails}`;
  return /EACCES|ERR_DLOPEN_FAILED|not accessible for the namespace|@rollup\/rollup-|node_modules\/esbuild/i.test(
    payload,
  );
}

function copyInputWorkspace(targetRoot) {
  removePath(targetRoot);
  fs.mkdirSync(targetRoot, { recursive: true });

  for (const fileName of ['package.json', 'package-lock.json', '.npmrc']) {
    const source = path.join(root, fileName);
    if (!fs.existsSync(source)) continue;
    fs.copyFileSync(source, path.join(targetRoot, fileName));
  }

  copyRecursive(path.join(root, 'site'), path.join(targetRoot, 'site'));

  const rootNodeModules = path.join(root, 'node_modules');
  if (fs.existsSync(rootNodeModules)) {
    copyRecursive(rootNodeModules, path.join(targetRoot, 'node_modules'));
    ensureEsbuildExecutable(targetRoot);
  }
}

function copyDistBack(sourceRoot) {
  const sourceDist = path.join(sourceRoot, 'site', '.vitepress', 'dist');
  if (!fs.existsSync(sourceDist)) {
    throw new Error(`[codexmate] Build succeeded but dist not found at: ${sourceDist}`);
  }

  const targetDist = path.join(root, 'site', '.vitepress', 'dist');
  removePath(targetDist);
  fs.mkdirSync(path.dirname(targetDist), { recursive: true });
  copyRecursive(sourceDist, targetDist);
}

if (!ensureVitepress(root)) {
  console.error('[codexmate] vitepress is unavailable after dependency installation.');
  process.exit(1);
}

const directBuild = runDocsBuild(root, { echo: false });
if (directBuild.status === 0) {
  const directDist = path.join(root, 'site', '.vitepress', 'dist');
  if (!fs.existsSync(directDist)) {
    flushOutput(directBuild);
    console.error(`[codexmate] Build succeeded but dist not found at: ${directDist}`);
    process.exit(1);
  }
  flushOutput(directBuild);
  process.exit(0);
}

if (!isNoexecFailure(directBuild)) {
  flushOutput(directBuild);
  process.exit(directBuild.status == null ? 1 : directBuild.status);
}

console.log('[codexmate] Detected noexec native-module failure, retrying in temp workspace...');
flushOutput(directBuild);

copyInputWorkspace(tempRoot);

if (!ensureVitepress(tempRoot)) {
  console.error('[codexmate] vitepress is unavailable in temp workspace.');
  process.exit(1);
}

const tempBuild = runDocsBuild(tempRoot);
if (tempBuild.status !== 0) {
  process.exit(tempBuild.status == null ? 1 : tempBuild.status);
}

copyDistBack(tempRoot);
console.log(`[codexmate] Docs build succeeded via temp workspace: ${tempRoot}`);
