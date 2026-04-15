const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zipLib = require('zip-lib');
const yauzl = require('yauzl');
const { execSync } = require('child_process');

const {
    resolveExistingDir,
    stripUtf8Bom
} = require('../lib/cli-utils');
const { ensureDir } = require('../lib/cli-file-utils');
const {
    isPathInside,
    resolveCopyTargetRoot,
    commandExists
} = require('../lib/cli-path-utils');
const { registerDownloadArtifact } = require('../lib/download-artifacts');
const { createArchiveHelperController } = require('./archive-helpers');

const CONFIG_DIR = path.join(os.homedir(), '.codex');
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CODEX_SKILLS_DIR = path.join(CONFIG_DIR, 'skills');
const CLAUDE_SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');
const AGENTS_SKILLS_DIR = path.join(os.homedir(), '.agents', 'skills');

const MAX_UPLOAD_SIZE = 200 * 1024 * 1024;
const MAX_SKILLS_ZIP_UPLOAD_SIZE = 20 * 1024 * 1024;
const MAX_SKILLS_ZIP_ENTRY_COUNT = 2000;
const MAX_SKILLS_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

function getCodexSkillsDir() {
    const joinPath = (basePath, ...segments) => {
        const base = typeof basePath === 'string' ? basePath.trim() : '';
        const pathApi = base.includes('/') && !base.includes('\\') && path.posix ? path.posix : path;
        return pathApi.join(base, ...segments);
    };
    const envCodexHome = typeof process.env.CODEX_HOME === 'string' ? process.env.CODEX_HOME.trim() : '';
    if (envCodexHome) {
        const target = joinPath(envCodexHome, 'skills');
        return resolveExistingDir([target], target);
    }
    const xdgConfig = typeof process.env.XDG_CONFIG_HOME === 'string' ? process.env.XDG_CONFIG_HOME.trim() : '';
    if (xdgConfig) {
        const target = joinPath(xdgConfig, 'codex', 'skills');
        return resolveExistingDir([target], target);
    }
    const homeConfigDir = joinPath(os.homedir(), '.config', 'codex', 'skills');
    return resolveExistingDir([homeConfigDir], CODEX_SKILLS_DIR);
}

function getClaudeSkillsDir() {
    const joinPath = (basePath, ...segments) => {
        const base = typeof basePath === 'string' ? basePath.trim() : '';
        const pathApi = base.includes('/') && !base.includes('\\') && path.posix ? path.posix : path;
        return pathApi.join(base, ...segments);
    };
    const envClaudeHome = typeof process.env.CLAUDE_HOME === 'string' && process.env.CLAUDE_HOME.trim()
        ? process.env.CLAUDE_HOME.trim()
        : (typeof process.env.CLAUDE_CONFIG_DIR === 'string' ? process.env.CLAUDE_CONFIG_DIR.trim() : '');
    if (envClaudeHome) {
        const target = joinPath(envClaudeHome, 'skills');
        return resolveExistingDir([target], target);
    }
    const xdgConfig = typeof process.env.XDG_CONFIG_HOME === 'string' ? process.env.XDG_CONFIG_HOME.trim() : '';
    if (xdgConfig) {
        const target = joinPath(xdgConfig, 'claude', 'skills');
        return resolveExistingDir([target], target);
    }
    const homeConfigDir = joinPath(os.homedir(), '.config', 'claude', 'skills');
    return resolveExistingDir([homeConfigDir], CLAUDE_SKILLS_DIR);
}

const SKILL_TARGETS = Object.freeze([
    Object.freeze({ app: 'codex', label: 'Codex', dir: getCodexSkillsDir() }),
    Object.freeze({ app: 'claude', label: 'Claude Code', dir: getClaudeSkillsDir() })
]);

const SKILL_IMPORT_SOURCES = Object.freeze([
    ...SKILL_TARGETS,
    Object.freeze({ app: 'agents', label: 'Agents', dir: AGENTS_SKILLS_DIR })
]);

const {
    copyDirRecursive,
    inspectZipArchiveLimits,
    writeUploadZip,
    extractUploadZip
} = createArchiveHelperController({
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
});

function normalizeCodexSkillName(name) {
    const value = typeof name === 'string' ? name.trim() : '';
    if (!value) {
        return { error: '技能名称不能为空' };
    }
    if (value.includes('\0')) {
        return { error: '技能名称非法' };
    }
    if (value === '.' || value === '..') {
        return { error: '技能名称非法' };
    }
    if (value.includes('/') || value.includes('\\')) {
        return { error: '技能名称非法' };
    }
    if (path.basename(value) !== value) {
        return { error: '技能名称非法' };
    }
    if (value.startsWith('.')) {
        return { error: '系统技能不可删除' };
    }
    return { name: value };
}

function normalizeSkillTargetApp(app) {
    const value = typeof app === 'string' ? app.trim().toLowerCase() : '';
    return SKILL_TARGETS.some((item) => item.app === value) ? value : '';
}

function getSkillTargetByApp(app) {
    const normalizedApp = normalizeSkillTargetApp(app);
    if (!normalizedApp) return null;
    return SKILL_TARGETS.find((item) => item.app === normalizedApp) || null;
}

function resolveSkillTarget(params = {}, defaultApp = 'codex') {
    const hasExplicitTargetApp = !!(params && typeof params === 'object'
        && Object.prototype.hasOwnProperty.call(params, 'targetApp'));
    const hasExplicitTarget = !!(params && typeof params === 'object'
        && Object.prototype.hasOwnProperty.call(params, 'target'));
    const hasAnyExplicitTarget = hasExplicitTargetApp || hasExplicitTarget;
    const rawTargetApp = hasExplicitTargetApp ? params.targetApp : '';
    const rawTarget = hasExplicitTarget ? params.target : '';
    const raw = rawTargetApp || rawTarget || '';
    if (hasAnyExplicitTarget && raw === '') {
        return null;
    }
    if (hasAnyExplicitTarget && !getSkillTargetByApp(raw)) {
        return null;
    }
    return getSkillTargetByApp(raw)
        || getSkillTargetByApp(defaultApp)
        || SKILL_TARGETS[0]
        || null;
}

function isSkillDirectoryEntryAtRoot(rootDir, entryName) {
    const targetPath = path.join(rootDir, entryName);
    try {
        const stat = fs.statSync(targetPath);
        return stat.isDirectory();
    } catch (e) {
        return false;
    }
}

function normalizeSkillImportSourceApp(app) {
    const value = typeof app === 'string' ? app.trim().toLowerCase() : '';
    return SKILL_IMPORT_SOURCES.some((item) => item.app === value) ? value : '';
}

function getSkillImportSourceByApp(app) {
    const normalizedApp = normalizeSkillImportSourceApp(app);
    if (!normalizedApp) return null;
    return SKILL_IMPORT_SOURCES.find((item) => item.app === normalizedApp) || null;
}

function parseSimpleSkillFrontmatter(content = '') {
    const normalized = String(content || '').replace(/\r\n/g, '\n');
    if (!normalized.startsWith('---\n')) {
        return {};
    }
    const endIndex = normalized.indexOf('\n---\n', 4);
    if (endIndex <= 4) {
        return {};
    }
    const frontmatterRaw = normalized.slice(4, endIndex);
    const result = {};
    const lines = frontmatterRaw.split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const matched = trimmed.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
        if (!matched) continue;
        const key = matched[1];
        let value = matched[2] || '';
        const indicator = value.trim();
        if (/^[>|]/.test(indicator)) {
            const blockLines = [];
            let cursor = lineIndex + 1;
            while (cursor < lines.length) {
                const candidateLine = lines[cursor];
                if (!candidateLine.trim()) {
                    blockLines.push('');
                    cursor += 1;
                    continue;
                }
                if (/^\s/.test(candidateLine)) {
                    blockLines.push(candidateLine);
                    cursor += 1;
                    continue;
                }
                break;
            }
            lineIndex = cursor - 1;
            const indents = blockLines
                .filter((item) => item.trim())
                .map((item) => {
                    const indentMatch = item.match(/^[ \t]*/);
                    return indentMatch ? indentMatch[0].length : 0;
                });
            const commonIndent = indents.length ? Math.min(...indents) : 0;
            const deindented = blockLines.map((item) => {
                if (!item.trim()) return '';
                return item.slice(commonIndent);
            });
            if (indicator.startsWith('>')) {
                const paragraphs = [];
                let paragraphLines = [];
                for (const blockLine of deindented) {
                    const blockTrimmed = blockLine.trim();
                    if (!blockTrimmed) {
                        if (paragraphLines.length) {
                            paragraphs.push(paragraphLines.join(' '));
                            paragraphLines = [];
                        }
                        continue;
                    }
                    paragraphLines.push(blockTrimmed);
                }
                if (paragraphLines.length) {
                    paragraphs.push(paragraphLines.join(' '));
                }
                value = paragraphs.join('\n');
            } else {
                value = deindented.join('\n');
            }
        }
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
            value = value.slice(1, -1);
        }
        result[key] = value.trim();
    }
    return result;
}

function stripMarkdownFrontmatter(content = '') {
    const normalized = String(content || '').replace(/\r\n/g, '\n');
    if (!normalized.startsWith('---\n')) {
        return normalized;
    }
    const endIndex = normalized.indexOf('\n---\n', 4);
    if (endIndex <= 4) {
        return normalized;
    }
    return normalized.slice(endIndex + 5);
}

function extractSkillDescriptionFromMarkdown(content = '') {
    const normalized = String(content || '').replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    let inFence = false;
    for (const line of lines) {
        const trimmedStart = line.trimStart();
        if (trimmedStart.startsWith('```')) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;
        if (/^( {4}|\t)/.test(line)) continue;
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('#')) continue;
        if (trimmed.startsWith('---')) continue;
        if (/^([A-Za-z0-9_-]+)\s*:\s*/.test(trimmed)) continue;
        return trimmed.slice(0, 200);
    }
    return '';
}

function readCodexSkillMetadata(skillPath) {
    const skillFile = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
        return {
            hasSkillFile: false,
            displayName: '',
            description: ''
        };
    }
    try {
        const raw = fs.readFileSync(skillFile, 'utf-8');
        const content = stripUtf8Bom(raw);
        const frontmatter = parseSimpleSkillFrontmatter(content);
        const contentWithoutFrontmatter = stripMarkdownFrontmatter(content);
        const heading = contentWithoutFrontmatter.match(/^\s*#\s+(.+)$/m);
        const displayName = typeof frontmatter.name === 'string' && frontmatter.name.trim()
            ? frontmatter.name.trim()
            : (heading && heading[1] ? heading[1].trim() : '');
        const description = typeof frontmatter.description === 'string' && frontmatter.description.trim()
            ? frontmatter.description.trim().slice(0, 200)
            : extractSkillDescriptionFromMarkdown(contentWithoutFrontmatter);
        return {
            hasSkillFile: true,
            displayName,
            description
        };
    } catch (e) {
        return {
            hasSkillFile: false,
            displayName: '',
            description: ''
        };
    }
}

function getSkillEntryInfoByName(rootDir, entryName) {
    const targetPath = path.join(rootDir, entryName);
    const normalized = normalizeCodexSkillName(entryName);
    if (normalized.error) {
        return null;
    }
    const relativePath = path.relative(rootDir, targetPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return null;
    }

    try {
        const lstat = fs.lstatSync(targetPath);
        const isSymbolicLink = lstat.isSymbolicLink();
        if (!lstat.isDirectory() && !isSymbolicLink) {
            return null;
        }
        if (isSymbolicLink && !isSkillDirectoryEntryAtRoot(rootDir, entryName)) {
            return null;
        }
        const metadata = readCodexSkillMetadata(targetPath);
        return {
            name: entryName,
            path: targetPath,
            hasSkillFile: !!metadata.hasSkillFile,
            displayName: metadata.displayName || entryName,
            description: metadata.description || '',
            sourceType: isSymbolicLink ? 'symlink' : 'directory',
            updatedAt: Number.isFinite(lstat.mtimeMs) ? Math.floor(lstat.mtimeMs) : 0
        };
    } catch (e) {
        return null;
    }
}

function listSkills(params = {}) {
    const target = resolveSkillTarget(params);
    if (!target) {
        return { error: '目标宿主不支持' };
    }
    if (!fs.existsSync(target.dir)) {
        return {
            targetApp: target.app,
            targetLabel: target.label,
            root: target.dir,
            exists: false,
            items: []
        };
    }
    try {
        const entries = fs.readdirSync(target.dir, { withFileTypes: true });
        const items = entries
            .map((entry) => {
                const name = entry && entry.name ? entry.name : '';
                if (!name || name.startsWith('.')) return null;
                return getSkillEntryInfoByName(target.dir, name);
            })
            .filter(Boolean)
            .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'));
        return {
            targetApp: target.app,
            targetLabel: target.label,
            root: target.dir,
            exists: true,
            items
        };
    } catch (e) {
        return { error: `读取 skills 目录失败: ${e.message}` };
    }
}

function listCodexSkills() {
    return listSkills({ targetApp: 'codex' });
}

function listSkillEntriesByRoot(rootDir) {
    if (!rootDir || !fs.existsSync(rootDir)) {
        return [];
    }
    try {
        const entries = fs.readdirSync(rootDir, { withFileTypes: true });
        return entries
            .map((entry) => {
                const name = entry && entry.name ? entry.name : '';
                if (!name || name.startsWith('.')) return null;
                const normalized = normalizeCodexSkillName(name);
                if (normalized.error) return null;
                const skillPath = path.join(rootDir, name);
                const relativePath = path.relative(rootDir, skillPath);
                if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
                    return null;
                }
                try {
                    const lstat = fs.lstatSync(skillPath);
                    const isSymbolicLink = lstat.isSymbolicLink();
                    if (!lstat.isDirectory() && !isSymbolicLink) {
                        return null;
                    }
                    if (isSymbolicLink) {
                        const realPath = fs.realpathSync(skillPath);
                        const realStat = fs.statSync(realPath);
                        if (!realStat.isDirectory()) {
                            return null;
                        }
                    }
                    return {
                        name,
                        path: skillPath,
                        sourceType: isSymbolicLink ? 'symlink' : 'directory'
                    };
                } catch (e) {
                    return null;
                }
            })
            .filter(Boolean);
    } catch (e) {
        return [];
    }
}

function scanUnmanagedSkills(params = {}) {
    const getPathApi = (basePath) => {
        const base = typeof basePath === 'string' ? basePath.trim() : '';
        return base.includes('/') && !base.includes('\\') && path.posix ? path.posix : path;
    };
    const target = resolveSkillTarget(params);
    if (!target) {
        return { error: '目标宿主不支持' };
    }
    const targetRoot = resolveCopyTargetRoot(target.dir);
    const targetPathApi = getPathApi(targetRoot);
    const existing = listSkills({ targetApp: target.app });
    if (existing.error) {
        return { error: existing.error };
    }
    const existingNames = new Set((Array.isArray(existing.items) ? existing.items : [])
        .map((item) => (item && typeof item.name === 'string' ? item.name.trim() : ''))
        .filter(Boolean));

    const items = [];
    const sources = SKILL_IMPORT_SOURCES.filter((source) => source.app !== target.app);
    for (const source of sources) {
        const sourceEntries = listSkillEntriesByRoot(source.dir);
        for (const entry of sourceEntries) {
            const targetCandidate = targetPathApi.join(targetRoot, entry.name);
            if (fs.existsSync(targetCandidate)) {
                continue;
            }
            if (existingNames.has(entry.name)) {
                continue;
            }
            const metadata = readCodexSkillMetadata(entry.path);
            items.push({
                key: `${source.app}:${entry.name}`,
                name: entry.name,
                displayName: metadata.displayName || entry.name,
                description: metadata.description || '',
                sourceApp: source.app,
                sourceLabel: source.label,
                sourcePath: entry.path,
                sourceType: entry.sourceType,
                hasSkillFile: !!metadata.hasSkillFile
            });
        }
    }

    items.sort((a, b) => {
        const nameCompare = a.displayName.localeCompare(b.displayName, 'zh-Hans-CN');
        if (nameCompare !== 0) return nameCompare;
        return a.sourceLabel.localeCompare(b.sourceLabel, 'zh-Hans-CN');
    });

    return {
        targetApp: target.app,
        targetLabel: target.label,
        root: target.dir,
        items,
        sources: sources.map((source) => ({
            app: source.app,
            label: source.label,
            path: source.dir,
            exists: fs.existsSync(source.dir)
        }))
    };
}

function scanUnmanagedCodexSkills() {
    return scanUnmanagedSkills({ targetApp: 'codex' });
}

function importSkills(params = {}) {
    const getPathApi = (basePath) => {
        const base = typeof basePath === 'string' ? basePath.trim() : '';
        return base.includes('/') && !base.includes('\\') && path.posix ? path.posix : path;
    };
    const target = resolveSkillTarget(params);
    if (!target) {
        return { error: '目标宿主不支持' };
    }
    const targetRoot = resolveCopyTargetRoot(target.dir);
    const targetPathApi = getPathApi(targetRoot);
    const rawItems = Array.isArray(params.items) ? params.items : [];
    if (!rawItems.length) {
        return { error: '请先选择要导入的 skill' };
    }

    const imported = [];
    const failed = [];
    const dedup = new Set();

    for (const rawItem of rawItems) {
        const safeItem = rawItem && typeof rawItem === 'object' ? rawItem : {};
        const normalizedName = normalizeCodexSkillName(safeItem.name);
        if (normalizedName.error) {
            failed.push({
                name: safeItem && safeItem.name ? String(safeItem.name) : '',
                sourceApp: safeItem && safeItem.sourceApp ? String(safeItem.sourceApp) : '',
                error: normalizedName.error
            });
            continue;
        }
        const source = getSkillImportSourceByApp(safeItem.sourceApp);
        if (!source) {
            failed.push({
                name: normalizedName.name,
                sourceApp: safeItem && safeItem.sourceApp ? String(safeItem.sourceApp) : '',
                error: '来源应用不支持'
            });
            continue;
        }
        if (source.app === target.app) {
            failed.push({
                name: normalizedName.name,
                sourceApp: source.app,
                error: '来源与目标相同，无需导入'
            });
            continue;
        }
        const dedupKey = `${source.app}:${normalizedName.name}`;
        if (dedup.has(dedupKey)) {
            continue;
        }
        dedup.add(dedupKey);

        const sourcePathApi = getPathApi(source.dir);
        const sourcePath = sourcePathApi.join(source.dir, normalizedName.name);
        const sourceRelative = sourcePathApi.relative(source.dir, sourcePath);
        if (sourceRelative.startsWith('..') || sourcePathApi.isAbsolute(sourceRelative)) {
            failed.push({
                name: normalizedName.name,
                sourceApp: source.app,
                error: '来源路径非法'
            });
            continue;
        }
        if (!fs.existsSync(sourcePath)) {
            failed.push({
                name: normalizedName.name,
                sourceApp: source.app,
                error: '来源 skill 不存在'
            });
            continue;
        }

        const targetPath = targetPathApi.join(targetRoot, normalizedName.name);
        const targetRelative = targetPathApi.relative(targetRoot, targetPath);
        if (targetRelative.startsWith('..') || targetPathApi.isAbsolute(targetRelative)) {
            failed.push({
                name: normalizedName.name,
                sourceApp: source.app,
                error: '目标路径非法'
            });
            continue;
        }
        if (fs.existsSync(targetPath)) {
            failed.push({
                name: normalizedName.name,
                sourceApp: source.app,
                error: `${target.label} 中已存在同名 skill`
            });
            continue;
        }

        let copiedToTarget = false;
        try {
            const lstat = fs.lstatSync(sourcePath);
            if (!lstat.isDirectory() && !lstat.isSymbolicLink()) {
                failed.push({
                    name: normalizedName.name,
                    sourceApp: source.app,
                    error: '来源不是技能目录'
                });
                continue;
            }
            const sourceDirForCopy = lstat.isSymbolicLink() ? fs.realpathSync(sourcePath) : sourcePath;
            const sourceStat = fs.statSync(sourceDirForCopy);
            if (!sourceStat.isDirectory()) {
                failed.push({
                    name: normalizedName.name,
                    sourceApp: source.app,
                    error: '来源 skill 无法读取'
                });
                continue;
            }
            if (isPathInside(targetRoot, sourceDirForCopy)) {
                failed.push({
                    name: normalizedName.name,
                    sourceApp: source.app,
                    error: '目标路径不能位于来源 skill 目录内'
                });
                continue;
            }
            ensureDir(targetRoot);
            const visitedRealPaths = new Set([sourceDirForCopy]);
            copyDirRecursive(sourceDirForCopy, targetPath, {
                dereferenceSymlinks: true,
                allowedRootRealPath: sourceDirForCopy,
                visitedRealPaths
            });
            copiedToTarget = true;
            imported.push({
                name: normalizedName.name,
                sourceApp: source.app,
                sourceLabel: source.label,
                targetApp: target.app,
                targetLabel: target.label,
                path: targetPath
            });
        } catch (e) {
            if (!copiedToTarget && fs.existsSync(targetPath)) {
                try {
                    removeDirectoryRecursive(targetPath);
                } catch (_) {}
            }
            failed.push({
                name: normalizedName.name,
                sourceApp: source.app,
                error: e && e.message ? e.message : '导入失败'
            });
        }
    }

    return {
        success: failed.length === 0,
        imported,
        failed,
        targetApp: target.app,
        targetLabel: target.label,
        root: targetRoot
    };
}

function importCodexSkills(params = {}) {
    return importSkills({ ...(params || {}), targetApp: 'codex' });
}

function collectSkillDirectoriesFromRoot(rootDir, limit = MAX_SKILLS_ZIP_ENTRY_COUNT) {
    const results = [];
    let truncated = false;
    if (!rootDir || !fs.existsSync(rootDir)) {
        return { results, truncated };
    }
    const normalizedLimit = Number.isFinite(limit) && limit > 0
        ? Math.floor(limit)
        : MAX_SKILLS_ZIP_ENTRY_COUNT;
    const stack = [rootDir];
    while (stack.length > 0) {
        if (results.length >= normalizedLimit) {
            truncated = true;
            break;
        }
        const currentDir = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch (e) {
            continue;
        }

        const hasSkillFile = entries.some((entry) => entry && entry.isFile() && String(entry.name || '') === 'SKILL.md');
        if (hasSkillFile) {
            results.push(currentDir);
            continue;
        }

        for (const entry of entries) {
            if (!entry || !entry.isDirectory()) continue;
            const entryName = typeof entry.name === 'string' ? entry.name.trim() : '';
            if (!entryName || entryName.startsWith('.')) {
                continue;
            }
            stack.push(path.join(currentDir, entryName));
        }
    }
    return { results, truncated };
}

function resolveSkillNameFromImportedDirectory(skillDir, extractionRoot, fallbackName = '') {
    const directoryBaseName = path.basename(skillDir || '');
    const extractionBaseName = path.basename(extractionRoot || '');
    let candidate = directoryBaseName;
    if (!candidate || candidate === extractionBaseName || candidate.startsWith('.')) {
        const fallback = typeof fallbackName === 'string' ? fallbackName.trim() : '';
        const fallbackBase = fallback ? path.basename(fallback, path.extname(fallback)) : '';
        candidate = fallbackBase || candidate;
    }
    return normalizeCodexSkillName(candidate);
}

async function importSkillsFromZipFile(zipPath, options = {}) {
    const getPathApi = (basePath) => {
        const base = typeof basePath === 'string' ? basePath.trim() : '';
        return base.includes('/') && !base.includes('\\') && path.posix ? path.posix : path;
    };
    const fallbackName = typeof options.fallbackName === 'string' ? options.fallbackName : '';
    const tempDir = typeof options.tempDir === 'string' ? options.tempDir : '';
    const imported = [];
    const failed = [];
    const dedupNames = new Set();
    const extractionPathApi = getPathApi(tempDir || zipPath);
    const extractionBaseDir = tempDir || extractionPathApi.dirname(zipPath);
    const extractionRoot = extractionPathApi.join(extractionBaseDir, 'extract');
    let target = null;
    let targetRoot = '';

    try {
        target = resolveSkillTarget(options, 'codex');
        if (!target) {
            return { error: '目标宿主不支持' };
        }
        targetRoot = resolveCopyTargetRoot(target.dir);
        const targetPathApi = getPathApi(targetRoot);
        await inspectZipArchiveLimits(zipPath, {
            maxEntryCount: MAX_SKILLS_ZIP_ENTRY_COUNT,
            maxUncompressedBytes: MAX_SKILLS_ZIP_UNCOMPRESSED_BYTES
        });

        await extractUploadZip(zipPath, extractionRoot);
        const discovery = collectSkillDirectoriesFromRoot(extractionRoot, MAX_SKILLS_ZIP_ENTRY_COUNT);
        const discoveredDirs = discovery.results;
        if (discoveredDirs.length === 0) {
            return { error: '压缩包中未发现包含 SKILL.md 的技能目录' };
        }
        if (discovery.truncated) {
            return { error: '压缩包中的技能目录数量超出导入上限' };
        }

        for (const skillDir of discoveredDirs) {
            const normalizedName = resolveSkillNameFromImportedDirectory(skillDir, extractionRoot, fallbackName);
            if (normalizedName.error) {
                failed.push({
                    name: path.basename(skillDir || ''),
                    error: normalizedName.error
                });
                continue;
            }
            const dedupKey = normalizedName.name.toLowerCase();
            if (dedupNames.has(dedupKey)) {
                continue;
            }
            dedupNames.add(dedupKey);

            const targetPath = targetPathApi.join(targetRoot, normalizedName.name);
            const targetRelative = targetPathApi.relative(targetRoot, targetPath);
            if (targetRelative.startsWith('..') || targetPathApi.isAbsolute(targetRelative)) {
                failed.push({
                    name: normalizedName.name,
                    error: '目标路径非法'
                });
                continue;
            }
            if (fs.existsSync(targetPath)) {
                failed.push({
                    name: normalizedName.name,
                    error: `${target.label} 中已存在同名 skill`
                });
                continue;
            }

            let copiedToTarget = false;
            try {
                const sourceRealPath = fs.realpathSync(skillDir);
                const sourceStat = fs.statSync(sourceRealPath);
                if (!sourceStat.isDirectory()) {
                    failed.push({
                        name: normalizedName.name,
                        error: '来源 skill 无法读取'
                    });
                    continue;
                }
                if (isPathInside(targetRoot, sourceRealPath)) {
                    failed.push({
                        name: normalizedName.name,
                        error: '目标路径不能位于来源 skill 目录内'
                    });
                    continue;
                }
                ensureDir(targetRoot);
                const visitedRealPaths = new Set([sourceRealPath]);
                copyDirRecursive(sourceRealPath, targetPath, {
                    dereferenceSymlinks: true,
                    allowedRootRealPath: sourceRealPath,
                    visitedRealPaths
                });
                copiedToTarget = true;
                imported.push({
                    name: normalizedName.name,
                    targetApp: target.app,
                    targetLabel: target.label,
                    path: targetPath
                });
            } catch (e) {
                if (!copiedToTarget && fs.existsSync(targetPath)) {
                    try {
                        removeDirectoryRecursive(targetPath);
                    } catch (_) {}
                }
                failed.push({
                    name: normalizedName.name,
                    error: e && e.message ? e.message : '导入失败'
                });
            }
        }

        if (imported.length === 0 && failed.length > 0) {
            return {
                error: failed[0].error || '导入失败',
                imported,
                failed,
                targetApp: target.app,
                targetLabel: target.label,
                root: targetRoot
            };
        }

        return {
            success: failed.length === 0,
            imported,
            failed,
            targetApp: target.app,
            targetLabel: target.label,
            root: targetRoot
        };
    } catch (e) {
        return {
            error: `导入失败：${e && e.message ? e.message : '未知错误'}`
        };
    } finally {
        if (tempDir) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        } else if (fs.existsSync(extractionRoot)) {
            try {
                fs.rmSync(extractionRoot, { recursive: true, force: true });
            } catch (_) {}
        }
    }
}

async function importCodexSkillsFromZipFile(zipPath, options = {}) {
    return importSkillsFromZipFile(zipPath, { ...(options || {}), targetApp: 'codex' });
}

async function importSkillsFromZip(payload = {}) {
    if (!payload || typeof payload.fileBase64 !== 'string' || !payload.fileBase64.trim()) {
        return { error: '缺少技能压缩包内容' };
    }
    const fallbackTarget = resolveSkillTarget(payload, 'codex');
    const fallbackTargetApp = fallbackTarget ? fallbackTarget.app : 'codex';
    const fallbackName = payload.fileName || `${fallbackTargetApp}-skills.zip`;
    const upload = writeUploadZip(payload.fileBase64, 'codex-skills-import', fallbackName);
    if (upload.error) {
        return { error: upload.error };
    }
    const importOptions = { tempDir: upload.tempDir, fallbackName };
    if (Object.prototype.hasOwnProperty.call(payload, 'targetApp')) {
        importOptions.targetApp = payload.targetApp;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'target')) {
        importOptions.target = payload.target;
    }
    return importSkillsFromZipFile(upload.zipPath, importOptions);
}

async function importCodexSkillsFromZip(payload = {}) {
    return importSkillsFromZip({ ...(payload || {}), targetApp: 'codex' });
}

async function exportSkills(params = {}) {
    const target = resolveSkillTarget(params);
    if (!target) {
        return { error: '目标宿主不支持' };
    }
    const rawNames = Array.isArray(params.names) ? params.names : [];
    const uniqueNames = Array.from(new Set(rawNames
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)));
    if (uniqueNames.length === 0) {
        return { error: '请先选择要导出的 skill' };
    }

    const exported = [];
    const failed = [];
    const stagingTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skills-export-'));
    const stagingRoot = path.join(stagingTempDir, 'skills');
    ensureDir(stagingRoot);

    try {
        for (const rawName of uniqueNames) {
            const normalizedName = normalizeCodexSkillName(rawName);
            if (normalizedName.error) {
                failed.push({ name: rawName, error: normalizedName.error });
                continue;
            }
            const sourcePath = path.join(target.dir, normalizedName.name);
            const sourceRelative = path.relative(target.dir, sourcePath);
            if (sourceRelative.startsWith('..') || path.isAbsolute(sourceRelative)) {
                failed.push({ name: normalizedName.name, error: '来源路径非法' });
                continue;
            }
            if (!fs.existsSync(sourcePath)) {
                failed.push({ name: normalizedName.name, error: 'skill 不存在' });
                continue;
            }

            try {
                const lstat = fs.lstatSync(sourcePath);
                if (!lstat.isDirectory() && !lstat.isSymbolicLink()) {
                    failed.push({ name: normalizedName.name, error: '来源不是技能目录' });
                    continue;
                }
                const sourceDirForCopy = lstat.isSymbolicLink() ? fs.realpathSync(sourcePath) : sourcePath;
                const sourceStat = fs.statSync(sourceDirForCopy);
                if (!sourceStat.isDirectory()) {
                    failed.push({ name: normalizedName.name, error: '来源 skill 无法读取' });
                    continue;
                }
                const targetPath = path.join(stagingRoot, normalizedName.name);
                const visitedRealPaths = new Set([sourceDirForCopy]);
                copyDirRecursive(sourceDirForCopy, targetPath, {
                    dereferenceSymlinks: true,
                    allowedRootRealPath: sourceDirForCopy,
                    visitedRealPaths
                });
                exported.push({
                    name: normalizedName.name,
                    path: sourcePath
                });
            } catch (e) {
                failed.push({
                    name: normalizedName.name,
                    error: e && e.message ? e.message : '导出失败'
                });
            }
        }

        if (exported.length === 0) {
            return {
                error: failed[0] && failed[0].error ? failed[0].error : '无可导出的 skill',
                exported,
                failed,
                targetApp: target.app,
                targetLabel: target.label,
                root: target.dir
            };
        }

        const randomToken = crypto.randomBytes(12).toString('hex');
        const zipFileName = `${target.app}-skills-${randomToken}.zip`;
        const zipFilePath = path.join(os.tmpdir(), zipFileName);
        if (fs.existsSync(zipFilePath)) {
            try {
                fs.unlinkSync(zipFilePath);
            } catch (_) {}
        }
        await zipLib.archiveFolder(stagingRoot, zipFilePath);
        const artifact = registerDownloadArtifact(zipFilePath, {
            fileName: zipFileName,
            deleteAfterDownload: true
        });

        return {
            success: failed.length === 0,
            fileName: zipFileName,
            downloadPath: artifact.downloadPath,
            exported,
            failed,
            targetApp: target.app,
            targetLabel: target.label,
            root: target.dir
        };
    } catch (e) {
        return {
            error: `导出失败：${e && e.message ? e.message : '未知错误'}`,
            exported,
            failed,
            targetApp: target.app,
            targetLabel: target.label,
            root: target.dir
        };
    } finally {
        try {
            fs.rmSync(stagingTempDir, { recursive: true, force: true });
        } catch (_) {}
    }
}

async function exportCodexSkills(params = {}) {
    return exportSkills({ ...(params || {}), targetApp: 'codex' });
}

function removeDirectoryRecursive(targetPath) {
    if (typeof fs.rmSync === 'function') {
        fs.rmSync(targetPath, { recursive: true, force: false });
        return;
    }
    fs.rmdirSync(targetPath, { recursive: true });
}

function deleteSkills(params = {}) {
    const target = resolveSkillTarget(params);
    if (!target) {
        return { error: '目标宿主不支持' };
    }
    const rawList = Array.isArray(params.names) ? params.names : [];
    const uniqueNames = Array.from(new Set(rawList
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)));
    if (!uniqueNames.length) {
        return { error: '请先选择要删除的 skill' };
    }

    const deleted = [];
    const failed = [];
    for (const rawName of uniqueNames) {
        const normalized = normalizeCodexSkillName(rawName);
        if (normalized.error) {
            failed.push({ name: rawName, error: normalized.error });
            continue;
        }

        const skillPath = path.join(target.dir, normalized.name);
        const relativePath = path.relative(target.dir, skillPath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            failed.push({ name: normalized.name, error: '技能路径非法' });
            continue;
        }
        if (!fs.existsSync(skillPath)) {
            failed.push({ name: normalized.name, error: 'skill 不存在' });
            continue;
        }

        try {
            const stat = fs.lstatSync(skillPath);
            if (!stat.isDirectory() && !stat.isSymbolicLink()) {
                failed.push({ name: normalized.name, error: '仅支持删除技能目录' });
                continue;
            }
            removeDirectoryRecursive(skillPath);
            deleted.push(normalized.name);
        } catch (e) {
            failed.push({
                name: normalized.name,
                error: e && e.message ? e.message : '删除失败'
            });
        }
    }

    return {
        success: failed.length === 0,
        deleted,
        failed,
        targetApp: target.app,
        targetLabel: target.label,
        root: target.dir
    };
}

function deleteCodexSkills(params = {}) {
    return deleteSkills({ ...(params || {}), targetApp: 'codex' });
}

module.exports = {
    MAX_SKILLS_ZIP_UPLOAD_SIZE,
    MAX_SKILLS_ZIP_ENTRY_COUNT,
    MAX_SKILLS_ZIP_UNCOMPRESSED_BYTES,
    SKILL_TARGETS,
    SKILL_IMPORT_SOURCES,
    getCodexSkillsDir,
    getClaudeSkillsDir,
    normalizeSkillTargetApp,
    getSkillTargetByApp,
    resolveSkillTarget,
    resolveCopyTargetRoot,
    listSkills,
    listCodexSkills,
    scanUnmanagedSkills,
    scanUnmanagedCodexSkills,
    importSkills,
    importCodexSkills,
    importSkillsFromZipFile,
    importCodexSkillsFromZipFile,
    importSkillsFromZip,
    importCodexSkillsFromZip,
    exportSkills,
    exportCodexSkills,
    deleteSkills,
    deleteCodexSkills
};

