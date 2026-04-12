function createZipCommandController(deps = {}) {
    const {
        fs,
        path,
        execSync,
        process,
        yauzl,
        ensureDir,
        formatTimestampForFileName,
        inspectZipArchiveLimits,
        resolveZipTool,
        resolveUnzipTool,
        zipWithLibrary,
        unzipWithLibrary,
        DEFAULT_EXTRACT_SUFFIXES,
        MAX_SKILLS_ZIP_ENTRY_COUNT,
        MAX_SKILLS_ZIP_UNCOMPRESSED_BYTES,
    } = deps;

    if (!fs) throw new Error('createZipCommandController 缺少 fs');
    if (!path) throw new Error('createZipCommandController 缺少 path');
    if (typeof execSync !== 'function') throw new Error('createZipCommandController 缺少 execSync');
    if (!process) throw new Error('createZipCommandController 缺少 process');
    if (!yauzl) throw new Error('createZipCommandController 缺少 yauzl');
    if (typeof ensureDir !== 'function') throw new Error('createZipCommandController 缺少 ensureDir');
    if (typeof formatTimestampForFileName !== 'function') throw new Error('createZipCommandController 缺少 formatTimestampForFileName');
    if (typeof inspectZipArchiveLimits !== 'function') throw new Error('createZipCommandController 缺少 inspectZipArchiveLimits');
    if (typeof resolveZipTool !== 'function') throw new Error('createZipCommandController 缺少 resolveZipTool');
    if (typeof resolveUnzipTool !== 'function') throw new Error('createZipCommandController 缺少 resolveUnzipTool');
    if (typeof zipWithLibrary !== 'function') throw new Error('createZipCommandController 缺少 zipWithLibrary');
    if (typeof unzipWithLibrary !== 'function') throw new Error('createZipCommandController 缺少 unzipWithLibrary');
    if (!Array.isArray(DEFAULT_EXTRACT_SUFFIXES)) throw new Error('createZipCommandController 缺少 DEFAULT_EXTRACT_SUFFIXES');
    if (!Number.isFinite(MAX_SKILLS_ZIP_ENTRY_COUNT)) throw new Error('createZipCommandController 缺少 MAX_SKILLS_ZIP_ENTRY_COUNT');
    if (!Number.isFinite(MAX_SKILLS_ZIP_UNCOMPRESSED_BYTES)) throw new Error('createZipCommandController 缺少 MAX_SKILLS_ZIP_UNCOMPRESSED_BYTES');

    async function cmdZip(targetPath, options = {}) {
        if (!targetPath) {
            console.error('用法: codexmate zip <文件或文件夹路径> [--max:压缩级别]');
            console.log('\n示例:');
            console.log('  codexmate zip ./myproject');
            console.log('  codexmate zip ./myproject --max:9');
            console.log('  codexmate zip D:/data/folder --max:1');
            console.log('\n压缩级别: 0(仅存储) ~ 9(极限压缩), 默认: 5');
            process.exit(1);
        }

        const absPath = path.resolve(targetPath);
        if (!fs.existsSync(absPath)) {
            console.error('错误: 路径不存在:', absPath);
            process.exit(1);
        }

        const compressionLevel = options.max !== undefined ? options.max : 5;
        if (compressionLevel < 0 || compressionLevel > 9) {
            console.error('错误: 压缩级别必须在 0-9 之间');
            process.exit(1);
        }

        const baseName = path.basename(absPath);
        const outputDir = path.dirname(absPath);
        const outputPath = path.join(outputDir, `${baseName}.zip`);

        const zipTool = resolveZipTool();
        const useZipCmd = zipTool.type === 'zip';

        console.log('\n压缩配置:');
        console.log('  源路径:', absPath);
        console.log('  输出文件:', outputPath);
        console.log('  压缩工具:', useZipCmd ? '系统 zip' : 'zip-lib');
        if (useZipCmd) {
            console.log('  压缩级别:', compressionLevel);
        } else {
            console.log('  压缩级别: 固定（zip-lib 不支持 --max，已忽略）');
        }
        console.log('\n开始压缩...\n');

        try {
            if (useZipCmd) {
                const cmd = `"${zipTool.cmd}" -${compressionLevel} -q -r "${outputPath}" "${absPath}"`;
                execSync(cmd, { stdio: 'ignore' });
            } else {
                await zipWithLibrary(absPath, outputPath);
            }

            console.log('✓ 压缩完成!');
            console.log('  输出文件:', outputPath);
            console.log();
        } catch (e) {
            console.error('压缩失败:', e.message);
            process.exit(1);
        }
    }

    async function cmdUnzip(zipPath, outputDir) {
        if (!zipPath) {
            console.error('用法: codexmate unzip <zip文件路径> [输出目录]');
            console.log('\n示例:');
            console.log('  codexmate unzip ./archive.zip');
            console.log('  codexmate unzip ./archive.zip ./output');
            console.log('  codexmate unzip D:/data/file.zip D:/extracted');
            process.exit(1);
        }

        const absZipPath = path.resolve(zipPath);
        if (!fs.existsSync(absZipPath)) {
            console.error('错误: 文件不存在:', absZipPath);
            process.exit(1);
        }

        if (!absZipPath.toLowerCase().endsWith('.zip')) {
            console.error('错误: 仅支持 .zip 文件');
            process.exit(1);
        }

        const baseName = path.basename(absZipPath, '.zip');
        const defaultOutputDir = path.join(path.dirname(absZipPath), baseName);
        const absOutputDir = outputDir ? path.resolve(outputDir) : defaultOutputDir;

        resolveUnzipTool();

        console.log('\n解压配置:');
        console.log('  源文件:', absZipPath);
        console.log('  输出目录:', absOutputDir);
        console.log('  解压工具:', 'zip-lib');
        console.log('\n开始解压...\n');

        try {
            await unzipWithLibrary(absZipPath, absOutputDir);
            console.log('✓ 解压完成!');
            console.log('  输出目录:', absOutputDir);
            console.log();
        } catch (e) {
            console.error('解压失败:', e.message);
            process.exit(1);
        }
    }

    function splitExtractSuffixInput(rawValue) {
        if (Array.isArray(rawValue)) {
            return rawValue.flatMap((item) => splitExtractSuffixInput(item));
        }
        if (typeof rawValue !== 'string') {
            return [];
        }
        return rawValue
            .split(/[,\s]+/g)
            .map((item) => item.trim())
            .filter(Boolean);
    }

    function normalizeExtractSuffix(rawSuffix, fallbackSuffixes = DEFAULT_EXTRACT_SUFFIXES) {
        const fallbackItems = splitExtractSuffixInput(fallbackSuffixes);
        const sourceItems = splitExtractSuffixInput(rawSuffix);
        const source = sourceItems.length > 0 ? sourceItems : fallbackItems;
        const dedup = new Set();

        for (const item of source) {
            const lower = item.toLowerCase();
            if (!lower) {
                continue;
            }
            const normalized = lower.startsWith('.') ? lower : `.${lower}`;
            if (normalized.length > 1) {
                dedup.add(normalized);
            }
        }

        if (dedup.size === 0) {
            return [...DEFAULT_EXTRACT_SUFFIXES];
        }
        return Array.from(dedup);
    }

    function buildDefaultExtractOutputDir(baseCwd = process.cwd()) {
        const normalizedCwd = path.resolve(baseCwd);
        const parentDir = path.dirname(normalizedCwd);
        const timestamp = formatTimestampForFileName().replace(/-/g, '');
        return path.join(parentDir, timestamp);
    }

    function sanitizeNameSegment(rawValue, fallback = 'item') {
        const value = typeof rawValue === 'string' ? rawValue.trim() : '';
        const sanitized = value
            .replace(/[^\w.-]+/g, '_')
            .replace(/^_+|_+$/g, '');
        return sanitized || fallback;
    }

    function resolveDuplicateOutputPath(outputDir, originalFileName, zipPath = '', counters = new Map()) {
        const fallbackName = `file${path.extname(originalFileName || '')}`;
        const fileName = path.basename(originalFileName || '') || fallbackName;
        const firstChoice = path.join(outputDir, fileName);
        const firstChoiceKey = `exact:${fileName}`;
        if (!counters.has(firstChoiceKey)) {
            counters.set(firstChoiceKey, true);
            if (!fs.existsSync(firstChoice)) {
                return firstChoice;
            }
        }

        const ext = path.extname(fileName);
        const baseName = path.basename(fileName, ext);
        const safeBaseName = sanitizeNameSegment(baseName, 'file');
        const zipBaseName = sanitizeNameSegment(path.basename(zipPath || '', '.zip'), 'zip');
        const duplicateKey = `dup:${safeBaseName}|${zipBaseName}|${ext}`;
        let index = counters.has(duplicateKey) ? counters.get(duplicateKey) : 1;

        for (; index <= 100000; index++) {
            const candidateName = `${safeBaseName}__${zipBaseName}__${index}${ext}`;
            const candidatePath = path.join(outputDir, candidateName);
            if (!fs.existsSync(candidatePath)) {
                counters.set(duplicateKey, index + 1);
                return candidatePath;
            }
        }

        throw new Error(`重名文件过多，无法生成唯一文件名: ${fileName}`);
    }

    function collectZipFilesFromDir(rootDir, recursive = true) {
        const queue = [rootDir];
        const result = [];

        while (queue.length > 0) {
            const currentDir = queue.shift();
            let entries = [];
            try {
                entries = fs.readdirSync(currentDir, { withFileTypes: true });
            } catch (e) {
                throw new Error(`读取目录失败: ${currentDir} (${e.message})`);
            }

            for (const entry of entries) {
                const entryPath = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    if (recursive) {
                        queue.push(entryPath);
                    }
                    continue;
                }
                if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
                    result.push(entryPath);
                }
            }
        }

        result.sort((a, b) => a.localeCompare(b));
        return result;
    }

    function extractMatchedEntriesFromZip(zipPath, outputDir, suffixes, duplicateCounters = new Map()) {
        const normalizedSuffixes = normalizeExtractSuffix(suffixes);
        return new Promise((resolve, reject) => {
            yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (openErr, zipFile) => {
                if (openErr) {
                    reject(openErr);
                    return;
                }
                if (!zipFile) {
                    reject(new Error('无法读取 ZIP 文件'));
                    return;
                }

                let settled = false;
                let matched = 0;
                let extracted = 0;
                let skippedDir = 0;
                let skippedExt = 0;

                const finish = (err) => {
                    if (settled) return;
                    settled = true;
                    try {
                        zipFile.close();
                    } catch (_) {}
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ matched, extracted, skippedDir, skippedExt });
                    }
                };

                zipFile.on('entry', (entry) => {
                    if (settled) return;
                    const rawEntryName = typeof entry.fileName === 'string' ? entry.fileName : '';
                    const normalizedEntryName = rawEntryName.replace(/\\/g, '/');

                    if (!normalizedEntryName || normalizedEntryName.endsWith('/')) {
                        skippedDir += 1;
                        zipFile.readEntry();
                        return;
                    }

                    const entryBaseName = path.basename(normalizedEntryName);
                    const lowerBaseName = entryBaseName.toLowerCase();
                    const matchedSuffix = normalizedSuffixes.some((suffix) => lowerBaseName.endsWith(suffix));
                    if (!entryBaseName || !matchedSuffix) {
                        skippedExt += 1;
                        zipFile.readEntry();
                        return;
                    }

                    matched += 1;
                    zipFile.openReadStream(entry, (streamErr, readStream) => {
                        if (streamErr || !readStream) {
                            finish(streamErr || new Error('无法读取 ZIP 条目流'));
                            return;
                        }

                        let completed = false;
                        const outputPath = resolveDuplicateOutputPath(outputDir, entryBaseName, zipPath, duplicateCounters);
                        const writeStream = fs.createWriteStream(outputPath);
                        const fail = (writeErr) => {
                            if (completed) return;
                            completed = true;
                            try {
                                readStream.destroy();
                            } catch (_) {}
                            try {
                                writeStream.destroy();
                            } catch (_) {}
                            try {
                                if (fs.existsSync(outputPath)) {
                                    fs.unlinkSync(outputPath);
                                }
                            } catch (_) {}
                            finish(writeErr);
                        };

                        readStream.on('error', fail);
                        writeStream.on('error', fail);
                        writeStream.on('finish', () => {
                            if (completed || settled) return;
                            completed = true;
                            extracted += 1;
                            zipFile.readEntry();
                        });

                        readStream.pipe(writeStream);
                    });
                });

                zipFile.on('end', () => {
                    finish(null);
                });
                zipFile.on('error', (zipErr) => {
                    finish(zipErr);
                });

                zipFile.readEntry();
            });
        });
    }

    async function cmdUnzipExt(zipDirPath, outputDir, options = {}) {
        if (!zipDirPath) {
            console.error('用法: codexmate unzip-ext <zip目录> [输出目录] [--ext:后缀[,后缀...]] [--no-recursive]');
            console.log('\n示例:');
            console.log('  codexmate unzip-ext ./archives');
            console.log('  codexmate unzip-ext ./archives ./output --ext:json,txt');
            console.log('  codexmate unzip-ext D:/data/zips --ext:txt --no-recursive');
            console.log('  说明: 默认递归扫描子目录，可通过 --no-recursive 关闭递归');
            process.exit(1);
        }

        const recursive = options.recursive !== false;
        const suffixes = normalizeExtractSuffix(options.ext);
        const absZipDir = path.resolve(zipDirPath);
        const absOutputDir = outputDir ? path.resolve(outputDir) : buildDefaultExtractOutputDir(process.cwd());

        if (!fs.existsSync(absZipDir)) {
            console.error('错误: 目录不存在:', absZipDir);
            process.exit(1);
        }
        try {
            if (!fs.statSync(absZipDir).isDirectory()) {
                console.error('错误: 仅支持目录路径:', absZipDir);
                process.exit(1);
            }
        } catch (e) {
            console.error('错误: 无法读取目录信息:', e.message);
            process.exit(1);
        }

        let zipFiles = [];
        try {
            zipFiles = collectZipFilesFromDir(absZipDir, recursive);
        } catch (e) {
            console.error('扫描 ZIP 文件失败:', e.message);
            process.exit(1);
        }

        if (zipFiles.length === 0) {
            console.error('错误: 未找到任何 ZIP 文件');
            process.exit(1);
        }

        ensureDir(absOutputDir);

        console.log('\n批量解压配置:');
        console.log('  ZIP 目录:', absZipDir);
        console.log('  输出目录:', absOutputDir);
        console.log('  后缀过滤:', suffixes.join(', '));
        console.log('  递归扫描:', recursive ? '是' : '否');
        console.log('  ZIP 数量:', zipFiles.length);
        console.log('\n开始提取...\n');

        let totalMatched = 0;
        let totalExtracted = 0;
        let totalSkippedDir = 0;
        let totalSkippedExt = 0;
        const failed = [];
        const duplicateCounters = new Map();

        for (const zipFilePath of zipFiles) {
            try {
                await inspectZipArchiveLimits(zipFilePath, {
                    maxEntryCount: MAX_SKILLS_ZIP_ENTRY_COUNT,
                    maxUncompressedBytes: MAX_SKILLS_ZIP_UNCOMPRESSED_BYTES
                });
                const result = await extractMatchedEntriesFromZip(zipFilePath, absOutputDir, suffixes, duplicateCounters);
                totalMatched += result.matched;
                totalExtracted += result.extracted;
                totalSkippedDir += result.skippedDir;
                totalSkippedExt += result.skippedExt;
                console.log(`✓ ${path.basename(zipFilePath)}: 命中 ${result.matched}，提取 ${result.extracted}`);
            } catch (e) {
                failed.push({ zipFilePath, message: e && e.message ? e.message : String(e) });
                console.error(`✗ ${path.basename(zipFilePath)}: ${e && e.message ? e.message : e}`);
            }
        }

        console.log('\n提取结果:');
        console.log('  输出目录:', absOutputDir);
        console.log('  扫描 ZIP:', zipFiles.length);
        console.log('  命中条目:', totalMatched);
        console.log('  已提取:', totalExtracted);
        console.log('  已跳过(目录条目):', totalSkippedDir);
        console.log('  已跳过(后缀不匹配):', totalSkippedExt);
        if (failed.length > 0) {
            console.error('  失败数量:', failed.length);
            for (const item of failed) {
                console.error(`    - ${item.zipFilePath}: ${item.message}`);
            }
            process.exit(1);
        }
        console.log();
    }

    function parseZipCommandArgs(args = []) {
        const options = {};
        let targetPath = null;
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (typeof arg !== 'string' || !arg) continue;
            if (arg.startsWith('--max:')) {
                options.max = parseInt(arg.substring(6), 10);
            } else if (!targetPath) {
                targetPath = arg;
            }
        }
        return { targetPath, options };
    }

    function parseUnzipExtCommandArgs(args = []) {
        const options = {
            ext: [],
            recursive: true
        };
        let zipDirPath = null;
        let outputDir = null;
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (typeof arg !== 'string' || !arg) continue;
            if (arg.startsWith('--ext:')) {
                options.ext.push(...splitExtractSuffixInput(arg.substring(6)));
            } else if (arg.startsWith('--ext=')) {
                options.ext.push(...splitExtractSuffixInput(arg.substring(6)));
            } else if (arg === '--ext') {
                const nextArg = args[i + 1];
                if (typeof nextArg === 'string' && !nextArg.startsWith('--')) {
                    options.ext.push(...splitExtractSuffixInput(nextArg));
                    i += 1;
                }
            } else if (arg === '--recursive') {
                options.recursive = true;
            } else if (arg === '--no-recursive') {
                options.recursive = false;
            } else if (!zipDirPath) {
                zipDirPath = arg;
            } else if (!outputDir) {
                outputDir = arg;
            }
        }
        return { zipDirPath, outputDir, options };
    }

    return {
        cmdZip,
        cmdUnzip,
        cmdUnzipExt,
        splitExtractSuffixInput,
        parseZipCommandArgs,
        parseUnzipExtCommandArgs
    };
}

module.exports = {
    createZipCommandController
};
