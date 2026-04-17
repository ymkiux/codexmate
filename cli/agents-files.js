function createAgentsFileController(deps = {}) {
    const {
        fs,
        path,
        os,
        ensureDir,
        stripUtf8Bom,
        detectLineEnding,
        normalizeLineEnding,
        ensureUtf8Bom,
        buildLineDiff,
        CONFIG_DIR,
        AGENTS_FILE_NAME,
        CLAUDE_DIR,
        CLAUDE_MD_FILE_NAME,
        readOpenclawAgentsFile,
        readOpenclawWorkspaceFile
    } = deps;

    if (!fs) throw new Error('createAgentsFileController 缺少 fs');
    if (!path) throw new Error('createAgentsFileController 缺少 path');
    if (!os) throw new Error('createAgentsFileController 缺少 os');
    if (typeof ensureDir !== 'function') throw new Error('createAgentsFileController 缺少 ensureDir');
    if (typeof stripUtf8Bom !== 'function') throw new Error('createAgentsFileController 缺少 stripUtf8Bom');
    if (typeof detectLineEnding !== 'function') throw new Error('createAgentsFileController 缺少 detectLineEnding');
    if (typeof normalizeLineEnding !== 'function') throw new Error('createAgentsFileController 缺少 normalizeLineEnding');
    if (typeof ensureUtf8Bom !== 'function') throw new Error('createAgentsFileController 缺少 ensureUtf8Bom');
    if (typeof buildLineDiff !== 'function') throw new Error('createAgentsFileController 缺少 buildLineDiff');
    if (typeof CONFIG_DIR !== 'string' || !CONFIG_DIR) throw new Error('createAgentsFileController 缺少 CONFIG_DIR');
    if (typeof AGENTS_FILE_NAME !== 'string' || !AGENTS_FILE_NAME) throw new Error('createAgentsFileController 缺少 AGENTS_FILE_NAME');
    if (typeof CLAUDE_DIR !== 'string' || !CLAUDE_DIR) throw new Error('createAgentsFileController 缺少 CLAUDE_DIR');
    if (typeof CLAUDE_MD_FILE_NAME !== 'string' || !CLAUDE_MD_FILE_NAME) throw new Error('createAgentsFileController 缺少 CLAUDE_MD_FILE_NAME');
    if (typeof readOpenclawAgentsFile !== 'function') throw new Error('createAgentsFileController 缺少 readOpenclawAgentsFile');
    if (typeof readOpenclawWorkspaceFile !== 'function') throw new Error('createAgentsFileController 缺少 readOpenclawWorkspaceFile');

    function resolveAgentsFilePath(params = {}) {
        const baseDir = typeof params.baseDir === 'string' && params.baseDir.trim()
            ? params.baseDir.trim()
            : CONFIG_DIR;
        return path.join(baseDir, AGENTS_FILE_NAME);
    }

    function validateAgentsBaseDir(filePath) {
        const dirPath = path.dirname(filePath);
        try {
            const stat = fs.statSync(dirPath);
            if (!stat.isDirectory()) {
                return { error: `目标不是目录: ${dirPath}` };
            }
        } catch (e) {
            return { error: `目标目录不存在: ${dirPath}` };
        }
        return { ok: true, dirPath };
    }

    function resolveClaudeMdFilePath() {
        return path.join(CLAUDE_DIR, CLAUDE_MD_FILE_NAME);
    }

    function readClaudeMdFile(params = {}) {
        const filePath = resolveClaudeMdFilePath();
        const lineEndingFallback = os.EOL === '\r\n' ? '\r\n' : '\n';
        if (!fs.existsSync(filePath)) {
            return {
                exists: false,
                path: filePath,
                content: '',
                lineEnding: lineEndingFallback
            };
        }
        if (params.metaOnly) {
            return {
                exists: true,
                path: filePath,
                content: '',
                lineEnding: lineEndingFallback
            };
        }
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            return {
                exists: true,
                path: filePath,
                content: stripUtf8Bom(raw),
                lineEnding: detectLineEnding(raw)
            };
        } catch (e) {
            return { error: `读取 CLAUDE.md 失败: ${e.message}` };
        }
    }

    function applyClaudeMdFile(params = {}) {
        const filePath = resolveClaudeMdFilePath();
        const content = typeof params.content === 'string' ? params.content : '';
        const lineEnding = params.lineEnding === '\r\n' ? '\r\n' : '\n';
        const normalized = normalizeLineEnding(content, lineEnding);
        const finalContent = ensureUtf8Bom(normalized);
        try {
            ensureDir(CLAUDE_DIR);
            fs.writeFileSync(filePath, finalContent, 'utf-8');
            return { success: true, path: filePath };
        } catch (e) {
            return { error: `写入 CLAUDE.md 失败: ${e.message}` };
        }
    }

    function readAgentsFile(params = {}) {
        const filePath = resolveAgentsFilePath(params);
        const dirCheck = validateAgentsBaseDir(filePath);
        if (dirCheck.error) {
            return { error: dirCheck.error };
        }

        if (!fs.existsSync(filePath)) {
            return {
                exists: false,
                path: filePath,
                content: '',
                lineEnding: os.EOL === '\r\n' ? '\r\n' : '\n'
            };
        }

        if (params.metaOnly) {
            return {
                exists: true,
                path: filePath,
                content: '',
                lineEnding: os.EOL === '\r\n' ? '\r\n' : '\n'
            };
        }

        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            return {
                exists: true,
                path: filePath,
                content: stripUtf8Bom(raw),
                lineEnding: detectLineEnding(raw)
            };
        } catch (e) {
            return { error: `读取 AGENTS.md 失败: ${e.message}` };
        }
    }

    function applyAgentsFile(params = {}) {
        const filePath = resolveAgentsFilePath(params);
        const dirCheck = validateAgentsBaseDir(filePath);
        if (dirCheck.error) {
            return { error: dirCheck.error };
        }

        const content = typeof params.content === 'string' ? params.content : '';
        const lineEnding = params.lineEnding === '\r\n' ? '\r\n' : '\n';
        const normalized = normalizeLineEnding(content, lineEnding);
        const finalContent = ensureUtf8Bom(normalized);

        try {
            fs.writeFileSync(filePath, finalContent, 'utf-8');
            return { success: true, path: filePath };
        } catch (e) {
            return { error: `写入 AGENTS.md 失败: ${e.message}` };
        }
    }

    function normalizeDiffText(input) {
        const safe = typeof input === 'string' ? input : '';
        return normalizeLineEnding(stripUtf8Bom(safe), '\n');
    }

    function buildAgentsDiff(params = {}) {
        const hasBaseContent = typeof params.baseContent === 'string';
        const contextRaw = typeof params.context === 'string' ? params.context.trim() : '';
        const context = contextRaw || 'codex';
        const metaOnly = hasBaseContent;
        let readResult;
        if (context === 'claude-md') {
            readResult = readClaudeMdFile({ metaOnly });
        } else if (context === 'openclaw') {
            readResult = readOpenclawAgentsFile({ metaOnly });
        } else if (context === 'openclaw-workspace') {
            readResult = readOpenclawWorkspaceFile({ ...params, metaOnly });
        } else if (context === 'codex') {
            readResult = readAgentsFile({ ...params, metaOnly });
        } else {
            return { error: `Unsupported agents diff context: ${context}` };
        }
        if (readResult && readResult.error) {
            return { error: readResult.error };
        }

        const beforeText = normalizeDiffText(
            hasBaseContent ? params.baseContent : (readResult && readResult.content ? readResult.content : '')
        );
        const afterText = normalizeDiffText(params.content);
        const diff = buildLineDiff(beforeText, afterText);
        const hasChanges = diff.truncated ? beforeText !== afterText : (diff.stats.added > 0 || diff.stats.removed > 0);
        return {
            diff: {
                ...diff,
                hasChanges
            },
            path: readResult && readResult.path ? readResult.path : '',
            exists: !!(readResult && readResult.exists),
            context,
            configError: readResult && readResult.configError ? readResult.configError : ''
        };
    }

    return {
        resolveAgentsFilePath,
        validateAgentsBaseDir,
        resolveClaudeMdFilePath,
        readClaudeMdFile,
        applyClaudeMdFile,
        readAgentsFile,
        applyAgentsFile,
        normalizeDiffText,
        buildAgentsDiff
    };
}

module.exports = {
    createAgentsFileController
};
