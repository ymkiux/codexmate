const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function normalizePathForCompare(targetPath, options = {}) {
    const ignoreCase = !!options.ignoreCase;
    let resolved = '';
    try {
        resolved = fs.realpathSync.native ? fs.realpathSync.native(targetPath) : fs.realpathSync(targetPath);
    } catch (e) {
        resolved = path.resolve(targetPath);
    }
    return ignoreCase ? resolved.toLowerCase() : resolved;
}

function isPathInside(targetPath, rootPath) {
    if (!targetPath || !rootPath) {
        return false;
    }
    const ignoreCase = process.platform === 'win32';
    const resolvedTarget = normalizePathForCompare(targetPath, { ignoreCase });
    const resolvedRoot = normalizePathForCompare(rootPath, { ignoreCase });
    if (resolvedTarget === resolvedRoot) {
        return true;
    }
    const separator = resolvedRoot.includes('/') && !resolvedRoot.includes('\\') ? '/' : path.sep;
    const rootWithSlash = resolvedRoot.endsWith(separator) ? resolvedRoot : resolvedRoot + separator;
    return resolvedTarget.startsWith(rootWithSlash);
}

function resolveCopyTargetRoot(targetDir) {
    const base = typeof targetDir === 'string' ? targetDir.trim() : '';
    const pathApi = base.includes('/') && !base.includes('\\') && path.posix ? path.posix : path;
    const suffixSegments = [];
    let current = pathApi.resolve(base || '');
    while (current && !fs.existsSync(current)) {
        const parent = pathApi.dirname(current);
        if (!parent || parent === current) {
            break;
        }
        suffixSegments.unshift(pathApi.basename(current));
        current = parent;
    }
    let resolvedRoot = normalizePathForCompare(current || base);
    if (!resolvedRoot) {
        resolvedRoot = pathApi.resolve(base || '');
    }
    for (const segment of suffixSegments) {
        resolvedRoot = pathApi.join(resolvedRoot, segment);
    }
    return resolvedRoot;
}

function commandExists(command, args = '') {
    const cmd = typeof command === 'string' ? command.trim() : '';
    const argText = typeof args === 'string' ? args.trim() : '';
    if (!cmd || cmd.includes('\0') || /[\r\n]/.test(cmd)) {
        return false;
    }
    const argv = argText ? argText.split(/\s+/g).filter(Boolean) : [];
    const hasSeparators = cmd.includes('/') || cmd.includes('\\');
    const useShell = process.platform === 'win32' && !hasSeparators;
    if (useShell) {
        if (!/^[A-Za-z0-9._-]+$/.test(cmd)) return false;
        if (argText && /[\r\n;&|<>`$]/.test(argText)) return false;
    }
    try {
        const probe = spawnSync(cmd, argv, {
            stdio: 'ignore',
            windowsHide: true,
            timeout: 5000,
            shell: useShell
        });
        return probe.status === 0;
    } catch (_) {
        return false;
    }
}

module.exports = {
    normalizePathForCompare,
    isPathInside,
    resolveCopyTargetRoot,
    commandExists
};
