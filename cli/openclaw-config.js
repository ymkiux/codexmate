const JSON5 = require('json5');

function createOpenclawConfigController(deps = {}) {
    const {
        fs,
        path,
        os,
        ensureDir,
        readJsonObjectFromFile,
        writeJsonAtomic,
        backupFileIfNeededOnce,
        stripUtf8Bom,
        detectLineEnding,
        normalizeLineEnding,
        ensureUtf8Bom,
        isPlainObject,
        resolveHomePath,
        readAgentsFile,
        applyAgentsFile,
        OPENCLAW_CONFIG_FILE,
        OPENCLAW_WORKSPACE_DIR,
        OPENCLAW_DIR,
        OPENCLAW_DEFAULT_AGENT_ID,
        OPENCLAW_AUTH_PROFILES_FILE_NAME,
        OPENCLAW_AUTH_STATE_FILE_NAME,
        AGENTS_FILE_NAME
    } = deps;

    if (!fs) throw new Error('createOpenclawConfigController 缺少 fs');
    if (!path) throw new Error('createOpenclawConfigController 缺少 path');
    if (!os) throw new Error('createOpenclawConfigController 缺少 os');
    if (typeof ensureDir !== 'function') throw new Error('createOpenclawConfigController 缺少 ensureDir');
    if (typeof readJsonObjectFromFile !== 'function') throw new Error('createOpenclawConfigController 缺少 readJsonObjectFromFile');
    if (typeof writeJsonAtomic !== 'function') throw new Error('createOpenclawConfigController 缺少 writeJsonAtomic');
    if (typeof backupFileIfNeededOnce !== 'function') throw new Error('createOpenclawConfigController 缺少 backupFileIfNeededOnce');
    if (typeof stripUtf8Bom !== 'function') throw new Error('createOpenclawConfigController 缺少 stripUtf8Bom');
    if (typeof detectLineEnding !== 'function') throw new Error('createOpenclawConfigController 缺少 detectLineEnding');
    if (typeof normalizeLineEnding !== 'function') throw new Error('createOpenclawConfigController 缺少 normalizeLineEnding');
    if (typeof ensureUtf8Bom !== 'function') throw new Error('createOpenclawConfigController 缺少 ensureUtf8Bom');
    if (typeof isPlainObject !== 'function') throw new Error('createOpenclawConfigController 缺少 isPlainObject');
    if (typeof resolveHomePath !== 'function') throw new Error('createOpenclawConfigController 缺少 resolveHomePath');
    if (typeof readAgentsFile !== 'function') throw new Error('createOpenclawConfigController 缺少 readAgentsFile');
    if (typeof applyAgentsFile !== 'function') throw new Error('createOpenclawConfigController 缺少 applyAgentsFile');
    if (!OPENCLAW_CONFIG_FILE) throw new Error('createOpenclawConfigController 缺少 OPENCLAW_CONFIG_FILE');
    if (!OPENCLAW_WORKSPACE_DIR) throw new Error('createOpenclawConfigController 缺少 OPENCLAW_WORKSPACE_DIR');
    if (!OPENCLAW_DIR) throw new Error('createOpenclawConfigController 缺少 OPENCLAW_DIR');
    if (!OPENCLAW_DEFAULT_AGENT_ID) throw new Error('createOpenclawConfigController 缺少 OPENCLAW_DEFAULT_AGENT_ID');
    if (!OPENCLAW_AUTH_PROFILES_FILE_NAME) throw new Error('createOpenclawConfigController 缺少 OPENCLAW_AUTH_PROFILES_FILE_NAME');
    if (!OPENCLAW_AUTH_STATE_FILE_NAME) throw new Error('createOpenclawConfigController 缺少 OPENCLAW_AUTH_STATE_FILE_NAME');
    if (!AGENTS_FILE_NAME) throw new Error('createOpenclawConfigController 缺少 AGENTS_FILE_NAME');

    function resolveOpenclawWorkspaceDir(config) {
        const workspace = config
            && config.agents
            && config.agents.defaults
            && typeof config.agents.defaults.workspace === 'string'
            ? config.agents.defaults.workspace
            : '';
        const resolved = resolveHomePath(workspace);
        if (!resolved) {
            return OPENCLAW_WORKSPACE_DIR;
        }
        if (path.isAbsolute(resolved)) {
            return resolved;
        }
        return path.join(OPENCLAW_DIR, resolved);
    }

    function normalizeOpenclawWorkspaceFileName(input) {
        const raw = typeof input === 'string' ? input.trim() : '';
        if (!raw) {
            return { error: '文件名不能为空' };
        }
        if (raw.includes('\0')) {
            return { error: '文件名非法' };
        }
        if (raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
            return { error: '文件名非法' };
        }
        const baseName = path.basename(raw);
        if (baseName !== raw) {
            return { error: '文件名非法' };
        }
        if (!raw.toLowerCase().endsWith('.md')) {
            return { error: '仅支持 .md 文件' };
        }
        return { ok: true, name: raw };
    }

    function normalizeOpenclawProviderId(provider) {
        const normalized = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
        if (!normalized) return '';
        if (normalized === 'modelstudio' || normalized === 'qwencloud') {
            return 'qwen';
        }
        if (normalized === 'z.ai' || normalized === 'z-ai') {
            return 'zai';
        }
        if (normalized === 'opencode-zen') {
            return 'opencode';
        }
        if (normalized === 'opencode-go-auth') {
            return 'opencode-go';
        }
        if (normalized === 'kimi' || normalized === 'kimi-code' || normalized === 'kimi-coding') {
            return 'kimi';
        }
        if (normalized === 'bedrock' || normalized === 'aws-bedrock') {
            return 'amazon-bedrock';
        }
        if (normalized === 'bytedance' || normalized === 'doubao') {
            return 'volcengine';
        }
        if (normalized === 'volcengine-plan') {
            return 'volcengine';
        }
        if (normalized === 'byteplus-plan') {
            return 'byteplus';
        }
        return normalized;
    }

    function findNormalizedOpenclawProviderValue(entries, provider) {
        if (!isPlainObject(entries)) {
            return undefined;
        }
        const providerKey = normalizeOpenclawProviderId(provider);
        if (!providerKey) {
            return undefined;
        }
        for (const [key, value] of Object.entries(entries)) {
            if (normalizeOpenclawProviderId(key) === providerKey) {
                return value;
            }
        }
        return undefined;
    }

    function resolveOpenclawStateDir() {
        const override = typeof process.env.OPENCLAW_STATE_DIR === 'string'
            ? process.env.OPENCLAW_STATE_DIR.trim()
            : '';
        return override ? resolveHomePath(override) : OPENCLAW_DIR;
    }

    function resolveOpenclawAgentDir() {
        const override = [process.env.OPENCLAW_AGENT_DIR, process.env.PI_CODING_AGENT_DIR]
            .find(value => typeof value === 'string' && value.trim());
        if (override) {
            return resolveHomePath(override.trim());
        }
        return path.join(resolveOpenclawStateDir(), 'agents', OPENCLAW_DEFAULT_AGENT_ID, 'agent');
    }

    function buildOpenclawAuthProfileDisplay(profileId, credential) {
        const type = typeof credential.type === 'string' && credential.type.trim()
            ? credential.type.trim()
            : 'unknown';
        const parts = [`AuthProfile(${type}:${profileId})`];
        const label = typeof credential.displayName === 'string' && credential.displayName.trim()
            ? credential.displayName.trim()
            : (typeof credential.email === 'string' && credential.email.trim() ? credential.email.trim() : '');
        if (label) {
            parts.push(label);
        }
        return parts.join(' · ');
    }

    function resolveOpenclawAuthProfileEditableValue(credential) {
        if (!isPlainObject(credential)) {
            return {
                resolvedValue: '',
                resolvedField: '',
                editable: false,
                valueKind: 'missing'
            };
        }
        if (credential.type === 'api_key' && typeof credential.key === 'string' && credential.key.trim()) {
            return {
                resolvedValue: credential.key.trim(),
                resolvedField: 'key',
                editable: true,
                valueKind: 'api_key'
            };
        }
        if (credential.type === 'token' && typeof credential.token === 'string' && credential.token.trim()) {
            return {
                resolvedValue: credential.token.trim(),
                resolvedField: 'token',
                editable: true,
                valueKind: 'token'
            };
        }
        if (credential.type === 'oauth' && typeof credential.access === 'string' && credential.access.trim()) {
            return {
                resolvedValue: credential.access.trim(),
                resolvedField: 'access',
                editable: true,
                valueKind: 'oauth-access'
            };
        }
        return {
            resolvedValue: '',
            resolvedField: '',
            editable: false,
            valueKind: typeof credential.type === 'string' && credential.type.trim()
                ? credential.type.trim()
                : 'missing'
        };
    }

    function getOpenclawAuthProfileTypeRank(credential) {
        const type = typeof credential.type === 'string' ? credential.type.trim().toLowerCase() : '';
        if (type === 'oauth') return 0;
        if (type === 'token') return 1;
        if (type === 'api_key') return 2;
        return 3;
    }

    function readOpenclawAuthProfilesSummary() {
        const agentDir = resolveOpenclawAgentDir();
        const authStorePath = path.join(agentDir, OPENCLAW_AUTH_PROFILES_FILE_NAME);
        const authStatePath = path.join(agentDir, OPENCLAW_AUTH_STATE_FILE_NAME);
        const storeResult = readJsonObjectFromFile(authStorePath, { profiles: {} });
        const stateResult = readJsonObjectFromFile(authStatePath, {});
        const profiles = storeResult.ok && isPlainObject(storeResult.data) && isPlainObject(storeResult.data.profiles)
            ? storeResult.data.profiles
            : {};
        const state = stateResult.ok && isPlainObject(stateResult.data)
            ? stateResult.data
            : {};

        const grouped = new Map();
        for (const [profileId, credential] of Object.entries(profiles)) {
            if (!isPlainObject(credential)) continue;
            const provider = typeof credential.provider === 'string' ? credential.provider.trim() : '';
            const normalizedProvider = normalizeOpenclawProviderId(provider);
            if (!normalizedProvider) continue;
            if (!grouped.has(normalizedProvider)) {
                grouped.set(normalizedProvider, []);
            }
            grouped.get(normalizedProvider).push([profileId, credential]);
        }

        const providers = {};
        for (const [providerKey, entries] of grouped.entries()) {
            const explicitOrder = findNormalizedOpenclawProviderValue(state.order, providerKey);
            const lastGood = findNormalizedOpenclawProviderValue(state.lastGood, providerKey);
            let selectedEntry = null;

            if (typeof explicitOrder === 'string' && explicitOrder.trim()) {
                selectedEntry = entries.find(([profileId]) => profileId === explicitOrder.trim()) || null;
            }
            if (!selectedEntry && typeof lastGood === 'string' && lastGood.trim()) {
                selectedEntry = entries.find(([profileId]) => profileId === lastGood.trim()) || null;
            }
            if (!selectedEntry) {
                entries.sort((a, b) => {
                    const rankDelta = getOpenclawAuthProfileTypeRank(a[1]) - getOpenclawAuthProfileTypeRank(b[1]);
                    if (rankDelta !== 0) return rankDelta;
                    return a[0].localeCompare(b[0]);
                });
                selectedEntry = entries[0] || null;
            }
            if (!selectedEntry) continue;
            const [profileId, credential] = selectedEntry;
            const resolvedValueMeta = resolveOpenclawAuthProfileEditableValue(credential);
            providers[providerKey] = {
                profileId,
                provider: typeof credential.provider === 'string' ? credential.provider : providerKey,
                normalizedProvider: providerKey,
                type: typeof credential.type === 'string' ? credential.type : '',
                displayName: typeof credential.displayName === 'string' ? credential.displayName : '',
                display: buildOpenclawAuthProfileDisplay(profileId, credential),
                email: typeof credential.email === 'string' ? credential.email : '',
                editable: !!resolvedValueMeta.editable,
                resolvedValue: resolvedValueMeta.resolvedValue,
                resolvedField: resolvedValueMeta.resolvedField,
                valueKind: resolvedValueMeta.valueKind
            };
        }

        return {
            authStorePath,
            authStatePath,
            providers
        };
    }

    function sanitizeOpenclawAuthProfilesForClient(providers) {
        const sanitized = {};
        for (const [providerKey, summary] of Object.entries(isPlainObject(providers) ? providers : {})) {
            if (!isPlainObject(summary)) {
                continue;
            }
            const normalized = { ...summary };
            delete normalized.resolvedValue;
            sanitized[providerKey] = normalized;
        }
        return sanitized;
    }

    function normalizeOpenclawAuthProfileUpdate(entry) {
        if (!isPlainObject(entry)) return null;
        const profileId = typeof entry.profileId === 'string' ? entry.profileId.trim() : '';
        const provider = typeof entry.provider === 'string' ? entry.provider.trim() : '';
        const field = typeof entry.field === 'string' ? entry.field.trim() : '';
        const value = typeof entry.value === 'string' ? entry.value.trim() : '';
        const allowedFields = new Set(['key', 'token', 'access']);
        if (!profileId || !provider || !allowedFields.has(field) || !value) {
            return null;
        }
        return { profileId, provider, field, value };
    }

    function applyOpenclawAuthProfileUpdates(params = {}) {
        const updates = Array.isArray(params.updates)
            ? params.updates.map(normalizeOpenclawAuthProfileUpdate).filter(Boolean)
            : [];
        if (!updates.length) {
            return { ok: true, applied: [] };
        }

        const authSummary = readOpenclawAuthProfilesSummary();
        const authStorePath = authSummary.authStorePath;
        const storeResult = readJsonObjectFromFile(authStorePath, { version: 1, profiles: {} });
        if (!storeResult.ok) {
            return { ok: false, error: storeResult.error || '读取 OpenClaw auth profile 失败' };
        }
        const store = isPlainObject(storeResult.data) ? storeResult.data : { version: 1, profiles: {} };
        const profiles = isPlainObject(store.profiles) ? { ...store.profiles } : {};
        const applied = [];

        for (const update of updates) {
            const existing = profiles[update.profileId];
            if (!isPlainObject(existing)) {
                return { ok: false, error: `未找到 OpenClaw 认证配置: ${update.profileId}` };
            }
            const existingProvider = typeof existing.provider === 'string' ? existing.provider.trim() : '';
            if (normalizeOpenclawProviderId(existingProvider) !== normalizeOpenclawProviderId(update.provider)) {
                return { ok: false, error: `认证配置与 provider 不匹配: ${update.profileId}` };
            }

            const next = { ...existing };
            next[update.field] = update.value;
            if (update.field === 'key') {
                next.type = 'api_key';
                delete next.keyRef;
            } else if (update.field === 'token') {
                next.type = 'token';
                delete next.tokenRef;
            } else if (update.field === 'access') {
                next.type = 'oauth';
            }
            profiles[update.profileId] = next;
            applied.push({
                profileId: update.profileId,
                provider: existingProvider || update.provider,
                field: update.field
            });
        }

        try {
            ensureDir(path.dirname(authStorePath));
            const backupPath = fs.existsSync(authStorePath) ? backupFileIfNeededOnce(authStorePath) : '';
            writeJsonAtomic(authStorePath, {
                ...store,
                version: Number(store.version) > 0 ? Number(store.version) : 1,
                profiles
            });
            return {
                ok: true,
                applied,
                authStorePath,
                backupPath
            };
        } catch (e) {
            return {
                ok: false,
                error: e && e.message ? e.message : '写入 OpenClaw auth profile 失败'
            };
        }
    }

    function readOpenclawConfigFile() {
        const filePath = OPENCLAW_CONFIG_FILE;
        const authProfilesByProvider = sanitizeOpenclawAuthProfilesForClient(
            readOpenclawAuthProfilesSummary().providers
        );
        if (!fs.existsSync(filePath)) {
            return {
                exists: false,
                path: filePath,
                content: '',
                lineEnding: os.EOL === '\r\n' ? '\r\n' : '\n',
                authProfilesByProvider
            };
        }

        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            return {
                exists: true,
                path: filePath,
                content: stripUtf8Bom(raw),
                lineEnding: detectLineEnding(raw),
                authProfilesByProvider
            };
        } catch (e) {
            return { error: `读取 OpenClaw 配置失败: ${e.message}` };
        }
    }

    function parseOpenclawConfigText(content) {
        const raw = stripUtf8Bom(typeof content === 'string' ? content : '');
        if (!raw.trim()) {
            return { ok: false, error: 'OpenClaw 配置内容不能为空' };
        }
        try {
            const parsed = JSON5.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return { ok: false, error: '配置格式错误（根节点必须是对象）' };
            }
            return { ok: true, data: parsed };
        } catch (e) {
            return { ok: false, error: `配置解析失败: ${e.message}` };
        }
    }

    function getOpenclawWorkspaceInfo() {
        const readResult = readOpenclawConfigFile();
        let workspaceDir = OPENCLAW_WORKSPACE_DIR;
        let configError = readResult.error || '';
        if (!configError && readResult.exists && readResult.content.trim()) {
            const parsed = parseOpenclawConfigText(readResult.content);
            if (parsed.ok) {
                workspaceDir = resolveOpenclawWorkspaceDir(parsed.data);
            } else {
                configError = parsed.error || '';
            }
        }
        return {
            workspaceDir,
            configError,
            configPath: readResult.path || OPENCLAW_CONFIG_FILE
        };
    }

    function readOpenclawAgentsFile(params = {}) {
        const workspaceInfo = getOpenclawWorkspaceInfo();
        const baseDir = workspaceInfo.workspaceDir;
        const filePath = path.join(baseDir, AGENTS_FILE_NAME);

        if (!fs.existsSync(baseDir)) {
            return {
                exists: false,
                path: filePath,
                content: '',
                lineEnding: os.EOL === '\r\n' ? '\r\n' : '\n',
                workspaceDir: baseDir,
                configError: workspaceInfo.configError,
                baseDirMissing: true
            };
        }

        const readResult = readAgentsFile({ baseDir, metaOnly: !!params.metaOnly });
        return {
            ...readResult,
            workspaceDir: baseDir,
            configError: workspaceInfo.configError
        };
    }

    function applyOpenclawAgentsFile(params = {}) {
        const workspaceInfo = getOpenclawWorkspaceInfo();
        const baseDir = workspaceInfo.workspaceDir;
        ensureDir(baseDir);
        const result = applyAgentsFile({
            ...params,
            baseDir
        });
        return {
            ...result,
            workspaceDir: baseDir,
            configError: workspaceInfo.configError
        };
    }

    function readOpenclawWorkspaceFile(params = {}) {
        const nameResult = normalizeOpenclawWorkspaceFileName(params.fileName);
        if (nameResult.error) {
            return { error: nameResult.error };
        }
        const workspaceInfo = getOpenclawWorkspaceInfo();
        const baseDir = workspaceInfo.workspaceDir;
        const filePath = path.join(baseDir, nameResult.name);

        if (!fs.existsSync(baseDir)) {
            return {
                exists: false,
                path: filePath,
                content: '',
                lineEnding: os.EOL === '\r\n' ? '\r\n' : '\n',
                workspaceDir: baseDir,
                configError: workspaceInfo.configError,
                baseDirMissing: true
            };
        }

        if (!fs.existsSync(filePath)) {
            return {
                exists: false,
                path: filePath,
                content: '',
                lineEnding: os.EOL === '\r\n' ? '\r\n' : '\n',
                workspaceDir: baseDir,
                configError: workspaceInfo.configError
            };
        }

        if (params.metaOnly) {
            return {
                exists: true,
                path: filePath,
                content: '',
                lineEnding: os.EOL === '\r\n' ? '\r\n' : '\n',
                workspaceDir: baseDir,
                configError: workspaceInfo.configError
            };
        }

        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            return {
                exists: true,
                path: filePath,
                content: stripUtf8Bom(raw),
                lineEnding: detectLineEnding(raw),
                workspaceDir: baseDir,
                configError: workspaceInfo.configError
            };
        } catch (e) {
            return { error: `读取 OpenClaw 工作区文件失败: ${e.message}` };
        }
    }

    function applyOpenclawWorkspaceFile(params = {}) {
        const nameResult = normalizeOpenclawWorkspaceFileName(params.fileName);
        if (nameResult.error) {
            return { error: nameResult.error };
        }
        const workspaceInfo = getOpenclawWorkspaceInfo();
        const baseDir = workspaceInfo.workspaceDir;
        ensureDir(baseDir);

        const content = typeof params.content === 'string' ? params.content : '';
        const lineEnding = params.lineEnding === '\r\n' ? '\r\n' : '\n';
        const normalized = normalizeLineEnding(content, lineEnding);
        const finalContent = ensureUtf8Bom(normalized);
        const filePath = path.join(baseDir, nameResult.name);

        try {
            fs.writeFileSync(filePath, finalContent, 'utf-8');
            return {
                success: true,
                path: filePath,
                workspaceDir: baseDir,
                configError: workspaceInfo.configError
            };
        } catch (e) {
            return { error: `写入 OpenClaw 工作区文件失败: ${e.message}` };
        }
    }

    function applyOpenclawConfig(params = {}) {
        const content = typeof params.content === 'string' ? params.content : '';
        const lineEnding = params.lineEnding === '\r\n' ? '\r\n' : '\n';
        const normalized = normalizeLineEnding(content, lineEnding);
        const parsed = parseOpenclawConfigText(normalized);
        if (!parsed.ok) {
            return { success: false, error: parsed.error };
        }

        try {
            const authUpdateResult = applyOpenclawAuthProfileUpdates({ updates: params.authProfileUpdates });
            if (!authUpdateResult.ok) {
                return {
                    success: false,
                    error: authUpdateResult.error || '写入 OpenClaw 认证配置失败'
                };
            }
            ensureDir(OPENCLAW_DIR);
            const backupPath = backupFileIfNeededOnce(OPENCLAW_CONFIG_FILE);
            fs.writeFileSync(OPENCLAW_CONFIG_FILE, normalized, 'utf-8');
            const result = {
                success: true,
                targetPath: OPENCLAW_CONFIG_FILE
            };
            if (backupPath) {
                result.backupPath = backupPath;
            }
            if (authUpdateResult.authStorePath) {
                result.authStorePath = authUpdateResult.authStorePath;
            }
            if (Array.isArray(authUpdateResult.applied) && authUpdateResult.applied.length) {
                result.authProfilesUpdated = authUpdateResult.applied;
            }
            return result;
        } catch (e) {
            return {
                success: false,
                error: e.message || '写入 OpenClaw 配置失败'
            };
        }
    }

    return {
        readOpenclawConfigFile,
        applyOpenclawConfig,
        readOpenclawAgentsFile,
        applyOpenclawAgentsFile,
        readOpenclawWorkspaceFile,
        applyOpenclawWorkspaceFile
    };
}

module.exports = {
    createOpenclawConfigController
};
