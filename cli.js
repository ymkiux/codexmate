#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const toml = require('@iarna/toml');
const JSON5 = require('json5');
const zipLib = require('zip-lib');
const { exec, execSync, spawn, spawnSync } = require('child_process');
const http = require('http');
const https = require('https');
const net = require('net');
const readline = require('readline');
const {
    expandHomePath,
    resolveExistingDir,
    resolveHomePath,
    hasUtf8Bom,
    stripUtf8Bom,
    ensureUtf8Bom,
    detectLineEnding,
    normalizeLineEnding,
    isValidProviderName,
    escapeTomlBasicString,
    buildModelProviderTableHeader,
    buildModelsCandidates,
    isValidHttpUrl,
    normalizeBaseUrl,
    joinApiUrl
} = require('./lib/cli-utils');
const {
    ensureDir,
    readJsonFile,
    readJsonArrayFile,
    readJsonObjectFromFile,
    backupFileIfNeededOnce,
    writeJsonAtomic,
    formatTimestampForFileName
} = require('./lib/cli-file-utils');
const {
    extractModelNames,
    hasModelsListPayload,
    extractModelIds,
    buildModelsProbeUrl,
    buildModelProbeSpec,
    buildModelsCacheKey
} = require('./lib/cli-models-utils');
const { probeUrl, probeJsonPost } = require('./lib/cli-network-utils');
const {
    toIsoTime,
    updateLatestIso,
    truncateText,
    extractMessageText,
    normalizeRole,
    parseMaxMessagesValue,
    resolveMaxMessagesValue
} = require('./lib/cli-session-utils');
const { createMcpStdioServer } = require('./lib/mcp-stdio');
const {
    validateWorkflowDefinition,
    executeWorkflowDefinition
} = require('./lib/workflow-engine');

const DEFAULT_WEB_PORT = 3737;
const DEFAULT_WEB_HOST = '127.0.0.1';

// ============================================================================
// 配置
// ============================================================================
const CONFIG_DIR = path.join(os.homedir(), '.codex');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.toml');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');
const AUTH_PROFILES_DIR = path.join(CONFIG_DIR, 'auth-profiles');
const AUTH_REGISTRY_FILE = path.join(AUTH_PROFILES_DIR, 'registry.json');
const MODELS_FILE = path.join(CONFIG_DIR, 'models.json');
const CURRENT_MODELS_FILE = path.join(CONFIG_DIR, 'provider-current-models.json');
const INIT_MARK_FILE = path.join(CONFIG_DIR, 'codexmate-init.json');
const BUILTIN_PROXY_SETTINGS_FILE = path.join(CONFIG_DIR, 'codexmate-proxy.json');
const CODEX_SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const OPENCLAW_CONFIG_FILE = path.join(OPENCLAW_DIR, 'openclaw.json');
const OPENCLAW_WORKSPACE_DIR = path.join(OPENCLAW_DIR, 'workspace');
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const RECENT_CONFIGS_FILE = path.join(CONFIG_DIR, 'recent-configs.json');
const WORKFLOW_DEFINITIONS_FILE = path.join(CONFIG_DIR, 'codexmate-workflows.json');
const WORKFLOW_RUNS_FILE = path.join(CONFIG_DIR, 'codexmate-workflow-runs.jsonl');
const DEFAULT_CLAUDE_MODEL = 'glm-4.7';
const CODEX_BACKUP_NAME = 'codex-config';

const DEFAULT_MODELS = ['gpt-5.3-codex', 'gpt-5.1-codex-max', 'gpt-4-turbo', 'gpt-4'];
const SPEED_TEST_TIMEOUT_MS = 8000;
const HEALTH_CHECK_TIMEOUT_MS = 6000;
const MAX_SESSION_LIST_SIZE = 300;
const MAX_EXPORT_MESSAGES = 1000;
const DEFAULT_SESSION_DETAIL_MESSAGES = 300;
const MAX_SESSION_DETAIL_MESSAGES = 1000;
const SESSION_TITLE_READ_BYTES = 64 * 1024;
const CODEXMATE_MANAGED_MARKER = '# codexmate-managed: true';
const SESSION_LIST_CACHE_TTL_MS = 4000;
const SESSION_SUMMARY_READ_BYTES = 256 * 1024;
const SESSION_CONTENT_READ_BYTES = SESSION_SUMMARY_READ_BYTES;
const DEFAULT_CONTENT_SCAN_LIMIT = 50;
const SESSION_SCAN_FACTOR = 4;
const SESSION_SCAN_MIN_FILES = 800;
const MAX_SESSION_PATH_LIST_SIZE = 2000;
const AGENTS_FILE_NAME = 'AGENTS.md';
const MODELS_CACHE_TTL_MS = 60 * 1000;
const MODELS_NEGATIVE_CACHE_TTL_MS = 5 * 1000;
const MODELS_CACHE_MAX_ENTRIES = 50;
const MODELS_RESPONSE_MAX_BYTES = 1024 * 1024;
const MAX_RECENT_CONFIGS = 3;
const MAX_UPLOAD_SIZE = 200 * 1024 * 1024;
const BUILTIN_PROXY_PROVIDER_NAME = 'codexmate-proxy';
const DEFAULT_BUILTIN_PROXY_SETTINGS = Object.freeze({
    enabled: false,
    host: '127.0.0.1',
    port: 8318,
    provider: '',
    authSource: 'provider',
    timeoutMs: 30000
});
const BOOTSTRAP_TEXT_MARKERS = [
    'agents.md instructions',
    '<instructions>',
    '<environment_context>',
    'you are a coding agent',
    'codex cli'
];
const CLI_INSTALL_TARGETS = Object.freeze([
    {
        id: 'claude',
        name: 'Claude Code CLI',
        packageName: '@anthropic-ai/claude-code',
        bins: ['claude']
    },
    {
        id: 'codex',
        name: 'Codex CLI',
        packageName: '@openai/codex',
        bins: ['codex']
    }
]);

const HTTP_KEEP_ALIVE_AGENT = new http.Agent({ keepAlive: true });
const HTTPS_KEEP_ALIVE_AGENT = new https.Agent({ keepAlive: true });

function resolveWebPort() {
    const raw = process.env.CODEXMATE_PORT;
    if (!raw) return DEFAULT_WEB_PORT;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WEB_PORT;
    return parsed;
}

function resolveWebHost(options = {}) {
    const optionHost = typeof options.host === 'string' ? options.host.trim() : '';
    if (optionHost) {
        return optionHost;
    }
    const envHost = typeof process.env.CODEXMATE_HOST === 'string' ? process.env.CODEXMATE_HOST.trim() : '';
    if (envHost) {
        return envHost;
    }
    return DEFAULT_WEB_HOST;
}

const EMPTY_CONFIG_FALLBACK_TEMPLATE = `model = "gpt-5.3-codex"
model_reasoning_effort = "high"
disable_response_storage = true
approval_policy = "never"
sandbox_mode = "danger-full-access"
model_provider = "maxx"
personality = "pragmatic"
web_search = "live"

[model_providers.maxx]
name = "maxx"
base_url = "https://maxx-direct.cloverstd.com"
wire_api = "responses"
requires_openai_auth = false
preferred_auth_method = "sk-"
request_max_retries = 4
stream_max_retries = 10
stream_idle_timeout_ms = 300000
`;

let g_initNotice = '';
let g_sessionListCache = new Map();
let g_modelsCache = new Map();
let g_modelsInFlight = new Map();
let g_builtinProxyRuntime = null;
const DEFAULT_LOCAL_PROVIDER_NAME = 'local';

function isBuiltinProxyProvider(providerName) {
    return typeof providerName === 'string' && providerName.trim() === BUILTIN_PROXY_PROVIDER_NAME;
}

function isReservedProviderNameForCreation(providerName) {
    return typeof providerName === 'string'
        && providerName.trim().toLowerCase() === DEFAULT_LOCAL_PROVIDER_NAME;
}

function isDefaultLocalProvider(providerName) {
    return typeof providerName === 'string' && providerName.trim() === DEFAULT_LOCAL_PROVIDER_NAME;
}

function isNonDeletableProvider(providerName) {
    return isBuiltinProxyProvider(providerName) || isDefaultLocalProvider(providerName);
}

function isNonEditableProvider(providerName) {
    return isBuiltinProxyProvider(providerName) || isDefaultLocalProvider(providerName);
}

// ============================================================================
// 工具函数
// ============================================================================
function ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

function readConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        throw new Error(`配置文件不存在: ${CONFIG_FILE}`);
    }
    try {
        const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = toml.parse(content);
        if (isPlainObject(parsed) && isPlainObject(parsed.model_providers)) {
            parsed.model_providers = normalizeLegacyModelProviders(parsed.model_providers);
        }
        return parsed;
    } catch (e) {
        throw new Error(`配置文件解析失败: ${e.message}`);
    }
}

function writeConfig(content) {
    try {
        fs.writeFileSync(CONFIG_FILE, content, 'utf-8');
    } catch (e) {
        throw new Error(`写入配置失败: ${e.message}`);
    }
}

function readModels() {
    if (fs.existsSync(MODELS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(MODELS_FILE, 'utf-8'));
        } catch (e) {}
    }
    return [...DEFAULT_MODELS];
}

function writeModels(models) {
    fs.writeFileSync(MODELS_FILE, JSON.stringify(models, null, 2), 'utf-8');
}

function readCurrentModels() {
    if (fs.existsSync(CURRENT_MODELS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CURRENT_MODELS_FILE, 'utf-8'));
        } catch (e) {}
    }
    return {};
}

function writeCurrentModels(data) {
    fs.writeFileSync(CURRENT_MODELS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function updateAuthJson(apiKey) {
    let authData = {};
    if (fs.existsSync(AUTH_FILE)) {
        try {
            const content = fs.readFileSync(AUTH_FILE, 'utf-8');
            if (content.trim()) authData = JSON.parse(content);
        } catch (e) {}
    }
    authData['OPENAI_API_KEY'] = apiKey;
    fs.writeFileSync(AUTH_FILE, JSON.stringify(authData, null, 2), 'utf-8');
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

const PROVIDER_CONFIG_KEYS = new Set([
    'name',
    'base_url',
    'wire_api',
    'requires_openai_auth',
    'preferred_auth_method',
    'request_max_retries',
    'stream_max_retries',
    'stream_idle_timeout_ms'
]);

function looksLikeProviderConfig(value) {
    if (!isPlainObject(value)) return false;
    return Object.keys(value).some((key) => PROVIDER_CONFIG_KEYS.has(key));
}

function isRecoverableNestedProviderConfig(value) {
    if (!isPlainObject(value)) return false;
    const hasBaseUrl = typeof value.base_url === 'string' && value.base_url.trim() !== '';
    if (!hasBaseUrl) return false;
    const hasProviderSignals = [
        'wire_api',
        'requires_openai_auth',
        'preferred_auth_method',
        'request_max_retries',
        'stream_max_retries',
        'stream_idle_timeout_ms'
    ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
    return hasProviderSignals;
}

function collectNestedProviderConfigs(node, pathSegments, collector) {
    if (!isPlainObject(node)) return;
    const segments = Array.isArray(pathSegments) ? pathSegments : [String(pathSegments || '')];
    const lastSegment = segments.length > 0 ? segments[segments.length - 1] : '';
    if (lastSegment === 'metadata') {
        return;
    }
    if (isRecoverableNestedProviderConfig(node)) {
        collector.push({
            name: segments.join('.'),
            segments: segments.slice(),
            provider: node
        });
        return;
    }
    for (const [childKey, childValue] of Object.entries(node)) {
        if (!isPlainObject(childValue)) continue;
        collectNestedProviderConfigs(childValue, [...segments, childKey], collector);
    }
}

function setLegacySegmentsMetadata(provider, segments) {
    if (!isPlainObject(provider) || !Array.isArray(segments) || segments.length === 0) return;
    try {
        Object.defineProperty(provider, '__codexmate_legacy_segments', {
            value: segments.map((item) => String(item)),
            enumerable: false,
            configurable: true,
            writable: true
        });
    } catch (e) {}
}

function normalizeLegacyModelProviders(modelProviders) {
    if (!isPlainObject(modelProviders)) {
        return modelProviders;
    }

    let changed = false;
    const normalized = {};
    const addRecovered = (entry) => {
        const name = entry && typeof entry.name === 'string' ? entry.name : '';
        const segments = entry && Array.isArray(entry.segments) ? entry.segments.slice() : null;
        const provider = entry ? entry.provider : null;
        if (!name || !isPlainObject(provider)) return;
        if (Object.prototype.hasOwnProperty.call(modelProviders, name)) return;
        if (Object.prototype.hasOwnProperty.call(normalized, name)) return;
        setLegacySegmentsMetadata(provider, segments);
        normalized[name] = provider;
        changed = true;
    };

    for (const [name, provider] of Object.entries(modelProviders)) {
        normalized[name] = provider;
        if (!isPlainObject(provider)) continue;

        if (looksLikeProviderConfig(provider)) {
            setLegacySegmentsMetadata(provider, [name]);
            for (const [childKey, childValue] of Object.entries(provider)) {
                if (!isPlainObject(childValue)) continue;
                const recovered = [];
                collectNestedProviderConfigs(childValue, [name, childKey], recovered);
                for (const recoveredEntry of recovered) {
                    addRecovered(recoveredEntry);
                }
            }
            continue;
        }

        const recovered = [];
        collectNestedProviderConfigs(provider, [name], recovered);
        if (recovered.length > 0) {
            delete normalized[name];
            changed = true;
            for (const recoveredEntry of recovered) {
                addRecovered(recoveredEntry);
            }
        }
    }

    return changed ? normalized : modelProviders;
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function areStringArraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (String(a[i]) !== String(b[i])) return false;
    }
    return true;
}

function parseTomlDottedKeyExpression(expression) {
    const text = String(expression || '');
    let index = 0;
    const segments = [];
    const skipWhitespace = () => {
        while (index < text.length && /\s/.test(text[index])) index++;
    };

    while (index < text.length) {
        skipWhitespace();
        if (index >= text.length) break;

        const ch = text[index];
        if (ch === "'") {
            const end = text.indexOf("'", index + 1);
            if (end === -1) return null;
            segments.push(text.slice(index + 1, end));
            index = end + 1;
        } else if (ch === '"') {
            index += 1;
            let value = '';
            let closed = false;
            while (index < text.length) {
                const cur = text[index];
                if (cur === '"') {
                    index += 1;
                    closed = true;
                    break;
                }
                if (cur !== '\\') {
                    value += cur;
                    index += 1;
                    continue;
                }
                if (index + 1 >= text.length) return null;
                const esc = text[index + 1];
                if (esc === 'u' || esc === 'U') {
                    const hexLen = esc === 'u' ? 4 : 8;
                    const hex = text.slice(index + 2, index + 2 + hexLen);
                    if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
                    try {
                        value += String.fromCodePoint(parseInt(hex, 16));
                    } catch (e) {
                        return null;
                    }
                    index += 2 + hexLen;
                    continue;
                }
                const unescaped = {
                    b: '\b',
                    t: '\t',
                    n: '\n',
                    f: '\f',
                    r: '\r',
                    '"': '"',
                    '\\': '\\'
                }[esc];
                if (unescaped === undefined) return null;
                value += unescaped;
                index += 2;
            }
            if (!closed) return null;
            segments.push(value);
        } else {
            const start = index;
            while (index < text.length && !/\s|\./.test(text[index])) index++;
            const bare = text.slice(start, index);
            if (!bare) return null;
            segments.push(bare);
        }

        skipWhitespace();
        if (index >= text.length) break;
        if (text[index] !== '.') return null;
        index += 1;
    }

    return segments.length > 0 ? segments : null;
}

function findProviderSectionRanges(content, providerName, exactSegments = null) {
    const text = typeof content === 'string' ? content : '';
    const name = typeof providerName === 'string' ? providerName.trim() : '';
    const targetSegments = Array.isArray(exactSegments) ? exactSegments.map((item) => String(item)) : null;
    if (!text || !name) return [];

    const safeName = escapeRegex(name);
    const headerPatterns = [
        { priority: 0, regex: new RegExp(`^\\s*model_providers\\s*\\.\\s*"${safeName}"\\s*$`) },
        { priority: 1, regex: new RegExp(`^\\s*model_providers\\s*\\.\\s*'${safeName}'\\s*$`) },
        { priority: 2, regex: new RegExp(`^\\s*model_providers\\s*\\.\\s*${safeName}\\s*$`) }
    ];

    const allHeaders = [];
    const targetPriorityByStart = new Map();
    const sectionLineRegex = /^[ \t]*\[(?!\[)([^\]\n]+)\][ \t]*(?:#.*)?$/gm;
    let match;
    while ((match = sectionLineRegex.exec(text)) !== null) {
        const start = match.index;
        allHeaders.push(start);
        const headerExpr = String(match[1] || '').trim();

        const parsedSegments = parseTomlDottedKeyExpression(headerExpr);
        if (Array.isArray(parsedSegments) && parsedSegments.length >= 2 && parsedSegments[0] === 'model_providers') {
            const providerSegments = parsedSegments.slice(1);
            if (targetSegments && targetSegments.length > 0 && areStringArraysEqual(providerSegments, targetSegments)) {
                const prev = targetPriorityByStart.get(start);
                if (prev === undefined || -3 < prev) {
                    targetPriorityByStart.set(start, -3);
                }
                continue;
            }
            if (!targetSegments || targetSegments.length === 0) {
                const parsedName = providerSegments.join('.');
                if (parsedName === name) {
                    const prev = targetPriorityByStart.get(start);
                    if (prev === undefined || -2 < prev) {
                        targetPriorityByStart.set(start, -2);
                    }
                    continue;
                }
            }
        }

        for (const pattern of headerPatterns) {
            if (pattern.regex.test(headerExpr)) {
                const prev = targetPriorityByStart.get(start);
                if (prev === undefined || pattern.priority < prev) {
                    targetPriorityByStart.set(start, pattern.priority);
                }
                break;
            }
        }
    }

    if (targetPriorityByStart.size === 0) {
        return [];
    }

    const ranges = [];
    for (let i = 0; i < allHeaders.length; i++) {
        const start = allHeaders[i];
        if (!targetPriorityByStart.has(start)) continue;
        const end = i + 1 < allHeaders.length ? allHeaders[i + 1] : text.length;
        ranges.push({
            start,
            end,
            priority: targetPriorityByStart.get(start)
        });
    }
    return ranges;
}

function normalizeAuthProfileName(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    const sanitized = raw
        .replace(/[\\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
    return sanitized;
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
            name: normalizeAuthProfileName(item.name) || item.name.trim(),
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

function readAuthRegistry() {
    const parsed = readJsonFile(AUTH_REGISTRY_FILE, null);
    return normalizeAuthRegistry(parsed);
}

function writeAuthRegistry(registry) {
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
    const safePayload = parseAuthProfileJson(JSON.stringify(payload || {}));
    const sourceFile = typeof options.sourceFile === 'string' ? options.sourceFile : '';
    const preferredName = normalizeAuthProfileName(options.name || '');
    const profileName = preferredName || getAuthProfileNameFallback(safePayload, sourceFile);
    const fileName = `${profileName}.json`;
    const profilePath = path.join(AUTH_PROFILES_DIR, fileName);

    ensureDir(AUTH_PROFILES_DIR);
    writeJsonAtomic(profilePath, safePayload);

    const registry = readAuthRegistry();
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

function getCodexSessionsDir() {
    const candidates = [];
    const envCodexHome = process.env.CODEX_HOME;
    if (envCodexHome) {
        candidates.push(path.join(envCodexHome, 'sessions'));
    }
    const xdgConfig = process.env.XDG_CONFIG_HOME;
    if (xdgConfig) {
        candidates.push(path.join(xdgConfig, 'codex', 'sessions'));
    }
    candidates.push(path.join(os.homedir(), '.config', 'codex', 'sessions'));
    candidates.push(CODEX_SESSIONS_DIR);
    return resolveExistingDir(candidates, CODEX_SESSIONS_DIR);
}

function getClaudeProjectsDir() {
    const candidates = [];
    const envClaudeHome = process.env.CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR;
    if (envClaudeHome) {
        candidates.push(path.join(envClaudeHome, 'projects'));
    }
    const xdgConfig = process.env.XDG_CONFIG_HOME;
    if (xdgConfig) {
        candidates.push(path.join(xdgConfig, 'claude', 'projects'));
    }
    candidates.push(path.join(os.homedir(), '.config', 'claude', 'projects'));
    candidates.push(CLAUDE_PROJECTS_DIR);
    return resolveExistingDir(candidates, CLAUDE_PROJECTS_DIR);
}

function readModelsCacheEntry(cacheKey) {
    if (!cacheKey) return null;
    const entry = g_modelsCache.get(cacheKey);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
        g_modelsCache.delete(cacheKey);
        return null;
    }
    g_modelsCache.delete(cacheKey);
    g_modelsCache.set(cacheKey, entry);
    return entry.result || null;
}

function writeModelsCacheEntry(cacheKey, result) {
    if (!cacheKey) return;
    const isNegative = !!(result && (result.error || result.unlimited));
    const ttl = isNegative ? MODELS_NEGATIVE_CACHE_TTL_MS : MODELS_CACHE_TTL_MS;
    const entry = {
        result,
        expiresAt: Date.now() + ttl
    };
    if (g_modelsCache.has(cacheKey)) {
        g_modelsCache.delete(cacheKey);
    }
    g_modelsCache.set(cacheKey, entry);
    while (g_modelsCache.size > MODELS_CACHE_MAX_ENTRIES) {
        const oldestKey = g_modelsCache.keys().next().value;
        g_modelsCache.delete(oldestKey);
    }
}

async function fetchModelsFromBaseUrl(baseUrl, apiKey) {
    const cacheKey = buildModelsCacheKey(baseUrl, apiKey);
    const cached = readModelsCacheEntry(cacheKey);
    if (cached) return cached;

    const inFlight = g_modelsInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const promise = (async () => {
        const result = await fetchModelsFromBaseUrlCore(baseUrl, apiKey);
        writeModelsCacheEntry(cacheKey, result);
        return result;
    })();

    g_modelsInFlight.set(cacheKey, promise);
    promise.finally(() => {
        g_modelsInFlight.delete(cacheKey);
    });
    return promise;
}

async function fetchModelsFromBaseUrlCore(baseUrl, apiKey) {
    const candidates = buildModelsCandidates(baseUrl);
    if (candidates.length === 0) return { error: 'Provider missing URL' };

    let lastError = '';
    for (const modelsUrl of candidates) {
        let parsed;
        try {
            parsed = new URL(modelsUrl);
        } catch (e) {
            lastError = 'Invalid URL';
            continue;
        }

        const transport = parsed.protocol === 'https:' ? https : http;
        const agent = parsed.protocol === 'https:' ? HTTPS_KEEP_ALIVE_AGENT : HTTP_KEEP_ALIVE_AGENT;
        const headers = {
            'User-Agent': 'codexmate-models',
            'Accept': 'application/json'
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
            headers['x-api-key'] = apiKey;
        }

        const result = await new Promise((innerResolve) => {
            let settled = false;
            const finish = (payload) => {
                if (settled) return;
                settled = true;
                innerResolve(payload);
            };
            const req = transport.request(parsed, { method: 'GET', headers, agent }, (res) => {
                const status = res.statusCode || 0;
                const contentType = String(res.headers['content-type'] || '').toLowerCase();
                if (status === 404 || status === 405 || status === 501) {
                    res.resume();
                    return finish({ unavailable: true });
                }
                let body = '';
                let receivedBytes = 0;
                res.on('data', chunk => {
                    receivedBytes += chunk.length || 0;
                    if (receivedBytes > MODELS_RESPONSE_MAX_BYTES) {
                        res.destroy();
                        return finish({ unavailable: true });
                    }
                    body += chunk;
                });
                res.on('end', () => {
                    if (settled) return;
                    if (status >= 400) {
                        return finish({ error: `Request failed: ${status}` });
                    }
                    if (contentType && !contentType.includes('application/json')) {
                        return finish({ unavailable: true });
                    }
                    try {
                        const payload = JSON.parse(body || '{}');
                        if (!hasModelsListPayload(payload)) {
                            return finish({ unavailable: true });
                        }
                        const models = extractModelNames(payload);
                        return finish({ models });
                    } catch (e) {
                        return finish({ unavailable: true });
                    }
                });
            });

            req.setTimeout(SPEED_TEST_TIMEOUT_MS, () => {
                req.destroy(new Error('timeout'));
            });
            req.on('error', (err) => {
                finish({ error: err.message || 'Request failed' });
            });
            req.end();
        });

        if (result && Array.isArray(result.models)) {
            return { models: result.models };
        }
        if (result && result.error) {
            lastError = result.error;
            continue;
        }
    }

    if (lastError) {
        return { error: lastError };
    }
    return { unlimited: true };
}

async function fetchProviderModels(providerName, overrides = {}) {
    const { config } = readConfigOrVirtualDefault();
    const targetProvider = providerName || config.model_provider || '';
    if (!targetProvider) return { error: '未设置当前提供商' };

    const providers = config.model_providers || {};
    const provider = providers[targetProvider];
    if (!provider) return { error: `提供商不存在: ${targetProvider}` };

    const baseUrl = overrides.baseUrl || provider.base_url || '';
    const apiKey = overrides.apiKey ?? provider.preferred_auth_method ?? '';
    const res = await fetchModelsFromBaseUrl(baseUrl, apiKey);
    if (res.unlimited) return { models: [], provider: targetProvider, unlimited: true };
    if (res.error) return { error: res.error };
    return { models: res.models || [], provider: targetProvider, unlimited: false };
}

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

function readOpenclawConfigFile() {
    const filePath = OPENCLAW_CONFIG_FILE;
    if (!fs.existsSync(filePath)) {
        return {
            exists: false,
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

function readOpenclawAgentsFile() {
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

    const readResult = readAgentsFile({ baseDir });
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
        return result;
    } catch (e) {
        return {
            success: false,
            error: e.message || '写入 OpenClaw 配置失败'
        };
    }
}

function normalizeRecentConfigs(items) {
    if (!Array.isArray(items)) return [];
    const output = [];
    const seen = new Set();
    for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const provider = typeof item.provider === 'string' ? item.provider.trim() : '';
        const model = typeof item.model === 'string' ? item.model.trim() : '';
        if (!provider || !model) continue;
        const key = `${provider}::${model}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push({
            provider,
            model,
            usedAt: typeof item.usedAt === 'string' ? item.usedAt : ''
        });
    }
    return output;
}

function readRecentConfigs() {
    return normalizeRecentConfigs(readJsonArrayFile(RECENT_CONFIGS_FILE, []));
}

function writeRecentConfigs(items) {
    writeJsonAtomic(RECENT_CONFIGS_FILE, items);
}

function recordRecentConfig(provider, model) {
    const providerName = typeof provider === 'string' ? provider.trim() : '';
    const modelName = typeof model === 'string' ? model.trim() : '';
    if (!providerName || !modelName) return;

    const now = new Date().toISOString();
    const current = readRecentConfigs();
    const next = [{
        provider: providerName,
        model: modelName,
        usedAt: now
    }];

    for (const item of current) {
        if (item.provider === providerName && item.model === modelName) continue;
        next.push(item);
    }

    const trimmed = next.slice(0, MAX_RECENT_CONFIGS);
    writeRecentConfigs(trimmed);
}

async function runRemoteHealthCheck(provider, modelName, options = {}) {
    const issues = [];
    const results = {};
    const baseUrl = normalizeBaseUrl(provider && provider.base_url ? provider.base_url : '');
    if (!baseUrl) {
        issues.push({
            code: 'remote-skip-base-url',
            message: '无法进行远程探测：base_url 为空',
            suggestion: '补全 base_url 或关闭远程探测'
        });
        return { issues, results };
    }

    const requiresAuth = provider && provider.requires_openai_auth !== false;
    const apiKey = typeof provider.preferred_auth_method === 'string'
        ? provider.preferred_auth_method.trim()
        : '';
    const authValue = requiresAuth ? apiKey : (apiKey || '');
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : HEALTH_CHECK_TIMEOUT_MS;

    const baseProbe = await probeUrl(baseUrl, { apiKey: authValue, timeoutMs });
    results.base = {
        url: baseUrl,
        status: baseProbe.status || 0,
        ok: baseProbe.ok,
        durationMs: baseProbe.durationMs || 0
    };

    if (!baseProbe.ok) {
        issues.push({
            code: 'remote-unreachable',
            message: `远程探测失败：${baseProbe.error || '无法连接'}`,
            suggestion: '检查网络与 base_url 可达性'
        });
        return { issues, results };
    }

    if (baseProbe.status === 401 || baseProbe.status === 403) {
        issues.push({
            code: 'remote-auth-failed',
            message: '远程探测鉴权失败（401/403）',
            suggestion: '检查 API Key 或认证方式'
        });
    } else if (baseProbe.status >= 400) {
        issues.push({
            code: 'remote-http-error',
            message: `远程探测返回异常状态: ${baseProbe.status}`,
            suggestion: '检查 base_url 是否正确'
        });
    }

    const modelsUrl = buildModelsProbeUrl(baseUrl);
    if (modelsUrl) {
        const modelsProbe = await probeUrl(modelsUrl, { apiKey: authValue, timeoutMs, maxBytes: 256 * 1024 });
        results.models = {
            url: modelsUrl,
            status: modelsProbe.status || 0,
            ok: modelsProbe.ok,
            durationMs: modelsProbe.durationMs || 0
        };

        if (!modelsProbe.ok) {
            issues.push({
                code: 'remote-models-unreachable',
                message: `模型列表探测失败：${modelsProbe.error || '无法连接'}`,
                suggestion: '检查 base_url 是否包含 /v1 或关闭远程探测'
            });
        } else if (modelsProbe.status === 401 || modelsProbe.status === 403) {
            issues.push({
                code: 'remote-models-auth-failed',
                message: '模型列表鉴权失败（401/403）',
                suggestion: '检查 API Key 或认证方式'
            });
        } else if (modelsProbe.status >= 400) {
            issues.push({
                code: 'remote-models-http-error',
                message: `模型列表返回异常状态: ${modelsProbe.status}`,
                suggestion: '确认 /v1/models 可用'
            });
        } else {
            let payload = null;
            try {
                payload = modelsProbe.body ? JSON.parse(modelsProbe.body) : null;
            } catch (e) {
                issues.push({
                    code: 'remote-models-parse',
                    message: '模型列表解析失败（非 JSON）',
                    suggestion: '确认 /v1/models 返回 JSON'
                });
            }

            if (payload) {
                const ids = extractModelIds(payload);
                if (ids.length === 0) {
                    issues.push({
                        code: 'remote-models-empty',
                        message: '模型列表为空或结构无法识别',
                        suggestion: '确认 provider 是否兼容 /v1/models'
                    });
                } else if (modelName && !ids.includes(modelName)) {
                    issues.push({
                        code: 'remote-model-unavailable',
                        message: `远程模型列表中未找到: ${modelName}`,
                        suggestion: '切换模型或确认模型名称'
                    });
                }
            }
        }
    }

    const modelProbeSpec = buildModelProbeSpec(provider, modelName, baseUrl);
    if (modelProbeSpec && modelProbeSpec.url) {
        const modelProbe = await probeJsonPost(modelProbeSpec.url, modelProbeSpec.body, {
            apiKey: authValue,
            timeoutMs,
            maxBytes: 256 * 1024
        });

        results.modelProbe = {
            url: modelProbeSpec.url,
            status: modelProbe.status || 0,
            ok: modelProbe.ok,
            durationMs: modelProbe.durationMs || 0
        };

        if (!modelProbe.ok) {
            issues.push({
                code: 'remote-model-probe-unreachable',
                message: `模型可用性探测失败：${modelProbe.error || '无法连接'}`,
                suggestion: '检查网络或模型接口是否可用'
            });
        } else if (modelProbe.status === 401 || modelProbe.status === 403) {
            issues.push({
                code: 'remote-model-probe-auth-failed',
                message: '模型可用性探测鉴权失败（401/403）',
                suggestion: '检查 API Key 或认证方式'
            });
        } else if (modelProbe.status >= 400) {
            issues.push({
                code: 'remote-model-probe-http-error',
                message: `模型可用性探测返回异常状态: ${modelProbe.status}`,
                suggestion: '检查模型或接口路径'
            });
        } else {
            let payload = null;
            try {
                payload = modelProbe.body ? JSON.parse(modelProbe.body) : null;
            } catch (e) {
                issues.push({
                    code: 'remote-model-probe-parse',
                    message: '模型可用性探测解析失败（非 JSON）',
                    suggestion: '确认模型接口返回 JSON'
                });
            }
            if (payload && payload.error) {
                const message = typeof payload.error.message === 'string'
                    ? payload.error.message
                    : '模型接口返回错误';
                issues.push({
                    code: 'remote-model-probe-error',
                    message: `模型可用性探测失败：${message}`,
                    suggestion: '检查模型名与权限'
                });
            }
        }
    }

    return { issues, results };
}

async function buildConfigHealthReport(params = {}) {
    const issues = [];
    const status = readConfigOrVirtualDefault();
    const config = status.config || {};

    if (status.isVirtual) {
        issues.push({
            code: 'config-missing',
            message: status.reason || '未检测到 config.toml',
            suggestion: '在模板编辑器中确认应用配置，生成可用的 config.toml'
        });
    }

    const providerName = typeof config.model_provider === 'string' ? config.model_provider.trim() : '';
    const modelName = typeof config.model === 'string' ? config.model.trim() : '';
    if (!providerName) {
        issues.push({
            code: 'provider-missing',
            message: '当前 provider 未设置',
            suggestion: '在模板中设置 model_provider'
        });
    }

    if (!modelName) {
        issues.push({
            code: 'model-missing',
            message: '当前模型未设置',
            suggestion: '在模板中设置 model'
        });
    }

    const providers = config.model_providers && typeof config.model_providers === 'object'
        ? config.model_providers
        : {};
    const provider = providerName ? providers[providerName] : null;
    if (providerName && !provider) {
        issues.push({
            code: 'provider-not-found',
            message: `当前 provider 未在配置中找到: ${providerName}`,
            suggestion: '检查 model_providers 是否包含该 provider 配置块'
        });
    }

    if (provider && typeof provider === 'object') {
        const baseUrl = typeof provider.base_url === 'string' ? provider.base_url.trim() : '';
        if (!isValidHttpUrl(baseUrl)) {
            issues.push({
                code: 'base-url-invalid',
                message: '当前 provider 的 base_url 无效',
                suggestion: '请设置为 http/https 的完整 URL'
            });
        }

        const requiresAuth = provider.requires_openai_auth;
        if (requiresAuth !== false) {
            const apiKey = typeof provider.preferred_auth_method === 'string'
                ? provider.preferred_auth_method.trim()
                : '';
            if (!apiKey) {
                issues.push({
                    code: 'api-key-missing',
                    message: '当前 provider 未配置 API Key',
                    suggestion: '在模板中设置 preferred_auth_method'
                });
            }
        }
    }

    if (modelName) {
        const models = readModels();
        if (!models.includes(modelName)) {
            issues.push({
                code: 'model-unavailable',
                message: `模型未在可用列表中找到: ${modelName}`,
                suggestion: '在模型列表中添加该模型或切换到已有模型'
            });
        }
    }

    const remoteEnabled = !!params.remote;
    let remote = null;
    if (remoteEnabled) {
        const baseUrl = provider && typeof provider.base_url === 'string' ? provider.base_url.trim() : '';
        if (!provider) {
            issues.push({
                code: 'remote-skip-provider',
                message: '无法进行远程探测：provider 未找到',
                suggestion: '检查 model_provider 配置或关闭远程探测'
            });
        } else if (!isValidHttpUrl(baseUrl)) {
            issues.push({
                code: 'remote-skip-base-url',
                message: '无法进行远程探测：base_url 无效',
                suggestion: '补全 base_url 或关闭远程探测'
            });
        } else {
            const timeoutMs = Number.isFinite(params.timeoutMs)
                ? Math.max(1000, Number(params.timeoutMs))
                : undefined;
            const apiKey = typeof provider.preferred_auth_method === 'string'
                ? provider.preferred_auth_method.trim()
                : '';
            const speedResult = await runSpeedTest(baseUrl, apiKey, { timeoutMs });
            const status = speedResult && typeof speedResult.status === 'number'
                ? speedResult.status
                : 0;
            const durationMs = speedResult && typeof speedResult.durationMs === 'number'
                ? speedResult.durationMs
                : 0;
            const error = speedResult && speedResult.error ? String(speedResult.error) : '';
            remote = {
                type: 'speed-test',
                url: baseUrl,
                ok: !!speedResult.ok,
                status,
                durationMs,
                error
            };

            if (!speedResult.ok) {
                const errorLower = error.toLowerCase();
                if (errorLower.includes('timeout')) {
                    issues.push({
                        code: 'remote-speedtest-timeout',
                        message: '远程测速超时',
                        suggestion: '检查网络或 base_url 是否可达'
                    });
                } else if (errorLower.includes('invalid url')) {
                    issues.push({
                        code: 'remote-speedtest-invalid-url',
                        message: '远程测速失败：base_url 无效',
                        suggestion: '请设置为 http/https 的完整 URL'
                    });
                } else {
                    issues.push({
                        code: 'remote-speedtest-unreachable',
                        message: `远程测速失败：${error || '无法连接'}`,
                        suggestion: '检查网络或 base_url 是否可用'
                    });
                }
            } else if (status === 401 || status === 403) {
                issues.push({
                    code: 'remote-speedtest-auth-failed',
                    message: '远程测速鉴权失败（401/403）',
                    suggestion: '检查 API Key 或认证方式'
                });
            } else if (status >= 400) {
                issues.push({
                    code: 'remote-speedtest-http-error',
                    message: `远程测速返回异常状态: ${status}`,
                    suggestion: '检查 base_url 或服务状态'
                });
            }
        }
    }

    return {
        ok: issues.length === 0,
        issues,
        summary: {
            currentProvider: providerName,
            currentModel: modelName
        },
        remote
    };
}

function buildDefaultConfigContent(initializedAt) {
    const defaultModel = DEFAULT_MODELS[0] || 'gpt-4';
    return `${CODEXMATE_MANAGED_MARKER}
# codexmate-initialized-at: ${initializedAt}

model_provider = "openai"
model = "${defaultModel}"

[model_providers.openai]
name = "openai"
base_url = "https://api.openai.com/v1"
wire_api = "responses"
requires_openai_auth = false
preferred_auth_method = ""
request_max_retries = 4
stream_max_retries = 10
stream_idle_timeout_ms = 300000
`;
}

function buildVirtualDefaultConfig() {
    return toml.parse(EMPTY_CONFIG_FALLBACK_TEMPLATE);
}

function readConfigOrVirtualDefault() {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            return {
                config: readConfig(),
                isVirtual: false,
                reason: ''
            };
        } catch (e) {
            return {
                config: buildVirtualDefaultConfig(),
                isVirtual: true,
                reason: e.message || '配置文件无效，已回退到默认模板'
            };
        }
    }

    return {
        config: buildVirtualDefaultConfig(),
        isVirtual: true,
        reason: `配置文件不存在: ${CONFIG_FILE}`
    };
}

function normalizeTopLevelConfigWithTemplate(template, selectedProvider, selectedModel) {
    let content = typeof template === 'string' ? template : '';
    if (!content.trim()) {
        throw new Error('模板内容为空');
    }

    const provider = typeof selectedProvider === 'string' ? selectedProvider.trim() : '';
    const model = typeof selectedModel === 'string' ? selectedModel.trim() : '';

    if (provider) {
        if (/^\s*model_provider\s*=.*$/m.test(content)) {
            content = content.replace(/^\s*model_provider\s*=.*$/m, `model_provider = "${provider}"`);
        } else {
            content = `model_provider = "${provider}"\n` + content;
        }
    }

    if (model) {
        if (/^\s*model\s*=.*$/m.test(content)) {
            content = content.replace(/^\s*model\s*=.*$/m, `model = "${model}"`);
        } else {
            content = `model = "${model}"\n` + content;
        }
    }

    return content;
}

function applyServiceTierToTemplate(template, serviceTier) {
    let content = typeof template === 'string' ? template : '';
    const tier = typeof serviceTier === 'string' ? serviceTier.trim().toLowerCase() : '';
    if (!tier) {
        return content;
    }

    content = content.replace(/^\s*service_tier\s*=\s*["'][^"']*["']\s*\n?/gmi, '');
    if (tier !== 'fast') {
        return content;
    }

    content = content.replace(/^\s*\n*/, '');
    return `service_tier = "fast"\n${content}`;
}

function applyReasoningEffortToTemplate(template, reasoningEffort) {
    let content = typeof template === 'string' ? template : '';
    const effort = typeof reasoningEffort === 'string' ? reasoningEffort.trim().toLowerCase() : '';
    if (!effort) {
        return content;
    }

    content = content.replace(/^\s*model_reasoning_effort\s*=\s*["'][^"']*["']\s*\n?/gmi, '');
    if (effort === 'high' || effort === 'xhigh') {
        content = content.replace(/^\s*\n*/, '');
        return `model_reasoning_effort = "${effort}"\n${content}`;
    }
    return content;
}

function getConfigTemplate(params = {}) {
    let content = EMPTY_CONFIG_FALLBACK_TEMPLATE;
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
            if (raw && raw.trim()) {
                content = raw;
            }
        } catch (e) {}
    }
    const selectedProvider = params.provider || '';
    const selectedModel = params.model || '';
    let template = normalizeTopLevelConfigWithTemplate(content, selectedProvider, selectedModel);
    if (typeof params.serviceTier === 'string') {
        template = applyServiceTierToTemplate(template, params.serviceTier);
    }
    if (typeof params.reasoningEffort === 'string') {
        template = applyReasoningEffortToTemplate(template, params.reasoningEffort);
    }
    return {
        template
    };
}

function applyConfigTemplate(params = {}) {
    const template = typeof params.template === 'string' ? params.template : '';
    if (!template.trim()) {
        return { error: '模板内容不能为空' };
    }

    let parsed;
    try {
        parsed = toml.parse(template);
    } catch (e) {
        return { error: `模板 TOML 解析失败: ${e.message}` };
    }

    if (!parsed.model_provider || typeof parsed.model_provider !== 'string') {
        return { error: '模板缺少 model_provider' };
    }

    if (!parsed.model || typeof parsed.model !== 'string') {
        return { error: '模板缺少 model' };
    }

    if (!parsed.model_providers || typeof parsed.model_providers !== 'object') {
        return { error: '模板缺少 model_providers 配置块' };
    }

    const activeProvider = parsed.model_provider;
    const activeProviderBlock = parsed.model_providers[activeProvider];
    if (!activeProviderBlock || typeof activeProviderBlock !== 'object') {
        return { error: `模板中找不到当前 provider: ${activeProvider}` };
    }

    writeConfig(template.trim() + '\n');
    updateAuthJson(activeProviderBlock.preferred_auth_method || '');

    const models = readModels();
    if (!models.includes(parsed.model)) {
        models.push(parsed.model);
        writeModels(models);
    }

    const currentModels = readCurrentModels();
    currentModels[activeProvider] = parsed.model;
    writeCurrentModels(currentModels);

    recordRecentConfig(activeProvider, parsed.model);

    return { success: true };
}

function addProviderToConfig(params = {}) {
    const name = typeof params.name === 'string' ? params.name.trim() : '';
    const url = typeof params.url === 'string' ? params.url.trim() : '';
    const key = typeof params.key === 'string' ? params.key.trim() : '';
    const allowManaged = !!params.allowManaged;

    if (!name) return { error: '名称不能为空' };
    if (!url) return { error: 'URL 不能为空' };
    if (!isValidProviderName(name)) {
        return { error: '名称仅支持字母/数字/._-' };
    }
    if (isReservedProviderNameForCreation(name)) {
        return { error: 'local provider 为系统保留名称，不可新增' };
    }
    if (isBuiltinProxyProvider(name) && !allowManaged) {
        return { error: '本地代理配置为系统内建项，不可手动添加' };
    }

    ensureConfigDir();

    let content = '';
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            content = fs.readFileSync(CONFIG_FILE, 'utf-8');
        } catch (e) {
            return { error: `读取 config.toml 失败: ${e.message}` };
        }
    } else {
        content = EMPTY_CONFIG_FALLBACK_TEMPLATE;
    }

    if (!content || !content.trim()) {
        content = EMPTY_CONFIG_FALLBACK_TEMPLATE;
    }

    let parsed;
    try {
        parsed = toml.parse(content);
    } catch (e) {
        return { error: `config.toml 解析失败: ${e.message}` };
    }

    const normalizedProviders = isPlainObject(parsed.model_providers)
        ? normalizeLegacyModelProviders(parsed.model_providers)
        : {};
    if (normalizedProviders && normalizedProviders[name]) {
        return { error: '提供商已存在' };
    }

    const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
    const safeName = escapeTomlBasicString(name);
    const safeUrl = escapeTomlBasicString(url);
    const safeKey = escapeTomlBasicString(key);
    const block = [
        buildModelProviderTableHeader(name),
        `name = "${safeName}"`,
        `base_url = "${safeUrl}"`,
        `wire_api = "responses"`,
        `requires_openai_auth = false`,
        `preferred_auth_method = "${safeKey}"`,
        `request_max_retries = 4`,
        `stream_max_retries = 10`,
        `stream_idle_timeout_ms = 300000`
    ].join(lineEnding);

    const newContent = content.trimEnd() + lineEnding + lineEnding + block + lineEnding;

    try {
        writeConfig(newContent);
    } catch (e) {
        return { error: `写入配置失败: ${e.message}` };
    }

    return { success: true };
}

function updateProviderInConfig(params = {}) {
    const name = typeof params.name === 'string' ? params.name.trim() : '';
    const url = typeof params.url === 'string' ? params.url.trim() : '';
    const key = params.key !== undefined && params.key !== null
        ? String(params.key).trim()
        : undefined;
    const allowManaged = !!params.allowManaged;

    if (!name) return { error: '名称不能为空' };
    if (!url && key === undefined) {
        return { error: 'URL 或密钥至少填写一项' };
    }
    if (isNonEditableProvider(name) && !allowManaged) {
        if (isDefaultLocalProvider(name)) {
            return { error: 'local provider 为系统保留项，不可编辑' };
        }
        return { error: '本地代理配置为系统内建项，不可编辑' };
    }

    try {
        cmdUpdate(name, url || undefined, key, true, { allowManaged });
        return { success: true };
    } catch (e) {
        return { error: e.message || '更新失败' };
    }
}

function deleteProviderFromConfig(params = {}) {
    const name = typeof params.name === 'string' ? params.name.trim() : '';
    if (!name) return { error: '名称不能为空' };
    if (isNonDeletableProvider(name)) {
        if (isDefaultLocalProvider(name)) {
            return { error: 'local provider 为系统保留项，不可删除' };
        }
        return { error: '本地代理配置为系统内建项，不可删除' };
    }
    if (!fs.existsSync(CONFIG_FILE)) {
        return { error: 'config.toml 不存在' };
    }

    let config;
    try {
        config = readConfig();
    } catch (e) {
        return { error: `读取配置失败: ${e.message}` };
    }

    const result = performProviderDeletion(name, { silent: true, config });
    if (result.error) {
        return { error: result.error };
    }
    return {
        success: true,
        switched: !!result.switched,
        provider: result.provider || '',
        model: result.model || ''
    };
}

function performProviderDeletion(name, options = {}) {
    const silent = !!options.silent;
    if (isNonDeletableProvider(name)) {
        const msg = isDefaultLocalProvider(name)
            ? 'local provider 为系统保留项，不可删除'
            : '本地代理配置为系统内建项，不可删除';
        if (!silent) console.error('错误:', msg);
        return { error: msg };
    }
    const config = options.config || readConfig();
    if (!config.model_providers || !config.model_providers[name]) {
        const msg = '提供商不存在';
        if (!silent) console.error('错误:', msg, name);
        return { error: msg };
    }

    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
    const hasBom = content.charCodeAt(0) === 0xFEFF;
    const providerConfig = config.model_providers[name];
    const providerSegments = providerConfig && Array.isArray(providerConfig.__codexmate_legacy_segments)
        ? providerConfig.__codexmate_legacy_segments
        : null;

    const remainingProviders = Object.keys(config.model_providers || {}).filter(item => item !== name);
    if (remainingProviders.length === 0) {
        const msg = '删除后将没有可用提供商';
        if (!silent) console.error('错误:', msg);
        return { error: msg };
    }

    const currentProvider = typeof config.model_provider === 'string' ? config.model_provider.trim() : '';
    const currentModels = readCurrentModels();
    const models = readModels();
    const result = { success: true, switched: false, provider: '', model: '' };

    if (currentModels[name]) {
        delete currentModels[name];
    }

    let fallbackProvider = currentProvider;
    let fallbackModel = typeof config.model === 'string' ? config.model.trim() : '';
    if (currentProvider === name) {
        fallbackProvider = remainingProviders[0];
        fallbackModel = currentModels[fallbackProvider]
            || (Array.isArray(models) && models.length > 0 ? models[0] : (DEFAULT_MODELS[0] || ''));
        result.switched = true;
        result.provider = fallbackProvider;
        result.model = fallbackModel;
    }

    const upsertTopLevel = (text, key, value) => {
        if (!value && value !== '') return text;
        const regex = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
        if (regex.test(text)) {
            return text.replace(regex, `${key} = "${value}"`);
        }
        return `${key} = "${value}"${lineEnding}${text}`;
    };

    let updatedContent = null;
    const ranges = findProviderSectionRanges(content, name, providerSegments);
    if (ranges.length > 0) {
        const sorted = ranges.sort((a, b) => b.start - a.start);
        let removedContent = content;
        for (const range of sorted) {
            removedContent = removedContent.slice(0, range.start) + removedContent.slice(range.end);
        }
        updatedContent = removedContent.replace(/\n{3,}/g, lineEnding + lineEnding);
    }

    if (updatedContent) {
        if (result.switched) {
            updatedContent = upsertTopLevel(updatedContent, 'model_provider', fallbackProvider);
            updatedContent = upsertTopLevel(updatedContent, 'model', fallbackModel);
            currentModels[fallbackProvider] = fallbackModel;
        }
    } else {
        // 回退：重建 TOML，保持行尾风格
        const rebuilt = JSON.parse(JSON.stringify(config));
        delete rebuilt.model_providers[name];
        if (result.switched) {
            rebuilt.model_provider = fallbackProvider;
            rebuilt.model = fallbackModel;
            currentModels[fallbackProvider] = fallbackModel;
        }
        const hasMarker = content.includes(CODEXMATE_MANAGED_MARKER);
        let rebuiltToml = toml.stringify(rebuilt).trimEnd();
        rebuiltToml = rebuiltToml.replace(/\n/g, lineEnding);
        if (hasMarker && !rebuiltToml.includes(CODEXMATE_MANAGED_MARKER)) {
            rebuiltToml = `${CODEXMATE_MANAGED_MARKER}${lineEnding}${rebuiltToml}`;
        }
        updatedContent = rebuiltToml + lineEnding;
        if (hasBom && updatedContent.charCodeAt(0) !== 0xFEFF) {
            updatedContent = '\uFEFF' + updatedContent;
        }
    }

    writeCurrentModels(currentModels);
    writeConfig(updatedContent.trimEnd() + lineEnding);

    return result;
}

function ensureSupportFiles(defaultProvider, defaultModel) {
    if (!fs.existsSync(MODELS_FILE)) {
        writeModels([...DEFAULT_MODELS]);
    } else {
        const existingModels = readModels();
        const mergedModels = Array.isArray(existingModels) ? [...existingModels] : [];
        let hasNewDefaultModel = false;
        for (const model of DEFAULT_MODELS) {
            if (!mergedModels.includes(model)) {
                mergedModels.push(model);
                hasNewDefaultModel = true;
            }
        }
        if (hasNewDefaultModel) {
            writeModels(mergedModels);
        }
    }

    const currentModels = readCurrentModels();
    if (!currentModels[defaultProvider]) {
        currentModels[defaultProvider] = defaultModel;
        writeCurrentModels(currentModels);
    }

    if (!fs.existsSync(AUTH_FILE)) {
        updateAuthJson('');
    }
}

function writeInitMark(payload) {
    fs.writeFileSync(INIT_MARK_FILE, JSON.stringify(payload, null, 2), 'utf-8');
}

function ensureManagedConfigBootstrap() {
    ensureConfigDir();

    const initializedAt = new Date().toISOString();
    const defaultProvider = 'openai';
    const defaultModel = DEFAULT_MODELS[0] || 'gpt-4';
    const forceResetExistingConfig = process.env.CODEXMATE_FORCE_RESET_EXISTING_CONFIG === '1';
    const mark = readJsonFile(INIT_MARK_FILE, null);
    const hasConfig = fs.existsSync(CONFIG_FILE);

    if (mark) {
        if (!hasConfig) {
            writeConfig(buildDefaultConfigContent(initializedAt));
            ensureSupportFiles(defaultProvider, defaultModel);
            g_initNotice = '检测到配置缺失，已自动重建默认配置。';
            return { notice: g_initNotice };
        }
        ensureSupportFiles(defaultProvider, defaultModel);
        return { notice: '' };
    }

    if (hasConfig) {
        let existingContent = '';
        try {
            existingContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
        } catch (e) {}

        if (existingContent.includes(CODEXMATE_MANAGED_MARKER)) {
            writeInitMark({
                version: 1,
                initializedAt,
                mode: 'managed-config-detected',
                backupFile: ''
            });
            ensureSupportFiles(defaultProvider, defaultModel);
            return { notice: '' };
        }

        const backupFile = `config.toml.codexmate-backup-${formatTimestampForFileName(initializedAt)}.bak`;
        const backupPath = path.join(CONFIG_DIR, backupFile);
        fs.copyFileSync(CONFIG_FILE, backupPath);

        if (forceResetExistingConfig) {
            writeConfig(buildDefaultConfigContent(initializedAt));
            ensureSupportFiles(defaultProvider, defaultModel);
            writeInitMark({
                version: 1,
                initializedAt,
                mode: 'first-run-reset',
                backupFile
            });

            g_initNotice = `首次使用已备份原配置到 ${backupFile}，并重建默认配置。`;
            return { notice: g_initNotice, backupFile };
        }

        ensureSupportFiles(defaultProvider, defaultModel);
        writeInitMark({
            version: 1,
            initializedAt,
            mode: 'legacy-config-preserved',
            backupFile
        });
        g_initNotice = `检测到已有配置，已备份到 ${backupFile}，并保留原配置不覆盖。`;
        return { notice: g_initNotice, backupFile };
    }

    writeConfig(buildDefaultConfigContent(initializedAt));
    ensureSupportFiles(defaultProvider, defaultModel);
    writeInitMark({
        version: 1,
        initializedAt,
        mode: 'fresh-install',
        backupFile: ''
    });
    g_initNotice = '首次使用已创建默认配置。';
    return { notice: g_initNotice };
}

function resetConfigToDefault() {
    ensureConfigDir();
    const initializedAt = new Date().toISOString();
    const defaultProvider = 'openai';
    const defaultModel = DEFAULT_MODELS[0] || 'gpt-4';

    let backupFile = '';
    if (fs.existsSync(CONFIG_FILE)) {
        backupFile = `config.toml.reset-${formatTimestampForFileName(initializedAt)}.bak`;
        fs.copyFileSync(CONFIG_FILE, path.join(CONFIG_DIR, backupFile));
    }

    writeConfig(buildDefaultConfigContent(initializedAt));
    ensureSupportFiles(defaultProvider, defaultModel);
    writeInitMark({
        version: 1,
        initializedAt,
        mode: 'manual-reset',
        backupFile
    });

    return { success: true, backupFile };
}

function consumeInitNotice() {
    const notice = g_initNotice;
    g_initNotice = '';
    return notice;
}

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
    const rootWithSlash = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
    return resolvedTarget.startsWith(rootWithSlash);
}

function collectJsonlFiles(rootDir, maxFiles = 5000) {
    if (!fs.existsSync(rootDir)) {
        return [];
    }

    const stack = [rootDir];
    const files = [];
    while (stack.length > 0 && files.length < maxFiles) {
        const dir = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                files.push(fullPath);
            }

            if (files.length >= maxFiles) {
                break;
            }
        }
    }

    return files;
}

function readJsonlRecords(filePath) {
    let content = '';
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
        return [];
    }

    const records = [];
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            records.push(JSON.parse(trimmed));
        } catch (e) {}
    }
    return records;
}

function getFileHeadText(filePath, maxBytes = SESSION_SUMMARY_READ_BYTES) {
    let fd;
    try {
        fd = fs.openSync(filePath, 'r');
        const stat = fs.fstatSync(fd);
        const size = Math.min(maxBytes, stat.size);
        if (size <= 0) {
            return '';
        }

        const buffer = Buffer.alloc(size);
        fs.readSync(fd, buffer, 0, size, 0);
        return buffer.toString('utf-8');
    } catch (e) {
        return '';
    } finally {
        if (fd !== undefined) {
            try { fs.closeSync(fd); } catch (e) {}
        }
    }
}

function parseJsonlContent(content) {
    if (!content) {
        return [];
    }

    const records = [];
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            records.push(JSON.parse(trimmed));
        } catch (e) {}
    }
    return records;
}

function parseJsonlHeadRecords(filePath, maxBytes = SESSION_SUMMARY_READ_BYTES) {
    const headText = getFileHeadText(filePath, maxBytes);
    if (!headText) {
        return [];
    }

    return parseJsonlContent(headText);
}

function isBootstrapLikeText(text) {
    if (!text || typeof text !== 'string') {
        return false;
    }

    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return false;
    }

    return BOOTSTRAP_TEXT_MARKERS.some(marker => normalized.includes(marker));
}

function removeLeadingSystemMessage(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return [];
    }

    let startIndex = 0;
    while (startIndex < messages.length) {
        const item = messages[startIndex];
        const role = item ? normalizeRole(item.role) : '';
        const text = item && typeof item.text === 'string' ? item.text : '';
        const isSystemRole = role === 'system';
        const isBootstrapText = isBootstrapLikeText(text);
        if (!item || isSystemRole || isBootstrapText) {
            startIndex += 1;
            continue;
        }
        break;
    }

    if (startIndex <= 0) {
        return messages;
    }
    return messages.slice(startIndex);
}

function countConversationMessagesInRecords(records, source) {
    const messages = [];
    for (const record of records) {
        if (source === 'codex') {
            if (record.type === 'response_item' && record.payload && record.payload.type === 'message') {
                const role = normalizeRole(record.payload.role);
                if (role === 'assistant' || role === 'user' || role === 'system') {
                    messages.push({
                        role,
                        text: extractMessageText(record.payload.content)
                    });
                }
            }
            continue;
        }

        const role = normalizeRole(record.type);
        if (role === 'assistant' || role === 'user' || role === 'system') {
            const content = record.message ? record.message.content : '';
            messages.push({
                role,
                text: extractMessageText(content)
            });
        }
    }

    return removeLeadingSystemMessage(messages).length;
}

function sortSessionsByUpdatedAt(items) {
    items.sort((a, b) => {
        const aTime = Date.parse(a.updatedAt || '') || 0;
        const bTime = Date.parse(b.updatedAt || '') || 0;
        return bTime - aTime;
    });
    return items;
}

function mergeAndLimitSessions(items, limit) {
    const deduped = [];
    const seen = new Set();
    for (const item of items) {
        if (!item || !item.filePath) continue;
        const key = `${item.source}:${item.filePath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
    }

    return sortSessionsByUpdatedAt(deduped).slice(0, limit);
}

function normalizeSessionPathFilter(pathFilter) {
    if (typeof pathFilter !== 'string') {
        return '';
    }
    const trimmed = pathFilter.trim();
    return trimmed ? trimmed.toLowerCase() : '';
}

function matchesSessionPathFilter(session, normalizedFilter) {
    if (!normalizedFilter) {
        return true;
    }
    if (!session || typeof session !== 'object') {
        return false;
    }

    const cwd = typeof session.cwd === 'string' ? session.cwd.toLowerCase() : '';
    return cwd.includes(normalizedFilter);
}

function normalizeQueryTokens(query) {
    if (typeof query !== 'string') {
        return [];
    }
    return query
        .split(/\s+/)
        .map(item => item.trim())
        .map(item => item.toLowerCase())
        .filter(Boolean);
}

function expandSessionQueryTokens(tokens) {
    const base = Array.isArray(tokens) ? tokens.map(t => String(t || '').toLowerCase()).filter(Boolean) : [];
    const result = [];
    const seen = new Set();
    let hasClaudeAlias = false;
    let hasDaudeAlias = false;

    // First pass: detect multi-token aliases (e.g., "claude code", "daude code")
    for (let i = 0; i < base.length; i++) {
        const token = base[i];
        const nextToken = base[i + 1] || '';

        // Check for "claude code" pattern (two separate tokens)
        if (token === 'claude' && nextToken === 'code') {
            hasClaudeAlias = true;
            i++; // Skip next token
            continue;
        }
        // Check for "daude code" pattern (two separate tokens)
        if (token === 'daude' && nextToken === 'code') {
            hasDaudeAlias = true;
            i++; // Skip next token
            continue;
        }
        // Check for combined patterns (e.g., "claude-code", "claude_code", "claudecode")
        if (/^claude[-_ ]?code$/.test(token) || token === 'claudecode') {
            hasClaudeAlias = true;
            continue;
        }
        if (/^daude[-_ ]?code$/.test(token) || token === 'daudecode') {
            hasDaudeAlias = true;
            continue;
        }
        if (!seen.has(token)) {
            seen.add(token);
            result.push(token);
        }
    }

    const push = (token) => {
        const normalized = String(token || '').toLowerCase();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        result.push(normalized);
    };

    if (hasClaudeAlias) {
        push('claude');
        push('code');
    }
    if (hasDaudeAlias) {
        push('daude');
        push('code');
    }

    return result;
}

function normalizeKeywords(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set();
    const result = [];
    for (const item of value) {
        const normalized = typeof item === 'string' ? item.trim() : String(item || '').trim();
        if (!normalized) continue;
        const lower = normalized.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        result.push(normalized);
    }
    return result;
}

function normalizeCapabilities(value) {
    const result = {};
    if (!value || typeof value !== 'object') {
        return result;
    }
    if (value.code === true) {
        result.code = true;
    }
    return result;
}

function normalizeQueryMode(mode) {
    return mode === 'or' ? 'or' : 'and';
}

function normalizeQueryScope(scope) {
    if (scope === 'content' || scope === 'all' || scope === 'summary') {
        return scope;
    }
    return 'summary';
}

function normalizeRoleFilter(roleFilter) {
    if (roleFilter === 'all' || roleFilter === undefined || roleFilter === null) {
        return 'all';
    }
    const normalized = normalizeRole(String(roleFilter));
    return normalized || 'all';
}

function matchTokensInText(text, tokens, mode = 'and') {
    if (!Array.isArray(tokens) || tokens.length === 0) {
        return true;
    }
    const haystack = String(text || '').toLowerCase();
    if (!haystack) {
        return false;
    }
    if (mode === 'or') {
        return tokens.some(token => haystack.includes(token));
    }
    return tokens.every(token => haystack.includes(token));
}

function buildSessionSummaryText(session) {
    if (!session) {
        return '';
    }
    const keywords = Array.isArray(session.keywords) ? session.keywords.join(' ') : '';
    const provider = typeof session.provider === 'string' ? session.provider : '';
    return [
        session.title,
        session.sessionId,
        session.cwd,
        session.filePath,
        session.sourceLabel,
        provider,
        keywords
    ].filter(Boolean).join(' ');
}

function extractMessageFromRecord(record, source) {
    if (!record) {
        return null;
    }
    if (source === 'codex') {
        if (record.type === 'response_item' && record.payload && record.payload.type === 'message') {
            const role = normalizeRole(record.payload.role);
            const text = extractMessageText(record.payload.content);
            if (!role || !text) {
                return null;
            }
            return { role, text };
        }
        return null;
    }

    const role = normalizeRole(record.type);
    if (!role) {
        return null;
    }
    const content = record.message ? record.message.content : '';
    const text = extractMessageText(content);
    if (!text) {
        return null;
    }
    return { role, text };
}

function scanSessionContentForQuery(session, tokens, options = {}) {
    if (!session || !Array.isArray(tokens) || tokens.length === 0) {
        return { hit: false, count: 0, snippets: [] };
    }

    const filePath = resolveSessionFilePath(session.source, session.filePath, session.sessionId);
    if (!filePath) {
        return { hit: false, count: 0, snippets: [] };
    }

    const maxBytes = Number.isFinite(Number(options.maxBytes))
        ? Math.max(1024, Number(options.maxBytes))
        : SESSION_CONTENT_READ_BYTES;
    const headText = getFileHeadText(filePath, maxBytes);
    if (!headText) {
        return { hit: false, count: 0, snippets: [] };
    }

    const records = parseJsonlContent(headText);
    const mode = normalizeQueryMode(options.mode);
    const roleFilter = normalizeRoleFilter(options.roleFilter);
    const maxMatches = Number.isFinite(Number(options.maxMatches))
        ? Math.max(1, Number(options.maxMatches))
        : 1;
    const snippetLimit = Number.isFinite(Number(options.snippetLimit))
        ? Math.max(0, Number(options.snippetLimit))
        : 0;

    const messages = [];
    for (const record of records) {
        const message = extractMessageFromRecord(record, session.source);
        if (!message || !message.text) {
            continue;
        }
        messages.push(message);
    }

    const filteredMessages = roleFilter === 'system'
        ? messages
        : removeLeadingSystemMessage(messages);

    let count = 0;
    const snippets = [];

    for (const message of filteredMessages) {
        if (roleFilter !== 'all' && message.role !== roleFilter) {
            continue;
        }
        if (!matchTokensInText(message.text, tokens, mode)) {
            continue;
        }

        count += 1;
        if (snippetLimit > 0 && snippets.length < snippetLimit) {
            snippets.push(truncateText(message.text));
        }
        if (count >= maxMatches) {
            break;
        }
    }

    return { hit: count > 0, count, snippets };
}

function applySessionQueryFilter(sessions, options = {}) {
    const tokens = Array.isArray(options.tokens) ? options.tokens : [];
    if (tokens.length === 0) {
        return sessions;
    }

    const mode = normalizeQueryMode(options.queryMode);
    const scope = normalizeQueryScope(options.queryScope);
    const roleFilter = normalizeRoleFilter(options.roleFilter);
    const contentScanLimit = Number.isFinite(Number(options.contentScanLimit))
        ? Math.max(1, Number(options.contentScanLimit))
        : DEFAULT_CONTENT_SCAN_LIMIT;
    const contentScanBytes = Number.isFinite(Number(options.contentScanBytes))
        ? Math.max(1024, Number(options.contentScanBytes))
        : SESSION_CONTENT_READ_BYTES;

    let scanned = 0;
    const results = [];

    for (const session of sessions) {
        if (scope === 'content' && scanned >= contentScanLimit) {
            break;
        }

        const summaryText = buildSessionSummaryText(session);
        const summaryHit = scope !== 'content' && matchTokensInText(summaryText, tokens, mode);
        let contentHit = false;
        let contentInfo = null;

        const shouldScanContent = scope === 'content' || scope === 'all' || !summaryHit;
        if (shouldScanContent && scanned < contentScanLimit) {
            scanned += 1;
            contentInfo = scanSessionContentForQuery(session, tokens, {
                mode,
                roleFilter,
                maxBytes: contentScanBytes,
                maxMatches: 1,
                snippetLimit: 2
            });
            contentHit = contentInfo.hit;
        }

        const hit = scope === 'summary'
            ? summaryHit
            : (scope === 'content' ? contentHit : (summaryHit || contentHit));

        if (!hit) {
            continue;
        }

        const matchInfo = contentInfo && contentInfo.hit
            ? contentInfo
            : { hit: true, count: 1, snippets: [] };
        session.match = {
            hit: true,
            count: matchInfo.count || 1,
            snippets: Array.isArray(matchInfo.snippets) ? matchInfo.snippets : []
        };
        results.push(session);
    }

    return results;
}
function collectRecentJsonlFiles(rootDir, options = {}) {
    if (!fs.existsSync(rootDir)) {
        return [];
    }

    const returnCount = Math.max(1, Number(options.returnCount) || 1);
    const maxFilesScanned = Math.max(returnCount, Number(options.maxFilesScanned) || 2000);
    const ignoreSubPath = typeof options.ignoreSubPath === 'string' ? options.ignoreSubPath : '';
    const stack = [rootDir];
    const filesMeta = [];
    let scanned = 0;

    while (stack.length > 0 && scanned < maxFilesScanned) {
        const dir = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }

            if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
                continue;
            }

            if (ignoreSubPath && fullPath.includes(ignoreSubPath)) {
                continue;
            }

            scanned += 1;
            try {
                const stat = fs.statSync(fullPath);
                filesMeta.push({ filePath: fullPath, mtimeMs: stat.mtimeMs || 0 });
            } catch (e) {}

            if (scanned >= maxFilesScanned) {
                break;
            }
        }
    }

    filesMeta.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return filesMeta.slice(0, returnCount).map(item => item.filePath);
}

function getSessionListCache(cacheKey, forceRefresh = false) {
    if (forceRefresh) {
        g_sessionListCache.delete(cacheKey);
        return null;
    }

    const cached = g_sessionListCache.get(cacheKey);
    if (!cached) {
        return null;
    }

    if ((Date.now() - cached.timestamp) > SESSION_LIST_CACHE_TTL_MS) {
        g_sessionListCache.delete(cacheKey);
        return null;
    }

    return cached.value;
}

function setSessionListCache(cacheKey, value) {
    g_sessionListCache.set(cacheKey, {
        timestamp: Date.now(),
        value
    });

    if (g_sessionListCache.size > 20) {
        const firstKey = g_sessionListCache.keys().next().value;
        if (firstKey) {
            g_sessionListCache.delete(firstKey);
        }
    }
}

function invalidateSessionListCache() {
    g_sessionListCache.clear();
}

function parseCodexSessionSummary(filePath) {
    const records = parseJsonlHeadRecords(filePath);
    if (records.length === 0) {
        return null;
    }

    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (e) {
        return null;
    }

    let sessionId = path.basename(filePath, '.jsonl');
    let cwd = '';
    let createdAt = '';
    let updatedAt = stat.mtime.toISOString();
    let firstPrompt = '';
    let messageCount = 0;
    const previewMessages = [];

    for (const record of records) {
        if (record.timestamp) {
            updatedAt = updateLatestIso(updatedAt, record.timestamp);
        }

        if (record.type === 'session_meta' && record.payload) {
            sessionId = record.payload.id || sessionId;
            cwd = record.payload.cwd || cwd;
            createdAt = toIsoTime(record.payload.timestamp || record.timestamp, createdAt);
            continue;
        }

        if (record.type === 'response_item' && record.payload && record.payload.type === 'message') {
            const role = normalizeRole(record.payload.role);
            if (role === 'user' || role === 'assistant' || role === 'system') {
                const text = extractMessageText(record.payload.content);
                previewMessages.push({ role, text });
            }
        }
    }

    const filteredPreviewMessages = removeLeadingSystemMessage(previewMessages);
    messageCount = filteredPreviewMessages.length;
    const firstUser = filteredPreviewMessages.find(item => item.role === 'user' && item.text);
    if (firstUser) {
        firstPrompt = truncateText(firstUser.text);
    }

    if (!firstPrompt) {
        const titleRecords = parseJsonlHeadRecords(filePath, SESSION_TITLE_READ_BYTES);
        const titleMessages = [];
        for (const record of titleRecords) {
            if (record.type === 'response_item' && record.payload && record.payload.type === 'message') {
                const role = normalizeRole(record.payload.role);
                if (role === 'user' || role === 'assistant' || role === 'system') {
                    titleMessages.push({
                        role,
                        text: extractMessageText(record.payload.content)
                    });
                }
            }
        }

        const filteredTitleMessages = removeLeadingSystemMessage(titleMessages);
        const titleUser = filteredTitleMessages.find(item => item.role === 'user' && item.text);
        if (titleUser) {
            firstPrompt = truncateText(titleUser.text);
        }
    }

    messageCount = Math.max(0, messageCount);

    return {
        source: 'codex',
        sourceLabel: 'Codex',
        provider: 'codex',
        sessionId,
        title: firstPrompt || sessionId,
        cwd,
        createdAt,
        updatedAt,
        messageCount,
        filePath,
        keywords: [],
        capabilities: {}
    };
}

function parseClaudeSessionSummary(filePath) {
    const records = parseJsonlHeadRecords(filePath);
    if (records.length === 0) {
        return null;
    }

    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (e) {
        return null;
    }

    const sessionId = path.basename(filePath, '.jsonl');
    let cwd = '';
    let firstPrompt = '';
    let messageCount = 0;
    const previewMessages = [];
    let createdAt = '';
    let updatedAt = stat.mtime.toISOString();

    for (const record of records) {
        if (!createdAt && record.timestamp) {
            createdAt = toIsoTime(record.timestamp, createdAt);
        }
        if (record.timestamp) {
            updatedAt = updateLatestIso(updatedAt, record.timestamp);
        }

        if (!cwd && record.cwd) {
            cwd = record.cwd;
        }

        const role = normalizeRole(record.type);
        if (role === 'assistant' || role === 'user' || role === 'system') {
            const userContent = record.message ? record.message.content : '';
            previewMessages.push({
                role,
                text: extractMessageText(userContent)
            });
        }
    }

    const filteredPreviewMessages = removeLeadingSystemMessage(previewMessages);
    messageCount = filteredPreviewMessages.length;
    const firstUser = filteredPreviewMessages.find(item => item.role === 'user' && item.text);
    if (firstUser) {
        firstPrompt = truncateText(firstUser.text);
    }

    if (!firstPrompt) {
        const titleRecords = parseJsonlHeadRecords(filePath, SESSION_TITLE_READ_BYTES);
        const titleMessages = [];
        for (const record of titleRecords) {
            const role = normalizeRole(record.type);
            if (role === 'assistant' || role === 'user' || role === 'system') {
                const userContent = record.message ? record.message.content : '';
                titleMessages.push({
                    role,
                    text: extractMessageText(userContent)
                });
            }
        }

        const filteredTitleMessages = removeLeadingSystemMessage(titleMessages);
        const titleUser = filteredTitleMessages.find(item => item.role === 'user' && item.text);
        if (titleUser) {
            firstPrompt = truncateText(titleUser.text);
        }
    }

    messageCount = Math.max(0, messageCount);

    return {
        source: 'claude',
        sourceLabel: 'Claude Code',
        provider: 'claude',
        sessionId,
        title: firstPrompt || sessionId,
        cwd,
        createdAt,
        updatedAt,
        messageCount,
        filePath,
        keywords: [],
        capabilities: { code: true }
    };
}

function listCodexSessions(limit, options = {}) {
    const codexSessionsDir = getCodexSessionsDir();
    const scanFactor = Number.isFinite(Number(options.scanFactor))
        ? Math.max(1, Number(options.scanFactor))
        : SESSION_SCAN_FACTOR;
    const minFiles = Number.isFinite(Number(options.minFiles))
        ? Math.max(1, Number(options.minFiles))
        : Math.min(SESSION_SCAN_MIN_FILES, MAX_SESSION_LIST_SIZE * SESSION_SCAN_FACTOR);
    const targetCount = Number.isFinite(Number(options.targetCount))
        ? Math.max(1, Math.floor(Number(options.targetCount)))
        : Math.max(1, Math.floor(limit * scanFactor));
    const scanCount = Number.isFinite(Number(options.scanCount))
        ? Math.max(targetCount, Math.floor(Number(options.scanCount)))
        : Math.max(targetCount, minFiles);
    const maxFilesScanned = Number.isFinite(Number(options.maxFilesScanned))
        ? Math.max(scanCount, Math.floor(Number(options.maxFilesScanned)))
        : Math.max(scanCount * 2, minFiles);
    const files = collectRecentJsonlFiles(codexSessionsDir, {
        returnCount: scanCount,
        maxFilesScanned
    });
    const sessions = [];

    for (const filePath of files) {
        const summary = parseCodexSessionSummary(filePath);
        if (summary) {
            sessions.push(summary);
        }

        if (sessions.length >= targetCount) {
            break;
        }
    }

    return mergeAndLimitSessions(sessions, limit);
}

function listClaudeSessions(limit, options = {}) {
    const claudeProjectsDir = getClaudeProjectsDir();
    if (!fs.existsSync(claudeProjectsDir)) {
        return [];
    }

    const scanFactor = Number.isFinite(Number(options.scanFactor))
        ? Math.max(1, Number(options.scanFactor))
        : SESSION_SCAN_FACTOR;
    const minFiles = Number.isFinite(Number(options.minFiles))
        ? Math.max(1, Number(options.minFiles))
        : Math.min(SESSION_SCAN_MIN_FILES, MAX_SESSION_LIST_SIZE * SESSION_SCAN_FACTOR);
    const targetCount = Number.isFinite(Number(options.targetCount))
        ? Math.max(1, Math.floor(Number(options.targetCount)))
        : Math.max(1, Math.floor(limit * scanFactor));
    const scanCount = Number.isFinite(Number(options.scanCount))
        ? Math.max(targetCount, Math.floor(Number(options.scanCount)))
        : Math.max(targetCount, minFiles);
    const maxFilesScanned = Number.isFinite(Number(options.maxFilesScanned))
        ? Math.max(scanCount, Math.floor(Number(options.maxFilesScanned)))
        : Math.max(scanCount * 2, minFiles);

    const sessions = [];
    let projectDirs = [];
    try {
        projectDirs = fs.readdirSync(claudeProjectsDir, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => path.join(claudeProjectsDir, entry.name));
    } catch (e) {
        projectDirs = [];
    }

    for (const projectDir of projectDirs) {
        const indexPath = path.join(projectDir, 'sessions-index.json');
        const index = readJsonFile(indexPath, null);
        if (!index || !Array.isArray(index.entries)) {
            continue;
        }

        for (const entry of index.entries) {
            if (!entry || typeof entry !== 'object') continue;
            const sessionId = entry.sessionId || '';
            if (!sessionId) continue;

            let filePath = typeof entry.fullPath === 'string' && entry.fullPath
                ? entry.fullPath
                : path.join(projectDir, `${sessionId}.jsonl`);
            filePath = expandHomePath(filePath);
            if (filePath && !path.isAbsolute(filePath)) {
                filePath = path.join(projectDir, filePath);
            }
            filePath = filePath ? path.resolve(filePath) : '';

            if (!fs.existsSync(filePath)) {
                continue;
            }

            const updatedAt = toIsoTime(entry.modified || entry.fileMtime, '');
            const createdAt = toIsoTime(entry.created, '');
            let title = truncateText(entry.summary || entry.firstPrompt || sessionId, 120);
            let messageCount = Number.isFinite(entry.messageCount) ? Math.max(0, entry.messageCount - 1) : 0;

            const quickRecords = parseJsonlHeadRecords(filePath, SESSION_TITLE_READ_BYTES);
            if (quickRecords.length > 0) {
                const filteredCount = countConversationMessagesInRecords(quickRecords, 'claude');
                if (filteredCount > 0 || messageCount === 0) {
                    messageCount = filteredCount;
                }

                const quickMessages = [];
                for (const record of quickRecords) {
                    const role = normalizeRole(record.type);
                    if (role === 'assistant' || role === 'user' || role === 'system') {
                        const content = record.message ? record.message.content : '';
                        quickMessages.push({ role, text: extractMessageText(content) });
                    }
                }
                const filteredQuickMessages = removeLeadingSystemMessage(quickMessages);
                const firstUser = filteredQuickMessages.find(item => item.role === 'user' && item.text);
                if (firstUser) {
                    title = truncateText(firstUser.text, 120);
                }
            }

            const provider = typeof entry.provider === 'string' && entry.provider.trim()
                ? entry.provider.trim()
                : 'claude';
            const keywords = normalizeKeywords(entry.keywords);
            const capabilities = normalizeCapabilities(entry.capabilities);

            sessions.push({
                source: 'claude',
                sourceLabel: 'Claude Code',
                provider,
                sessionId,
                title,
                cwd: entry.projectPath || index.originalPath || '',
                createdAt,
                updatedAt,
                messageCount,
                filePath,
                keywords,
                capabilities
            });

            if (sessions.length >= targetCount) {
                break;
            }
        }

        if (sessions.length >= targetCount) {
            break;
        }
    }

    if (sessions.length === 0) {
        const fallbackFiles = collectRecentJsonlFiles(claudeProjectsDir, {
            returnCount: scanCount,
            maxFilesScanned,
            ignoreSubPath: `${path.sep}subagents${path.sep}`
        });
        for (const filePath of fallbackFiles) {
            const summary = parseClaudeSessionSummary(filePath);
            if (summary) {
                sessions.push(summary);
            }

            if (sessions.length >= targetCount) {
                break;
            }
        }
    }

    return mergeAndLimitSessions(sessions, limit);
}

function listAllSessions(params = {}) {
    const source = params.source === 'codex' || params.source === 'claude'
        ? params.source
        : 'all';
    const rawLimit = Number(params.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(rawLimit, MAX_SESSION_LIST_SIZE))
        : 120;
    const forceRefresh = !!params.forceRefresh;
    const normalizedPathFilter = normalizeSessionPathFilter(params.pathFilter);
    const hasPathFilter = !!normalizedPathFilter;
    const queryTokens = expandSessionQueryTokens(normalizeQueryTokens(params.query));
    const hasQuery = queryTokens.length > 0;
    const cacheKey = hasQuery ? '' : `${source}:${limit}:${normalizedPathFilter}`;
    if (!hasQuery) {
        const cached = getSessionListCache(cacheKey, forceRefresh);
        if (cached) {
            return cached;
        }
    }

    const scanOptions = hasPathFilter
        ? {
            scanFactor: SESSION_SCAN_FACTOR * 2,
            minFiles: SESSION_SCAN_MIN_FILES * 2
        }
        : {};

    let sessions = [];
    if (source === 'all' || source === 'codex') {
        sessions = sessions.concat(listCodexSessions(limit, scanOptions));
    }
    if (source === 'all' || source === 'claude') {
        sessions = sessions.concat(listClaudeSessions(limit, scanOptions));
    }

    if (hasPathFilter) {
        sessions = sessions.filter(item => matchesSessionPathFilter(item, normalizedPathFilter));
    }

    let result = sessions;
    if (hasQuery) {
        result = applySessionQueryFilter(result, {
            tokens: queryTokens,
            queryMode: params.queryMode,
            queryScope: params.queryScope,
            roleFilter: params.roleFilter,
            contentScanLimit: params.contentScanLimit,
            contentScanBytes: params.contentScanBytes
        });
    }
    result = mergeAndLimitSessions(result, limit);
    if (!hasQuery) {
        setSessionListCache(cacheKey, result);
    }
    return result;
}

function listSessionPaths(params = {}) {
    const source = typeof params.source === 'string' ? params.source.trim().toLowerCase() : '';
    if (source && source !== 'codex' && source !== 'claude' && source !== 'all') {
        return [];
    }
    const validSource = source === 'codex' || source === 'claude' ? source : 'all';
    const rawLimit = Number(params.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(rawLimit, MAX_SESSION_PATH_LIST_SIZE))
        : 500;
    const forceRefresh = !!params.forceRefresh;
    const cacheKey = `paths:${validSource}:${limit}`;
    const cached = getSessionListCache(cacheKey, forceRefresh);
    if (cached) {
        return cached;
    }

    const gatherLimit = Math.min(MAX_SESSION_PATH_LIST_SIZE, Math.max(limit * 4, 800));
    const scanOptions = {
        scanFactor: SESSION_SCAN_FACTOR * 2,
        minFiles: SESSION_SCAN_MIN_FILES * 2,
        targetCount: Math.max(gatherLimit * 2, 1000)
    };

    let sessions = [];
    if (validSource === 'all' || validSource === 'codex') {
        sessions = sessions.concat(listCodexSessions(gatherLimit, scanOptions));
    }
    if (validSource === 'all' || validSource === 'claude') {
        sessions = sessions.concat(listClaudeSessions(gatherLimit, scanOptions));
    }

    const dedupedPaths = [];
    const seen = new Set();
    const sorted = sortSessionsByUpdatedAt(sessions);
    for (const session of sorted) {
        const cwd = typeof session.cwd === 'string' ? session.cwd.trim() : '';
        if (!cwd) {
            continue;
        }
        const key = cwd.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        dedupedPaths.push(cwd);
        if (dedupedPaths.length >= limit) {
            break;
        }
    }

    setSessionListCache(cacheKey, dedupedPaths);
    return dedupedPaths;
}

function resolveSessionFilePath(source, filePath, sessionId) {
    const root = source === 'claude' ? getClaudeProjectsDir() : getCodexSessionsDir();
    if (!root || !fs.existsSync(root)) {
        return '';
    }

    if (typeof filePath === 'string' && filePath.trim()) {
        const expandedPath = expandHomePath(filePath.trim());
        const targetPath = expandedPath ? path.resolve(expandedPath) : '';
        if (targetPath && fs.existsSync(targetPath) && isPathInside(targetPath, root)) {
            return targetPath;
        }
    }

    if (typeof sessionId === 'string' && sessionId.trim()) {
        const targetId = sessionId.trim().toLowerCase();
        const files = collectJsonlFiles(root, 5000);
        const matchedFile = files.find(item => path.basename(item, '.jsonl').toLowerCase() === targetId);
        if (matchedFile && fs.existsSync(matchedFile)) {
            return matchedFile;
        }
    }

    return '';
}

function findClaudeSessionIndexPath(sessionFilePath) {
    const root = getClaudeProjectsDir();
    if (!root || !sessionFilePath) {
        return '';
    }
    if (!isPathInside(sessionFilePath, root)) {
        return '';
    }
    let current = path.dirname(sessionFilePath);
    const resolvedRoot = path.resolve(root);
    while (current && isPathInside(current, resolvedRoot)) {
        const candidate = path.join(current, 'sessions-index.json');
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return '';
}

function canListenPort(host, port) {
    return new Promise((resolve) => {
        const tester = net.createServer();
        tester.unref();
        tester.once('error', () => {
            resolve(false);
        });
        tester.once('listening', () => {
            tester.close(() => resolve(true));
        });
        tester.listen(port, host);
    });
}

async function findAvailablePort(host, startPort, maxAttempts = 20) {
    const start = parseInt(String(startPort), 10);
    if (!Number.isFinite(start) || start <= 0) {
        return 0;
    }
    const attempts = Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 20;
    for (let offset = 0; offset < attempts; offset += 1) {
        const candidate = start + offset;
        if (candidate > 65535) {
            break;
        }
        // eslint-disable-next-line no-await-in-loop
        const ok = await canListenPort(host, candidate);
        if (ok) {
            return candidate;
        }
    }
    return 0;
}

function normalizeBuiltinProxySettings(raw) {
    const merged = {
        ...DEFAULT_BUILTIN_PROXY_SETTINGS,
        ...(isPlainObject(raw) ? raw : {})
    };
    const host = typeof merged.host === 'string' ? merged.host.trim() : '';
    const port = parseInt(String(merged.port), 10);
    const provider = typeof merged.provider === 'string' ? merged.provider.trim() : '';
    const authSourceRaw = typeof merged.authSource === 'string' ? merged.authSource.trim().toLowerCase() : '';
    const timeoutMs = parseInt(String(merged.timeoutMs), 10);
    const authSource = authSourceRaw === 'profile' || authSourceRaw === 'none' ? authSourceRaw : 'provider';

    return {
        enabled: merged.enabled !== false,
        host: host || DEFAULT_BUILTIN_PROXY_SETTINGS.host,
        port: Number.isFinite(port) && port > 0 && port <= 65535 ? port : DEFAULT_BUILTIN_PROXY_SETTINGS.port,
        provider,
        authSource,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000 ? timeoutMs : DEFAULT_BUILTIN_PROXY_SETTINGS.timeoutMs
    };
}

function readBuiltinProxySettings() {
    const parsed = readJsonFile(BUILTIN_PROXY_SETTINGS_FILE, null);
    return normalizeBuiltinProxySettings(parsed);
}

function resolveBuiltinProxyProviderName(rawProviderName, providers = {}, preferredProvider = '') {
    const providerMap = providers && isPlainObject(providers) ? providers : {};
    const providerNames = Object.keys(providerMap)
        .filter((name) => name && name !== BUILTIN_PROXY_PROVIDER_NAME);
    const requested = typeof rawProviderName === 'string' ? rawProviderName.trim() : '';
    if (requested && requested !== BUILTIN_PROXY_PROVIDER_NAME && providerMap[requested]) {
        return requested;
    }
    const preferred = typeof preferredProvider === 'string' ? preferredProvider.trim() : '';
    if (preferred && preferred !== BUILTIN_PROXY_PROVIDER_NAME && providerMap[preferred]) {
        return preferred;
    }
    return providerNames[0] || '';
}

function saveBuiltinProxySettings(payload = {}, options = {}) {
    const current = readBuiltinProxySettings();
    const merged = normalizeBuiltinProxySettings({
        ...current,
        ...(isPlainObject(payload) ? payload : {})
    });

    if (!merged.host) {
        return { error: '代理 host 不能为空' };
    }
    if (!Number.isFinite(merged.port) || merged.port <= 0 || merged.port > 65535) {
        return { error: '代理端口无效（1-65535）' };
    }

    const { config } = readConfigOrVirtualDefault();
    const providers = config && isPlainObject(config.model_providers) ? config.model_providers : {};
    const preferredProvider = typeof config.model_provider === 'string' ? config.model_provider.trim() : '';
    const finalProvider = resolveBuiltinProxyProviderName(merged.provider, providers, preferredProvider);

    const normalized = {
        ...merged,
        provider: finalProvider
    };

    if (!options.skipWrite) {
        writeJsonAtomic(BUILTIN_PROXY_SETTINGS_FILE, normalized);
    }

    return {
        success: true,
        settings: normalized
    };
}

function buildProxyListenUrl(settings) {
    const host = formatHostForUrl(settings.host || DEFAULT_BUILTIN_PROXY_SETTINGS.host);
    return `http://${host}:${settings.port}`;
}

function hasCodexConfigReadyForProxy() {
    const result = readConfigOrVirtualDefault();
    if (!result || result.isVirtual) {
        return false;
    }
    const config = result.config || {};
    if (!isPlainObject(config.model_providers)) {
        return false;
    }
    const providerNames = Object.keys(config.model_providers)
        .filter((name) => name && name !== BUILTIN_PROXY_PROVIDER_NAME);
    return providerNames.length > 0;
}

function resolveBuiltinProxyUpstream(settings) {
    const { config } = readConfigOrVirtualDefault();
    const providers = config && isPlainObject(config.model_providers) ? config.model_providers : {};
    const currentProvider = typeof config.model_provider === 'string' ? config.model_provider.trim() : '';
    const providerName = resolveBuiltinProxyProviderName(settings.provider, providers, currentProvider);
    if (!providerName) {
        return { error: '未找到可用的上游 provider，请先添加 provider' };
    }
    if (providerName === BUILTIN_PROXY_PROVIDER_NAME) {
        return { error: `上游 provider 不能是 ${BUILTIN_PROXY_PROVIDER_NAME}` };
    }
    const provider = providers[providerName];
    if (!provider || !isPlainObject(provider)) {
        return { error: `上游 provider 不存在: ${providerName}` };
    }

    const baseUrl = typeof provider.base_url === 'string' ? provider.base_url.trim() : '';
    if (!baseUrl || !isValidHttpUrl(baseUrl)) {
        return { error: `上游 provider base_url 无效: ${providerName}` };
    }

    let token = '';
    if (settings.authSource === 'profile') {
        token = resolveAuthTokenFromCurrentProfile();
    } else if (settings.authSource === 'provider') {
        token = typeof provider.preferred_auth_method === 'string' ? provider.preferred_auth_method.trim() : '';
        if (!token) {
            token = resolveAuthTokenFromCurrentProfile();
        }
    }

    let authHeader = '';
    if (token) {
        authHeader = /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
    }

    return {
        providerName,
        baseUrl: normalizeBaseUrl(baseUrl),
        authHeader
    };
}

function createBuiltinProxyServer(settings, upstream) {
    const connections = new Set();
    const timeoutMs = settings.timeoutMs;

    const server = http.createServer((req, res) => {
        let parsedIncoming;
        try {
            parsedIncoming = new URL(req.url || '/', 'http://localhost');
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'invalid request path' }));
            return;
        }

        const incomingPath = parsedIncoming.pathname || '/';
        if (incomingPath === '/health' || incomingPath === '/status') {
            const body = JSON.stringify({
                ok: true,
                upstreamProvider: upstream.providerName,
                upstreamBaseUrl: upstream.baseUrl
            });
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(body, 'utf-8')
            });
            res.end(body, 'utf-8');
            return;
        }

        if (!(incomingPath === '/v1' || incomingPath.startsWith('/v1/'))) {
            const body = JSON.stringify({ error: 'proxy only supports /v1/* paths' });
            res.writeHead(404, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(body, 'utf-8')
            });
            res.end(body, 'utf-8');
            return;
        }

        const suffix = incomingPath === '/v1'
            ? ''
            : incomingPath.replace(/^\/v1\/?/, '');
        const targetBase = joinApiUrl(upstream.baseUrl, suffix);
        if (!targetBase) {
            const body = JSON.stringify({ error: 'failed to build upstream URL' });
            res.writeHead(500, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(body, 'utf-8')
            });
            res.end(body, 'utf-8');
            return;
        }

        let targetUrl;
        try {
            targetUrl = new URL(targetBase);
            targetUrl.search = parsedIncoming.search || '';
        } catch (e) {
            const body = JSON.stringify({ error: `invalid upstream URL: ${e.message}` });
            res.writeHead(500, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(body, 'utf-8')
            });
            res.end(body, 'utf-8');
            return;
        }

        const requestHeaders = { ...req.headers };
        delete requestHeaders.host;
        delete requestHeaders.connection;
        delete requestHeaders['content-length'];
        if (upstream.authHeader) {
            requestHeaders.authorization = upstream.authHeader;
        }
        requestHeaders['x-codexmate-proxy'] = '1';
        if (!requestHeaders['x-forwarded-for'] && req.socket && req.socket.remoteAddress) {
            requestHeaders['x-forwarded-for'] = req.socket.remoteAddress;
        }

        const transport = targetUrl.protocol === 'https:' ? https : http;
        const upstreamReq = transport.request({
            protocol: targetUrl.protocol,
            hostname: targetUrl.hostname,
            port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
            method: req.method || 'GET',
            path: `${targetUrl.pathname}${targetUrl.search}`,
            headers: requestHeaders,
            agent: targetUrl.protocol === 'https:' ? HTTPS_KEEP_ALIVE_AGENT : HTTP_KEEP_ALIVE_AGENT
        }, (upstreamRes) => {
            const responseHeaders = { ...upstreamRes.headers };
            delete responseHeaders.connection;
            res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
            upstreamRes.pipe(res);
        });

        upstreamReq.setTimeout(timeoutMs, () => {
            upstreamReq.destroy(new Error(`upstream timeout (${timeoutMs}ms)`));
        });

        upstreamReq.on('error', (err) => {
            if (res.headersSent) {
                try { res.destroy(err); } catch (_) {}
                return;
            }
            const body = JSON.stringify({ error: `proxy request failed: ${err.message}` });
            res.writeHead(502, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(body, 'utf-8')
            });
            res.end(body, 'utf-8');
        });

        req.pipe(upstreamReq);
    });

    server.on('connection', (socket) => {
        connections.add(socket);
        socket.on('close', () => connections.delete(socket));
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(settings.port, settings.host, () => {
            server.removeListener('error', reject);
            resolve({
                server,
                connections,
                settings,
                upstream,
                startedAt: toIsoTime(Date.now()),
                listenUrl: buildProxyListenUrl(settings)
            });
        });
    });
}

async function startBuiltinProxyRuntime(payload = {}) {
    if (g_builtinProxyRuntime) {
        return {
            error: '内建代理已在运行',
            runtime: {
                listenUrl: g_builtinProxyRuntime.listenUrl,
                upstreamProvider: g_builtinProxyRuntime.upstream.providerName
            }
        };
    }

    const saveResult = saveBuiltinProxySettings(payload);
    if (saveResult.error) {
        return { error: saveResult.error };
    }
    const settings = saveResult.settings;
    const upstream = resolveBuiltinProxyUpstream(settings);
    if (upstream.error) {
        return { error: upstream.error };
    }

    try {
        g_builtinProxyRuntime = await createBuiltinProxyServer(settings, upstream);
        return {
            success: true,
            running: true,
            listenUrl: g_builtinProxyRuntime.listenUrl,
            upstreamProvider: upstream.providerName,
            settings
        };
    } catch (e) {
        return { error: `启动内建代理失败: ${e.message}` };
    }
}

async function stopBuiltinProxyRuntime() {
    if (!g_builtinProxyRuntime) {
        return { success: true, running: false };
    }
    const runtime = g_builtinProxyRuntime;
    g_builtinProxyRuntime = null;

    await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
        };

        runtime.server.close(() => finish());
        setTimeout(() => finish(), 1000);
    });

    for (const socket of runtime.connections) {
        try { socket.destroy(); } catch (_) {}
    }
    runtime.connections.clear();

    return {
        success: true,
        running: false
    };
}

function getBuiltinProxyStatus() {
    const settings = readBuiltinProxySettings();
    return {
        running: !!g_builtinProxyRuntime,
        settings,
        runtime: g_builtinProxyRuntime
            ? {
                provider: DEFAULT_LOCAL_PROVIDER_NAME,
                startedAt: g_builtinProxyRuntime.startedAt,
                listenUrl: g_builtinProxyRuntime.listenUrl,
                upstreamProvider: g_builtinProxyRuntime.upstream.providerName,
                upstreamBaseUrl: g_builtinProxyRuntime.upstream.baseUrl
            }
            : null
    };
}

function applyBuiltinProxyProvider(params = {}) {
    const settings = readBuiltinProxySettings();
    const hostForUrl = formatHostForUrl(settings.host);
    const baseUrl = `http://${hostForUrl}:${settings.port}`;

    const { config } = readConfigOrVirtualDefault();
    const providers = config && isPlainObject(config.model_providers) ? config.model_providers : {};
    const exists = !!providers[BUILTIN_PROXY_PROVIDER_NAME];
    const saveResult = exists
        ? updateProviderInConfig({
            name: BUILTIN_PROXY_PROVIDER_NAME,
            url: baseUrl,
            key: '',
            allowManaged: true
        })
        : addProviderToConfig({
            name: BUILTIN_PROXY_PROVIDER_NAME,
            url: baseUrl,
            key: '',
            allowManaged: true
        });

    if (saveResult && saveResult.error) {
        return saveResult;
    }

    const switchToProxy = params.switchToProxy !== false;
    let targetModel = '';
    if (switchToProxy) {
        try {
            targetModel = cmdSwitch(BUILTIN_PROXY_PROVIDER_NAME, true) || '';
        } catch (e) {
            return { error: `写入代理 provider 成功，但切换失败: ${e.message}` };
        }
    }

    return {
        success: true,
        provider: BUILTIN_PROXY_PROVIDER_NAME,
        baseUrl,
        switched: switchToProxy,
        model: targetModel
    };
}

async function ensureBuiltinProxyForCodexDefault(params = {}) {
    const payload = isPlainObject(params) ? { ...params } : {};
    const switchToProxy = payload.switchToProxy !== false;
    delete payload.switchToProxy;
    payload.enabled = true;

    const saveResult = saveBuiltinProxySettings(payload);
    if (saveResult.error) {
        return { error: saveResult.error };
    }
    let nextSettings = saveResult.settings;

    let upstreamResult = resolveBuiltinProxyUpstream(nextSettings);
    if (upstreamResult.error) {
        return { error: upstreamResult.error };
    }

    const runtime = g_builtinProxyRuntime;
    const shouldRestart = !!runtime && (
        runtime.settings.host !== nextSettings.host
        || runtime.settings.port !== nextSettings.port
        || runtime.settings.authSource !== nextSettings.authSource
        || runtime.settings.timeoutMs !== nextSettings.timeoutMs
        || runtime.upstream.providerName !== upstreamResult.providerName
        || runtime.upstream.baseUrl !== upstreamResult.baseUrl
        || runtime.upstream.authHeader !== upstreamResult.authHeader
    );

    if (shouldRestart) {
        await stopBuiltinProxyRuntime();
    }

    if (!g_builtinProxyRuntime) {
        let startRes = await startBuiltinProxyRuntime(nextSettings);
        if (!startRes.success && /EADDRINUSE/i.test(String(startRes.error || ''))) {
            const fallbackPort = await findAvailablePort(nextSettings.host, nextSettings.port + 1, 30);
            if (fallbackPort > 0) {
                const retrySave = saveBuiltinProxySettings({
                    ...nextSettings,
                    port: fallbackPort,
                    enabled: true
                });
                if (retrySave.success) {
                    nextSettings = retrySave.settings;
                    upstreamResult = resolveBuiltinProxyUpstream(nextSettings);
                    if (upstreamResult.error) {
                        return { error: upstreamResult.error };
                    }
                    startRes = await startBuiltinProxyRuntime(nextSettings);
                }
            }
        }
        if (!startRes.success) {
            return { error: startRes.error || '启动内建代理失败' };
        }
    }

    let applyRes = {
        success: true,
        provider: BUILTIN_PROXY_PROVIDER_NAME,
        baseUrl: buildProxyListenUrl(nextSettings),
        switched: false,
        model: ''
    };
    if (switchToProxy) {
        applyRes = applyBuiltinProxyProvider({ switchToProxy: true });
        if (applyRes.error) {
            return applyRes;
        }
    }

    const status = getBuiltinProxyStatus();
    return {
        success: true,
        provider: applyRes.provider,
        baseUrl: applyRes.baseUrl,
        switched: applyRes.switched,
        model: applyRes.model || '',
        settings: status.settings,
        runtime: status.runtime
    };
}

function updateClaudeSessionIndex(indexPath, sessionFilePath, sessionId) {
    if (!indexPath || !fs.existsSync(indexPath)) {
        return;
    }
    const index = readJsonFile(indexPath, null);
    if (!index || !Array.isArray(index.entries)) {
        return;
    }
    const resolvedFile = sessionFilePath ? path.resolve(sessionFilePath) : '';
    const resolvedLower = resolvedFile ? resolvedFile.toLowerCase() : '';
    const filtered = index.entries.filter((entry) => {
        if (!entry || typeof entry !== 'object') {
            return false;
        }
        const entrySessionId = typeof entry.sessionId === 'string' ? entry.sessionId : '';
        if (sessionId && entrySessionId === sessionId) {
            return false;
        }
        if (entry.fullPath) {
            const expanded = expandHomePath(entry.fullPath);
            const entryPath = expanded ? path.resolve(expanded) : '';
            if (entryPath && resolvedLower && entryPath.toLowerCase() === resolvedLower) {
                return false;
            }
        }
        return true;
    });
    if (filtered.length === index.entries.length) {
        return;
    }
    index.entries = filtered;
    try {
        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
    } catch (e) {}
}

async function deleteSessionData(params = {}) {
    const source = params.source === 'claude' ? 'claude' : (params.source === 'codex' ? 'codex' : '');
    if (!source) {
        return { error: 'Invalid source' };
    }

    const filePath = resolveSessionFilePath(source, params.filePath, params.sessionId);
    if (!filePath) {
        return { error: 'Session file not found' };
    }

    const sessionId = params.sessionId || path.basename(filePath, '.jsonl');
    try {
        fs.unlinkSync(filePath);
    } catch (e) {
        return { error: `删除会话失败: ${e.message}` };
    }

    if (source === 'claude') {
        const indexPath = findClaudeSessionIndexPath(filePath);
        if (indexPath) {
            updateClaudeSessionIndex(indexPath, filePath, sessionId);
        }
    }

    invalidateSessionListCache();

    return {
        success: true,
        source,
        sessionId,
        filePath
    };
}

function generateCloneSessionId() {
    if (crypto.randomUUID) {
        return `clone-${crypto.randomUUID()}`;
    }
    const timePart = Date.now().toString(36);
    const randomPart = crypto.randomBytes(8).toString('hex');
    return `clone-${timePart}-${randomPart}`;
}

function allocateCloneSessionTarget(dirPath) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const sessionId = generateCloneSessionId();
        const filePath = path.join(dirPath, `${sessionId}.jsonl`);
        if (!fs.existsSync(filePath)) {
            return { sessionId, filePath };
        }
    }
    const fallbackId = `clone-${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
    return { sessionId: fallbackId, filePath: path.join(dirPath, `${fallbackId}.jsonl`) };
}

function parseTimestampMs(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value > 1e12) return value;
        if (value > 1e9) return value * 1000;
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            if (numeric > 1e12) return numeric;
            if (numeric > 1e9) return numeric * 1000;
            return numeric;
        }
    }
    return null;
}

async function cloneCodexSession(params = {}) {
    const source = params.source === 'codex' ? 'codex' : '';
    if (!source) {
        return { error: '仅支持 Codex 会话克隆' };
    }

    const filePath = resolveSessionFilePath(source, params.filePath, params.sessionId);
    if (!filePath) {
        return { error: 'Session file not found' };
    }

    let content = '';
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
        return { error: `读取会话失败: ${e.message}` };
    }

    if (!content.trim()) {
        return { error: 'Session file is empty' };
    }

    const lineEnding = detectLineEnding(content);
    const rawLines = content.split(/\r?\n/);
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
        rawLines.pop();
    }

    let originalSessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : '';
    if (!originalSessionId) {
        originalSessionId = path.basename(filePath, '.jsonl');
    }
    let maxTimestampMs = 0;

    for (const line of rawLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const record = JSON.parse(trimmed);
            if (record && record.type === 'session_meta' && record.payload) {
                if (record.payload.id) {
                    originalSessionId = record.payload.id;
                }
            }
            if (record && record.timestamp !== undefined) {
                const ts = parseTimestampMs(record.timestamp);
                if (Number.isFinite(ts) && ts > maxTimestampMs) {
                    maxTimestampMs = ts;
                }
            }
        } catch (e) {}
    }

    const sessionsDir = getCodexSessionsDir();
    ensureDir(sessionsDir);
    const target = allocateCloneSessionTarget(sessionsDir);
    const newSessionId = target.sessionId;
    const newFilePath = target.filePath;
    const offsetMs = maxTimestampMs ? (Date.now() - maxTimestampMs) : 0;
    const cloneTime = new Date(Date.now() + 1);
    const cloneIso = cloneTime.toISOString();

    const outputLines = [];
    for (const line of rawLines) {
        const trimmed = line.trim();
        if (!trimmed) {
            outputLines.push(line);
            continue;
        }
        let record;
        try {
            record = JSON.parse(trimmed);
        } catch (e) {
            outputLines.push(line);
            continue;
        }

        if (originalSessionId && typeof record.sessionId === 'string' && record.sessionId === originalSessionId) {
            record.sessionId = newSessionId;
        }
        if (originalSessionId && typeof record.session_id === 'string' && record.session_id === originalSessionId) {
            record.session_id = newSessionId;
        }
        if (offsetMs && record.timestamp !== undefined) {
            const ts = parseTimestampMs(record.timestamp);
            if (Number.isFinite(ts)) {
                record.timestamp = new Date(ts + offsetMs).toISOString();
            }
        }
        if (record && record.type === 'session_meta' && record.payload && typeof record.payload === 'object') {
            record.payload = {
                ...record.payload,
                id: newSessionId,
                timestamp: cloneIso
            };
            record.timestamp = cloneIso;
        }

        outputLines.push(JSON.stringify(record));
    }

    const output = outputLines.join(lineEnding) + lineEnding;
    try {
        fs.writeFileSync(newFilePath, output, 'utf-8');
    } catch (e) {
        return { error: `写入克隆会话失败: ${e.message}` };
    }
    try {
        fs.utimesSync(newFilePath, cloneTime, cloneTime);
    } catch (e) {}

    invalidateSessionListCache();

    return {
        success: true,
        source,
        sourceLabel: 'Codex',
        sessionId: newSessionId,
        filePath: newFilePath
    };
}

function buildSessionMarkdown(payload) {
    const lines = [
        '# AI Session Export',
        '',
        `- Source: ${payload.sourceLabel}`,
        `- Session ID: ${payload.sessionId}`,
        `- Updated At: ${payload.updatedAt || 'unknown'}`,
        `- Working Directory: ${payload.cwd || 'unknown'}`,
        `- Original File: ${payload.filePath}`,
        '',
        '## Messages',
        ''
    ];

    if (!payload.messages || payload.messages.length === 0) {
        lines.push('(no user/assistant messages found)');
        lines.push('');
        return lines.join('\n');
    }

    payload.messages.forEach((message, index) => {
        const role = message.role === 'assistant' ? 'Assistant' : 'User';
        const timeInfo = message.timestamp ? ` · ${message.timestamp}` : '';
        lines.push(`### ${index + 1}. ${role}${timeInfo}`);
        lines.push('');
        lines.push(message.text || '(empty message)');
        lines.push('');
    });

    return lines.join('\n');
}

function buildSessionPlainText(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return '';
    }

    const lines = [];
    messages.forEach((message) => {
        const role = normalizeRole(message && message.role) || 'unknown';
        const text = message && typeof message.text === 'string' ? message.text : '';
        lines.push(role);
        lines.push(text);
        lines.push('');
    });

    while (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }

    return lines.join('\n');
}

function resolveStateMaxMessages(state) {
    if (!state || typeof state !== 'object') {
        return MAX_EXPORT_MESSAGES;
    }

    return resolveMaxMessagesValue(state.maxMessages, MAX_EXPORT_MESSAGES);
}

function canAppendMessage(state) {
    const maxMessages = resolveStateMaxMessages(state);
    if (maxMessages === Infinity) {
        return true;
    }
    return state.messages.length < maxMessages;
}

function extractCodexMessageFromRecord(record, state, lineIndex = -1) {
    if (record.timestamp) {
        state.updatedAt = toIsoTime(record.timestamp, state.updatedAt);
    }

    if (record.type === 'session_meta' && record.payload) {
        state.sessionId = record.payload.id || state.sessionId;
        state.cwd = record.payload.cwd || state.cwd;
        return;
    }

    if (record.type === 'response_item' && record.payload && record.payload.type === 'message') {
        const role = normalizeRole(record.payload.role);
        if (role === 'user' || role === 'assistant' || role === 'system') {
            const text = extractMessageText(record.payload.content);
            if (text && canAppendMessage(state)) {
                state.messages.push({
                    role,
                    text,
                    timestamp: toIsoTime(record.timestamp, ''),
                    recordLineIndex: Number.isInteger(lineIndex) ? lineIndex : -1
                });
            }
        }
    }
}

function extractClaudeMessageFromRecord(record, state, lineIndex = -1) {
    if (record.timestamp) {
        state.updatedAt = toIsoTime(record.timestamp, state.updatedAt);
    }

    if (!state.sessionId && record.sessionId) {
        state.sessionId = record.sessionId;
    }

    if (!state.cwd && record.cwd) {
        state.cwd = record.cwd;
    }

    const role = normalizeRole(record.type);
    if (role === 'user' || role === 'assistant' || role === 'system') {
        const content = record.message ? record.message.content : '';
        const text = extractMessageText(content);
        if (text && canAppendMessage(state)) {
            state.messages.push({
                role,
                text,
                timestamp: toIsoTime(record.timestamp, ''),
                recordLineIndex: Number.isInteger(lineIndex) ? lineIndex : -1
            });
        }
    }
}

function recordHasCodexMessage(record) {
    if (!record || record.type !== 'response_item' || !record.payload) {
        return false;
    }
    if (record.payload.type !== 'message') {
        return false;
    }
    const role = normalizeRole(record.payload.role);
    if (role !== 'user' && role !== 'assistant' && role !== 'system') {
        return false;
    }
    const text = extractMessageText(record.payload.content);
    return !!text;
}

function recordHasClaudeMessage(record) {
    if (!record) {
        return false;
    }
    const role = normalizeRole(record.type);
    if (role !== 'user' && role !== 'assistant' && role !== 'system') {
        return false;
    }
    const content = record.message ? record.message.content : '';
    const text = extractMessageText(content);
    return !!text;
}

function recordHasMessage(record, source) {
    return source === 'codex'
        ? recordHasCodexMessage(record)
        : recordHasClaudeMessage(record);
}

function extractMessagesFromRecords(records, source, options = {}) {
    const maxMessages = resolveMaxMessagesValue(options.maxMessages, MAX_EXPORT_MESSAGES);
    const state = {
        sessionId: '',
        cwd: '',
        updatedAt: '',
        messages: [],
        maxMessages,
        truncated: false
    };

    for (let lineIndex = 0; lineIndex < records.length; lineIndex++) {
        const record = records[lineIndex];
        if (source === 'codex') {
            extractCodexMessageFromRecord(record, state, lineIndex);
        } else {
            extractClaudeMessageFromRecord(record, state, lineIndex);
        }

        if (state.maxMessages !== Infinity && state.messages.length >= state.maxMessages) {
            for (let i = lineIndex + 1; i < records.length; i++) {
                if (recordHasMessage(records[i], source)) {
                    state.truncated = true;
                    break;
                }
            }
            break;
        }
    }

    return state;
}

async function extractMessagesFromFile(filePath, source, options = {}) {
    const maxMessages = resolveMaxMessagesValue(options.maxMessages, MAX_EXPORT_MESSAGES);
    const state = {
        sessionId: '',
        cwd: '',
        updatedAt: '',
        messages: [],
        maxMessages,
        truncated: false
    };

    let stream;
    let rl;
    try {
        stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
        rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

        let lineIndex = 0;
        let limitReached = false;
        for await (const line of rl) {
            const currentLineIndex = lineIndex;
            lineIndex += 1;

            const trimmed = line.trim();
            if (!trimmed) continue;

            let record;
            try {
                record = JSON.parse(trimmed);
            } catch (e) {
                continue;
            }

            if (limitReached) {
                if (recordHasMessage(record, source)) {
                    state.truncated = true;
                    break;
                }
                continue;
            }

            if (source === 'codex') {
                extractCodexMessageFromRecord(record, state, currentLineIndex);
            } else {
                extractClaudeMessageFromRecord(record, state, currentLineIndex);
            }

            if (state.maxMessages !== Infinity && state.messages.length >= state.maxMessages) {
                limitReached = true;
            }
        }
    } catch (e) {
        const fallbackRecords = readJsonlRecords(filePath);
        return extractMessagesFromRecords(fallbackRecords, source, { maxMessages });
    } finally {
        if (rl) {
            try { rl.close(); } catch (e) {}
        }
        if (stream && !stream.destroyed && stream.destroy) {
            try { stream.destroy(); } catch (e) {}
        }
    }

    return state;
}

async function readSessionDetail(params = {}) {
    const source = params.source === 'claude' ? 'claude' : (params.source === 'codex' ? 'codex' : '');
    if (!source) {
        return { error: 'Invalid source' };
    }

    const filePath = resolveSessionFilePath(source, params.filePath, params.sessionId);
    if (!filePath) {
        return { error: 'Session file not found' };
    }

    const rawLimit = Number(params.messageLimit);
    const messageLimit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(rawLimit, MAX_SESSION_DETAIL_MESSAGES))
        : DEFAULT_SESSION_DETAIL_MESSAGES;

    const extracted = await extractMessagesFromFile(filePath, source);
    const sessionId = extracted.sessionId || params.sessionId || path.basename(filePath, '.jsonl');
    const sourceLabel = source === 'codex' ? 'Codex' : 'Claude Code';
    const allMessages = removeLeadingSystemMessage(Array.isArray(extracted.messages) ? extracted.messages : [])
        .map((message, messageIndex) => ({
            ...message,
            messageIndex
        }));
    const startIndex = Math.max(0, allMessages.length - messageLimit);
    const clippedMessages = allMessages.slice(startIndex);

    return {
        source,
        sourceLabel,
        sessionId,
        cwd: extracted.cwd || '',
        updatedAt: extracted.updatedAt || '',
        totalMessages: allMessages.length,
        clipped: allMessages.length > clippedMessages.length,
        messageLimit,
        messages: clippedMessages,
        filePath
    };
}

async function readSessionPlain(params = {}) {
    const source = params.source === 'claude' ? 'claude' : (params.source === 'codex' ? 'codex' : '');
    if (!source) {
        return { error: 'Invalid source' };
    }

    const filePath = resolveSessionFilePath(source, params.filePath, params.sessionId);
    if (!filePath) {
        return { error: 'Session file not found' };
    }

    let extracted;
    try {
        extracted = await extractMessagesFromFile(filePath, source, { maxMessages: Infinity });
    } catch (e) {
        extracted = null;
    }

    if (!extracted) {
        return { error: 'Failed to parse session file' };
    }

    if ((!extracted.messages || extracted.messages.length === 0) && !extracted.sessionId && !extracted.cwd) {
        const fallbackRecords = readJsonlRecords(filePath);
        if (fallbackRecords.length === 0) {
            return { error: 'Session file is empty' };
        }
        extracted = extractMessagesFromRecords(fallbackRecords, source, { maxMessages: Infinity });
    }

    const sessionId = extracted.sessionId || params.sessionId || path.basename(filePath, '.jsonl');
    const sourceLabel = source === 'codex' ? 'Codex' : 'Claude Code';
    const messages = removeLeadingSystemMessage(Array.isArray(extracted.messages) ? extracted.messages : []);
    const text = buildSessionPlainText(messages);

    return {
        source,
        sourceLabel,
        sessionId,
        title: sessionId,
        filePath,
        text
    };
}

async function exportSessionData(params = {}) {
    const source = params.source === 'claude' ? 'claude' : (params.source === 'codex' ? 'codex' : '');
    if (!source) {
        return { error: 'Invalid source' };
    }

    const maxMessages = resolveMaxMessagesValue(params.maxMessages, MAX_EXPORT_MESSAGES);
    const filePath = resolveSessionFilePath(source, params.filePath, params.sessionId);
    if (!filePath) {
        return { error: 'Session file not found' };
    }

    let extracted;
    try {
        extracted = await extractMessagesFromFile(filePath, source, { maxMessages });
    } catch (e) {
        extracted = null;
    }

    if (!extracted) {
        return { error: 'Failed to parse session file' };
    }

    if ((!extracted.messages || extracted.messages.length === 0) && !extracted.sessionId && !extracted.cwd) {
        const fallbackRecords = readJsonlRecords(filePath);
        if (fallbackRecords.length === 0) {
            return { error: 'Session file is empty' };
        }
        extracted = extractMessagesFromRecords(fallbackRecords, source, { maxMessages });
    }

    extracted.messages = removeLeadingSystemMessage(Array.isArray(extracted.messages) ? extracted.messages : []);

    if (!extracted.messages || extracted.messages.length === 0) {
        const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
        if (!stat || stat.size === 0) {
            return { error: 'Session file is empty' };
        }
    }

    const sessionId = extracted.sessionId || params.sessionId || path.basename(filePath, '.jsonl');
    const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const sourceLabel = source === 'codex' ? 'Codex' : 'Claude Code';
    const truncated = !!extracted.truncated;
    const maxMessagesLabel = maxMessages === Infinity ? 'all' : maxMessages;
    const markdown = buildSessionMarkdown({
        sourceLabel,
        sessionId,
        updatedAt: extracted.updatedAt,
        cwd: extracted.cwd,
        filePath,
        messages: extracted.messages
    });

    return {
        source,
        sourceLabel,
        sessionId,
        fileName: `${source}-session-${safeSessionId}.md`,
        content: markdown,
        truncated,
        maxMessages: maxMessagesLabel
    };
}

function buildExportPayload(includeKeys) {
    const { config } = readConfigOrVirtualDefault();
    const providers = config.model_providers || {};
    const providerData = {};
    for (const [name, provider] of Object.entries(providers)) {
        if (isBuiltinProxyProvider(name)) {
            continue;
        }
        providerData[name] = {
            baseUrl: provider.base_url || '',
            apiKey: includeKeys ? (provider.preferred_auth_method || '') : null
        };
    }

    return {
        version: 1,
        currentProvider: config.model_provider || '',
        currentModel: config.model || '',
        providers: providerData,
        models: readModels(),
        currentModels: readCurrentModels()
    };
}

function buildClaudeSharePayload(config = {}) {
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey : '';
    const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl : '';
    const model = typeof config.model === 'string' ? config.model : '';

    if (!baseUrl) return { error: 'Claude Base URL 未设置' };
    if (!apiKey) return { error: 'Claude API 密钥未设置' };

    return {
        payload: {
            baseUrl: baseUrl.trim(),
            apiKey: apiKey.trim(),
            model: (model && model.trim()) || DEFAULT_CLAUDE_MODEL
        }
    };
}

function buildProviderSharePayload(params = {}) {
    const name = typeof params.name === 'string' ? params.name.trim() : '';
    if (!name) {
        return { error: '缺少提供商名称' };
    }

    const { config } = readConfigOrVirtualDefault();
    const providers = config.model_providers || {};
    const provider = providers[name];
    if (!provider || typeof provider !== 'object') {
        return { error: `提供商不存在: ${name}` };
    }

    const baseUrl = typeof provider.base_url === 'string' ? provider.base_url.trim() : '';
    const apiKey = typeof provider.preferred_auth_method === 'string'
        ? provider.preferred_auth_method
        : '';

    if (!baseUrl) {
        return { error: `提供商 ${name} 缺少 base_url` };
    }

    return {
        payload: {
            name,
            baseUrl,
            apiKey
        }
    };
}

function normalizeImportPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return { error: 'Invalid import payload' };
    }

    const rawProviders = payload.providers || payload.model_providers || [];
    const providers = {};
    if (Array.isArray(rawProviders)) {
        for (const item of rawProviders) {
            if (!item || typeof item !== 'object') continue;
            const name = item.name || item.provider || '';
            const baseUrl = item.baseUrl || item.base_url || item.url || '';
            const apiKey = item.apiKey ?? item.key ?? item.preferred_auth_method ?? null;
            if (name && baseUrl) {
                providers[name] = { baseUrl, apiKey };
            }
        }
    } else if (typeof rawProviders === 'object') {
        for (const [name, item] of Object.entries(rawProviders)) {
            if (!item || typeof item !== 'object') continue;
            const baseUrl = item.baseUrl || item.base_url || item.url || '';
            const apiKey = item.apiKey ?? item.key ?? item.preferred_auth_method ?? null;
            if (name && baseUrl) {
                providers[name] = { baseUrl, apiKey };
            }
        }
    }

    if (Object.keys(providers).length === 0 && (!payload.models || payload.models.length === 0)) {
        return { error: 'Invalid import payload' };
    }

    return {
        providers,
        models: Array.isArray(payload.models) ? payload.models : [],
        currentProvider: typeof payload.currentProvider === 'string' ? payload.currentProvider : '',
        currentModel: typeof payload.currentModel === 'string' ? payload.currentModel : '',
        currentModels: payload.currentModels && typeof payload.currentModels === 'object' ? payload.currentModels : {}
    };
}

function importConfigData(payload, options = {}) {
    const normalized = normalizeImportPayload(payload);
    if (normalized.error) {
        return { error: normalized.error };
    }

    const overwriteProviders = !!options.overwriteProviders;
    const applyCurrent = !!options.applyCurrent;
    const applyCurrentModels = !!options.applyCurrentModels;

    const { config: existingConfig } = readConfigOrVirtualDefault();
    const existingProviders = existingConfig.model_providers || {};
    let addedProviders = 0;
    let updatedProviders = 0;

    for (const [name, provider] of Object.entries(normalized.providers)) {
        if (isBuiltinProxyProvider(name)) {
            continue;
        }
        if (existingProviders[name]) {
            if (overwriteProviders) {
                const apiKey = typeof provider.apiKey === 'string' && provider.apiKey
                    ? provider.apiKey
                    : undefined;
                cmdUpdate(name, provider.baseUrl, apiKey, true);
                updatedProviders += 1;
            }
        } else {
            const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey : '';
            cmdAdd(name, provider.baseUrl, apiKey, true);
            addedProviders += 1;
        }
    }

    let addedModels = 0;
    if (normalized.models.length > 0) {
        const existingModels = new Set(readModels());
        for (const model of normalized.models) {
            if (typeof model !== 'string' || !model.trim()) continue;
            if (!existingModels.has(model)) {
                cmdAddModel(model, true);
                existingModels.add(model);
                addedModels += 1;
            }
        }
    }

    if (applyCurrentModels && normalized.currentModels) {
        const currentModels = readCurrentModels();
        for (const [name, model] of Object.entries(normalized.currentModels)) {
            if (isBuiltinProxyProvider(name)) continue;
            if (typeof model !== 'string' || !model) continue;
            currentModels[name] = model;
        }
        writeCurrentModels(currentModels);
    }

    const { config: finalConfig } = readConfigOrVirtualDefault();
    const finalProviders = finalConfig.model_providers || {};
    if (applyCurrent && normalized.currentProvider) {
        if (finalProviders[normalized.currentProvider]) {
            cmdSwitch(normalized.currentProvider, true);
        }
        if (normalized.currentModel) {
            const models = readModels();
            if (!models.includes(normalized.currentModel)) {
                cmdAddModel(normalized.currentModel, true);
            }
            cmdUseModel(normalized.currentModel, true);
        }
    }

    return {
        success: true,
        summary: {
            addedProviders,
            updatedProviders,
            addedModels
        }
    };
}

function resolveSpeedTestTarget(params) {
    if (!params) return { error: 'Missing params' };

    if (params.name) {
        const { config } = readConfigOrVirtualDefault();
        const providers = config.model_providers || {};
        const provider = providers[params.name];
        if (!provider) {
            return { error: 'Provider not found' };
        }
        if (!provider.base_url) {
            return { error: 'Provider missing URL' };
        }
        return {
            url: provider.base_url,
            apiKey: provider.preferred_auth_method || ''
        };
    }

    if (params.url) {
        return { url: params.url, apiKey: '' };
    }

    return { error: 'Missing name or url' };
}

function runSpeedTest(targetUrl, apiKey, options = {}) {
    return new Promise((resolve) => {
        let parsed;
        try {
            parsed = new URL(targetUrl);
        } catch (e) {
            return resolve({ ok: false, error: 'Invalid URL' });
        }

        const timeoutMs = Number.isFinite(options.timeoutMs)
            ? Math.max(1000, Number(options.timeoutMs))
            : SPEED_TEST_TIMEOUT_MS;

        const transport = parsed.protocol === 'https:' ? https : http;
        const headers = {
            'User-Agent': 'codexmate-speed-test',
            'Accept': 'application/json'
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const start = Date.now();
        const req = transport.request(parsed, { method: 'GET', headers }, (res) => {
            res.on('data', () => {});
            res.on('end', () => {
                resolve({
                    ok: true,
                    status: res.statusCode || 0,
                    durationMs: Date.now() - start
                });
            });
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('timeout'));
        });

        req.on('error', (err) => {
            resolve({ ok: false, error: err.message, durationMs: Date.now() - start });
        });

        req.end();
    });
}

// ============================================================================
// 命令
// ============================================================================

// 交互式配置向导
async function cmdSetup() {
    console.log('\n交互式配置向导');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const lineQueue = [];
    let lineResolver = null;
    let rlClosed = false;
    rl.on('line', (line) => {
        if (lineResolver) {
            const resolve = lineResolver;
            lineResolver = null;
            resolve(line);
        } else {
            lineQueue.push(line);
        }
    });
    rl.on('close', () => {
        rlClosed = true;
        if (lineResolver) {
            const resolve = lineResolver;
            lineResolver = null;
            resolve('');
        }
    });
    const ask = async (question) => {
        if (question) {
            process.stdout.write(question);
        }
        if (lineQueue.length > 0) {
            return lineQueue.shift();
        }
        if (rlClosed) {
            return '';
        }
        return await new Promise(resolve => {
            lineResolver = resolve;
        });
    };

    let providerName = '';
    let baseUrl = '';
    let apiKey = '';
    let modelName = '';
    let isCustomProvider = false;

    try {
        const { config } = readConfigOrVirtualDefault();
        const providers = config.model_providers || {};
        const providerNames = Object.keys(providers);
        const defaultProvider = config.model_provider || providerNames[0] || '';
        let availableModels = [];
        let defaultModel = config.model || '';
        let modelFetchUnlimited = false;

        while (true) {
            console.log('\n选择提供商:');
            if (providerNames.length > 0) {
                providerNames.forEach((name, index) => {
                    console.log(`  ${index + 1}. ${name}`);
                });
                console.log(`  ${providerNames.length + 1}. 自定义`);
            } else {
                console.log('  (暂无提供商，需自定义)');
            }

            const suffix = defaultProvider ? ` (默认 ${defaultProvider})` : '';
            const input = (await ask(`请输入序号或名称${suffix}: `)).trim();

            if (!input) {
                if (defaultProvider) {
                    providerName = defaultProvider;
                    isCustomProvider = false;
                    break;
                }
                isCustomProvider = true;
                break;
            }

            if (/^\d+$/.test(input)) {
                const index = parseInt(input, 10);
                if (index >= 1 && index <= providerNames.length) {
                    providerName = providerNames[index - 1];
                    isCustomProvider = false;
                    break;
                }
                if (index === providerNames.length + 1) {
                    isCustomProvider = true;
                    break;
                }
                console.log('提示: 序号无效，请重试。');
                continue;
            }

            if (providers[input]) {
                providerName = input;
                isCustomProvider = false;
                break;
            }

            if (isValidProviderName(input)) {
                providerName = input;
                isCustomProvider = true;
                break;
            }

            console.log('提示: 名称仅支持字母/数字/._-');
        }

        if (isCustomProvider && !providerName) {
            while (true) {
                const nameInput = (await ask('请输入自定义提供商名称(字母/数字/._-): ')).trim();
                if (!nameInput) {
                    console.log('提示: 名称不能为空。');
                    continue;
                }
                if (!isValidProviderName(nameInput)) {
                    console.log('提示: 名称仅支持字母/数字/._-');
                    continue;
                }
                providerName = nameInput;
                break;
            }
        }

        if (isCustomProvider) {
            while (true) {
                const urlInput = (await ask('Base URL: ')).trim();
                if (!urlInput) {
                    console.log('提示: Base URL 不能为空。');
                    continue;
                }
                baseUrl = urlInput;
                break;
            }
            apiKey = (await ask('API Key (可空): ')).trim();
        }

        let modelFetchError = '';
        if (providerName) {
            if (isCustomProvider) {
                const res = await fetchModelsFromBaseUrl(baseUrl, apiKey);
                if (res.unlimited) {
                    modelFetchUnlimited = true;
                } else if (res.error) {
                    modelFetchError = res.error;
                } else {
                    availableModels = res.models || [];
                }
            } else {
                const res = await fetchProviderModels(providerName);
                if (res.unlimited) {
                    modelFetchUnlimited = true;
                } else if (res.error) {
                    modelFetchError = res.error;
                } else {
                    availableModels = res.models || [];
                }
            }
        }
        if (modelFetchUnlimited) {
            console.log('提示: 提供商未提供模型列表，视为不限，请手动输入。');
        } else if (modelFetchError) {
            console.log(`提示: 获取模型列表失败: ${modelFetchError}，请手动输入。`);
        }
        if (availableModels.length > 0) {
            if (!defaultModel || !availableModels.includes(defaultModel)) {
                defaultModel = availableModels[0];
            }
        }

        while (true) {
            console.log('\n选择模型:');
            if (availableModels.length > 0) {
                availableModels.forEach((name, index) => {
                    console.log(`  ${index + 1}. ${name}`);
                });
            } else {
                console.log('  (暂无模型，将使用自定义输入)');
            }

            const suffix = defaultModel ? ` (默认 ${defaultModel})` : '';
            const input = (await ask(`请输入序号或名称${suffix}: `)).trim();

            if (!input) {
                if (defaultModel) {
                    modelName = defaultModel;
                    break;
                }
                console.log('提示: 模型不能为空。');
                continue;
            }

            if (/^\d+$/.test(input)) {
                const index = parseInt(input, 10);
                if (index >= 1 && index <= availableModels.length) {
                    modelName = availableModels[index - 1];
                    break;
                }
                console.log('提示: 序号无效，请重试。');
                continue;
            }

            modelName = input;
            break;
        }

        console.log('\n即将应用:');
        console.log('  提供商:', providerName);
        if (isCustomProvider) {
            console.log('  Base URL:', baseUrl);
        }
        console.log('  模型:', modelName);

        const confirm = (await ask('确认应用? (Y/n): ')).trim().toLowerCase();
        if (confirm === 'n' || confirm === 'no') {
            console.log('已取消');
            return;
        }

        if (isCustomProvider) {
            if (providers[providerName]) {
                cmdUpdate(providerName, baseUrl, apiKey, true);
            } else {
                cmdAdd(providerName, baseUrl, apiKey, true);
            }
        }

        const latestModels = readModels();
        if (modelName && !latestModels.includes(modelName)) {
            cmdAddModel(modelName, true);
        }

        cmdSwitch(providerName, true);
        cmdUseModel(modelName, true);

        console.log('✓ 已应用配置');
        console.log('  提供商:', providerName);
        console.log('  模型:', modelName);
        console.log();
    } catch (e) {
        console.error('错误:', e.message || e);
        process.exitCode = 1;
    } finally {
        rl.close();
    }
}

// 显示当前状态
function cmdStatus() {
    const { config, isVirtual } = readConfigOrVirtualDefault();
    const current = config.model_provider || '未设置';
    const currentModel = config.model || '未设置';

    console.log('\n当前状态:');
    console.log('  提供商:', current);
    console.log('  模型:', currentModel);
    console.log('  模型列表: 接口提供');
    if (isVirtual) {
        console.log('  说明: 当前为虚拟默认配置（config.toml 尚未创建）');
    }
    console.log();
}

// 列出所有提供商
function cmdList() {
    const { config, isVirtual } = readConfigOrVirtualDefault();
    const providers = config.model_providers || {};
    const current = config.model_provider;

    console.log('\n提供商列表:');
    console.log('┌─────────────────────────────────────────────────────────┐');

    const names = Object.keys(providers);
    if (names.length === 0) {
        console.log('│  (无)                                                         │');
    } else {
        names.forEach(name => {
            const p = providers[name];
            const isCurrent = name === current;
            const marker = isCurrent ? '●' : ' ';
            const key = p.preferred_auth_method || '(无密钥)';
            const displayKey = key.length > 30 ? key.substring(0, 27) + '...' : key;

            console.log(`│ ${marker} ${name.padEnd(20)}  ${displayKey.padEnd(31)} │`);
        });
    }

    console.log('└─────────────────────────────────────────────────────────┘');
    console.log(`总计: ${names.length} 个提供商`);
    if (isVirtual) {
        console.log('提示: 当前使用虚拟默认配置（config.toml 尚未创建）');
    }
    console.log();
}

// 列出所有模型
async function cmdModels() {
    const res = await fetchProviderModels('');
    if (res.error) {
        console.error('错误: 获取模型列表失败:', res.error);
        process.exitCode = 1;
        return;
    }
    if (res.unlimited) {
        const label = res.provider ? ` (${res.provider})` : '';
        console.log(`\n可用模型${label}:`);
        console.log('  (接口未提供，视为不限)');
        console.log();
        return;
    }
    const models = Array.isArray(res.models) ? res.models : [];
    const label = res.provider ? ` (${res.provider})` : '';
    console.log(`\n可用模型${label}:`);
    if (models.length === 0) {
        console.log('  (空)');
    } else {
        models.forEach((m, i) => {
            console.log(`  ${i + 1}. ${m}`);
        });
    }
    console.log();
}

// 切换提供商
function cmdSwitch(providerName, silent = false) {
    const config = readConfig();
    const providers = config.model_providers || {};

    if (!providers[providerName]) {
        if (!silent) {
            console.error('错误: 提供商不存在:', providerName);
            console.log('\n可用的提供商:');
            Object.keys(providers).forEach(name => console.log('  -', name));
        }
        throw new Error('提供商不存在');
    }

    // 切换提供商
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const newContent = content.replace(
        /^(model_provider\s*=\s*)(["']).*?(["'])/m,
        `$1$2${providerName}$3`
    );
    writeConfig(newContent);

    // 更新认证信息
    const apiKey = providers[providerName].preferred_auth_method || '';
    updateAuthJson(apiKey);

    // 切换到该提供商的模型
    const currentModels = readCurrentModels();
    const targetModel = currentModels[providerName] || readModels()[0];
    const content2 = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const modelRegex = /^(model\s*=\s*)(["']).*?(["'])/m;
    if (modelRegex.test(content2)) {
        const newContent2 = content2.replace(modelRegex, `$1$2${targetModel}$3`);
        writeConfig(newContent2);
    }

    if (!silent) {
        console.log('✓ 已切换到:', providerName);
        console.log('✓ 当前模型:', targetModel);
        console.log();
    }
    recordRecentConfig(providerName, targetModel);
    return targetModel;
}

// 切换模型
function cmdUseModel(modelName, silent = false) {
    if (!modelName) {
        if (!silent) console.error('错误: 模型名称必填');
        throw new Error('模型名称必填');
    }
    const models = readModels();
    if (!models.includes(modelName)) {
        models.push(modelName);
        writeModels(models);
    }

    const config = readConfig();
    const currentProvider = config.model_provider;
    if (!currentProvider) {
        if (!silent) console.error('错误: 未设置当前提供商');
        throw new Error('未设置当前提供商');
    }

    // 更新模型
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const modelRegex = /^(model\s*=\s*)(["']).*?(["'])/m;
    if (modelRegex.test(content)) {
        const newContent = content.replace(modelRegex, `$1$2${modelName}$3`);
        writeConfig(newContent);
    }

    // 保存当前提供商的模型选择
    const currentModels = readCurrentModels();
    currentModels[currentProvider] = modelName;
    writeCurrentModels(currentModels);

    if (!silent) {
        console.log('✓ 已切换模型:', modelName);
        console.log();
    }
    recordRecentConfig(currentProvider, modelName);
}

// 添加提供商
function cmdAdd(name, baseUrl, apiKey, silent = false) {
    const providerName = typeof name === 'string' ? name.trim() : '';
    const providerBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim() : '';

    if (!providerName || !providerBaseUrl) {
        if (!silent) {
            console.error('用法: codexmate add <名称> <URL> [密钥]');
            console.log('\n示例:');
            console.log('  codexmate add 88code https://api.88code.ai/v1 sk-xxx');
        }
        throw new Error('名称和URL必填');
    }
    if (!isValidProviderName(providerName)) {
        if (!silent) console.error('错误: 名称仅支持字母/数字/._-');
        throw new Error('名称仅支持字母/数字/._-');
    }
    if (isReservedProviderNameForCreation(providerName)) {
        if (!silent) console.error('错误: local provider 为系统保留名称，不可新增');
        throw new Error('local provider 为系统保留名称，不可新增');
    }

    const config = readConfig();
    if (config.model_providers && config.model_providers[providerName]) {
        if (!silent) console.error('错误: 提供商已存在:', providerName);
        throw new Error('提供商已存在');
    }

    const safeName = escapeTomlBasicString(providerName);
    const safeBaseUrl = escapeTomlBasicString(providerBaseUrl);
    const safeApiKey = escapeTomlBasicString(apiKey || '');
    const newBlock = `
${buildModelProviderTableHeader(providerName)}
name = "${safeName}"
base_url = "${safeBaseUrl}"
wire_api = "responses"
requires_openai_auth = false
preferred_auth_method = "${safeApiKey}"
request_max_retries = 4
stream_max_retries = 10
stream_idle_timeout_ms = 300000
`;

    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    writeConfig(content.trimEnd() + '\n' + newBlock);

    // 初始化当前模型
    const currentModels = readCurrentModels();
    if (!currentModels[providerName]) {
        currentModels[providerName] = readModels()[0];
        writeCurrentModels(currentModels);
    }

    if (!silent) {
        console.log('✓ 已添加提供商:', providerName);
        console.log('  URL:', providerBaseUrl);
        console.log();
    }
}

// 删除提供商
function cmdDelete(name, silent = false) {
    const res = performProviderDeletion(name, { silent });
    if (res.error) {
        throw new Error(res.error);
    }
    if (!silent) {
        console.log('✓ 已删除提供商:', name);
        if (res.switched && res.provider) {
            console.log(`  已自动切换到 provider: ${res.provider}，model: ${res.model || '(未设置)'}`);
        }
        console.log();
    }
}

// 更新提供商
function cmdUpdate(name, baseUrl, apiKey, silent = false, options = {}) {
    const allowManaged = !!(options && options.allowManaged);
    if (!name) {
        if (!silent) console.error('错误: 提供商名称必填');
        throw new Error('提供商名称必填');
    }
    if (isNonEditableProvider(name) && !allowManaged) {
        const msg = isDefaultLocalProvider(name)
            ? 'local provider 为系统保留项，不可编辑'
            : '本地代理配置为系统内建项，不可编辑';
        if (!silent) console.error(`错误: ${msg}`);
        throw new Error(msg);
    }

    const config = readConfig();
    if (!config.model_providers || !config.model_providers[name]) {
        if (!silent) console.error('错误: 提供商不存在:', name);
        throw new Error('提供商不存在');
    }

    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const providerConfig = config.model_providers[name];
    const providerSegments = providerConfig && Array.isArray(providerConfig.__codexmate_legacy_segments)
        ? providerConfig.__codexmate_legacy_segments
        : null;
    const ranges = findProviderSectionRanges(content, name, providerSegments);
    if (ranges.length === 0) {
        if (!silent) console.error('错误: 无法找到提供商配置块');
        throw new Error('无法找到提供商配置块');
    }

    const replaceTomlStringField = (block, fieldName, rawValue) => {
        const safeValue = escapeTomlBasicString(rawValue);
        const escapedFieldName = escapeRegex(fieldName);
        const tripleStartRegex = new RegExp(`^(\\s*${escapedFieldName}\\s*=\\s*)(\"\"\"|''')`, 'm');
        const tripleStartMatch = tripleStartRegex.exec(block);
        if (tripleStartMatch) {
            const prefixStart = tripleStartMatch.index;
            const prefixEnd = prefixStart + tripleStartMatch[1].length;
            const tripleQuote = tripleStartMatch[2];
            const valueStart = prefixEnd + tripleQuote.length;
            const valueEnd = block.indexOf(tripleQuote, valueStart);
            if (valueEnd === -1) {
                throw new Error(`${fieldName} 使用了未闭合的多行 TOML 字符串，无法安全更新`);
            }
            const lineEndIndex = block.indexOf('\n', valueEnd + tripleQuote.length);
            const tailEnd = lineEndIndex === -1 ? block.length : lineEndIndex;
            const tail = block.slice(valueEnd + tripleQuote.length, tailEnd);
            const tailMatch = tail.match(/^(\s+#.*)?\s*$/);
            if (!tailMatch) {
                throw new Error(`${fieldName} 多行字符串后的语法不受支持，无法安全更新`);
            }
            const commentSuffix = tailMatch[1] || '';
            const replacementLine = `${block.slice(prefixStart, prefixEnd)}"${safeValue}"${commentSuffix}`;
            return block.slice(0, prefixStart) + replacementLine + block.slice(tailEnd);
        }

        const withCommentRegex = new RegExp(
            `^(\\s*${escapedFieldName}\\s*=\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'[^'\\n]*')(\\s+#.*)?$`,
            'm'
        );
        let replaced = false;
        let next = block.replace(
            withCommentRegex,
            (_, prefix, suffix = '') => {
                replaced = true;
                return `${prefix}"${safeValue}"${suffix}`;
            }
        );
        if (!replaced) {
            const fallbackRegex = new RegExp(`^(\\s*${escapedFieldName}\\s*=\\s*)(.*?)(\\s+#.*)?$`, 'm');
            next = next.replace(
                fallbackRegex,
                (_, prefix, __, suffix = '') => `${prefix}"${safeValue}"${suffix}`
            );
        }
        return next;
    };

    let newContent = content;
    const sorted = ranges.sort((a, b) => b.start - a.start);
    for (const range of sorted) {
        const providerBlock = newContent.slice(range.start, range.end);
        let updatedBlock = providerBlock;
        if (baseUrl) {
            updatedBlock = replaceTomlStringField(updatedBlock, 'base_url', baseUrl);
        }
        if (apiKey !== undefined) {
            updatedBlock = replaceTomlStringField(updatedBlock, 'preferred_auth_method', apiKey);
        }
        newContent = newContent.slice(0, range.start) + updatedBlock + newContent.slice(range.end);
    }

    writeConfig(newContent.trim());

    // 如果更新了 API Key 且该提供商是当前激活的，同步更新 auth.json
    const currentProvider = config.model_provider;
    if (apiKey !== undefined && name === currentProvider) {
        updateAuthJson(apiKey);
    }

    if (!silent) {
        console.log('✓ 已更新提供商:', name);
        console.log();
    }
}

// 添加模型
function cmdAddModel(modelName, silent = false) {
    if (!modelName) {
        if (!silent) console.error('用法: codexmate add-model <模型名称>');
        throw new Error('模型名称必填');
    }

    const models = readModels();
    if (models.includes(modelName)) {
        if (!silent) console.log('模型已存在:', modelName);
        return;
    }

    models.push(modelName);
    writeModels(models);

    if (!silent) {
        console.log('✓ 已添加模型:', modelName);
        console.log();
    }
}

// 删除模型
function cmdDeleteModel(modelName, silent = false) {
    const models = readModels();
    const index = models.indexOf(modelName);
    if (index === -1) {
        if (!silent) console.error('错误: 模型不存在:', modelName);
        throw new Error('模型不存在');
    }

    if (models.length <= 1) {
        if (!silent) console.error('错误: 至少需要保留一个模型');
        throw new Error('至少需要保留一个模型');
    }

    models.splice(index, 1);
    writeModels(models);

    // 检查是否有提供商使用该模型
    const currentModels = readCurrentModels();
    let needsUpdate = false;
    for (const [provider, currentModel] of Object.entries(currentModels)) {
        if (currentModel === modelName) {
            currentModels[provider] = models[0];
            needsUpdate = true;
        }
    }

    if (needsUpdate) {
        writeCurrentModels(currentModels);
    }

    if (!silent) {
        console.log('✓ 已删除模型:', modelName);
        console.log();
    }
}

// 脱敏 key
function maskKey(key) {
    if (!key) return '';
    if (key.length <= 8) return '****';
    return key.substring(0, 4) + '...' + key.substring(key.length - 4);
}

// 应用到 Claude Code settings.json（跨平台）
function applyToClaudeSettings(config = {}) {
    try {
        const apiKey = (config.apiKey || '').trim();
        if (!apiKey) {
            return { success: false, mode: 'settings-file', error: '请先输入 API Key' };
        }

        const baseUrl = (config.baseUrl || 'https://open.bigmodel.cn/api/anthropic').trim();
        const model = (config.model || DEFAULT_CLAUDE_MODEL).trim();
        const readResult = readJsonObjectFromFile(CLAUDE_SETTINGS_FILE, {});
        if (!readResult.ok) {
            return { success: false, mode: 'settings-file', error: readResult.error };
        }

        const currentSettings = readResult.data;
        const currentEnv = (currentSettings.env && typeof currentSettings.env === 'object' && !Array.isArray(currentSettings.env))
            ? currentSettings.env
            : {};

        const nextEnv = {
            ...currentEnv,
            ANTHROPIC_API_KEY: apiKey,
            ANTHROPIC_BASE_URL: baseUrl,
            ANTHROPIC_MODEL: model
        };
        delete nextEnv.ANTHROPIC_AUTH_TOKEN;
        delete nextEnv.CLAUDE_CODE_USE_KEY;

        const nextSettings = {
            ...currentSettings,
            env: nextEnv
        };

        ensureDir(CLAUDE_DIR);
        const backupPath = backupFileIfNeededOnce(CLAUDE_SETTINGS_FILE);
        writeJsonAtomic(CLAUDE_SETTINGS_FILE, nextSettings);

        const result = {
            success: true,
            mode: 'settings-file',
            targetPath: CLAUDE_SETTINGS_FILE,
            updatedKeys: [
                'env.ANTHROPIC_API_KEY',
                'env.ANTHROPIC_BASE_URL',
                'env.ANTHROPIC_MODEL'
            ]
        };
        if (backupPath) {
            result.backupPath = backupPath;
        }
        return result;
    } catch (e) {
        return {
            success: false,
            mode: 'settings-file',
            error: e.message || '应用 Claude 配置失败'
        };
    }
}

function readClaudeSettingsInfo() {
    const readResult = readJsonObjectFromFile(CLAUDE_SETTINGS_FILE, {});
    if (!readResult.ok) {
        return {
            error: readResult.error || '读取 Claude 配置失败',
            exists: !!readResult.exists,
            targetPath: CLAUDE_SETTINGS_FILE
        };
    }

    const settings = readResult.data || {};
    const env = (settings.env && typeof settings.env === 'object' && !Array.isArray(settings.env))
        ? settings.env
        : {};

    return {
        exists: !!readResult.exists,
        targetPath: CLAUDE_SETTINGS_FILE,
        apiKey: typeof env.ANTHROPIC_API_KEY === 'string' ? env.ANTHROPIC_API_KEY : '',
        baseUrl: typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL : '',
        model: typeof env.ANTHROPIC_MODEL === 'string' ? env.ANTHROPIC_MODEL : '',
        env
    };
}

// API: 打包 Claude 配置目录（系统 zip 可用则使用，否则回退 zip-lib）
async function prepareClaudeDirDownload() {
    try {
        if (!fs.existsSync(CLAUDE_DIR)) {
            return { error: 'Claude 配置目录不存在', path: CLAUDE_DIR };
        }

        const tempDir = os.tmpdir();
        const timestamp = Date.now();
        const zipFileName = `claude-config-${timestamp}.zip`;
        const zipFilePath = path.join(tempDir, zipFileName);

        const zipTool = resolveZipTool();
        if (zipTool.type === 'zip') {
            const cmd = `"${zipTool.cmd}" -0 -q -r "${zipFilePath}" "${CLAUDE_DIR}"`;
            execSync(cmd, { stdio: 'ignore' });
        } else {
            await zipLib.archiveFolder(CLAUDE_DIR, zipFilePath);
        }

        return {
            success: true,
            downloadPath: zipFilePath,
            fileName: zipFileName,
            sourcePath: CLAUDE_DIR
        };
    } catch (e) {
        return { error: `打包失败：${e.message}` };
    }
}

// API: 打包 Codex 配置目录（同策略）
async function prepareCodexDirDownload() {
    try {
        if (!fs.existsSync(CONFIG_DIR)) {
            return { error: 'Codex 配置目录不存在', path: CONFIG_DIR };
        }

        const tempDir = os.tmpdir();
        const timestamp = Date.now();
        const zipFileName = `${CODEX_BACKUP_NAME}-${timestamp}.zip`;
        const zipFilePath = path.join(tempDir, zipFileName);

        const zipTool = resolveZipTool();
        if (zipTool.type === 'zip') {
            const cmd = `"${zipTool.cmd}" -0 -q -r "${zipFilePath}" "${CONFIG_DIR}"`;
            execSync(cmd, { stdio: 'ignore' });
        } else {
            await zipLib.archiveFolder(CONFIG_DIR, zipFilePath);
        }

        return {
            success: true,
            downloadPath: zipFilePath,
            fileName: zipFileName,
            sourcePath: CONFIG_DIR
        };
    } catch (e) {
        return { error: `打包失败：${e.message}` };
    }
}

function copyDirRecursive(srcDir, destDir) {
    ensureDir(destDir);
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else if (entry.isSymbolicLink()) {
            const target = fs.readlinkSync(srcPath);
            fs.symlinkSync(target, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function writeUploadZip(base64, prefix, originalName = '') {
    let buffer;
    try {
        buffer = Buffer.from(base64 || '', 'base64');
    } catch (e) {
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
    const unzipTool = resolveUnzipTool();
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
            await zipLib.archiveFolder(dirPath, zipFilePath);
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

async function restoreClaudeDir(payload) {
    return await restoreConfigDirectoryFromUpload(payload, {
        targetDir: CLAUDE_DIR,
        requiredFileName: 'settings.json',
        markerDirName: '.claude',
        tempPrefix: 'claude-restore',
        backupPrefix: 'claude-config'
    });
}

async function restoreCodexDir(payload) {
    return await restoreConfigDirectoryFromUpload(payload, {
        targetDir: CONFIG_DIR,
        requiredFileName: 'config.toml',
        markerDirName: '.codex',
        tempPrefix: 'codex-restore',
        backupPrefix: 'codex-config'
    });
}

// CLI: 一行写入 Claude Code 配置
function cmdClaude(baseUrl, apiKey, model, silent = false) {
    const normalizedBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim() : '';
    const normalizedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    const normalizedModel = typeof model === 'string' && model.trim()
        ? model.trim()
        : DEFAULT_CLAUDE_MODEL;

    if (!normalizedBaseUrl || !normalizedKey) {
        if (!silent) {
            console.error('用法: codexmate claude <BaseURL> <API密钥> [模型]');
            console.log('\n示例:');
            console.log('  codexmate claude https://open.bigmodel.cn/api/anthropic sk-ant-xxx glm-4.7');
        }
        throw new Error('BaseURL 和 API 密钥必填');
    }

    const result = applyToClaudeSettings({
        baseUrl: normalizedBaseUrl,
        apiKey: normalizedKey,
        model: normalizedModel
    });

    if (!result || result.success === false) {
        const message = (result && result.error) || '应用 Claude 配置失败';
        if (!silent) console.error('错误:', message);
        throw new Error(message);
    }

    if (!silent) {
        console.log('✓ 已写入 Claude Code 配置');
        console.log('  Base URL:', normalizedBaseUrl);
        console.log('  模型:', normalizedModel);
        if (result.targetPath) {
            console.log('  目标文件:', result.targetPath);
        }
        if (result.backupPath) {
            console.log('  已自动备份:', result.backupPath);
        }
        console.log();
    }

    return result;
}

function commandExists(command, args = '') {
    try {
        execSync(`${command} ${args}`, { stdio: 'ignore', shell: process.platform === 'win32' });
        return true;
    } catch (e) {
        return false;
    }
}

function detectPreferredPackageManager() {
    const userAgent = typeof process.env.npm_config_user_agent === 'string'
        ? process.env.npm_config_user_agent.trim().toLowerCase()
        : '';
    if (userAgent.startsWith('pnpm/')) return 'pnpm';
    if (userAgent.startsWith('bun/')) return 'bun';
    if (userAgent.startsWith('npm/')) return 'npm';

    if (commandExists('pnpm', '--version')) return 'pnpm';
    if (commandExists('bun', '--version')) return 'bun';
    return 'npm';
}

function resolveCommandPath(command) {
    if (!command) return '';
    const locator = process.platform === 'win32' ? 'where' : 'which';
    try {
        const probe = spawnSync(locator, [command], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 2500
        });
        if (probe.error || probe.status !== 0) {
            return '';
        }
        const lines = String(probe.stdout || '')
            .split(/\r?\n/g)
            .map((line) => line.trim())
            .filter(Boolean);
        return lines[0] || '';
    } catch (e) {
        return '';
    }
}

function parseBinaryVersionOutput(text) {
    const raw = typeof text === 'string' ? text : '';
    const line = raw
        .split(/\r?\n/g)
        .map((item) => item.trim())
        .find(Boolean) || '';
    if (!line) return '';
    return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

function probeCliBinary(binName) {
    const attempts = [['--version'], ['-v'], ['version']];
    let lastError = '';

    for (const args of attempts) {
        const argString = args.join(' ').trim();
        const commandLine = argString ? `${binName} ${argString}` : binName;
        try {
            const stdout = execSync(commandLine, {
                encoding: 'utf8',
                windowsHide: true,
                timeout: 5000,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: process.platform === 'win32'
            });
            const version = parseBinaryVersionOutput(String(stdout || ''));
            return {
                installed: true,
                bin: binName,
                version: version || 'unknown',
                path: resolveCommandPath(binName),
                error: ''
            };
        } catch (error) {
            const err = error || {};
            const stdout = typeof err.stdout === 'string' ? err.stdout : String(err.stdout || '');
            const stderr = typeof err.stderr === 'string' ? err.stderr : String(err.stderr || '');
            const output = `${stdout}\n${stderr}`.trim();
            const version = parseBinaryVersionOutput(output);
            const status = Number.isFinite(err.status) ? err.status : null;
            if (version && status === 0) {
                return {
                    installed: true,
                    bin: binName,
                    version,
                    path: resolveCommandPath(binName),
                    error: ''
                };
            }
            if (version) {
                lastError = status !== null
                    ? `${binName} exited with ${status}: ${version}`
                    : `${binName} failed: ${version}`;
                continue;
            }
            const message = err && err.message ? String(err.message) : '';
            if (message && !/ENOENT/i.test(message)) {
                lastError = message;
            }
        }
    }

    return {
        installed: false,
        bin: binName,
        version: '',
        path: '',
        error: lastError
    };
}

function resolveInstallCommandsByPackageManager(packageManager) {
    const normalized = String(packageManager || '').trim().toLowerCase();
    const manager = normalized === 'pnpm' || normalized === 'bun' || normalized === 'npm'
        ? normalized
        : 'npm';
    const commandsByTarget = {};

    for (const target of CLI_INSTALL_TARGETS) {
        const pkg = target.packageName;
        if (manager === 'pnpm') {
            commandsByTarget[target.id] = {
                install: `pnpm add -g ${pkg}`,
                update: `pnpm up -g ${pkg}`,
                uninstall: `pnpm remove -g ${pkg}`
            };
            continue;
        }
        if (manager === 'bun') {
            commandsByTarget[target.id] = {
                install: `bun add -g ${pkg}`,
                update: `bun update -g ${pkg}`,
                uninstall: `bun remove -g ${pkg}`
            };
            continue;
        }
        commandsByTarget[target.id] = {
            install: `npm install -g ${pkg}`,
            update: `npm update -g ${pkg}`,
            uninstall: `npm uninstall -g ${pkg}`
        };
    }

    return {
        packageManager: manager,
        commandsByTarget
    };
}

function buildInstallStatusReport() {
    const packageManager = detectPreferredPackageManager();
    const targetReports = CLI_INSTALL_TARGETS.map((target) => {
        let hit = null;
        let lastError = '';
        for (const binName of target.bins) {
            const probe = probeCliBinary(binName);
            if (probe.installed) {
                hit = probe;
                break;
            }
            if (probe.error) {
                lastError = probe.error;
            }
        }
        return {
            id: target.id,
            name: target.name,
            packageName: target.packageName,
            installed: !!(hit && hit.installed),
            bin: hit ? hit.bin : (target.bins[0] || ''),
            version: hit ? hit.version : '',
            commandPath: hit ? hit.path : '',
            error: hit ? '' : lastError
        };
    });

    const commandSpec = resolveInstallCommandsByPackageManager(packageManager);
    return {
        platform: process.platform,
        packageManager: commandSpec.packageManager,
        targets: targetReports,
        commandsByTarget: commandSpec.commandsByTarget
    };
}

const ZIP_PATHS = [
    'zip'
];

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
        } catch (e) {}
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

// 压缩（系统 zip 优先，其次 zip-lib）
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

    // 生成输出文件名
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

// 解压（zip-lib）
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

    // 默认输出目录：zip文件同级目录下同名文件夹
    const baseName = path.basename(absZipPath, '.zip');
    const defaultOutputDir = path.join(path.dirname(absZipPath), baseName);
    const absOutputDir = outputDir ? path.resolve(outputDir) : defaultOutputDir;

    const unzipTool = resolveUnzipTool();

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

function resolveExportOutputPath(outputPath, defaultFileName) {
    const fallback = path.resolve(process.cwd(), defaultFileName);
    if (typeof outputPath !== 'string' || !outputPath.trim()) {
        return fallback;
    }

    const trimmed = outputPath.trim();
    const resolved = path.resolve(trimmed);
    const hasTrailingSep = /[\\\/]$/.test(trimmed);
    if (hasTrailingSep) {
        ensureDir(resolved);
        return path.join(resolved, defaultFileName);
    }

    if (fs.existsSync(resolved)) {
        try {
            const stat = fs.statSync(resolved);
            if (stat.isDirectory()) {
                return path.join(resolved, defaultFileName);
            }
        } catch (e) {}
    }

    return resolved;
}

function printExportSessionUsage() {
    console.log('\n用法: codexmate export-session --source <codex|claude> (--session-id <ID>|--file <PATH>) [--output <PATH>] [--max-messages <N|all|Infinity>]');
    console.log('\n示例:');
    console.log('  codexmate export-session --source codex --session-id 123456');
    console.log('  codexmate export-session --source claude --file "~/.claude/projects/demo/session.jsonl"');
    console.log('  codexmate export-session --source codex --session-id 123456 --max-messages=all');
}

function parseExportSessionArgs(args = []) {
    const options = {
        source: '',
        sessionId: '',
        filePath: '',
        output: '',
        maxMessages: undefined
    };
    const errors = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;

        if (arg.startsWith('--source=')) {
            options.source = arg.slice('--source='.length);
            continue;
        }
        if (arg === '--source') {
            options.source = args[i + 1] || '';
            i += 1;
            continue;
        }
        if (arg.startsWith('--session-id=')) {
            options.sessionId = arg.slice('--session-id='.length);
            continue;
        }
        if (arg === '--session-id') {
            options.sessionId = args[i + 1] || '';
            i += 1;
            continue;
        }
        if (arg.startsWith('--file=')) {
            options.filePath = arg.slice('--file='.length);
            continue;
        }
        if (arg === '--file') {
            options.filePath = args[i + 1] || '';
            i += 1;
            continue;
        }
        if (arg.startsWith('--output=')) {
            options.output = arg.slice('--output='.length);
            continue;
        }
        if (arg === '--output') {
            options.output = args[i + 1] || '';
            i += 1;
            continue;
        }
        if (arg.startsWith('--max-messages=')) {
            options.maxMessages = arg.slice('--max-messages='.length);
            continue;
        }
        if (arg === '--max-messages') {
            options.maxMessages = args[i + 1] || '';
            i += 1;
            continue;
        }

        errors.push(`未知参数: ${arg}`);
    }

    const normalizedSource = options.source.trim().toLowerCase();
    if (normalizedSource && normalizedSource !== 'codex' && normalizedSource !== 'claude') {
        errors.push('参数 --source 仅支持 codex 或 claude');
    }
    options.source = normalizedSource;

    if (!options.source) {
        errors.push('缺少 --source');
    }

    if (!options.sessionId && !options.filePath) {
        errors.push('必须指定 --session-id 或 --file');
    }

    if (options.maxMessages !== undefined) {
        const parsed = parseMaxMessagesValue(options.maxMessages);
        if (parsed === null) {
            errors.push('参数 --max-messages 无效');
        } else {
            options.maxMessages = parsed === Infinity ? Infinity : Math.max(1, Math.floor(parsed));
        }
    }

    return {
        options,
        error: errors.length > 0 ? errors.join('；') : ''
    };
}

async function cmdExportSession(args = []) {
    const parsed = parseExportSessionArgs(args);
    if (parsed.error) {
        console.error('错误:', parsed.error);
        printExportSessionUsage();
        process.exit(1);
    }

    const options = parsed.options;
    const maxMessages = resolveMaxMessagesValue(options.maxMessages, MAX_EXPORT_MESSAGES);
    let result;
    try {
        result = await exportSessionData({
            source: options.source,
            sessionId: options.sessionId,
            filePath: options.filePath,
            maxMessages
        });
    } catch (e) {
        console.error('导出失败:', e.message || e);
        process.exit(1);
    }

    if (result && result.error) {
        console.error('导出失败:', result.error);
        process.exit(1);
    }

    const defaultFileName = (result && result.fileName)
        ? result.fileName
        : `${options.source}-session-${options.sessionId || Date.now()}.md`;
    const outputPath = resolveExportOutputPath(options.output, defaultFileName);
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, (result && result.content) ? result.content : '', 'utf-8');

    console.log('\n✓ 会话已导出:', outputPath);
    if (result && result.truncated) {
        const label = maxMessages === Infinity ? 'all' : maxMessages;
        console.log(`! 已截断: 仅导出前 ${label} 条消息`);
        console.log('  可使用 --max-messages=all 导出完整内容');
    }
    console.log();
}

function parseStartOptions(args = []) {
    const options = { host: '' };
    if (!Array.isArray(args)) {
        return options;
    }

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;
        if (arg.startsWith('--host=')) {
            options.host = arg.slice('--host='.length);
            continue;
        }
        if (arg === '--host') {
            options.host = args[i + 1] || '';
            i += 1;
        }
    }

    return options;
}

function isAnyAddressHost(host) {
    return host === '0.0.0.0' || host === '::';
}

function formatHostForUrl(host) {
    const value = typeof host === 'string' ? host.trim() : '';
    if (!value) return '';
    if (value.startsWith('[') && value.endsWith(']')) {
        return value;
    }
    if (value.includes(':')) {
        return `[${value}]`;
    }
    return value;
}

function watchPathsForRestart(targets, onChange) {
    const disposers = [];
    const debounceMs = 300;
    let timer = null;

    const trigger = (info) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            onChange(info);
        }, debounceMs);
    };

    const addWatcher = (target, recursive) => {
        if (!fs.existsSync(target)) return;
        try {
            const watcher = fs.watch(target, { recursive }, (eventType, filename) => {
                if (!filename) return;
                const lower = filename.toLowerCase();
                if (!(/\.(html|js|mjs|css)$/.test(lower))) return;
                trigger({ target, eventType, filename });
            });
            disposers.push(() => watcher.close());
            return true;
        } catch (e) {
            return false;
        }
    };

    for (const target of targets) {
        const ok = addWatcher(target, true);
        if (!ok) {
            addWatcher(target, false);
        }
    }

    return () => {
        for (const dispose of disposers) {
            try { dispose(); } catch (_) {}
        }
    };
}

function createWebServer({ htmlPath, assetsDir, webDir, host, port, openBrowser }) {
    const connections = new Set();

    const server = http.createServer((req, res) => {
        const requestPath = (req.url || '/').split('?')[0];
        if (requestPath === '/api') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const { action, params } = JSON.parse(body);
                    let result;

                    switch (action) {
                        case 'status':
                            const statusConfigResult = readConfigOrVirtualDefault();
                            const config = statusConfigResult.config;
                            const serviceTier = typeof config.service_tier === 'string' ? config.service_tier.trim() : '';
                            const modelReasoningEffort = typeof config.model_reasoning_effort === 'string' ? config.model_reasoning_effort.trim() : '';
                            result = {
                                provider: config.model_provider || '未设置',
                                model: config.model || '未设置',
                                serviceTier,
                                modelReasoningEffort,
                                configReady: !statusConfigResult.isVirtual,
                                configNotice: statusConfigResult.reason || '',
                                initNotice: consumeInitNotice()
                            };
                            break;
                        case 'install-status':
                            result = buildInstallStatusReport();
                            break;
                        case 'list':
                            const listConfigResult = readConfigOrVirtualDefault();
                            const listConfig = listConfigResult.config;
                            const providers = listConfig.model_providers || {};
                            const current = listConfig.model_provider;
                            result = {
                                configReady: !listConfigResult.isVirtual,
                                providers: Object.entries(providers).map(([name, p]) => ({
                                    name,
                                    url: p.base_url || '',
                                    key: maskKey(p.preferred_auth_method || ''),
                                    hasKey: !!(p.preferred_auth_method && p.preferred_auth_method.trim()),
                                    current: name === current,
                                    readOnly: isBuiltinProxyProvider(name),
                                    nonDeletable: isNonDeletableProvider(name),
                                    nonEditable: isNonEditableProvider(name)
                                }))
                            };
                            break;
                        case 'models':
                            {
                                const providerName = params && typeof params.provider === 'string' ? params.provider : '';
                                if (!providerName) {
                                    result = { error: 'Provider name is required' };
                                } else {
                                    const res = await fetchProviderModels(providerName);
                                    if (res.error) {
                                        result = { error: res.error, models: [], source: 'remote' };
                                    } else if (res.unlimited) {
                                        result = { models: [], source: 'remote', provider: res.provider || '', unlimited: true };
                                    } else {
                                        result = { models: res.models || [], source: 'remote', provider: res.provider || '' };
                                    }
                                }
                            }
                            break;
                        case 'models-by-url':
                            {
                                const baseUrl = params && typeof params.baseUrl === 'string' ? params.baseUrl : '';
                                const apiKey = params && typeof params.apiKey === 'string' ? params.apiKey : '';
                                if (!baseUrl) {
                                    result = { error: 'Base URL is required' };
                                } else {
                                    const res = await fetchModelsFromBaseUrl(baseUrl, apiKey);
                                    if (res.error) {
                                        result = { error: res.error, models: [], source: 'remote' };
                                    } else if (res.unlimited) {
                                        result = { models: [], source: 'remote', unlimited: true };
                                    } else {
                                        result = { models: res.models || [], source: 'remote' };
                                    }
                                }
                            }
                            break;
                        case 'get-config-template':
                            result = getConfigTemplate(params || {});
                            break;
                        case 'apply-config-template':
                            result = applyConfigTemplate(params || {});
                            break;
                        case 'add-provider':
                            result = addProviderToConfig(params || {});
                            break;
                        case 'update-provider':
                            result = updateProviderInConfig(params || {});
                            break;
                        case 'delete-provider':
                            result = deleteProviderFromConfig(params || {});
                            break;
                        case 'get-recent-configs':
                            result = { items: readRecentConfigs() };
                            break;
                        case 'config-health-check':
                            result = await buildConfigHealthReport(params || {});
                            break;
                        case 'get-agents-file':
                            result = readAgentsFile(params || {});
                            break;
                        case 'apply-agents-file':
                            result = applyAgentsFile(params || {});
                            break;
                        case 'get-openclaw-config':
                            result = readOpenclawConfigFile();
                            break;
                        case 'apply-openclaw-config':
                            result = applyOpenclawConfig(params || {});
                            break;
                        case 'reset-config':
                            result = resetConfigToDefault();
                            break;
                        case 'get-openclaw-agents-file':
                            result = readOpenclawAgentsFile();
                            break;
                        case 'apply-openclaw-agents-file':
                            result = applyOpenclawAgentsFile(params || {});
                            break;
                        case 'get-openclaw-workspace-file':
                            result = readOpenclawWorkspaceFile(params || {});
                            break;
                        case 'apply-openclaw-workspace-file':
                            result = applyOpenclawWorkspaceFile(params || {});
                            break;
                        case 'switch':
                        case 'use':
                        case 'add':
                        case 'delete':
                        case 'update':
                            result = { error: 'Codex 配置改动已切换为模板确认模式，请使用模板编辑器并手动确认应用。' };
                            break;
                        case 'add-model':
                            cmdAddModel(params.model, true);
                            result = { success: true };
                            break;
                        case 'delete-model':
                            cmdDeleteModel(params.model, true);
                            result = { success: true };
                            break;
                        case 'get-claude-settings':
                            result = readClaudeSettingsInfo();
                            break;
                        case 'apply-claude-config':
                            result = applyToClaudeSettings(params.config);
                            break;
                        case 'export-claude-share':
                            result = buildClaudeSharePayload(params && params.config ? params.config : {});
                            break;
                        case 'export-provider':
                            result = buildProviderSharePayload(params || {});
                            break;
                        case 'export-config':
                            result = {
                                data: buildExportPayload(!!params.includeKeys)
                            };
                            break;
                        case 'import-config':
                            result = importConfigData(params.payload, params.options || {});
                            break;
                        case 'speed-test': {
                            const target = resolveSpeedTestTarget(params);
                            if (target.error) {
                                result = { error: target.error };
                                break;
                            }
                            result = await runSpeedTest(target.url, target.apiKey);
                            break;
                        }
                        case 'list-sessions':
                            {
                                const source = typeof params.source === 'string' ? params.source.trim().toLowerCase() : '';
                                if (source && source !== 'codex' && source !== 'claude' && source !== 'all') {
                                    result = { error: 'Invalid source. Must be codex, claude, or all' };
                                } else {
                                    result = {
                                        sessions: listAllSessions(params),
                                        source: source || 'all'
                                    };
                                }
                            }
                            break;
                        case 'list-session-paths':
                            {
                                const source = typeof params.source === 'string' ? params.source.trim().toLowerCase() : '';
                                if (source && source !== 'codex' && source !== 'claude' && source !== 'all') {
                                    result = { error: 'Invalid source. Must be codex, claude, or all' };
                                } else {
                                    result = {
                                        paths: listSessionPaths(params)
                                    };
                                }
                            }
                            break;
                        case 'export-session':
                            result = await exportSessionData(params);
                            break;
                        case 'delete-session':
                            result = await deleteSessionData(params || {});
                            break;
                        case 'clone-session':
                            result = await cloneCodexSession(params || {});
                            break;
                        case 'session-detail':
                            result = await readSessionDetail(params);
                            break;
                        case 'session-plain':
                            result = await readSessionPlain(params);
                            break;
                        case 'download-claude-dir':
                            result = await prepareClaudeDirDownload();
                            break;
                        case 'download-codex-dir':
                            result = await prepareCodexDirDownload();
                            break;
                        case 'restore-claude-dir':
                            result = await restoreClaudeDir(params || {});
                            break;
                        case 'restore-codex-dir':
                            result = await restoreCodexDir(params || {});
                            break;
                        case 'list-auth-profiles':
                            result = {
                                profiles: listAuthProfilesInfo()
                            };
                            break;
                        case 'import-auth-profile':
                            result = importAuthProfileFromUpload(params || {});
                            break;
                        case 'switch-auth-profile':
                            {
                                const profileName = params && typeof params.name === 'string' ? params.name.trim() : '';
                                if (!profileName) {
                                    result = { error: '认证名称不能为空' };
                                } else {
                                    try {
                                        result = switchAuthProfile(profileName, { silent: true });
                                    } catch (e) {
                                        result = { error: e.message || '切换认证失败' };
                                    }
                                }
                            }
                            break;
                        case 'delete-auth-profile':
                            result = deleteAuthProfile(params && params.name ? params.name : '');
                            break;
                        case 'proxy-status':
                            result = getBuiltinProxyStatus();
                            break;
                        case 'proxy-save-config':
                            result = saveBuiltinProxySettings(params || {});
                            break;
                        case 'proxy-start':
                            result = await startBuiltinProxyRuntime(params || {});
                            break;
                        case 'proxy-stop':
                            result = await stopBuiltinProxyRuntime();
                            break;
                        case 'proxy-enable-codex-default':
                            result = await ensureBuiltinProxyForCodexDefault(params || {});
                            break;
                        case 'proxy-apply-provider':
                            result = applyBuiltinProxyProvider(params || {});
                            break;
                        case 'workflow-list':
                            result = listWorkflowDefinitions();
                            break;
                        case 'workflow-get':
                            {
                                const id = params && typeof params.id === 'string' ? params.id.trim() : '';
                                if (!id) {
                                    result = { error: 'workflow id is required' };
                                } else {
                                    result = getWorkflowDefinitionById(id);
                                }
                            }
                            break;
                        case 'workflow-validate':
                            {
                                const id = params && typeof params.id === 'string' ? params.id.trim() : '';
                                if (!id) {
                                    result = { ok: false, error: 'workflow id is required' };
                                    break;
                                }
                                const input = params && params.input && typeof params.input === 'object' && !Array.isArray(params.input)
                                    ? params.input
                                    : {};
                                result = validateWorkflowById(id, input);
                            }
                            break;
                        case 'workflow-run':
                            {
                                const id = params && typeof params.id === 'string' ? params.id.trim() : '';
                                if (!id) {
                                    result = { error: 'workflow id is required' };
                                    break;
                                }
                                const input = params && params.input && typeof params.input === 'object' && !Array.isArray(params.input)
                                    ? params.input
                                    : {};
                                result = await runWorkflowById(id, input, {
                                    allowWrite: !!(params && params.allowWrite),
                                    dryRun: !!(params && params.dryRun)
                                });
                            }
                            break;
                        case 'workflow-runs':
                            {
                                const rawLimit = params && Number.isFinite(params.limit) ? params.limit : parseInt(params && params.limit, 10);
                                const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.floor(rawLimit)) : 20;
                                result = {
                                    runs: listWorkflowRunRecords(limit),
                                    limit
                                };
                            }
                            break;
                        default:
                            result = { error: '未知操作' };
                    }

                    const responseBody = JSON.stringify(result, null, 2);
                    res.writeHead(200, {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Content-Length': Buffer.byteLength(responseBody, 'utf-8')
                    });
                    res.end(responseBody, 'utf-8');
                } catch (e) {
                    const errorBody = JSON.stringify({ error: e.message }, null, 2);
                    res.writeHead(500, {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Content-Length': Buffer.byteLength(errorBody, 'utf-8')
                    });
                    res.end(errorBody, 'utf-8');
                }
            });
        } else if (requestPath.startsWith('/web-ui/')) {
            const normalized = path.normalize(requestPath).replace(/^([\\.\\/])+/, '');
            const filePath = path.join(__dirname, normalized);
            if (!isPathInside(filePath, webDir)) {
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Forbidden');
                return;
            }
            if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Not Found');
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            const mime = ext === '.js' || ext === '.mjs'
                ? 'application/javascript; charset=utf-8'
                : ext === '.html'
                    ? 'text/html; charset=utf-8'
                : ext === '.css'
                    ? 'text/css; charset=utf-8'
                    : ext === '.json'
                        ? 'application/json; charset=utf-8'
                        : 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': mime });
            fs.createReadStream(filePath).pipe(res);
        } else if (requestPath.startsWith('/download/')) {
            const fileName = requestPath.slice('/download/'.length);
            const decodedFileName = decodeURIComponent(fileName);
            const tempDir = os.tmpdir();
            const filePath = path.join(tempDir, decodedFileName);

            if (!isPathInside(filePath, tempDir)) {
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Forbidden');
                return;
            }
            if (!fs.existsSync(filePath)) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('File Not Found');
                return;
            }
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Not a File');
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`,
                'Content-Length': stat.size
            });
            fs.createReadStream(filePath).pipe(res);
        } else if (requestPath.startsWith('/res/')) {
            const normalized = path.normalize(requestPath).replace(/^([\\.\\/])+/, '');
            const filePath = path.join(__dirname, normalized);
            if (!isPathInside(filePath, assetsDir)) {
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Forbidden');
                return;
            }
            if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Not Found');
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            const mime = ext === '.js'
                ? 'application/javascript; charset=utf-8'
                : ext === '.html'
                    ? 'text/html; charset=utf-8'
                : ext === '.json'
                    ? 'application/json; charset=utf-8'
                    : 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': mime });
            fs.createReadStream(filePath).pipe(res);
        } else {
            const html = fs.readFileSync(htmlPath, 'utf-8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        }
    });

    server.on('connection', (socket) => {
        connections.add(socket);
        socket.on('close', () => connections.delete(socket));
    });

    server.once('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            console.error(`! 启动失败: 端口 ${port} 已被占用，可能有残留的 codexmate run 实例。`);
            console.error('  请先停止旧实例或更换端口后重试。');
        } else {
            console.error('! 启动 Web UI 失败:', err && err.message ? err.message : err);
        }
        process.exit(1);
    });

    const openHost = isAnyAddressHost(host) ? DEFAULT_WEB_HOST : host;
    const openUrl = `http://${formatHostForUrl(openHost)}:${port}`;
    server.listen(port, host, () => {
        console.log('\n✓ Web UI 已启动:', openUrl);
        if (host && host !== openHost) {
            console.log('  监听地址:', host);
        }
        console.log('  按 Ctrl+C 退出\n');
        if (isAnyAddressHost(host)) {
            console.warn('! 安全提示: 当前监听所有网卡（无鉴权）。');
            console.warn('  建议仅在可信网络使用，或改用 --host 127.0.0.1。');
        }

        if (!process.env.CODEXMATE_NO_BROWSER && openBrowser) {
            const platform = process.platform;
            let command;
            const url = openUrl;

            if (platform === 'win32') {
                command = `start \"\" \"${url}\"`;
            } else if (platform === 'darwin') {
                command = `open \"${url}\"`;
            } else {
                command = `xdg-open \"${url}\"`;
            }

            exec(command, (error) => {
                if (error) console.warn('无法自动打开浏览器，请手动访问:', url);
            });
        }
    });

    const stop = () => new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            for (const socket of connections) {
                try { socket.destroy(); } catch (_) {}
            }
            connections.clear();
            resolve();
        };

        if (!server.listening) {
            finish();
            return;
        }

        server.close(() => finish());
        setTimeout(() => finish(), 800);
    });

    return { server, stop };
}

// 打开 Web UI
function cmdStart(options = {}) {
    const webDir = path.join(__dirname, 'web-ui');
    const newHtmlPath = path.join(webDir, 'index.html');
    const legacyHtmlPath = path.join(__dirname, 'web-ui.html');
    const htmlPath = fs.existsSync(newHtmlPath) ? newHtmlPath : legacyHtmlPath;
    const assetsDir = path.join(__dirname, 'res');
    if (!fs.existsSync(htmlPath)) {
        console.error('错误: Web UI 页面不存在（尝试路径: web-ui/index.html, web-ui.html）');
        process.exit(1);
    }

    const port = resolveWebPort();
    const host = resolveWebHost(options);

    let serverHandle = createWebServer({
        htmlPath,
        assetsDir,
        webDir,
        host,
        port,
        openBrowser: true
    });

    const proxySettings = readBuiltinProxySettings();
    const shouldAutoStartProxy = proxySettings.enabled || hasCodexConfigReadyForProxy();
    if (shouldAutoStartProxy) {
        ensureBuiltinProxyForCodexDefault({
            ...proxySettings,
            switchToProxy: false
        }).then((res) => {
            if (res && res.success && res.runtime && res.runtime.listenUrl) {
                const entryProvider = res.runtime.provider || DEFAULT_LOCAL_PROVIDER_NAME;
                const upstreamLabel = res.runtime.upstreamProvider ? `（上游: ${res.runtime.upstreamProvider}）` : '';
                console.log(`~ 内建代理已启动(${entryProvider}): ${res.runtime.listenUrl}${upstreamLabel}`);
            } else if (res && res.error) {
                console.warn(`! 内建代理启动失败: ${res.error}`);
            }
        }).catch((err) => {
            console.warn(`! 内建代理启动失败: ${err && err.message ? err.message : err}`);
        });
    }

    const stopWatch = watchPathsForRestart(
        [webDir, legacyHtmlPath],
        async (info) => {
            const fileLabel = info && info.filename ? info.filename : (info && info.target ? path.basename(info.target) : 'unknown');
            console.log(`\n~ 侦测到前端变更 (${fileLabel})，重启中...`);
            console.log('  正在停止旧服务...');
            try {
                await serverHandle.stop();
                console.log('  旧服务已停止');
            } catch (e) {
                console.warn('! 停止旧服务失败:', e.message || e);
            }
            await new Promise((resolve) => setTimeout(resolve, 80));
            try {
                serverHandle = createWebServer({
                    htmlPath,
                    assetsDir,
                    webDir,
                    host,
                    port,
                    openBrowser: false
                });
                console.log('✓ 已重启 Web UI 服务\n');
            } catch (e) {
                console.error('! 重启失败:', e.message || e);
            }
        }
    );

    const handleExit = () => {
        stopWatch();
        Promise.allSettled([
            serverHandle.stop(),
            stopBuiltinProxyRuntime()
        ]).finally(() => process.exit(0));
    };

    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);
}

function cmdAuth(args = []) {
    const subcommand = (args[0] || 'list').toLowerCase();

    if (subcommand === 'list') {
        const profiles = listAuthProfilesInfo();
        if (profiles.length === 0) {
            console.log('\n认证列表: (空)\n');
            return;
        }
        console.log('\n认证列表:');
        profiles.forEach((profile) => {
            const marker = profile.current ? '●' : ' ';
            const type = profile.type || 'unknown';
            const email = profile.email || '(无邮箱)';
            console.log(` ${marker} ${profile.name}  [${type}]  ${email}`);
        });
        console.log();
        return;
    }

    if (subcommand === 'status') {
        const profiles = listAuthProfilesInfo();
        const current = profiles.find((item) => item.current);
        if (!current) {
            console.log('\n当前认证: 未设置\n');
            return;
        }
        console.log('\n当前认证:');
        console.log('  名称:', current.name);
        console.log('  类型:', current.type || 'unknown');
        if (current.email) {
            console.log('  账号:', current.email);
        }
        if (current.expired) {
            console.log('  过期时间:', current.expired);
        }
        console.log();
        return;
    }

    if (subcommand === 'import' || subcommand === 'upload') {
        const filePath = args[1];
        const nameArg = args[2] && !args[2].startsWith('--') ? args[2] : '';
        const noActivate = args.includes('--no-activate');
        if (!filePath) {
            throw new Error('用法: codexmate auth import <json文件路径> [名称] [--no-activate]');
        }
        const result = importAuthProfileFromFile(filePath, {
            name: nameArg,
            activate: !noActivate
        });
        console.log(`✓ 已导入认证: ${result.profile.name}`);
        if (result.profile.email) {
            console.log(`  账号: ${result.profile.email}`);
        }
        if (!noActivate) {
            console.log('  已自动切换为当前认证');
        }
        console.log();
        return;
    }

    if (subcommand === 'switch' || subcommand === 'use') {
        const name = args[1];
        if (!name) {
            throw new Error('用法: codexmate auth switch <名称>');
        }
        switchAuthProfile(name);
        return;
    }

    if (subcommand === 'delete' || subcommand === 'remove') {
        const name = args[1];
        if (!name) {
            throw new Error('用法: codexmate auth delete <名称>');
        }
        const result = deleteAuthProfile(name);
        if (result.error) {
            throw new Error(result.error);
        }
        console.log(`✓ 已删除认证: ${name}`);
        if (result.switchedTo) {
            console.log(`  已自动切换到: ${result.switchedTo}`);
        }
        console.log();
        return;
    }

    throw new Error(`未知 auth 子命令: ${subcommand}`);
}

function parseProxyCliOptions(args = []) {
    const payload = {};
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--provider') {
            payload.provider = args[i + 1] || '';
            i += 1;
            continue;
        }
        if (arg === '--host') {
            payload.host = args[i + 1] || '';
            i += 1;
            continue;
        }
        if (arg === '--port') {
            const raw = args[i + 1];
            i += 1;
            if (raw === undefined) {
                return { error: '--port 缺少值' };
            }
            const port = parseInt(raw, 10);
            if (!Number.isFinite(port)) {
                return { error: '--port 必须是数字' };
            }
            payload.port = port;
            continue;
        }
        if (arg === '--auth-source') {
            payload.authSource = args[i + 1] || '';
            i += 1;
            continue;
        }
        if (arg === '--timeout-ms') {
            const raw = args[i + 1];
            i += 1;
            if (raw === undefined) {
                return { error: '--timeout-ms 缺少值' };
            }
            const timeoutMs = parseInt(raw, 10);
            if (!Number.isFinite(timeoutMs)) {
                return { error: '--timeout-ms 必须是数字' };
            }
            payload.timeoutMs = timeoutMs;
            continue;
        }
        if (arg === '--enable') {
            payload.enabled = true;
            continue;
        }
        if (arg === '--disable') {
            payload.enabled = false;
            continue;
        }
        if (arg === '--no-switch') {
            payload.switchToProxy = false;
            continue;
        }
        return { error: `未知参数: ${arg}` };
    }
    return { payload };
}

async function cmdProxy(args = []) {
    const subcommand = (args[0] || 'status').toLowerCase();
    const optionResult = parseProxyCliOptions(args.slice(1));
    if (optionResult.error) {
        throw new Error(optionResult.error);
    }
    const options = optionResult.payload || {};

    if (subcommand === 'status') {
        const status = getBuiltinProxyStatus();
        const settings = status.settings || DEFAULT_BUILTIN_PROXY_SETTINGS;
        console.log('\n内建代理状态:');
        console.log('  运行中:', status.running ? '是' : '否');
        console.log('  启用:', settings.enabled ? '是' : '否');
        console.log('  监听:', buildProxyListenUrl(settings));
        console.log('  上游 provider:', settings.provider || '(自动)');
        console.log('  鉴权来源:', settings.authSource);
        if (status.runtime) {
            console.log('  实际上游:', status.runtime.upstreamProvider);
            console.log('  启动时间:', status.runtime.startedAt);
        }
        console.log();
        return;
    }

    if (subcommand === 'set' || subcommand === 'config') {
        const result = saveBuiltinProxySettings(options);
        if (result.error) {
            throw new Error(result.error);
        }
        const settings = result.settings;
        console.log('✓ 内建代理配置已保存');
        console.log('  监听:', buildProxyListenUrl(settings));
        console.log('  上游 provider:', settings.provider || '(自动)');
        console.log('  鉴权来源:', settings.authSource);
        console.log();
        return;
    }

    if (subcommand === 'apply' || subcommand === 'apply-provider') {
        const result = applyBuiltinProxyProvider({
            switchToProxy: options.switchToProxy !== false
        });
        if (result.error) {
            throw new Error(result.error);
        }
        console.log(`✓ 已写入本地代理 provider: ${result.provider}`);
        console.log(`  URL: ${result.baseUrl}`);
        if (result.switched) {
            console.log(`  已切换到 ${result.provider}${result.model ? ` / ${result.model}` : ''}`);
        }
        console.log();
        return;
    }

    if (subcommand === 'enable' || subcommand === 'default-codex') {
        const result = await ensureBuiltinProxyForCodexDefault(options);
        if (result.error) {
            throw new Error(result.error);
        }
        const listenUrl = result.runtime && result.runtime.listenUrl
            ? result.runtime.listenUrl
            : buildProxyListenUrl(result.settings || DEFAULT_BUILTIN_PROXY_SETTINGS);
        console.log('✓ 已启用 Codex 内建代理默认模式');
        console.log(`  监听: ${listenUrl}`);
        if (result.runtime && result.runtime.upstreamProvider) {
            console.log(`  上游 provider: ${result.runtime.upstreamProvider}`);
        }
        console.log(`  当前 provider: ${result.provider}${result.model ? ` / ${result.model}` : ''}`);
        console.log();
        return;
    }

    if (subcommand === 'start') {
        const result = await startBuiltinProxyRuntime({
            ...options,
            enabled: true
        });
        if (result.error) {
            throw new Error(result.error);
        }
        console.log(`✓ 内建代理已启动: ${result.listenUrl}`);
        console.log(`  上游 provider: ${result.upstreamProvider}`);
        console.log('  按 Ctrl+C 停止代理\n');

        await new Promise((resolve) => {
            let stopping = false;
            const gracefulStop = async () => {
                if (stopping) return;
                stopping = true;
                await stopBuiltinProxyRuntime();
                resolve();
            };
            process.once('SIGINT', gracefulStop);
            process.once('SIGTERM', gracefulStop);
        });
        return;
    }

    if (subcommand === 'stop') {
        await stopBuiltinProxyRuntime();
        console.log('✓ 内建代理已停止\n');
        return;
    }

    throw new Error(`未知 proxy 子命令: ${subcommand}`);
}

function parseWorkflowInputArg(rawInput) {
    const raw = typeof rawInput === 'string' ? rawInput.trim() : '';
    if (!raw) {
        return {};
    }
    let content = raw;
    if (raw.startsWith('@')) {
        const filePath = path.resolve(raw.slice(1));
        if (!fs.existsSync(filePath)) {
            throw new Error(`工作流输入文件不存在: ${filePath}`);
        }
        content = fs.readFileSync(filePath, 'utf-8');
    }
    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch (e) {
        throw new Error(`工作流输入 JSON 解析失败: ${e.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('工作流输入必须是 JSON 对象');
    }
    return parsed;
}

function printWorkflowHelp() {
    console.log('\n用法: codexmate workflow <list|get|validate|run|runs> [参数]');
    console.log('  codexmate workflow list');
    console.log('  codexmate workflow get diagnose-config');
    console.log('  codexmate workflow validate safe-provider-switch --input \'{"provider":"e2e"}\'');
    console.log('  codexmate workflow run diagnose-config --input \'{}\'');
    console.log('  codexmate workflow run safe-provider-switch --input \'{"provider":"e2e","apply":true}\' --allow-write');
    console.log('  codexmate workflow runs --limit 20');
    console.log('参数:');
    console.log('  --input <JSON|@file>  传入工作流输入');
    console.log('  --allow-write         允许执行写入步骤');
    console.log('  --dry-run             跳过写入步骤，仅预演');
    console.log('  --limit <N>           读取最近执行记录数量（runs）');
    console.log('  --json                以 JSON 输出');
    console.log();
}

function parseWorkflowCliOptions(args = []) {
    const options = {
        inputRaw: '',
        allowWrite: false,
        dryRun: false,
        limit: 20,
        json: false
    };
    const rest = [];
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--allow-write') {
            options.allowWrite = true;
            continue;
        }
        if (arg === '--dry-run') {
            options.dryRun = true;
            continue;
        }
        if (arg === '--json') {
            options.json = true;
            continue;
        }
        if (arg === '--input') {
            options.inputRaw = args[i + 1] || '';
            i += 1;
            continue;
        }
        if (arg.startsWith('--input=')) {
            options.inputRaw = arg.slice('--input='.length);
            continue;
        }
        if (arg === '--limit') {
            const raw = args[i + 1];
            i += 1;
            const value = parseInt(raw, 10);
            if (Number.isFinite(value)) {
                options.limit = value;
            }
            continue;
        }
        if (arg.startsWith('--limit=')) {
            const value = parseInt(arg.slice('--limit='.length), 10);
            if (Number.isFinite(value)) {
                options.limit = value;
            }
            continue;
        }
        rest.push(arg);
    }
    return { options, rest };
}

async function cmdWorkflow(args = []) {
    const argv = Array.isArray(args) ? args : [];
    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
        printWorkflowHelp();
        return;
    }
    const subcommand = String(argv[0] || '').trim().toLowerCase();
    const parsed = parseWorkflowCliOptions(argv.slice(1));
    const options = parsed.options;
    const rest = parsed.rest;

    if (subcommand === 'list') {
        const result = listWorkflowDefinitions();
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }
        const workflows = Array.isArray(result.workflows) ? result.workflows : [];
        console.log('\n可用工作流:');
        for (const item of workflows) {
            const mode = item.readOnly ? 'read-only' : 'read-write';
            console.log(`  - ${item.id} (${mode}, steps=${item.stepCount})`);
            if (item.description) {
                console.log(`    ${item.description}`);
            }
        }
        if (Array.isArray(result.warnings) && result.warnings.length > 0) {
            console.log('\n警告:');
            result.warnings.forEach((msg) => console.log(`  - ${msg}`));
        }
        console.log();
        return;
    }

    if (subcommand === 'runs') {
        const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : 20;
        const runs = listWorkflowRunRecords(limit);
        if (options.json) {
            console.log(JSON.stringify({ runs, limit }, null, 2));
            return;
        }
        console.log(`\n最近执行记录（${runs.length}/${limit}）:`);
        for (const item of runs) {
            const status = item && item.success ? 'OK' : 'FAIL';
            console.log(`  - [${status}] ${item.workflowId || '(unknown)'} runId=${item.runId || ''} duration=${item.durationMs || 0}ms`);
            if (item && item.error) {
                console.log(`    error: ${item.error}`);
            }
        }
        console.log();
        return;
    }

    const workflowId = typeof rest[0] === 'string' ? rest[0].trim() : '';
    if (!workflowId) {
        throw new Error('workflow id is required');
    }
    const input = parseWorkflowInputArg(options.inputRaw);

    if (subcommand === 'get') {
        const result = getWorkflowDefinitionById(workflowId);
        if (result.error) {
            throw new Error(result.error);
        }
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    if (subcommand === 'validate') {
        const result = validateWorkflowById(workflowId, input);
        if (!result.ok) {
            throw new Error(result.error || 'workflow validate failed');
        }
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(`✓ 工作流校验通过: ${workflowId}`);
            if (Array.isArray(result.warnings) && result.warnings.length > 0) {
                result.warnings.forEach((msg) => console.log(`  - ${msg}`));
            }
            console.log();
        }
        return;
    }

    if (subcommand === 'run') {
        const result = await runWorkflowById(workflowId, input, {
            allowWrite: options.allowWrite,
            dryRun: options.dryRun
        });
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            if (result.error) {
                console.error(`✗ 工作流执行失败: ${result.error}`);
            } else {
                console.log(`✓ 工作流执行完成: ${workflowId} (${result.durationMs || 0}ms)`);
            }
            const steps = Array.isArray(result.steps) ? result.steps : [];
            for (const step of steps) {
                const status = step.status || 'unknown';
                const label = step.id || step.tool || '(step)';
                console.log(`  - ${label}: ${status} (${step.durationMs || 0}ms)`);
                if (step.error) {
                    console.log(`    error: ${step.error}`);
                }
            }
            if (result.runId) {
                console.log(`  runId: ${result.runId}`);
            }
            console.log();
        }
        if (result.error) {
            throw new Error(result.error);
        }
        return;
    }

    throw new Error(`未知 workflow 子命令: ${subcommand}`);
}

async function runProxyCommand(displayName, binNames, args = [], installTip = '') {
    const extraArgs = Array.isArray(args) ? args.filter(arg => arg !== undefined) : [];
    const hasYolo = extraArgs.includes('--yolo');
    const finalArgs = hasYolo ? extraArgs : ['--yolo', ...extraArgs];

    const names = Array.isArray(binNames) ? binNames : [binNames];
    let selectedBin = names[0];
    let exists = false;

    // Detect if any of the bin names exist
    for (const name of names) {
        if (commandExists(name, '--version')) {
            selectedBin = name;
            exists = true;
            break;
        }
    }

    if (!exists) {
        let msg = `无法启动 ${displayName}，请确认已安装并在 PATH 中。`;
        if (installTip) {
            msg += `\n安装建议: ${installTip}`;
        }
        throw new Error(msg);
    }

    return new Promise((resolve, reject) => {
        const child = spawn(selectedBin, finalArgs, {
            stdio: 'inherit',
            shell: process.platform === 'win32'
        });

        child.on('error', (err) => {
            reject(new Error(`运行 ${selectedBin} 失败: ${err.message}`));
        });

        child.on('exit', (code, signal) => {
            if (typeof code === 'number') {
                resolve(code);
                return;
            }
            if (signal === 'SIGINT') {
                resolve(130);
                return;
            }
            if (signal === 'SIGTERM') {
                resolve(143);
                return;
            }
            resolve(1);
        });
    });
}

async function cmdCodex(args = []) {
    const ensureResult = await ensureBuiltinProxyForCodexDefault({});
    if (!ensureResult || ensureResult.success !== true) {
        const message = ensureResult && ensureResult.error
            ? ensureResult.error
            : '内建代理准备失败';
        throw new Error(message);
    }
    if (ensureResult.runtime && ensureResult.runtime.listenUrl) {
        console.log(`~ Codex 默认走内建代理: ${ensureResult.runtime.listenUrl}`);
    }
    return runProxyCommand('Codex', 'codex', args);
}

async function cmdQwen(args = []) {
    return runProxyCommand('Qwen', ['qwen', 'qwen-code'], args, 'npm install -g @qwen-code/qwen-code');
}

async function cmdGemini(args = []) {
    return runProxyCommand('Gemini', ['gemini', 'gemini-cli'], args, 'npm install -g @google/gemini-cli');
}

function parseMcpOptions(args = []) {
    const options = {
        subcommand: 'serve',
        transport: 'stdio',
        allowWrite: false,
        help: false
    };

    const argv = Array.isArray(args) ? [...args] : [];
    if (argv.length > 0 && !argv[0].startsWith('-')) {
        options.subcommand = String(argv.shift() || '').trim().toLowerCase() || 'serve';
    }

    const envAllowWrite = typeof process.env.CODEXMATE_MCP_ALLOW_WRITE === 'string'
        && ['1', 'true', 'yes', 'on'].includes(process.env.CODEXMATE_MCP_ALLOW_WRITE.trim().toLowerCase());
    options.allowWrite = envAllowWrite;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg) continue;
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--allow-write' || arg === '--allow-write-tools') {
            options.allowWrite = true;
            continue;
        }
        if (arg === '--read-only') {
            options.allowWrite = false;
            continue;
        }
        if (arg.startsWith('--transport=')) {
            options.transport = arg.slice('--transport='.length).trim().toLowerCase() || options.transport;
            continue;
        }
        if (arg === '--transport') {
            options.transport = String(argv[i + 1] || '').trim().toLowerCase() || options.transport;
            i += 1;
            continue;
        }
    }

    return options;
}

function toMcpToolResult(payload) {
    const structured = payload === undefined
        ? {}
        : (payload && typeof payload === 'object' ? payload : { value: payload });
    const hasError = !!(structured && typeof structured === 'object' && (
        (typeof structured.error === 'string' && structured.error.trim())
        || structured.success === false
    ));
    const text = JSON.stringify(structured, null, 2);
    const result = {
        content: [{ type: 'text', text }],
        structuredContent: structured
    };
    if (hasError) {
        result.isError = true;
    }
    return result;
}

function buildMcpStatusPayload() {
    const statusConfigResult = readConfigOrVirtualDefault();
    const config = statusConfigResult.config;
    const serviceTier = typeof config.service_tier === 'string' ? config.service_tier.trim() : '';
    const modelReasoningEffort = typeof config.model_reasoning_effort === 'string' ? config.model_reasoning_effort.trim() : '';
    return {
        provider: config.model_provider || '未设置',
        model: config.model || '未设置',
        serviceTier,
        modelReasoningEffort,
        configReady: !statusConfigResult.isVirtual,
        configNotice: statusConfigResult.reason || '',
        initNotice: consumeInitNotice()
    };
}

function buildMcpProviderListPayload() {
    const listConfigResult = readConfigOrVirtualDefault();
    const listConfig = listConfigResult.config;
    const providers = listConfig.model_providers || {};
    const current = listConfig.model_provider;
    return {
        configReady: !listConfigResult.isVirtual,
        providers: Object.entries(providers).map(([name, p]) => ({
            name,
            url: p.base_url || '',
            key: maskKey(p.preferred_auth_method || ''),
            hasKey: !!(p.preferred_auth_method && p.preferred_auth_method.trim()),
            current: name === current,
            readOnly: isBuiltinProxyProvider(name),
            nonDeletable: isNonDeletableProvider(name),
            nonEditable: isNonEditableProvider(name)
        }))
    };
}

function buildMcpClaudeSettingsPayload() {
    const info = readClaudeSettingsInfo();
    if (!info || typeof info !== 'object') {
        return { error: '读取 Claude 配置失败' };
    }
    if (info.error) {
        return info;
    }

    const apiKey = typeof info.apiKey === 'string' ? info.apiKey : '';
    const baseUrl = typeof info.baseUrl === 'string' ? info.baseUrl : '';
    const model = typeof info.model === 'string' ? info.model : '';
    const maskedApiKey = maskKey(apiKey);

    return {
        exists: !!info.exists,
        targetPath: info.targetPath || CLAUDE_SETTINGS_FILE,
        apiKey: maskedApiKey,
        apiKeyMasked: maskedApiKey,
        baseUrl,
        model,
        env: {
            ANTHROPIC_API_KEY: maskedApiKey,
            ANTHROPIC_BASE_URL: baseUrl,
            ANTHROPIC_MODEL: model
        },
        redacted: true
    };
}

function normalizeMcpSource(value) {
    const source = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!source) return '';
    if (source === 'codex' || source === 'claude' || source === 'all') {
        return source;
    }
    return null;
}

const BUILTIN_WORKFLOW_DEFINITIONS = Object.freeze({
    'diagnose-config': {
        id: 'diagnose-config',
        name: 'Diagnose Config',
        description: 'Collect status/providers/proxy snapshots for troubleshooting.',
        readOnly: true,
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
        },
        steps: [
            { id: 'status', tool: 'codexmate.status.get', arguments: {} },
            { id: 'providers', tool: 'codexmate.provider.list', arguments: {} },
            { id: 'proxy', tool: 'codexmate.proxy.status', arguments: {} }
        ]
    },
    'safe-provider-switch': {
        id: 'safe-provider-switch',
        name: 'Safe Provider Switch',
        description: 'Build template for a provider switch and optionally apply it.',
        readOnly: false,
        inputSchema: {
            type: 'object',
            properties: {
                provider: { type: 'string' },
                model: { type: 'string' },
                serviceTier: { type: 'string' },
                reasoningEffort: { type: 'string' },
                apply: { type: 'boolean' }
            },
            required: ['provider'],
            additionalProperties: false
        },
        steps: [
            { id: 'providers', tool: 'codexmate.provider.list', arguments: {} },
            {
                id: 'template',
                tool: 'codexmate.config.template.get',
                arguments: {
                    provider: '{{input.provider}}',
                    model: '{{input.model}}',
                    serviceTier: '{{input.serviceTier}}',
                    reasoningEffort: '{{input.reasoningEffort}}'
                }
            },
            {
                id: 'apply',
                tool: 'codexmate.config.template.apply',
                when: { path: 'input.apply', equals: true },
                arguments: {
                    template: '{{steps.template.output.template}}'
                }
            },
            {
                id: 'statusAfter',
                tool: 'codexmate.status.get',
                when: { path: 'input.apply', equals: true },
                arguments: {}
            }
        ]
    },
    'session-issue-pack': {
        id: 'session-issue-pack',
        name: 'Session Issue Pack',
        description: 'Collect session detail and markdown export for issue reports.',
        readOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string' },
                sessionId: { type: 'string' },
                file: { type: 'string' },
                maxMessages: { type: ['string', 'number'] }
            },
            additionalProperties: true
        },
        steps: [
            {
                id: 'detail',
                tool: 'codexmate.session.detail',
                arguments: {
                    source: '{{input.source}}',
                    sessionId: '{{input.sessionId}}',
                    file: '{{input.file}}',
                    maxMessages: '{{input.maxMessages}}'
                }
            },
            {
                id: 'export',
                tool: 'codexmate.session.export',
                arguments: {
                    source: '{{input.source}}',
                    sessionId: '{{input.sessionId}}',
                    file: '{{input.file}}',
                    maxMessages: '{{input.maxMessages}}'
                }
            }
        ]
    }
});

function cloneJson(value, fallback) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return fallback;
    }
}

function normalizeWorkflowId(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    if (!/^[a-zA-Z0-9._-]+$/.test(raw)) {
        return '';
    }
    return raw.toLowerCase();
}

function normalizeWorkflowDefinition(raw, idHint = '', source = 'custom') {
    const safe = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
    if (!safe) {
        return { ok: false, error: 'workflow must be an object' };
    }
    const id = normalizeWorkflowId(safe.id || idHint);
    if (!id) {
        return { ok: false, error: 'workflow id is invalid' };
    }
    const name = typeof safe.name === 'string' && safe.name.trim()
        ? safe.name.trim()
        : id;
    const description = typeof safe.description === 'string' ? safe.description.trim() : '';
    const inputSchema = safe.inputSchema && typeof safe.inputSchema === 'object'
        ? cloneJson(safe.inputSchema, { type: 'object', properties: {}, additionalProperties: true })
        : { type: 'object', properties: {}, additionalProperties: true };
    const stepsRaw = Array.isArray(safe.steps) ? safe.steps : [];
    if (stepsRaw.length === 0) {
        return { ok: false, error: 'workflow steps cannot be empty' };
    }

    const steps = [];
    for (let i = 0; i < stepsRaw.length; i += 1) {
        const item = stepsRaw[i];
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return { ok: false, error: `workflow step #${i + 1} must be an object` };
        }
        const stepIdRaw = typeof item.id === 'string' && item.id.trim()
            ? item.id.trim()
            : `step${i + 1}`;
        const stepId = normalizeWorkflowId(stepIdRaw);
        if (!stepId) {
            return { ok: false, error: `workflow step id invalid at #${i + 1}` };
        }
        const toolName = typeof item.tool === 'string' ? item.tool.trim() : '';
        if (!toolName) {
            return { ok: false, error: `workflow step "${stepId}" missing tool` };
        }
        const args = item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments)
            ? cloneJson(item.arguments, {})
            : {};
        const when = item.when && typeof item.when === 'object' && !Array.isArray(item.when)
            ? cloneJson(item.when, {})
            : null;
        steps.push({
            id: stepId,
            name: typeof item.name === 'string' ? item.name.trim() : '',
            tool: toolName,
            arguments: args,
            when,
            continueOnError: item.continueOnError === true,
            write: item.write === true
        });
    }

    return {
        ok: true,
        data: {
            id,
            name,
            description,
            source,
            readOnly: safe.readOnly !== false,
            inputSchema,
            steps
        }
    };
}

function loadBuiltinWorkflowDefinitions() {
    const items = [];
    for (const [id, raw] of Object.entries(BUILTIN_WORKFLOW_DEFINITIONS)) {
        const normalized = normalizeWorkflowDefinition(raw, id, 'builtin');
        if (!normalized.ok) {
            continue;
        }
        items.push(normalized.data);
    }
    return items;
}

function loadCustomWorkflowDefinitions() {
    const parsed = readJsonObjectFromFile(WORKFLOW_DEFINITIONS_FILE, {});
    if (!parsed.ok || !parsed.exists) {
        return {
            items: [],
            warnings: parsed.ok ? [] : [parsed.error || 'workflow file parse failed']
        };
    }
    const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
    let list = [];
    if (Array.isArray(data.workflows)) {
        list = data.workflows;
    } else if (data.workflows && typeof data.workflows === 'object') {
        list = Object.entries(data.workflows).map(([id, item]) => ({ ...(item || {}), id }));
    } else {
        list = Object.entries(data).map(([id, item]) => ({ ...(item || {}), id }));
    }

    const items = [];
    const warnings = [];
    for (const item of list) {
        const normalized = normalizeWorkflowDefinition(item, item && item.id ? item.id : '', 'custom');
        if (!normalized.ok) {
            warnings.push(normalized.error || 'invalid custom workflow');
            continue;
        }
        items.push(normalized.data);
    }
    return { items, warnings };
}

function buildWorkflowRegistry() {
    const registry = new Map();
    const warnings = [];
    const builtin = loadBuiltinWorkflowDefinitions();
    for (const item of builtin) {
        registry.set(item.id, item);
    }
    const custom = loadCustomWorkflowDefinitions();
    for (const item of custom.items) {
        if (registry.has(item.id)) {
            warnings.push(`custom workflow id duplicated with builtin and ignored: ${item.id}`);
            continue;
        }
        registry.set(item.id, item);
    }
    warnings.push(...custom.warnings);
    return { registry, warnings };
}

function listWorkflowDefinitions() {
    const { registry, warnings } = buildWorkflowRegistry();
    const workflows = Array.from(registry.values())
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            source: item.source,
            readOnly: item.readOnly !== false,
            stepCount: Array.isArray(item.steps) ? item.steps.length : 0
        }));
    return {
        workflows,
        warnings
    };
}

function getWorkflowDefinitionById(rawId) {
    const id = normalizeWorkflowId(rawId);
    if (!id) {
        return { error: 'workflow id is required' };
    }
    const { registry, warnings } = buildWorkflowRegistry();
    const workflow = registry.get(id);
    if (!workflow) {
        return { error: `workflow not found: ${id}` };
    }
    return {
        workflow: cloneJson(workflow, {}),
        warnings
    };
}

function createWorkflowToolCatalog() {
    return {
        'codexmate.status.get': {
            readOnly: true,
            handler: async () => buildMcpStatusPayload()
        },
        'codexmate.provider.list': {
            readOnly: true,
            handler: async () => buildMcpProviderListPayload()
        },
        'codexmate.proxy.status': {
            readOnly: true,
            handler: async () => getBuiltinProxyStatus()
        },
        'codexmate.session.list': {
            readOnly: true,
            handler: async (args = {}) => {
                const source = normalizeMcpSource(args.source);
                if (source === null) {
                    return { error: 'Invalid source. Must be codex, claude, or all' };
                }
                return {
                    source: source || 'all',
                    sessions: listAllSessions({
                        ...args,
                        source: source || 'all'
                    })
                };
            }
        },
        'codexmate.session.detail': {
            readOnly: true,
            handler: async (args = {}) => readSessionDetail(args || {})
        },
        'codexmate.session.export': {
            readOnly: true,
            handler: async (args = {}) => exportSessionData(args || {})
        },
        'codexmate.config.template.get': {
            readOnly: true,
            handler: async (args = {}) => getConfigTemplate(args || {})
        },
        'codexmate.config.template.apply': {
            readOnly: false,
            handler: async (args = {}) => applyConfigTemplate(args || {})
        }
    };
}

function getWorkflowKnownToolsSet() {
    return new Set(Object.keys(createWorkflowToolCatalog()));
}

function resolveWorkflowDefinitionWithToolMeta(workflow) {
    const catalog = createWorkflowToolCatalog();
    const safe = cloneJson(workflow, {});
    safe.steps = (Array.isArray(safe.steps) ? safe.steps : []).map((step) => {
        const tool = catalog[step.tool];
        return {
            ...step,
            write: step.write === true || !!(tool && tool.readOnly === false)
        };
    });
    return safe;
}

function validateWorkflowInputBySchema(inputSchema, input) {
    const schema = inputSchema && typeof inputSchema === 'object' ? inputSchema : {};
    if (schema.type && schema.type !== 'object') {
        return { ok: false, error: `unsupported input schema type: ${schema.type}` };
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, error: 'workflow input must be an object' };
    }
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) {
            return { ok: false, error: `missing required input field: ${key}` };
        }
    }
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    for (const [key, expected] of Object.entries(properties)) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
        const value = input[key];
        if (!expected || typeof expected !== 'object') continue;
        const type = expected.type;
        if (!type) continue;
        const typeList = Array.isArray(type) ? type : [type];
        const actualType = value === null ? 'null' : (Array.isArray(value) ? 'array' : typeof value);
        const matched = typeList.some((candidate) => {
            if (candidate === 'number') return typeof value === 'number' && Number.isFinite(value);
            if (candidate === 'integer') return Number.isInteger(value);
            if (candidate === 'array') return Array.isArray(value);
            if (candidate === 'object') return value && typeof value === 'object' && !Array.isArray(value);
            if (candidate === 'null') return value === null;
            return actualType === candidate;
        });
        if (!matched) {
            return { ok: false, error: `input field "${key}" type mismatch` };
        }
    }
    return { ok: true };
}

function appendWorkflowRunRecord(record) {
    ensureDir(path.dirname(WORKFLOW_RUNS_FILE));
    const content = `${JSON.stringify(record)}\n`;
    fs.appendFileSync(WORKFLOW_RUNS_FILE, content, { encoding: 'utf-8', mode: 0o600 });
}

function listWorkflowRunRecords(limit = 20) {
    const max = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 20;
    if (!fs.existsSync(WORKFLOW_RUNS_FILE)) {
        return [];
    }
    let content = '';
    try {
        content = fs.readFileSync(WORKFLOW_RUNS_FILE, 'utf-8');
    } catch (_) {
        return [];
    }
    const rows = content
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean);
    const parsed = [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
        try {
            const item = JSON.parse(rows[i]);
            parsed.push(item);
            if (parsed.length >= max) {
                break;
            }
        } catch (_) {}
    }
    return parsed;
}

function validateWorkflowById(workflowId, input = {}) {
    const definitionResult = getWorkflowDefinitionById(workflowId);
    if (definitionResult.error) {
        return { ok: false, error: definitionResult.error };
    }
    const workflow = resolveWorkflowDefinitionWithToolMeta(definitionResult.workflow);
    const knownTools = getWorkflowKnownToolsSet();
    const validation = validateWorkflowDefinition(workflow, { knownTools });
    if (!validation.ok) {
        return {
            ok: false,
            error: validation.error || 'workflow validation failed',
            issues: validation.issues || []
        };
    }
    const schemaValidation = validateWorkflowInputBySchema(workflow.inputSchema, input || {});
    if (!schemaValidation.ok) {
        return { ok: false, error: schemaValidation.error || 'workflow input validation failed' };
    }
    return {
        ok: true,
        workflow: {
            id: workflow.id,
            name: workflow.name,
            readOnly: workflow.readOnly !== false,
            stepCount: Array.isArray(workflow.steps) ? workflow.steps.length : 0
        },
        warnings: definitionResult.warnings || []
    };
}

async function runWorkflowById(workflowId, input = {}, options = {}) {
    const definitionResult = getWorkflowDefinitionById(workflowId);
    if (definitionResult.error) {
        return { error: definitionResult.error };
    }
    const workflow = resolveWorkflowDefinitionWithToolMeta(definitionResult.workflow);
    const knownTools = getWorkflowKnownToolsSet();
    const validation = validateWorkflowDefinition(workflow, { knownTools });
    if (!validation.ok) {
        return {
            error: validation.error || 'workflow validation failed',
            issues: validation.issues || []
        };
    }
    const schemaValidation = validateWorkflowInputBySchema(workflow.inputSchema, input || {});
    if (!schemaValidation.ok) {
        return { error: schemaValidation.error || 'workflow input validation failed' };
    }

    const catalog = createWorkflowToolCatalog();
    const allowWrite = options.allowWrite === true;
    const dryRun = options.dryRun === true;
    const runId = `wf-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const startedAt = toIsoTime(Date.now());

    const execution = await executeWorkflowDefinition(workflow, input || {}, {
        allowWrite,
        dryRun,
        invokeTool: async (toolName, args = {}) => {
            const tool = catalog[toolName];
            if (!tool) {
                return { error: `workflow tool not supported: ${toolName}` };
            }
            if (!tool.readOnly && !allowWrite) {
                return { error: `workflow requires write permission for tool: ${toolName}` };
            }
            return tool.handler(args || {});
        }
    });

    const endedAt = toIsoTime(Date.now());
    const record = {
        runId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        success: execution.success === true,
        error: execution.error || '',
        allowWrite,
        dryRun,
        startedAt,
        endedAt,
        durationMs: execution.durationMs || 0,
        steps: Array.isArray(execution.steps) ? execution.steps.map((step) => ({
            id: step.id,
            tool: step.tool,
            status: step.status,
            durationMs: step.durationMs || 0,
            error: step.error || ''
        })) : [],
        input: cloneJson(input || {}, {})
    };
    try {
        appendWorkflowRunRecord(record);
    } catch (_) {}

    return {
        success: execution.success === true,
        runId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        allowWrite,
        dryRun,
        startedAt: execution.startedAt || startedAt,
        endedAt: execution.endedAt || endedAt,
        durationMs: execution.durationMs || 0,
        steps: execution.steps || [],
        output: execution.output || null,
        warnings: definitionResult.warnings || [],
        ...(execution.error ? { error: execution.error } : {})
    };
}

function createMcpTools(options = {}) {
    const allowWrite = !!options.allowWrite;
    const tools = [];

    const pushTool = (tool) => {
        if (!tool || typeof tool !== 'object') return;
        if (!tool.readOnly && !allowWrite) return;
        tools.push({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema || { type: 'object', properties: {}, additionalProperties: false },
            annotations: {
                readOnlyHint: !!tool.readOnly
            },
            handler: async (args = {}) => {
                try {
                    const payload = await tool.handler(args || {});
                    return toMcpToolResult(payload);
                } catch (error) {
                    return toMcpToolResult({
                        error: error && error.message ? error.message : String(error || 'Tool execution failed')
                    });
                }
            }
        });
    };

    pushTool({
        name: 'codexmate.status.get',
        description: 'Get current provider/model status, config readiness and startup notice.',
        readOnly: true,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => buildMcpStatusPayload()
    });

    pushTool({
        name: 'codexmate.provider.list',
        description: 'List configured providers with masked key and active flags.',
        readOnly: true,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => buildMcpProviderListPayload()
    });

    pushTool({
        name: 'codexmate.model.list',
        description: 'List models from a provider. If provider is omitted, use current provider.',
        readOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                provider: { type: 'string' }
            },
            additionalProperties: false
        },
        handler: async (args = {}) => {
            const rawProvider = typeof args.provider === 'string' ? args.provider.trim() : '';
            let providerName = rawProvider;
            if (!providerName) {
                const cfg = readConfigOrVirtualDefault().config || {};
                providerName = typeof cfg.model_provider === 'string' ? cfg.model_provider.trim() : '';
            }
            if (!providerName) {
                return { error: 'Provider name is required' };
            }
            const res = await fetchProviderModels(providerName);
            if (res.error) {
                return { error: res.error, models: [], source: 'remote' };
            }
            if (res.unlimited) {
                return { models: [], source: 'remote', provider: res.provider || '', unlimited: true };
            }
            return { models: res.models || [], source: 'remote', provider: res.provider || '' };
        }
    });

    pushTool({
        name: 'codexmate.config.template.get',
        description: 'Get Codex config template with optional provider/model/service tier/reasoning effort.',
        readOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                provider: { type: 'string' },
                model: { type: 'string' },
                serviceTier: { type: 'string' },
                reasoningEffort: { type: 'string' }
            },
            additionalProperties: false
        },
        handler: async (args = {}) => getConfigTemplate(args || {})
    });

    pushTool({
        name: 'codexmate.claude.settings.get',
        description: 'Read Claude settings.json env values managed by codexmate.',
        readOnly: true,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => buildMcpClaudeSettingsPayload()
    });

    pushTool({
        name: 'codexmate.openclaw.config.get',
        description: 'Read OpenClaw config file content and metadata.',
        readOnly: true,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => readOpenclawConfigFile()
    });

    pushTool({
        name: 'codexmate.session.list',
        description: 'List sessions from codex/claude/all with filters.',
        readOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string' },
                pathFilter: { type: 'string' },
                query: { type: 'string' },
                roleFilter: { type: 'string' },
                timeRangePreset: { type: 'string' },
                limit: { type: 'number' },
                forceRefresh: { type: 'boolean' },
                queryMode: { type: 'string' },
                queryScope: { type: 'string' },
                contentScanLimit: { type: 'number' }
            },
            additionalProperties: false
        },
        handler: async (args = {}) => {
            const input = args && typeof args === 'object' ? args : {};
            const source = normalizeMcpSource(input.source);
            if (source === null) {
                return { error: 'Invalid source. Must be codex, claude, or all' };
            }
            const normalizedInput = {
                ...input,
                source: source || 'all'
            };
            return {
                sessions: listAllSessions(normalizedInput),
                source: source || 'all'
            };
        }
    });

    pushTool({
        name: 'codexmate.session.detail',
        description: 'Read a session detail by source + sessionId/file.',
        readOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string' },
                sessionId: { type: 'string' },
                file: { type: 'string' },
                maxMessages: { type: ['string', 'number'] }
            },
            additionalProperties: true
        },
        handler: async (args = {}) => readSessionDetail(args || {})
    });

    pushTool({
        name: 'codexmate.session.export',
        description: 'Export session as markdown payload.',
        readOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string' },
                sessionId: { type: 'string' },
                file: { type: 'string' },
                maxMessages: { type: ['string', 'number'] }
            },
            additionalProperties: true
        },
        handler: async (args = {}) => exportSessionData(args || {})
    });

    pushTool({
        name: 'codexmate.auth.profile.list',
        description: 'List codex auth profiles.',
        readOnly: true,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => ({ profiles: listAuthProfilesInfo() })
    });

    pushTool({
        name: 'codexmate.proxy.status',
        description: 'Get builtin proxy runtime status and persisted config.',
        readOnly: true,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => getBuiltinProxyStatus()
    });

    pushTool({
        name: 'codexmate.workflow.list',
        description: 'List available workflows (builtin + custom).',
        readOnly: true,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => listWorkflowDefinitions()
    });

    pushTool({
        name: 'codexmate.workflow.get',
        description: 'Get one workflow definition by id.',
        readOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string' }
            },
            required: ['id'],
            additionalProperties: false
        },
        handler: async (args = {}) => {
            const id = typeof args.id === 'string' ? args.id.trim() : '';
            if (!id) {
                return { error: 'workflow id is required' };
            }
            return getWorkflowDefinitionById(id);
        }
    });

    pushTool({
        name: 'codexmate.workflow.validate',
        description: 'Validate workflow definition and input payload.',
        readOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                input: { type: 'object' }
            },
            required: ['id'],
            additionalProperties: false
        },
        handler: async (args = {}) => {
            const id = typeof args.id === 'string' ? args.id.trim() : '';
            if (!id) {
                return { ok: false, error: 'workflow id is required' };
            }
            const input = args.input && typeof args.input === 'object' && !Array.isArray(args.input)
                ? args.input
                : {};
            return validateWorkflowById(id, input);
        }
    });

    pushTool({
        name: 'codexmate.workflow.run',
        description: 'Run workflow by id. Write steps require allow-write mode.',
        readOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                input: { type: 'object' },
                dryRun: { type: 'boolean' }
            },
            required: ['id'],
            additionalProperties: false
        },
        handler: async (args = {}) => {
            const id = typeof args.id === 'string' ? args.id.trim() : '';
            if (!id) {
                return { error: 'workflow id is required' };
            }
            const input = args.input && typeof args.input === 'object' && !Array.isArray(args.input)
                ? args.input
                : {};
            return runWorkflowById(id, input, {
                allowWrite,
                dryRun: args.dryRun === true
            });
        }
    });

    pushTool({
        name: 'codexmate.config.template.apply',
        description: 'Apply Codex TOML template and sync auth/model pointers.',
        readOnly: false,
        inputSchema: {
            type: 'object',
            properties: {
                template: { type: 'string' }
            },
            required: ['template'],
            additionalProperties: false
        },
        handler: async (args = {}) => applyConfigTemplate(args || {})
    });

    pushTool({
        name: 'codexmate.provider.add',
        description: 'Add provider into config.toml model_providers.',
        readOnly: false,
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                url: { type: 'string' },
                key: { type: 'string' }
            },
            required: ['name', 'url'],
            additionalProperties: false
        },
        handler: async (args = {}) => addProviderToConfig(args || {})
    });

    pushTool({
        name: 'codexmate.provider.update',
        description: 'Update provider url/key.',
        readOnly: false,
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                url: { type: 'string' },
                key: { type: 'string' }
            },
            required: ['name'],
            additionalProperties: false
        },
        handler: async (args = {}) => updateProviderInConfig(args || {})
    });

    pushTool({
        name: 'codexmate.provider.delete',
        description: 'Delete provider from config.',
        readOnly: false,
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' }
            },
            required: ['name'],
            additionalProperties: false
        },
        handler: async (args = {}) => deleteProviderFromConfig(args || {})
    });

    pushTool({
        name: 'codexmate.claude.config.apply',
        description: 'Apply Claude env config into ~/.claude/settings.json.',
        readOnly: false,
        inputSchema: {
            type: 'object',
            properties: {
                apiKey: { type: 'string' },
                baseUrl: { type: 'string' },
                model: { type: 'string' }
            },
            required: ['apiKey'],
            additionalProperties: false
        },
        handler: async (args = {}) => applyToClaudeSettings(args || {})
    });

    pushTool({
        name: 'codexmate.openclaw.config.apply',
        description: 'Apply OpenClaw config content into ~/.openclaw/openclaw.json.',
        readOnly: false,
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string' },
                lineEnding: { type: 'string' }
            },
            required: ['content'],
            additionalProperties: false
        },
        handler: async (args = {}) => applyOpenclawConfig(args || {})
    });

    pushTool({
        name: 'codexmate.session.delete',
        description: 'Delete one session or selected records in a session.',
        readOnly: false,
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string' },
                sessionId: { type: 'string' },
                file: { type: 'string' },
                recordLineIndex: { type: 'number' },
                recordLineIndices: { type: 'array', items: { type: 'number' } }
            },
            additionalProperties: true
        },
        handler: async (args = {}) => deleteSessionData(args || {})
    });

    pushTool({
        name: 'codexmate.auth.profile.switch',
        description: 'Switch active auth profile by name.',
        readOnly: false,
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' }
            },
            required: ['name'],
            additionalProperties: false
        },
        handler: async (args = {}) => {
            const profileName = typeof args.name === 'string' ? args.name.trim() : '';
            if (!profileName) return { error: '认证名称不能为空' };
            try {
                return switchAuthProfile(profileName, { silent: true });
            } catch (e) {
                return { error: e.message || '切换认证失败' };
            }
        }
    });

    pushTool({
        name: 'codexmate.auth.profile.delete',
        description: 'Delete an auth profile by name.',
        readOnly: false,
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' }
            },
            required: ['name'],
            additionalProperties: false
        },
        handler: async (args = {}) => deleteAuthProfile(typeof args.name === 'string' ? args.name : '')
    });

    pushTool({
        name: 'codexmate.proxy.start',
        description: 'Start builtin proxy runtime with optional overrides.',
        readOnly: false,
        inputSchema: {
            type: 'object',
            properties: {
                enabled: { type: 'boolean' },
                host: { type: 'string' },
                port: { type: 'number' },
                provider: { type: 'string' },
                authSource: { type: 'string' },
                timeoutMs: { type: 'number' }
            },
            additionalProperties: false
        },
        handler: async (args = {}) => startBuiltinProxyRuntime(args || {})
    });

    pushTool({
        name: 'codexmate.proxy.stop',
        description: 'Stop builtin proxy runtime.',
        readOnly: false,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => stopBuiltinProxyRuntime()
    });

    pushTool({
        name: 'codexmate.proxy.provider.apply',
        description: 'Apply builtin proxy provider into codex config.',
        readOnly: false,
        inputSchema: {
            type: 'object',
            properties: {
                switchToProxy: { type: 'boolean' },
                provider: { type: 'string' }
            },
            additionalProperties: true
        },
        handler: async (args = {}) => applyBuiltinProxyProvider(args || {})
    });

    return tools;
}

function createMcpResources() {
    return [
        {
            uri: 'codexmate://status',
            name: 'Status',
            description: 'Current provider/model status snapshot.',
            mimeType: 'application/json',
            read: async () => ({
                contents: [{
                    uri: 'codexmate://status',
                    mimeType: 'application/json',
                    text: JSON.stringify(buildMcpStatusPayload(), null, 2)
                }]
            })
        },
        {
            uri: 'codexmate://providers',
            name: 'Providers',
            description: 'Configured provider list (masked).',
            mimeType: 'application/json',
            read: async () => ({
                contents: [{
                    uri: 'codexmate://providers',
                    mimeType: 'application/json',
                    text: JSON.stringify(buildMcpProviderListPayload(), null, 2)
                }]
            })
        },
        {
            uri: 'codexmate://sessions',
            name: 'Sessions',
            description: 'Session listing resource. Query by source/query/pathFilter via URI params.',
            mimeType: 'application/json',
            read: async (params = {}) => {
                const uri = typeof params.uri === 'string' ? params.uri : 'codexmate://sessions';
                let source = '';
                let query = '';
                let pathFilter = '';
                let roleFilter = '';
                let timeRangePreset = '';
                try {
                    const parsed = new URL(uri);
                    source = parsed.searchParams.get('source') || '';
                    query = parsed.searchParams.get('query') || '';
                    pathFilter = parsed.searchParams.get('pathFilter') || '';
                    roleFilter = parsed.searchParams.get('roleFilter') || '';
                    timeRangePreset = parsed.searchParams.get('timeRangePreset') || '';
                } catch (_) {}
                const normalizedSource = normalizeMcpSource(source);
                if (normalizedSource === null) {
                    return {
                        contents: [{
                            uri,
                            mimeType: 'application/json',
                            text: JSON.stringify({ error: 'Invalid source. Must be codex, claude, or all' }, null, 2)
                        }]
                    };
                }
                const payload = {
                    source: normalizedSource || 'all',
                    sessions: listAllSessions({
                        source: normalizedSource || 'all',
                        query,
                        pathFilter,
                        roleFilter,
                        timeRangePreset
                    })
                };
                return {
                    contents: [{
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(payload, null, 2)
                    }]
                };
            }
        },
        {
            uri: 'codexmate://workflows',
            name: 'Workflows',
            description: 'Workflow list resource (builtin + custom).',
            mimeType: 'application/json',
            read: async () => ({
                contents: [{
                    uri: 'codexmate://workflows',
                    mimeType: 'application/json',
                    text: JSON.stringify(listWorkflowDefinitions(), null, 2)
                }]
            })
        },
        {
            uri: 'codexmate://workflow-runs',
            name: 'WorkflowRuns',
            description: 'Recent workflow execution records. Supports ?limit=<N>.',
            mimeType: 'application/json',
            read: async (params = {}) => {
                const uri = typeof params.uri === 'string' ? params.uri : 'codexmate://workflow-runs';
                let limit = 20;
                try {
                    const parsed = new URL(uri);
                    const rawLimit = parsed.searchParams.get('limit');
                    if (rawLimit) {
                        const parsedLimit = parseInt(rawLimit, 10);
                        if (Number.isFinite(parsedLimit)) {
                            limit = parsedLimit;
                        }
                    }
                } catch (_) {}
                const payload = {
                    runs: listWorkflowRunRecords(limit),
                    limit: Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 20
                };
                return {
                    contents: [{
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(payload, null, 2)
                    }]
                };
            }
        }
    ];
}

function createMcpPrompts() {
    return [
        {
            name: 'codexmate.diagnose_config',
            description: 'Generate troubleshooting guidance from current codexmate status/providers.',
            arguments: [],
            get: async () => {
                const status = buildMcpStatusPayload();
                const providers = buildMcpProviderListPayload();
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                '请根据以下配置快照进行故障诊断，并给出按优先级排序的修复步骤。',
                                '要求：先给结论，再给操作清单，最后给风险与回滚建议。',
                                '',
                                '[status]',
                                JSON.stringify(status, null, 2),
                                '',
                                '[providers]',
                                JSON.stringify(providers, null, 2)
                            ].join('\n')
                        }
                    }]
                };
            }
        },
        {
            name: 'codexmate.switch_provider_safely',
            description: 'Guide safe provider switch with pre-check and rollback plan.',
            arguments: [{
                name: 'provider',
                description: 'Target provider name',
                required: true
            }],
            get: async (args = {}) => {
                const provider = typeof args.provider === 'string' ? args.provider.trim() : '';
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                `请为 provider "${provider || '(missing)'}" 生成安全切换步骤。`,
                                '要求：',
                                '1) 先检查 provider 是否存在与 key 是否可用',
                                '2) 给出切换后验证项（模型拉取/健康检查）',
                                '3) 给出失败时回滚流程（回到旧 provider/model）'
                            ].join('\n')
                        }
                    }]
                };
            }
        },
        {
            name: 'codexmate.export_session_for_issue',
            description: 'Prepare issue report template from a selected session export.',
            arguments: [{
                name: 'source',
                description: 'Session source: codex or claude',
                required: true
            }, {
                name: 'sessionId',
                description: 'Session id',
                required: true
            }],
            get: async (args = {}) => {
                const source = typeof args.source === 'string' ? args.source.trim() : '';
                const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : '';
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                '请根据会话导出内容生成 issue 报告草稿。',
                                `source: ${source || '(missing)'}`,
                                `sessionId: ${sessionId || '(missing)'}`,
                                '',
                                '报告需包含：问题现象、复现步骤、预期行为、实际行为、可疑配置项。'
                            ].join('\n')
                        }
                    }]
                };
            }
        }
    ];
}

async function cmdMcp(args = []) {
    const options = parseMcpOptions(args);
    if (options.help) {
        console.log('\n用法: codexmate mcp [serve] [--transport stdio] [--allow-write|--read-only]');
        console.log('  默认 transport=stdio，默认 read-only。');
        console.log('  设置环境变量 CODEXMATE_MCP_ALLOW_WRITE=1 可默认开启写工具。');
        console.log();
        return;
    }

    if (options.subcommand !== 'serve') {
        throw new Error(`未知 mcp 子命令: ${options.subcommand}`);
    }
    if (options.transport !== 'stdio') {
        throw new Error(`当前仅支持 stdio 传输，收到: ${options.transport}`);
    }

    const packageVersion = (() => {
        try {
            const pkg = require('./package.json');
            return pkg && pkg.version ? pkg.version : '0.0.0';
        } catch (_) {
            return '0.0.0';
        }
    })();

    const server = createMcpStdioServer({
        protocolVersion: '2025-11-25',
        serverInfo: {
            name: 'codexmate-mcp',
            version: packageVersion
        },
        tools: createMcpTools({ allowWrite: options.allowWrite }),
        resources: createMcpResources(),
        prompts: createMcpPrompts(),
        logger: (level, message) => {
            const label = level === 'error' ? 'ERR' : 'INFO';
            console.error(`[MCP ${label}] ${message}`);
        }
    });

    server.start();

    await new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            server.stop();
            stopBuiltinProxyRuntime().finally(() => resolve());
        };
        process.once('SIGINT', finish);
        process.once('SIGTERM', finish);
        process.stdin.once('end', finish);
        process.stdin.once('close', finish);
    });
}

// ============================================================================
// 主程序
// ============================================================================
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const isMcpCommand = command === 'mcp';
    const bootstrap = ensureManagedConfigBootstrap();
    if (bootstrap && bootstrap.notice) {
        // MCP stdio transport requires stdout to be protocol-clean.
        if (!isMcpCommand) {
            console.log(`\n[Init] ${bootstrap.notice}`);
        }
    }

    if (args.length === 0) {
        console.log('\nCodex Mate - Codex 提供商管理工具');
        console.log('\n用法:');
        console.log('  codexmate status           显示当前状态');
        console.log('  codexmate setup            交互式配置向导');
        console.log('  codexmate list             列出所有提供商');
        console.log('  codexmate models           列出所有模型');
        console.log('  codexmate switch <名称>    切换提供商');
        console.log('  codexmate use <模型>       切换模型');
        console.log('  codexmate add <名称> <URL> [密钥]');
        console.log('  codexmate delete <名称>    删除提供商');
        console.log('  codexmate claude <BaseURL> <API密钥> [模型]  写入 Claude Code 配置');
        console.log('  codexmate add-model <模型> 添加模型');
        console.log('  codexmate delete-model <模型> 删除模型');
        console.log('  codexmate auth <list|import|switch|delete|status>  认证文件管理');
        console.log('  codexmate proxy <status|set|apply|enable|start|stop>  内建代理');
        console.log('  codexmate workflow <list|get|validate|run|runs>  MCP 工作流中心');
        console.log('  codexmate run [--host <HOST>]    启动 Web 界面');
        console.log('  codexmate codex [参数...]  等同于 codex --yolo');
        console.log('  codexmate qwen [参数...]   等同于 qwen --yolo');
        console.log('  codexmate gemini [参数...] 等同于 gemini --yolo');
        console.log('  codexmate mcp [serve] [--transport stdio] [--allow-write|--read-only]');
        console.log('  codexmate export-session --source <codex|claude> (--session-id <ID>|--file <PATH>) [--output <PATH>] [--max-messages <N|all|Infinity>]');
        console.log('  codexmate zip <路径> [--max:级别]  压缩（系统 zip 优先，其次 zip-lib）');
        console.log('  codexmate unzip <zip文件> [输出目录]  解压（zip-lib）');
        console.log('');
        process.exit(0);
    }

    switch (command) {
        case 'status': cmdStatus(); break;
        case 'setup': await cmdSetup(); break;
        case 'list': cmdList(); break;
        case 'models': await cmdModels(); break;
        case 'switch': cmdSwitch(args[1]); break;
        case 'use': cmdUseModel(args[1]); break;
        case 'add': cmdAdd(args[1], args[2], args[3]); break;
        case 'delete': cmdDelete(args[1]); break;
        case 'claude': cmdClaude(args[1], args[2], args[3]); break;
        case 'add-model': cmdAddModel(args[1]); break;
        case 'delete-model': cmdDeleteModel(args[1]); break;
        case 'auth': cmdAuth(args.slice(1)); break;
        case 'proxy': await cmdProxy(args.slice(1)); break;
        case 'workflow': await cmdWorkflow(args.slice(1)); break;
        case 'run': cmdStart(parseStartOptions(args.slice(1))); break;
        case 'start':
            console.error('错误: 命令已更名为 "run"，请使用: codexmate run');
            process.exit(1);
            break;
        case 'codex': {
            const exitCode = await cmdCodex(args.slice(1));
            process.exit(exitCode);
            break;
        }
        case 'qwen': {
            const exitCode = await cmdQwen(args.slice(1));
            process.exit(exitCode);
            break;
        }
        case 'gemini': {
            const exitCode = await cmdGemini(args.slice(1));
            process.exit(exitCode);
            break;
        }
        case 'mcp': await cmdMcp(args.slice(1)); break;
        case 'export-session': await cmdExportSession(args.slice(1)); break;
        case 'zip': {
            // 解析 --max:N 参数
            const zipOptions = {};
            let targetPath = null;
            for (let i = 1; i < args.length; i++) {
                const arg = args[i];
                if (arg.startsWith('--max:')) {
                    zipOptions.max = parseInt(arg.substring(6), 10);
                } else if (!targetPath) {
                    targetPath = arg;
                }
            }
            await cmdZip(targetPath, zipOptions);
            break;
        }
        case 'unzip': await cmdUnzip(args[1], args[2]); break;
        default:
            console.error('错误: 未知命令:', command);
            console.log('运行 "codexmate" 查看帮助');
            process.exit(1);
    }
}

main().catch((err) => {
    console.error('错误:', err && err.message ? err.message : err);
    process.exit(1);
});
