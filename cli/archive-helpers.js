function createArchiveHelperController(deps = {}) {
    const {
        fs,
        path,
        os,
        execSync,
        zipLib,
        yauzl,
        ensureDir,
        isPathInside,
        commandExists,
        MAX_UPLOAD_SIZE,
        MAX_SKILLS_ZIP_UPLOAD_SIZE,
        MAX_SKILLS_ZIP_ENTRY_COUNT,
        MAX_SKILLS_ZIP_UNCOMPRESSED_BYTES
    } = deps;

    if (!fs) throw new Error('createArchiveHelperController 缺少 fs');
    if (!path) throw new Error('createArchiveHelperController 缺少 path');
    if (!os) throw new Error('createArchiveHelperController 缺少 os');
    if (typeof execSync !== 'function') throw new Error('createArchiveHelperController 缺少 execSync');
    if (!zipLib) throw new Error('createArchiveHelperController 缺少 zipLib');
    if (!yauzl) throw new Error('createArchiveHelperController 缺少 yauzl');
    if (typeof ensureDir !== 'function') throw new Error('createArchiveHelperController 缺少 ensureDir');
    if (typeof isPathInside !== 'function') throw new Error('createArchiveHelperController 缺少 isPathInside');
    if (typeof commandExists !== 'function') throw new Error('createArchiveHelperController 缺少 commandExists');

    const ZIP_PATHS = ['zip'];

    function findZipExecutable() {
        for (const candidate of ZIP_PATHS) {
            try {
                if (candidate === 'zip') {
                    if (commandExists('zip', '--help')) {
                        return 'zip';
                    }
                } else if (fs.existsSync(candidate)) {
                    return candidate;
                }
            } catch (_) {}
        }
        return null;
    }

    function resolveZipTool() {
        const zipExe = findZipExecutable();
        if (zipExe) {
            return { type: 'zip', cmd: zipExe };
        }
        return { type: 'lib', cmd: 'zip-lib' };
    }

    function resolveUnzipTool() {
        return { type: 'lib', cmd: 'zip-lib' };
    }

    async function zipWithLibrary(absPath, outputPath) {
        const stat = fs.lstatSync(absPath);
        if (stat.isDirectory()) {
            await zipLib.archiveFolder(absPath, outputPath);
            return;
        }
        await zipLib.archiveFile(absPath, outputPath);
    }

    async function unzipWithLibrary(zipPath, outputDir) {
        await zipLib.extract(zipPath, outputDir);
    }

    function copyDirRecursive(srcDir, destDir, options = {}) {
        const dereferenceSymlinks = !!(options && options.dereferenceSymlinks);
        const allowedRootRealPath = (options && typeof options.allowedRootRealPath === 'string')
            ? options.allowedRootRealPath
            : '';
        const visitedRealPaths = options && options.visitedRealPaths instanceof Set
            ? options.visitedRealPaths
            : new Set();
        const childOptions = {
            ...options,
            dereferenceSymlinks,
            allowedRootRealPath,
            visitedRealPaths
        };
        ensureDir(destDir);
        const entries = fs.readdirSync(srcDir, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(srcDir, entry.name);
            const destPath = path.join(destDir, entry.name);
            if (entry.isDirectory()) {
                if (!dereferenceSymlinks) {
                    copyDirRecursive(srcPath, destPath, childOptions);
                    continue;
                }
                const realPath = fs.realpathSync(srcPath);
                if (allowedRootRealPath && !isPathInside(realPath, allowedRootRealPath)) {
                    throw new Error(`symlink escapes skill root: ${srcPath}`);
                }
                if (visitedRealPaths.has(realPath)) {
                    continue;
                }
                visitedRealPaths.add(realPath);
                try {
                    copyDirRecursive(srcPath, destPath, childOptions);
                } finally {
                    visitedRealPaths.delete(realPath);
                }
            } else if (entry.isSymbolicLink()) {
                if (dereferenceSymlinks) {
                    const realPath = fs.realpathSync(srcPath);
                    if (allowedRootRealPath && !isPathInside(realPath, allowedRootRealPath)) {
                        throw new Error(`symlink escapes skill root: ${srcPath}`);
                    }
                    const realStat = fs.statSync(realPath);
                    if (realStat.isDirectory()) {
                        if (visitedRealPaths.has(realPath)) {
                            continue;
                        }
                        visitedRealPaths.add(realPath);
                        try {
                            copyDirRecursive(realPath, destPath, childOptions);
                        } finally {
                            visitedRealPaths.delete(realPath);
                        }
                    } else {
                        fs.copyFileSync(realPath, destPath);
                    }
                } else {
                    const target = fs.readlinkSync(srcPath);
                    fs.symlinkSync(target, destPath);
                }
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    function inspectZipArchiveLimits(zipPath, options = {}) {
        const maxEntryCount = Number.isFinite(options.maxEntryCount) && options.maxEntryCount > 0
            ? Math.floor(options.maxEntryCount)
            : MAX_SKILLS_ZIP_ENTRY_COUNT;
        const maxUncompressedBytes = Number.isFinite(options.maxUncompressedBytes) && options.maxUncompressedBytes > 0
            ? Math.floor(options.maxUncompressedBytes)
            : MAX_SKILLS_ZIP_UNCOMPRESSED_BYTES;

        return new Promise((resolve, reject) => {
            yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (openErr, zipFile) => {
                if (openErr) {
                    reject(openErr);
                    return;
                }
                if (!zipFile) {
                    reject(new Error('无法读取 ZIP 文件'));
                    return;
                }
                let entryCount = 0;
                let totalUncompressedBytes = 0;
                let settled = false;
                const finish = (err, data) => {
                    if (settled) return;
                    settled = true;
                    try {
                        zipFile.close();
                    } catch (_) {}
                    if (err) {
                        reject(err);
                    } else {
                        resolve(data);
                    }
                };

                zipFile.on('entry', (entry) => {
                    if (settled) return;
                    entryCount += 1;
                    const entrySize = Number.isFinite(entry.uncompressedSize) ? entry.uncompressedSize : 0;
                    totalUncompressedBytes += entrySize;
                    if (entryCount > maxEntryCount) {
                        finish(new Error(`压缩包条目过多（>${maxEntryCount}）`));
                        return;
                    }
                    if (totalUncompressedBytes > maxUncompressedBytes) {
                        finish(new Error(`压缩包解压总大小超限（>${Math.floor(maxUncompressedBytes / 1024 / 1024)}MB）`));
                        return;
                    }
                    zipFile.readEntry();
                });

                zipFile.on('end', () => {
                    finish(null, { entryCount, totalUncompressedBytes });
                });

                zipFile.on('error', (zipErr) => {
                    finish(zipErr);
                });

                zipFile.readEntry();
            });
        });
    }

    function writeUploadZipStream(req, prefix, originalName = '', maxSize = MAX_SKILLS_ZIP_UPLOAD_SIZE) {
        return new Promise((resolve, reject) => {
            const lengthHeader = parseInt(req.headers['content-length'] || '0', 10);
            if (Number.isFinite(lengthHeader) && lengthHeader > maxSize) {
                reject(new Error(`备份文件过大（>${Math.floor(maxSize / 1024 / 1024)}MB）`));
                return;
            }

            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
            const rawName = originalName && typeof originalName === 'string' ? originalName : `${prefix}.zip`;
            const fileName = path.basename(rawName);
            const zipPath = path.join(tempDir, fileName.toLowerCase().endsWith('.zip') ? fileName : `${fileName}.zip`);
            const stream = fs.createWriteStream(zipPath);
            let bytesWritten = 0;
            let settled = false;
            let hasContent = false;

            const fail = (err) => {
                if (settled) return;
                settled = true;
                try {
                    stream.destroy();
                } catch (_) {}
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch (_) {}
                reject(err);
            };

            const done = () => {
                if (settled) return;
                settled = true;
                if (!hasContent || bytesWritten <= 0) {
                    try {
                        fs.rmSync(tempDir, { recursive: true, force: true });
                    } catch (_) {}
                    reject(new Error('备份文件为空'));
                    return;
                }
                resolve({ tempDir, zipPath });
            };

            req.on('error', (err) => fail(err));
            req.on('aborted', () => fail(new Error('上传已中断')));
            req.on('close', () => {
                if (!settled && !req.complete) {
                    fail(new Error('上传已中断'));
                }
            });
            stream.on('error', (err) => fail(err));
            req.on('data', (chunk) => {
                if (settled) return;
                hasContent = true;
                bytesWritten += chunk.length;
                if (bytesWritten > maxSize) {
                    fail(new Error(`备份文件过大（>${Math.floor(maxSize / 1024 / 1024)}MB）`));
                    try {
                        req.destroy();
                    } catch (_) {}
                    return;
                }
                stream.write(chunk);
            });
            req.on('end', () => {
                if (settled) return;
                stream.end(() => done());
            });
        });
    }

    function writeUploadZip(base64, prefix, originalName = '') {
        let buffer;
        try {
            buffer = Buffer.from(base64 || '', 'base64');
        } catch (_) {
            return { error: '备份文件内容不是有效的 base64 编码' };
        }

        if (!buffer || buffer.length === 0) {
            return { error: '备份文件为空' };
        }

        if (buffer.length > MAX_UPLOAD_SIZE) {
            return { error: `备份文件过大（>${Math.floor(MAX_UPLOAD_SIZE / 1024 / 1024)}MB）` };
        }

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
        const fileName = path.basename(originalName && typeof originalName === 'string' ? originalName : `${prefix}.zip`);
        const zipPath = path.join(tempDir, fileName.toLowerCase().endsWith('.zip') ? fileName : `${fileName}.zip`);
        fs.writeFileSync(zipPath, buffer);
        return { tempDir, zipPath };
    }

    async function extractUploadZip(zipPath, extractDir) {
        resolveUnzipTool();
        ensureDir(extractDir);
        await unzipWithLibrary(zipPath, extractDir);
    }

    function findConfigSourceDir(extractedDir, markerDirName, requiredFileName) {
        const markerPath = path.join(extractedDir, markerDirName);
        if (fs.existsSync(markerPath) && fs.statSync(markerPath).isDirectory()) {
            return markerPath;
        }

        const entries = fs.readdirSync(extractedDir, { withFileTypes: true }).filter((item) => item.isDirectory());
        if (entries.length === 1) {
            const onlyDir = path.join(extractedDir, entries[0].name);
            const nestedMarker = path.join(onlyDir, markerDirName);
            if (fs.existsSync(nestedMarker) && fs.statSync(nestedMarker).isDirectory()) {
                return nestedMarker;
            }
            if (fs.existsSync(path.join(onlyDir, requiredFileName))) {
                return onlyDir;
            }
        }

        if (fs.existsSync(path.join(extractedDir, requiredFileName))) {
            return extractedDir;
        }

        return extractedDir;
    }

    async function prepareDirectoryDownload(dirPath, options = {}) {
        const missingMessage = typeof options.missingMessage === 'string' && options.missingMessage.trim()
            ? options.missingMessage.trim()
            : '目录不存在';
        const fileNamePrefix = typeof options.fileNamePrefix === 'string' && options.fileNamePrefix.trim()
            ? options.fileNamePrefix.trim()
            : 'archive';

        try {
            if (!fs.existsSync(dirPath)) {
                return { error: missingMessage, path: dirPath };
            }

            const tempDir = os.tmpdir();
            const timestamp = Date.now();
            const zipFileName = `${fileNamePrefix}-${timestamp}.zip`;
            const zipFilePath = path.join(tempDir, zipFileName);

            const zipTool = resolveZipTool();
            if (zipTool.type === 'zip') {
                const cmd = `"${zipTool.cmd}" -0 -q -r "${zipFilePath}" "${dirPath}"`;
                execSync(cmd, { stdio: 'ignore' });
            } else {
                await zipWithLibrary(dirPath, zipFilePath);
            }

            return {
                success: true,
                downloadPath: zipFilePath,
                fileName: zipFileName,
                sourcePath: dirPath
            };
        } catch (e) {
            return { error: `打包失败：${e.message}` };
        }
    }

    async function backupDirectoryIfExists(dirPath, prefix) {
        if (!fs.existsSync(dirPath)) {
            return { backupPath: '' };
        }

        const tempDir = os.tmpdir();
        const timestamp = Date.now();
        const zipFileName = `${prefix}-${timestamp}.zip`;
        const zipFilePath = path.join(tempDir, zipFileName);
        const zipTool = resolveZipTool();

        try {
            if (zipTool.type === 'zip') {
                const cmd = `"${zipTool.cmd}" -0 -q -r "${zipFilePath}" "${dirPath}"`;
                execSync(cmd, { stdio: 'ignore' });
            } else {
                await zipWithLibrary(dirPath, zipFilePath);
            }
            return { backupPath: zipFilePath, fileName: zipFileName };
        } catch (e) {
            return { backupPath: '', warning: `备份失败: ${e.message}` };
        }
    }

    async function restoreConfigDirectoryFromUpload(payload, options) {
        const { targetDir, requiredFileName, markerDirName, tempPrefix, backupPrefix } = options;
        if (!payload || typeof payload.fileBase64 !== 'string' || !payload.fileBase64.trim()) {
            return { error: '缺少备份文件内容' };
        }

        const upload = writeUploadZip(payload.fileBase64, tempPrefix, payload.fileName);
        if (upload.error) {
            return { error: upload.error };
        }

        const tempDir = upload.tempDir;
        const extractDir = path.join(tempDir, 'extract');
        let backupPath = '';
        try {
            await extractUploadZip(upload.zipPath, extractDir);
            const sourceDir = findConfigSourceDir(extractDir, markerDirName, requiredFileName);
            const requiredPath = path.join(sourceDir, requiredFileName);
            if (!fs.existsSync(requiredPath)) {
                return { error: `无效备份，缺少 ${requiredFileName}` };
            }

            const backupResult = await backupDirectoryIfExists(targetDir, backupPrefix);
            backupPath = backupResult.backupPath || '';

            fs.rmSync(targetDir, { recursive: true, force: true });
            copyDirRecursive(sourceDir, targetDir);

            return {
                success: true,
                targetDir,
                appliedFrom: payload.fileName || '',
                backupPath,
                backupWarning: backupResult.warning || ''
            };
        } catch (e) {
            return { error: `导入失败：${e.message}` };
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }

    return {
        resolveZipTool,
        resolveUnzipTool,
        zipWithLibrary,
        unzipWithLibrary,
        copyDirRecursive,
        inspectZipArchiveLimits,
        writeUploadZipStream,
        writeUploadZip,
        extractUploadZip,
        findConfigSourceDir,
        prepareDirectoryDownload,
        backupDirectoryIfExists,
        restoreConfigDirectoryFromUpload
    };
}

module.exports = {
    createArchiveHelperController
};
