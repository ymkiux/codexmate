const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
    try {
        execSync(`${command} ${args}`, { stdio: 'ignore', shell: process.platform === 'win32' });
        return true;
    } catch (e) {
        return false;
    }
}

module.exports = {
    normalizePathForCompare,
    isPathInside,
    resolveCopyTargetRoot,
    commandExists
};

