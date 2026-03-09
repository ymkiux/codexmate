#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const toml = require('@iarna/toml');
const JSON5 = require('json5');
const zipLib = require('zip-lib');
const { exec, execSync } = require('child_process');
const http = require('http');
const https = require('https');
const readline = require('readline');

const DEFAULT_WEB_PORT = 3737;

// ============================================================================
// 配置
// ============================================================================
const CONFIG_DIR = path.join(os.homedir(), '.codex');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.toml');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');
const MODELS_FILE = path.join(CONFIG_DIR, 'models.json');
const CURRENT_MODELS_FILE = path.join(CONFIG_DIR, 'provider-current-models.json');
const INIT_MARK_FILE = path.join(CONFIG_DIR, 'codexmate-init.json');
const CODEX_SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const OPENCLAW_CONFIG_FILE = path.join(OPENCLAW_DIR, 'openclaw.json');
const OPENCLAW_WORKSPACE_DIR = path.join(OPENCLAW_DIR, 'workspace');
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const RECENT_CONFIGS_FILE = path.join(CONFIG_DIR, 'recent-configs.json');

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
const DEFAULT_CONTENT_SCAN_LIMIT = 10;
const SESSION_SCAN_FACTOR = 4;
const SESSION_SCAN_MIN_FILES = 800;
const MAX_SESSION_PATH_LIST_SIZE = 2000;
const AGENTS_FILE_NAME = 'AGENTS.md';
const UTF8_BOM = '\ufeff';
const MODELS_CACHE_TTL_MS = 60 * 1000;
const MODELS_NEGATIVE_CACHE_TTL_MS = 5 * 1000;
const MODELS_CACHE_MAX_ENTRIES = 50;
const MODELS_RESPONSE_MAX_BYTES = 1024 * 1024;
const MAX_RECENT_CONFIGS = 3;
const BOOTSTRAP_TEXT_MARKERS = [
    'agents.md instructions',
    '<instructions>',
    '<environment_context>',
    'you are a coding agent',
    'codex cli'
];

const HTTP_KEEP_ALIVE_AGENT = new http.Agent({ keepAlive: true });
const HTTPS_KEEP_ALIVE_AGENT = new https.Agent({ keepAlive: true });

function resolveWebPort() {
    const raw = process.env.CODEXMATE_PORT;
    if (!raw) return DEFAULT_WEB_PORT;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WEB_PORT;
    return parsed;
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
        return toml.parse(content);
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

function readJsonFile(filePath, fallback = null) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
        return fallback;
    }
}

function readJsonArrayFile(filePath, fallback = []) {
    if (!fs.existsSync(filePath)) {
        return Array.isArray(fallback) ? [...fallback] : [];
    }
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.trim()) {
            return Array.isArray(fallback) ? [...fallback] : [];
        }
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? parsed : (Array.isArray(fallback) ? [...fallback] : []);
    } catch (e) {
        return Array.isArray(fallback) ? [...fallback] : [];
    }
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function expandHomePath(value) {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    if (trimmed === '~') {
        return os.homedir();
    }
    if (trimmed.startsWith(`~${path.sep}`) || trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
        return path.resolve(os.homedir(), trimmed.slice(2));
    }
    return trimmed;
}

function resolveExistingDir(candidates = [], fallback = '') {
    for (const raw of candidates) {
        const candidate = expandHomePath(raw);
        if (!candidate) continue;
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                return candidate;
            }
        } catch (e) {}
    }
    return fallback;
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

function hasUtf8Bom(text) {
    return typeof text === 'string' && text.charCodeAt(0) === 0xfeff;
}

function stripUtf8Bom(text) {
    if (!text) return '';
    return hasUtf8Bom(text) ? text.slice(1) : text;
}

function ensureUtf8Bom(text) {
    const content = typeof text === 'string' ? text : '';
    return hasUtf8Bom(content) ? content : UTF8_BOM + content;
}

function detectLineEnding(text) {
    return typeof text === 'string' && text.includes('\r\n') ? '\r\n' : '\n';
}

function normalizeLineEnding(text, lineEnding) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return lineEnding === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

function isValidProviderName(name) {
    return typeof name === 'string' && /^[a-zA-Z0-9._-]+$/.test(name.trim());
}

function buildModelsCandidates(baseUrl) {
    const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : '';
    if (!trimmed) return [];
    if (/\/models\/?$/.test(trimmed)) {
        return [trimmed];
    }
    const normalized = trimmed.replace(/\/+$/, '');
    const candidates = [];
    const pushUnique = (url) => {
        if (url && !candidates.includes(url)) {
            candidates.push(url);
        }
    };

    if (/\/v1$/i.test(normalized)) {
        pushUnique(normalized + '/models');
    } else {
        pushUnique(normalized + '/v1/models');
        pushUnique(normalized + '/models');
    }

    pushUnique(trimmed);
    return candidates;
}

function extractModelNames(payload) {
    if (!payload || typeof payload !== 'object') return [];
    const data = Array.isArray(payload.data)
        ? payload.data
        : (Array.isArray(payload.models) ? payload.models : []);
    const names = [];
    for (const item of data) {
        if (typeof item === 'string') {
            if (item.trim()) names.push(item.trim());
            continue;
        }
        if (!item || typeof item !== 'object') continue;
        const name = item.id || item.name || item.model || '';
        if (typeof name === 'string' && name.trim()) {
            names.push(name.trim());
        }
    }
    return Array.from(new Set(names));
}

function hasModelsListPayload(payload) {
    if (!payload || typeof payload !== 'object') return false;
    return Array.isArray(payload.data) || Array.isArray(payload.models);
}

function hashModelsCacheValue(value) {
    if (!value) return '';
    try {
        return crypto.createHash('sha256').update(String(value)).digest('hex');
    } catch (e) {
        return '';
    }
}

function buildModelsCacheKey(baseUrl, apiKey) {
    const normalizedUrl = typeof baseUrl === 'string'
        ? baseUrl.trim().replace(/\/+$/, '')
        : '';
    const apiKeyHash = hashModelsCacheValue(apiKey);
    return `${normalizedUrl}|${apiKeyHash}`;
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

function resolveHomePath(input) {
    const raw = typeof input === 'string' ? input.trim() : '';
    if (!raw) return '';
    if (raw === '~') return os.homedir();
    if (raw.startsWith('~/') || raw.startsWith('~\\')) {
        return path.join(os.homedir(), raw.slice(2));
    }
    return raw;
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

function readJsonObjectFromFile(filePath, fallback = {}) {
    if (!fs.existsSync(filePath)) {
        return { ok: true, exists: false, data: { ...fallback } };
    }

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.trim()) {
            return { ok: true, exists: true, data: { ...fallback } };
        }

        const parsed = JSON.parse(content);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {
                ok: false,
                exists: true,
                error: `配置文件格式错误（根节点必须是对象）: ${filePath}`
            };
        }
        return { ok: true, exists: true, data: parsed };
    } catch (e) {
        return {
            ok: false,
            exists: true,
            error: `配置文件解析失败: ${e.message}`
        };
    }
}

function backupFileIfNeededOnce(filePath, backupPrefix = 'codexmate-backup') {
    if (!fs.existsSync(filePath)) {
        return '';
    }

    const dirPath = path.dirname(filePath);
    const baseName = path.basename(filePath);
    const existingPrefix = `${baseName}.${backupPrefix}-`;
    const hasBackup = fs.readdirSync(dirPath).some(fileName =>
        fileName.startsWith(existingPrefix) && fileName.endsWith('.bak')
    );

    if (hasBackup) {
        return '';
    }

    const backupPath = path.join(dirPath, `${existingPrefix}${formatTimestampForFileName()}.bak`);
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
}

function writeJsonAtomic(filePath, data) {
    const dirPath = path.dirname(filePath);
    ensureDir(dirPath);

    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    const content = `${JSON.stringify(data, null, 2)}\n`;

    try {
        fs.writeFileSync(tmpPath, content, 'utf-8');
        try {
            fs.renameSync(tmpPath, filePath);
        } catch (renameError) {
            if (process.platform === 'win32') {
                fs.copyFileSync(tmpPath, filePath);
                fs.unlinkSync(tmpPath);
            } else {
                throw renameError;
            }
        }
    } catch (e) {
        if (fs.existsSync(tmpPath)) {
            try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
        throw new Error(`写入 JSON 文件失败: ${e.message}`);
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

function isValidHttpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

function normalizeBaseUrl(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\/+$/g, '');
}

function joinApiUrl(baseUrl, pathSuffix) {
    const trimmed = normalizeBaseUrl(baseUrl);
    if (!trimmed) return '';
    const safeSuffix = String(pathSuffix || '').replace(/^\/+/g, '');
    if (!safeSuffix) return trimmed;
    if (/\/v1$/i.test(trimmed)) {
        return `${trimmed}/${safeSuffix}`;
    }
    return `${trimmed}/v1/${safeSuffix}`;
}

function buildModelsProbeUrl(baseUrl) {
    return joinApiUrl(baseUrl, 'models');
}

function normalizeWireApi(value) {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!raw) return 'responses';
    return raw.replace(/[\s-]/g, '_');
}

function buildModelProbeSpec(provider, modelName, baseUrl) {
    const model = typeof modelName === 'string' ? modelName.trim() : '';
    if (!model) return null;

    const wireApi = normalizeWireApi(provider && provider.wire_api);
    if (wireApi === 'chat_completions' || wireApi === 'chat') {
        return {
            url: joinApiUrl(baseUrl, 'chat/completions'),
            body: {
                model,
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1,
                temperature: 0
            }
        };
    }

    if (wireApi === 'completions') {
        return {
            url: joinApiUrl(baseUrl, 'completions'),
            body: {
                model,
                prompt: 'ping',
                max_tokens: 1,
                temperature: 0
            }
        };
    }

    return {
        url: joinApiUrl(baseUrl, 'responses'),
        body: {
            model,
            input: 'ping',
            max_output_tokens: 1
        }
    };
}

function probeUrl(targetUrl, options = {}) {
    return new Promise((resolve) => {
        let parsed;
        try {
            parsed = new URL(targetUrl);
        } catch (e) {
            return resolve({ ok: false, error: 'Invalid URL' });
        }

        const transport = parsed.protocol === 'https:' ? https : http;
        const headers = {
            'User-Agent': 'codexmate-health-check',
            'Accept': 'application/json'
        };
        if (options.apiKey) {
            headers['Authorization'] = `Bearer ${options.apiKey}`;
        }

        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : HEALTH_CHECK_TIMEOUT_MS;
        const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 256 * 1024;
        const start = Date.now();
        const req = transport.request(parsed, { method: 'GET', headers }, (res) => {
            const chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
                if (!chunk) return;
                size += chunk.length;
                if (size <= maxBytes) {
                    chunks.push(chunk);
                }
            });
            res.on('end', () => {
                const body = chunks.length > 0 ? Buffer.concat(chunks).toString('utf-8') : '';
                resolve({
                    ok: true,
                    status: res.statusCode || 0,
                    durationMs: Date.now() - start,
                    body
                });
            });
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('timeout'));
        });

        req.on('error', (err) => {
            resolve({
                ok: false,
                error: err.message || 'request failed',
                durationMs: Date.now() - start
            });
        });

        req.end();
    });
}

function probeJsonPost(targetUrl, body, options = {}) {
    return new Promise((resolve) => {
        let parsed;
        try {
            parsed = new URL(targetUrl);
        } catch (e) {
            return resolve({ ok: false, error: 'Invalid URL' });
        }

        const transport = parsed.protocol === 'https:' ? https : http;
        const headers = {
            'User-Agent': 'codexmate-health-check',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
        if (options.apiKey) {
            headers['Authorization'] = `Bearer ${options.apiKey}`;
        }

        const payload = JSON.stringify(body || {});
        headers['Content-Length'] = Buffer.byteLength(payload);

        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : HEALTH_CHECK_TIMEOUT_MS;
        const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 256 * 1024;
        const start = Date.now();
        const req = transport.request(parsed, { method: 'POST', headers }, (res) => {
            const chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
                if (!chunk) return;
                size += chunk.length;
                if (size <= maxBytes) {
                    chunks.push(chunk);
                }
            });
            res.on('end', () => {
                const bodyText = chunks.length > 0 ? Buffer.concat(chunks).toString('utf-8') : '';
                resolve({
                    ok: true,
                    status: res.statusCode || 0,
                    durationMs: Date.now() - start,
                    body: bodyText
                });
            });
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('timeout'));
        });

        req.on('error', (err) => {
            resolve({
                ok: false,
                error: err.message || 'request failed',
                durationMs: Date.now() - start
            });
        });

        req.write(payload);
        req.end();
    });
}

function extractModelIds(payload) {
    const ids = [];
    const pushValue = (value) => {
        if (typeof value === 'string' && value.trim()) {
            ids.push(value.trim());
        }
    };

    if (!payload) return ids;

    if (Array.isArray(payload)) {
        for (const item of payload) {
            if (item && typeof item === 'object') {
                pushValue(item.id);
                pushValue(item.model);
                pushValue(item.name);
            } else {
                pushValue(item);
            }
        }
        return ids;
    }

    if (Array.isArray(payload.data)) {
        for (const item of payload.data) {
            if (item && typeof item === 'object') {
                pushValue(item.id);
                pushValue(item.model);
                pushValue(item.name);
            } else {
                pushValue(item);
            }
        }
    }

    if (Array.isArray(payload.models)) {
        for (const item of payload.models) {
            if (item && typeof item === 'object') {
                pushValue(item.id);
                pushValue(item.model);
                pushValue(item.name);
            } else {
                pushValue(item);
            }
        }
    }

    return ids;
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

function formatTimestampForFileName(value) {
    const date = value ? new Date(value) : new Date();
    const normalized = Number.isNaN(date.getTime()) ? new Date() : date;
    const pad = (num) => String(num).padStart(2, '0');
    return [
        normalized.getFullYear(),
        pad(normalized.getMonth() + 1),
        pad(normalized.getDate()),
        '-',
        pad(normalized.getHours()),
        pad(normalized.getMinutes()),
        pad(normalized.getSeconds())
    ].join('');
}

function toIsoTime(value, fallback = '') {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return fallback;
    }
    return date.toISOString();
}

function updateLatestIso(currentIso, candidate) {
    const currentTime = Date.parse(currentIso || '') || 0;
    const candidateIso = toIsoTime(candidate, '');
    const candidateTime = Date.parse(candidateIso || '') || 0;
    if (!candidateTime) {
        return currentIso;
    }
    return candidateTime > currentTime ? candidateIso : currentIso;
}

function truncateText(text, maxLength = 90) {
    if (!text) return '';
    const normalized = String(text).replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return normalized.slice(0, maxLength - 1) + '…';
}

function extractMessageText(content) {
    if (typeof content === 'string') {
        return content.trim();
    }

    if (Array.isArray(content)) {
        const parts = content
            .map(item => extractMessageText(item))
            .filter(Boolean);
        return parts.join('\n').trim();
    }

    if (!content || typeof content !== 'object') {
        return '';
    }

    if (typeof content.text === 'string') {
        return content.text.trim();
    }

    if (typeof content.value === 'string') {
        return content.value.trim();
    }

    if (content.content !== undefined) {
        return extractMessageText(content.content);
    }

    if (typeof content.output === 'string') {
        return content.output.trim();
    }

    return '';
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
    return {
        template: normalizeTopLevelConfigWithTemplate(content, selectedProvider, selectedModel)
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

function normalizeRole(value) {
    if (typeof value !== 'string') {
        return '';
    }
    const role = value.trim().toLowerCase();
    if (role === 'assistant' || role === 'user' || role === 'system') {
        return role;
    }
    return '';
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

    let startIndex = 1;
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
    return [
        session.title,
        session.sessionId,
        session.cwd,
        session.filePath,
        session.sourceLabel
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

        if (scope !== 'summary' && (!summaryHit || scope === 'content')) {
            if (scanned < contentScanLimit) {
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
        sessionId,
        title: firstPrompt || sessionId,
        cwd,
        createdAt,
        updatedAt,
        messageCount,
        filePath
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
        sessionId,
        title: firstPrompt || sessionId,
        cwd,
        createdAt,
        updatedAt,
        messageCount,
        filePath
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

            sessions.push({
                source: 'claude',
                sourceLabel: 'Claude Code',
                sessionId,
                title,
                cwd: entry.projectPath || index.originalPath || '',
                createdAt,
                updatedAt,
                messageCount,
                filePath
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
    const queryTokens = normalizeQueryTokens(params.query);
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
    const source = params.source === 'codex' || params.source === 'claude'
        ? params.source
        : 'all';
    const rawLimit = Number(params.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(rawLimit, MAX_SESSION_PATH_LIST_SIZE))
        : 500;
    const forceRefresh = !!params.forceRefresh;
    const cacheKey = `paths:${source}:${limit}`;
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
    if (source === 'all' || source === 'codex') {
        sessions = sessions.concat(listCodexSessions(gatherLimit, scanOptions));
    }
    if (source === 'all' || source === 'claude') {
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
        const matchedFile = files.find(item => path.basename(item).toLowerCase().includes(targetId));
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

function parseMaxMessagesValue(value) {
    if (value === Infinity) {
        return Infinity;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        const lower = trimmed.toLowerCase();
        if (lower === 'all' || lower === 'infinity' || lower === 'inf') {
            return Infinity;
        }
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
        return null;
    }

    if (Number.isFinite(value)) {
        return value;
    }
    return null;
}

function resolveMaxMessagesValue(value, fallback) {
    const parsed = parseMaxMessagesValue(value);
    if (parsed === null) {
        return fallback;
    }
    if (parsed === Infinity) {
        return Infinity;
    }
    return Math.max(1, Math.floor(parsed));
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
    if (!name || !baseUrl) {
        if (!silent) {
            console.error('用法: codexmate add <名称> <URL> [密钥]');
            console.log('\n示例:');
            console.log('  codexmate add 88code https://api.88code.ai/v1 sk-xxx');
        }
        throw new Error('名称和URL必填');
    }

    const config = readConfig();
    if (config.model_providers && config.model_providers[name]) {
        if (!silent) console.error('错误: 提供商已存在:', name);
        throw new Error('提供商已存在');
    }

    const newBlock = `
[model_providers.${name}]
name = "${name}"
base_url = "${baseUrl}"
wire_api = "responses"
requires_openai_auth = false
preferred_auth_method = "${apiKey || ''}"
request_max_retries = 4
stream_max_retries = 10
stream_idle_timeout_ms = 300000
`;

    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    writeConfig(content.trimEnd() + '\n' + newBlock);

    // 初始化当前模型
    const currentModels = readCurrentModels();
    if (!currentModels[name]) {
        currentModels[name] = readModels()[0];
        writeCurrentModels(currentModels);
    }

    if (!silent) {
        console.log('✓ 已添加提供商:', name);
        console.log('  URL:', baseUrl);
        console.log();
    }
}

// 删除提供商
function cmdDelete(name, silent = false) {
    const config = readConfig();
    if (!config.model_providers || !config.model_providers[name]) {
        if (!silent) console.error('错误: 提供商不存在:', name);
        throw new Error('提供商不存在');
    }

    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionRegex = new RegExp(`\\[\\s*model_providers\\s*\\.\\s*${safeName}\\s*\\]`);
    const match = content.match(sectionRegex);
    if (!match) {
        if (!silent) console.error('错误: 无法找到提供商配置块');
        throw new Error('无法找到提供商配置块');
    }

    const startIdx = match.index;
    const rest = content.slice(startIdx + match[0].length);
    const nextIdx = rest.indexOf('[');
    const endIdx = nextIdx === -1 ? content.length : (startIdx + match[0].length + nextIdx);

    const newContent = content.slice(0, startIdx) + content.slice(endIdx);
    writeConfig(newContent.trim());

    // 删除当前模型记录
    const currentModels = readCurrentModels();
    delete currentModels[name];
    writeCurrentModels(currentModels);

    if (!silent) {
        console.log('✓ 已删除提供商:', name);
        console.log();
    }
}

// 更新提供商
function cmdUpdate(name, baseUrl, apiKey, silent = false) {
    if (!name) {
        if (!silent) console.error('错误: 提供商名称必填');
        throw new Error('提供商名称必填');
    }

    const config = readConfig();
    if (!config.model_providers || !config.model_providers[name]) {
        if (!silent) console.error('错误: 提供商不存在:', name);
        throw new Error('提供商不存在');
    }

    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionRegex = new RegExp(`\\[\\s*model_providers\\s*\\.\\s*${safeName}\\s*\\]`);
    const match = content.match(sectionRegex);
    if (!match) {
        if (!silent) console.error('错误: 无法找到提供商配置块');
        throw new Error('无法找到提供商配置块');
    }

    const startIdx = match.index;
    const rest = content.slice(startIdx + match[0].length);
    const nextIdx = rest.indexOf('[');
    const endIdx = nextIdx === -1 ? content.length : (startIdx + match[0].length + nextIdx);

    // 提取该提供商的配置块
    const providerBlock = content.slice(startIdx, endIdx);

    // 替换 base_url
    let updatedBlock = providerBlock;
    if (baseUrl) {
        updatedBlock = updatedBlock.replace(
            /^(base_url\s*=\s*)(["']).*?\2/m,
            `$1$2${baseUrl}$2`
        );
    }

    // 替换 preferred_auth_method (API Key)
    if (apiKey !== undefined) {
        updatedBlock = updatedBlock.replace(
            /^(preferred_auth_method\s*=\s*)(["']).*?\2/m,
            `$1$2${apiKey}$2`
        );
    }

    // 组合新的内容
    const newContent = content.slice(0, startIdx) + updatedBlock + content.slice(endIdx);
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
        const model = (config.model || 'glm-4.7').trim();
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

function commandExists(command, args = '') {
    try {
        execSync(`${command} ${args}`, { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

const SEVEN_ZIP_PATHS = [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    '7z'
];

function findSevenZipExecutable() {
    for (const candidate of SEVEN_ZIP_PATHS) {
        try {
            if (candidate === '7z') {
                if (commandExists('7z', '--help')) {
                    return '7z';
                }
            } else if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch (e) {}
    }
    return null;
}

function resolveZipTool() {
    const sevenZipExe = findSevenZipExecutable();
    if (sevenZipExe) {
        return { type: '7z', cmd: sevenZipExe };
    }
    return { type: 'lib', cmd: 'zip-lib' };
}

function resolveUnzipTool() {
    const sevenZipExe = findSevenZipExecutable();
    if (sevenZipExe) {
        return { type: '7z', cmd: sevenZipExe };
    }
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

// 压缩（7-Zip 优先）
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

    console.log('\n压缩配置:');
    console.log('  源路径:', absPath);
    console.log('  输出文件:', outputPath);
    console.log('  压缩级别:', compressionLevel);
    console.log('  压缩工具:', zipTool.type === '7z' ? '7-Zip' : 'zip-lib');
    console.log('  多线程:', zipTool.type === '7z' ? '启用' : '未启用（JS 库）');
    if (zipTool.type !== '7z') {
        console.log('  提示: JS 库不支持压缩级别，已忽略 --max');
    }
    console.log('\n开始压缩...\n');

    try {
        if (zipTool.type === '7z') {
            const cmd = `"${zipTool.cmd}" a -tzip -mmt=on -mx=${compressionLevel} "${outputPath}" "${absPath}"`;
            const result = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
            const sizeMatch = result.match(/Archive size:\s*(\d+)\s*bytes/);
            const filesMatch = result.match(/(\d+)\s*files/);

            console.log('✓ 压缩完成!');
            console.log('  输出文件:', outputPath);
            if (sizeMatch) {
                const sizeBytes = parseInt(sizeMatch[1]);
                const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);
                console.log('  压缩大小:', sizeMB, 'MB');
            }
            if (filesMatch) {
                console.log('  文件数量:', filesMatch[1]);
            }
            console.log();
            return;
        }

        await zipWithLibrary(absPath, outputPath);
        console.log('✓ 压缩完成!');
        console.log('  输出文件:', outputPath);
        console.log();
    } catch (e) {
        console.error('压缩失败:', e.message);
        process.exit(1);
    }
}

// 解压（7-Zip 优先）
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
    console.log('  解压工具:', unzipTool.type === '7z' ? '7-Zip' : 'zip-lib');
    console.log('  多线程:', unzipTool.type === '7z' ? '启用' : '未启用（JS 库）');
    console.log('\n开始解压...\n');

    try {
        if (unzipTool.type === '7z') {
            const cmd = `"${unzipTool.cmd}" x -mmt=on -o"${absOutputDir}" "${absZipPath}" -y`;
            const result = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
            const filesMatch = result.match(/(\d+)\s*files/);
            console.log('✓ 解压完成!');
            console.log('  输出目录:', absOutputDir);
            if (filesMatch) {
                console.log('  文件数量:', filesMatch[1]);
            }
            console.log();
            return;
        }

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

// 打开 Web UI
function cmdStart() {
    const htmlPath = path.join(__dirname, 'web-ui.html');
    if (!fs.existsSync(htmlPath)) {
        console.error('错误: web-ui.html 不存在');
        process.exit(1);
    }

    const server = http.createServer((req, res) => {
        if (req.url === '/api') {
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
                            result = {
                                provider: config.model_provider || '未设置',
                                model: config.model || '未设置',
                                configReady: !statusConfigResult.isVirtual,
                                configNotice: statusConfigResult.reason || '',
                                initNotice: consumeInitNotice()
                            };
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
                                    current: name === current
                                }))
                            };
                            break;
                        case 'models':
                            {
                                const providerName = params && typeof params.provider === 'string' ? params.provider : '';
                                const res = await fetchProviderModels(providerName);
                                if (res.error) {
                                    result = { error: res.error, models: [], source: 'remote' };
                                } else if (res.unlimited) {
                                    result = { models: [], source: 'remote', provider: res.provider || '', unlimited: true };
                                } else {
                                    result = { models: res.models || [], source: 'remote', provider: res.provider || '' };
                                }
                            }
                            break;
                        case 'models-by-url':
                            {
                                const baseUrl = params && typeof params.baseUrl === 'string' ? params.baseUrl : '';
                                const apiKey = params && typeof params.apiKey === 'string' ? params.apiKey : '';
                                const res = await fetchModelsFromBaseUrl(baseUrl, apiKey);
                                if (res.error) {
                                    result = { error: res.error, models: [], source: 'remote' };
                                } else if (res.unlimited) {
                                    result = { models: [], source: 'remote', unlimited: true };
                                } else {
                                    result = { models: res.models || [], source: 'remote' };
                                }
                            }
                            break;
                        case 'get-config-template':
                            result = getConfigTemplate(params || {});
                            break;
                        case 'apply-config-template':
                            result = applyConfigTemplate(params || {});
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
                        case 'apply-claude-config':
                            result = applyToClaudeSettings(params.config);
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
                            result = {
                                sessions: listAllSessions(params)
                            };
                            break;
                        case 'list-session-paths':
                            result = {
                                paths: listSessionPaths(params)
                            };
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
                        default:
                            result = { error: '未知操作' };
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
        } else {
            const html = fs.readFileSync(htmlPath, 'utf-8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        }
    });

    const port = resolveWebPort();
    server.listen(port, () => {
        console.log('\n✓ Web UI 已启动: http://localhost:' + port);
        console.log('  按 Ctrl+C 退出\n');

        // 打开浏览器
        const platform = process.platform;
        let command;
        const url = `http://localhost:${port}`;

        if (platform === 'win32') {
            command = `start "" "${url}"`;
        } else if (platform === 'darwin') {
            command = `open "${url}"`;
        } else {
            command = `xdg-open "${url}"`;
        }

        const disableBrowser = process.env.CODEXMATE_NO_BROWSER === '1';
        if (!disableBrowser) {
            exec(command, (error) => {
                if (error) console.warn('无法自动打开浏览器，请手动访问:', url);
            });
        }
    });
}

// ============================================================================
// 主程序
// ============================================================================
async function main() {
    const bootstrap = ensureManagedConfigBootstrap();
    if (bootstrap && bootstrap.notice) {
        console.log(`\n[Init] ${bootstrap.notice}`);
    }

    const args = process.argv.slice(2);
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
        console.log('  codexmate add-model <模型> 添加模型');
        console.log('  codexmate delete-model <模型> 删除模型');
        console.log('  codexmate start            启动 Web 界面');
        console.log('  codexmate export-session --source <codex|claude> (--session-id <ID>|--file <PATH>) [--output <PATH>] [--max-messages <N|all|Infinity>]');
        console.log('  codexmate zip <路径> [--max:级别]  压缩（7-Zip 优先）');
        console.log('  codexmate unzip <zip文件> [输出目录]  解压（7-Zip 优先）');
        console.log('');
        process.exit(0);
    }

    const command = args[0];

    switch (command) {
        case 'status': cmdStatus(); break;
        case 'setup': await cmdSetup(); break;
        case 'list': cmdList(); break;
        case 'models': await cmdModels(); break;
        case 'switch': cmdSwitch(args[1]); break;
        case 'use': cmdUseModel(args[1]); break;
        case 'add': cmdAdd(args[1], args[2], args[3]); break;
        case 'delete': cmdDelete(args[1]); break;
        case 'add-model': cmdAddModel(args[1]); break;
        case 'delete-model': cmdDeleteModel(args[1]); break;
        case 'start': cmdStart(); break;
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

