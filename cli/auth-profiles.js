function createAuthProfileController(deps = {}) {
    const {
        fs,
        path,
        ensureDir,
        readJsonFile,
        writeJsonAtomic,
        stripUtf8Bom,
        toIsoTime,
        isPlainObject,
        AUTH_PROFILES_DIR,
        AUTH_REGISTRY_FILE,
        AUTH_FILE
    } = deps;

    if (!fs) throw new Error('createAuthProfileController 缺少 fs');
    if (!path) throw new Error('createAuthProfileController 缺少 path');
    if (typeof ensureDir !== 'function') throw new Error('createAuthProfileController 缺少 ensureDir');
    if (typeof readJsonFile !== 'function') throw new Error('createAuthProfileController 缺少 readJsonFile');
    if (typeof writeJsonAtomic !== 'function') throw new Error('createAuthProfileController 缺少 writeJsonAtomic');
    if (typeof stripUtf8Bom !== 'function') throw new Error('createAuthProfileController 缺少 stripUtf8Bom');
    if (typeof toIsoTime !== 'function') throw new Error('createAuthProfileController 缺少 toIsoTime');
    if (typeof isPlainObject !== 'function') throw new Error('createAuthProfileController 缺少 isPlainObject');
    if (!AUTH_PROFILES_DIR) throw new Error('createAuthProfileController 缺少 AUTH_PROFILES_DIR');
    if (!AUTH_REGISTRY_FILE) throw new Error('createAuthProfileController 缺少 AUTH_REGISTRY_FILE');
    if (!AUTH_FILE) throw new Error('createAuthProfileController 缺少 AUTH_FILE');

    function normalizeAuthProfileName(value) {
        const raw = typeof value === 'string' ? value.trim() : '';
        if (!raw) return '';
        return raw.slice(0, 120);
    }

    function sanitizeAuthProfileFileStem(value) {
        const raw = typeof value === 'string' ? value.trim() : '';
        if (!raw) return '';
        return raw
            .replace(/[\\/:*?"<>|]/g, '-')
            .replace(/\s+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 120);
    }

    function normalizeAuthRegistry(raw) {
        const fallback = { version: 1, current: '', items: [] };
        if (!isPlainObject(raw)) return fallback;
        const items = Array.isArray(raw.items)
            ? raw.items.filter(item => isPlainObject(item) && typeof item.name === 'string' && item.name.trim())
            : [];
        return {
            version: 1,
            current: typeof raw.current === 'string' ? raw.current.trim() : '',
            items: items.map((item) => ({
                name: item.name.trim(),
                fileName: typeof item.fileName === 'string' ? path.basename(item.fileName) : '',
                type: typeof item.type === 'string' ? item.type : '',
                email: typeof item.email === 'string' ? item.email : '',
                accountId: typeof item.accountId === 'string' ? item.accountId : '',
                expired: typeof item.expired === 'string' ? item.expired : '',
                lastRefresh: typeof item.lastRefresh === 'string' ? item.lastRefresh : '',
                updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
                importedAt: typeof item.importedAt === 'string' ? item.importedAt : '',
                sourceFile: typeof item.sourceFile === 'string' ? item.sourceFile : ''
            }))
        };
    }

    function ensureAuthProfileStoragePrepared() {
        ensureDir(AUTH_PROFILES_DIR);
    }

    function readAuthRegistry() {
        ensureAuthProfileStoragePrepared();
        const parsed = readJsonFile(AUTH_REGISTRY_FILE, null);
        return normalizeAuthRegistry(parsed);
    }

    function writeAuthRegistry(registry) {
        ensureAuthProfileStoragePrepared();
        writeJsonAtomic(AUTH_REGISTRY_FILE, normalizeAuthRegistry(registry));
    }

    function parseAuthProfileJson(rawContent, label = '') {
        let parsed;
        try {
            parsed = JSON.parse(stripUtf8Bom(String(rawContent || '')));
        } catch (e) {
            throw new Error(`认证文件不是有效 JSON${label ? `: ${label}` : ''}`);
        }
        if (!isPlainObject(parsed)) {
            throw new Error('认证文件根节点必须是对象');
        }
        const hasCredential = ['access_token', 'refresh_token', 'id_token', 'OPENAI_API_KEY']
            .some((key) => typeof parsed[key] === 'string' && parsed[key].trim());
        if (!hasCredential) {
            throw new Error('认证文件缺少可用凭据（access_token / refresh_token / id_token / OPENAI_API_KEY）');
        }
        return parsed;
    }

    function buildAuthProfileSummary(name, payload, fileName = '') {
        const safePayload = isPlainObject(payload) ? payload : {};
        return {
            name,
            fileName: fileName || `${name}.json`,
            type: typeof safePayload.type === 'string' ? safePayload.type : '',
            email: typeof safePayload.email === 'string' ? safePayload.email : '',
            accountId: typeof safePayload.account_id === 'string'
                ? safePayload.account_id
                : (typeof safePayload.accountId === 'string' ? safePayload.accountId : ''),
            expired: typeof safePayload.expired === 'string' ? safePayload.expired : '',
            lastRefresh: typeof safePayload.last_refresh === 'string'
                ? safePayload.last_refresh
                : (typeof safePayload.lastRefresh === 'string' ? safePayload.lastRefresh : ''),
            updatedAt: toIsoTime(Date.now())
        };
    }

    function getAuthProfileNameFallback(payload, fallbackName = '') {
        const fromPayload = isPlainObject(payload)
            ? (payload.email || payload.account_id || payload.accountId || '')
            : '';
        const fromFallback = typeof fallbackName === 'string' ? fallbackName : '';
        const resolved = normalizeAuthProfileName(fromPayload) || normalizeAuthProfileName(fromFallback);
        if (resolved) return resolved;
        return `auth-${Date.now()}`;
    }

    function listAuthProfilesInfo() {
        const registry = readAuthRegistry();
        return registry.items.map((item) => ({
            ...item,
            current: item.name === registry.current
        }));
    }

    function upsertAuthProfile(payload, options = {}) {
        ensureAuthProfileStoragePrepared();
        const safePayload = parseAuthProfileJson(JSON.stringify(payload || {}));
        const sourceFile = typeof options.sourceFile === 'string' ? options.sourceFile : '';
        const preferredName = normalizeAuthProfileName(options.name || '');
        const profileName = preferredName || getAuthProfileNameFallback(safePayload, sourceFile);
        let fileStem = sanitizeAuthProfileFileStem(profileName) || sanitizeAuthProfileFileStem(sourceFile) || `auth-${Date.now()}`;

        const registry = readAuthRegistry();
        const existed = registry.items.find((item) => item && item.name === profileName);
        if (existed && existed.fileName) {
            fileStem = path.basename(existed.fileName, path.extname(existed.fileName));
        }

        let fileName = `${fileStem}.json`;
        let profilePath = path.join(AUTH_PROFILES_DIR, fileName);
        if (!existed && fs.existsSync(profilePath)) {
            fileStem = `${fileStem}-${Date.now().toString(16).slice(-6)}`;
            fileName = `${fileStem}.json`;
            profilePath = path.join(AUTH_PROFILES_DIR, fileName);
        }

        ensureDir(AUTH_PROFILES_DIR);
        writeJsonAtomic(profilePath, safePayload);
        const meta = buildAuthProfileSummary(profileName, safePayload, fileName);
        meta.importedAt = toIsoTime(Date.now());
        meta.sourceFile = sourceFile || '';

        const idx = registry.items.findIndex((item) => item.name === profileName);
        if (idx >= 0) {
            registry.items[idx] = {
                ...registry.items[idx],
                ...meta
            };
        } else {
            registry.items.push(meta);
        }
        registry.items.sort((a, b) => a.name.localeCompare(b.name));

        const shouldActivate = options.activate !== false;
        if (shouldActivate) {
            writeJsonAtomic(AUTH_FILE, safePayload);
            registry.current = profileName;
        }
        writeAuthRegistry(registry);

        return {
            success: true,
            profile: {
                ...meta,
                current: shouldActivate ? true : registry.current === profileName
            }
        };
    }

    function importAuthProfileFromFile(filePath, options = {}) {
        const absPath = path.resolve(String(filePath || ''));
        if (!absPath || !fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
            throw new Error('认证文件不存在');
        }
        const raw = fs.readFileSync(absPath, 'utf-8');
        const payload = parseAuthProfileJson(raw, path.basename(absPath));
        const fallbackName = path.basename(absPath, path.extname(absPath));
        return upsertAuthProfile(payload, {
            ...options,
            sourceFile: absPath,
            name: options.name || fallbackName
        });
    }

    function importAuthProfileFromUpload(payload = {}) {
        const fileBase64 = typeof payload.fileBase64 === 'string' ? payload.fileBase64.trim() : '';
        if (!fileBase64) {
            return { error: '缺少认证文件内容' };
        }
        let buffer;
        try {
            buffer = Buffer.from(fileBase64, 'base64');
        } catch (e) {
            return { error: '认证文件不是有效的 base64 编码' };
        }
        if (!buffer || buffer.length === 0) {
            return { error: '认证文件为空' };
        }
        if (buffer.length > 10 * 1024 * 1024) {
            return { error: '认证文件过大（>10MB）' };
        }

        try {
            const raw = buffer.toString('utf-8');
            const profileData = parseAuthProfileJson(raw, payload.fileName || 'upload.json');
            return upsertAuthProfile(profileData, {
                name: payload.name || path.basename(payload.fileName || '', path.extname(payload.fileName || '')),
                sourceFile: payload.fileName || '',
                activate: payload.activate !== false
            });
        } catch (e) {
            return { error: e.message || '导入认证文件失败' };
        }
    }

    function switchAuthProfile(name, options = {}) {
        ensureAuthProfileStoragePrepared();
        const profileName = normalizeAuthProfileName(name);
        if (!profileName) {
            throw new Error('认证名称不能为空');
        }
        const registry = readAuthRegistry();
        const profile = registry.items.find((item) => item.name === profileName);
        if (!profile) {
            throw new Error(`认证不存在: ${profileName}`);
        }
        const fileName = profile.fileName || `${profileName}.json`;
        const profilePath = path.join(AUTH_PROFILES_DIR, fileName);
        if (!fs.existsSync(profilePath)) {
            throw new Error(`认证文件不存在: ${fileName}`);
        }
        const raw = fs.readFileSync(profilePath, 'utf-8');
        const profileData = parseAuthProfileJson(raw, fileName);
        writeJsonAtomic(AUTH_FILE, profileData);

        registry.current = profileName;
        const idx = registry.items.findIndex((item) => item.name === profileName);
        if (idx >= 0) {
            registry.items[idx] = {
                ...registry.items[idx],
                updatedAt: toIsoTime(Date.now())
            };
        }
        writeAuthRegistry(registry);

        if (!options.silent) {
            console.log(`✓ 已切换认证: ${profileName}`);
            if (profile.email) {
                console.log(`  账号: ${profile.email}`);
            }
            console.log();
        }
        return {
            success: true,
            profile: {
                ...profile,
                current: true
            }
        };
    }

    function deleteAuthProfile(name) {
        ensureAuthProfileStoragePrepared();
        const profileName = normalizeAuthProfileName(name);
        if (!profileName) {
            return { error: '认证名称不能为空' };
        }
        const registry = readAuthRegistry();
        const idx = registry.items.findIndex((item) => item.name === profileName);
        if (idx < 0) {
            return { error: '认证不存在' };
        }
        const profile = registry.items[idx];
        const fileName = profile.fileName || `${profileName}.json`;
        const profilePath = path.join(AUTH_PROFILES_DIR, fileName);

        if (fs.existsSync(profilePath)) {
            try {
                fs.unlinkSync(profilePath);
            } catch (e) {
                return { error: `删除认证文件失败: ${e.message}` };
            }
        }

        registry.items.splice(idx, 1);
        let switchedTo = '';
        if (registry.current === profileName) {
            if (registry.items.length > 0) {
                const next = registry.items[0];
                try {
                    const nextPath = path.join(AUTH_PROFILES_DIR, next.fileName || `${next.name}.json`);
                    const raw = fs.readFileSync(nextPath, 'utf-8');
                    const nextData = parseAuthProfileJson(raw, next.fileName || `${next.name}.json`);
                    writeJsonAtomic(AUTH_FILE, nextData);
                    registry.current = next.name;
                    switchedTo = next.name;
                } catch (e) {
                    registry.current = '';
                }
            } else {
                registry.current = '';
            }
        }
        writeAuthRegistry(registry);
        return {
            success: true,
            switchedTo
        };
    }

    function resolveAuthTokenFromCurrentProfile() {
        ensureAuthProfileStoragePrepared();
        const registry = readAuthRegistry();
        if (!registry.current) return '';
        const profile = registry.items.find((item) => item.name === registry.current);
        if (!profile) return '';
        const filePath = path.join(AUTH_PROFILES_DIR, profile.fileName || `${profile.name}.json`);
        if (!fs.existsSync(filePath)) return '';
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const payload = parseAuthProfileJson(raw, profile.fileName || `${profile.name}.json`);
            if (typeof payload.access_token === 'string' && payload.access_token.trim()) {
                return payload.access_token.trim();
            }
            if (typeof payload.OPENAI_API_KEY === 'string' && payload.OPENAI_API_KEY.trim()) {
                return payload.OPENAI_API_KEY.trim();
            }
        } catch (e) {}
        return '';
    }

    return {
        normalizeAuthProfileName,
        normalizeAuthRegistry,
        ensureAuthProfileStoragePrepared,
        readAuthRegistry,
        writeAuthRegistry,
        parseAuthProfileJson,
        buildAuthProfileSummary,
        getAuthProfileNameFallback,
        listAuthProfilesInfo,
        upsertAuthProfile,
        importAuthProfileFromFile,
        importAuthProfileFromUpload,
        switchAuthProfile,
        deleteAuthProfile,
        resolveAuthTokenFromCurrentProfile
    };
}

module.exports = {
    createAuthProfileController
};
