#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const toml = require('@iarna/toml');
const { exec, execSync } = require('child_process');
const http = require('http');
const https = require('https');
const readline = require('readline');

const PORT = 3737;

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
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

const DEFAULT_MODELS = ['gpt-5.3-codex', 'gpt-5.1-codex-max', 'gpt-4-turbo', 'gpt-4'];
const SPEED_TEST_TIMEOUT_MS = 8000;
const MAX_SESSION_LIST_SIZE = 300;
const MAX_EXPORT_MESSAGES = 1000;
const DEFAULT_SESSION_DETAIL_MESSAGES = 300;
const MAX_SESSION_DETAIL_MESSAGES = 1000;
const SESSION_TITLE_READ_BYTES = 64 * 1024;
const CODEXMATE_MANAGED_MARKER = '# codexmate-managed: true';
const SESSION_LIST_CACHE_TTL_MS = 4000;
const SESSION_SUMMARY_READ_BYTES = 256 * 1024;
const SESSION_SCAN_FACTOR = 4;
const SESSION_SCAN_MIN_FILES = 800;
const MAX_BATCH_DELETE_SESSIONS = 500;
const BOOTSTRAP_TEXT_MARKERS = [
    'agents.md instructions',
    '<instructions>',
    '<environment_context>',
    'you are a coding agent',
    'codex cli'
];

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

function isPathInside(targetPath, rootPath) {
    const resolvedTarget = path.resolve(targetPath).toLowerCase();
    const resolvedRoot = path.resolve(rootPath).toLowerCase();
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
            updatedAt = toIsoTime(record.timestamp, updatedAt);
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
            updatedAt = toIsoTime(record.timestamp, updatedAt);
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

function listCodexSessions(limit) {
    const scanCount = Math.max(
        limit * SESSION_SCAN_FACTOR,
        Math.min(SESSION_SCAN_MIN_FILES, MAX_SESSION_LIST_SIZE * SESSION_SCAN_FACTOR)
    );
    const files = collectRecentJsonlFiles(CODEX_SESSIONS_DIR, {
        returnCount: scanCount,
        maxFilesScanned: Math.max(scanCount * 2, SESSION_SCAN_MIN_FILES)
    });
    const sessions = [];

    for (const filePath of files) {
        const summary = parseCodexSessionSummary(filePath);
        if (summary) {
            sessions.push(summary);
        }

        if (sessions.length >= limit * SESSION_SCAN_FACTOR) {
            break;
        }
    }

    return mergeAndLimitSessions(sessions, limit);
}

function listClaudeSessions(limit) {
    if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
        return [];
    }

    const sessions = [];
    let projectDirs = [];
    try {
        projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => path.join(CLAUDE_PROJECTS_DIR, entry.name));
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

            if (sessions.length >= limit * SESSION_SCAN_FACTOR) {
                break;
            }
        }

        if (sessions.length >= limit * SESSION_SCAN_FACTOR) {
            break;
        }
    }

    if (sessions.length === 0) {
        const scanCount = Math.max(
            limit * SESSION_SCAN_FACTOR,
            Math.min(SESSION_SCAN_MIN_FILES, MAX_SESSION_LIST_SIZE * SESSION_SCAN_FACTOR)
        );
        const fallbackFiles = collectRecentJsonlFiles(CLAUDE_PROJECTS_DIR, {
            returnCount: scanCount,
            maxFilesScanned: Math.max(scanCount * 2, SESSION_SCAN_MIN_FILES),
            ignoreSubPath: `${path.sep}subagents${path.sep}`
        });
        for (const filePath of fallbackFiles) {
            const summary = parseClaudeSessionSummary(filePath);
            if (summary) {
                sessions.push(summary);
            }

            if (sessions.length >= limit * SESSION_SCAN_FACTOR) {
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
    const cacheKey = `${source}:${limit}`;
    const cached = getSessionListCache(cacheKey, forceRefresh);
    if (cached) {
        return cached;
    }

    let sessions = [];
    if (source === 'all' || source === 'codex') {
        sessions = sessions.concat(listCodexSessions(limit));
    }
    if (source === 'all' || source === 'claude') {
        sessions = sessions.concat(listClaudeSessions(limit));
    }

    const result = mergeAndLimitSessions(sessions, limit);
    setSessionListCache(cacheKey, result);
    return result;
}

function resolveSessionFilePath(source, filePath, sessionId) {
    const root = source === 'claude' ? CLAUDE_PROJECTS_DIR : CODEX_SESSIONS_DIR;
    if (!root || !fs.existsSync(root)) {
        return '';
    }

    if (typeof filePath === 'string' && filePath.trim()) {
        const targetPath = path.resolve(filePath.trim());
        if (fs.existsSync(targetPath) && isPathInside(targetPath, root)) {
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

function extractCodexMessageFromRecord(record, state) {
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
            if (text && state.messages.length < MAX_EXPORT_MESSAGES) {
                state.messages.push({
                    role,
                    text,
                    timestamp: toIsoTime(record.timestamp, '')
                });
            }
        }
    }
}

function extractClaudeMessageFromRecord(record, state) {
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
        if (text && state.messages.length < MAX_EXPORT_MESSAGES) {
            state.messages.push({
                role,
                text,
                timestamp: toIsoTime(record.timestamp, '')
            });
        }
    }
}

function extractMessagesFromRecords(records, source) {
    const state = {
        sessionId: '',
        cwd: '',
        updatedAt: '',
        messages: []
    };

    for (const record of records) {
        if (source === 'codex') {
            extractCodexMessageFromRecord(record, state);
        } else {
            extractClaudeMessageFromRecord(record, state);
        }

        if (state.messages.length >= MAX_EXPORT_MESSAGES) {
            break;
        }
    }

    return state;
}

async function extractMessagesFromFile(filePath, source) {
    const state = {
        sessionId: '',
        cwd: '',
        updatedAt: '',
        messages: []
    };

    let stream;
    let rl;
    try {
        stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
        rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

        for await (const line of rl) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let record;
            try {
                record = JSON.parse(trimmed);
            } catch (e) {
                continue;
            }

            if (source === 'codex') {
                extractCodexMessageFromRecord(record, state);
            } else {
                extractClaudeMessageFromRecord(record, state);
            }

            if (state.messages.length >= MAX_EXPORT_MESSAGES) {
                rl.close();
                if (stream.destroy) {
                    stream.destroy();
                }
                break;
            }
        }
    } catch (e) {
        const fallbackRecords = readJsonlRecords(filePath);
        return extractMessagesFromRecords(fallbackRecords, source);
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
    const allMessages = removeLeadingSystemMessage(Array.isArray(extracted.messages) ? extracted.messages : []);
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

async function exportSessionData(params = {}) {
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
        extracted = await extractMessagesFromFile(filePath, source);
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
        extracted = extractMessagesFromRecords(fallbackRecords, source);
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
        content: markdown
    };
}

function deleteSessionFile(params = {}, options = {}) {
    const source = params.source === 'claude' ? 'claude' : (params.source === 'codex' ? 'codex' : '');
    if (!source) {
        return { error: 'Invalid source' };
    }

    const filePath = resolveSessionFilePath(source, params.filePath, params.sessionId);
    if (!filePath) {
        return { error: 'Session file not found' };
    }

    if (!filePath.toLowerCase().endsWith('.jsonl')) {
        return { error: 'Invalid session file' };
    }

    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (e) {
        return { error: 'Session file not found' };
    }

    if (!stat.isFile()) {
        return { error: 'Session path is not a file' };
    }

    try {
        fs.unlinkSync(filePath);
    } catch (e) {
        return { error: `Failed to delete session: ${e.message}` };
    }

    if (!options.skipCacheInvalidate) {
        invalidateSessionListCache();
    }

    return {
        success: true,
        source,
        sessionId: params.sessionId || path.basename(filePath, '.jsonl'),
        filePath
    };
}

function deleteSessionFilesBatch(params = {}) {
    const items = Array.isArray(params.items) ? params.items : [];
    if (items.length === 0) {
        return { error: 'No sessions provided' };
    }

    if (items.length > MAX_BATCH_DELETE_SESSIONS) {
        return { error: `Too many sessions, max ${MAX_BATCH_DELETE_SESSIONS}` };
    }

    const results = [];
    let deleted = 0;

    for (const item of items) {
        const payload = (item && typeof item === 'object') ? item : {};
        const source = typeof payload.source === 'string' ? payload.source : '';
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
        const filePath = typeof payload.filePath === 'string' ? payload.filePath : '';

        const single = deleteSessionFile(
            { source, sessionId, filePath },
            { skipCacheInvalidate: true }
        );

        if (single.error) {
            results.push({
                success: false,
                source: source || 'unknown',
                sessionId,
                filePath,
                error: single.error
            });
            continue;
        }

        deleted += 1;
        results.push({
            success: true,
            source: single.source,
            sessionId: single.sessionId,
            filePath: single.filePath
        });
    }

    if (deleted > 0) {
        invalidateSessionListCache();
    }

    const failed = results.length - deleted;
    return {
        success: failed === 0,
        total: results.length,
        deleted,
        failed,
        results
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

function runSpeedTest(targetUrl, apiKey) {
    return new Promise((resolve) => {
        let parsed;
        try {
            parsed = new URL(targetUrl);
        } catch (e) {
            return resolve({ ok: false, error: 'Invalid URL' });
        }

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

        req.setTimeout(SPEED_TEST_TIMEOUT_MS, () => {
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

// 显示当前状态
function cmdStatus() {
    const { config, isVirtual } = readConfigOrVirtualDefault();
    const current = config.model_provider || '未设置';
    const currentModel = config.model || '未设置';
    const models = readModels();
    const currentModels = readCurrentModels();

    console.log('\n当前状态:');
    console.log('  提供商:', current);
    console.log('  模型:', currentModel);
    console.log('  模型列表:', models.length, '个');
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
function cmdModels() {
    const models = readModels();
    const currentModels = readCurrentModels();

    console.log('\n可用模型:');
    models.forEach((m, i) => {
        const users = Object.entries(currentModels)
            .filter(([_, model]) => model === m)
            .map(([name, _]) => name);
        const usage = users.length > 0 ? users.join(', ') : '(未使用)';
        console.log(`  ${i + 1}. ${m}`);
        if (users.length > 0) {
            console.log(`     → ${usage}`);
        }
    });
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
    return targetModel;
}

// 切换模型
function cmdUseModel(modelName, silent = false) {
    const models = readModels();
    if (!models.includes(modelName)) {
        if (!silent) {
            console.error('错误: 模型不存在:', modelName);
            console.log('\n可用的模型:');
            models.forEach(m => console.log('  -', m));
        }
        throw new Error('模型不存在');
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

// 应用到系统环境变量
function applyToSystemEnv(config) {
    try {
        const apiKey = config.apiKey || '';

        // Windows 使用 setx 命令设置用户环境变量
        if (process.platform === 'win32') {
            const envVars = [
                ['ANTHROPIC_API_KEY', apiKey],
                ['ANTHROPIC_AUTH_TOKEN', apiKey],
                ['ANTHROPIC_BASE_URL', config.baseUrl || 'https://open.bigmodel.cn/api/anthropic'],
                ['CLAUDE_CODE_USE_KEY', '1'],
                ['ANTHROPIC_MODEL', config.model || 'glm-4.7']
            ];

            const errors = [];
            for (const [key, value] of envVars) {
                try {
                    // 转义值中的双引号，防止命令注入
                    const safeValue = value.replace(/"/g, '""');
                    execSync(`setx ${key} "${safeValue}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
                } catch (e) {
                    errors.push(`${key}: ${e.message || '设置失败'}`);
                }
            }

            if (errors.length > 0) {
                return { success: false, error: `部分环境变量设置失败:\n${errors.join('\n')}` };
            }
            return { success: true };
        } else {
            return { success: false, error: '仅支持 Windows 系统' };
        }
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// 多线程压缩
function cmdZip(targetPath, options = {}) {
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

    // 查找 7-Zip
    const sevenZipPaths = [
        'C:\\Program Files\\7-Zip\\7z.exe',
        'C:\\Program Files (x86)\\7-Zip\\7z.exe',
        '7z'
    ];

    let sevenZipExe = null;
    for (const p of sevenZipPaths) {
        try {
            if (p === '7z') {
                execSync('7z --help', { stdio: 'ignore' });
                sevenZipExe = '7z';
                break;
            } else if (fs.existsSync(p)) {
                sevenZipExe = p;
                break;
            }
        } catch (e) {}
    }

    if (!sevenZipExe) {
        console.error('错误: 未找到 7-Zip，请先安装 7-Zip');
        console.log('下载地址: https://www.7-zip.org/');
        process.exit(1);
    }

    console.log('\n压缩配置:');
    console.log('  源路径:', absPath);
    console.log('  输出文件:', outputPath);
    console.log('  压缩级别:', compressionLevel);
    console.log('  多线程: 启用');
    console.log('\n开始压缩...\n');

    try {
        const cmd = `"${sevenZipExe}" a -tzip -mmt=on -mx=${compressionLevel} "${outputPath}" "${absPath}"`;
        const result = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });

        // 解析输出获取文件信息
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
    } catch (e) {
        console.error('压缩失败:', e.message);
        process.exit(1);
    }
}

// 多线程解压
function cmdUnzip(zipPath, outputDir) {
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

    // 查找 7-Zip
    const sevenZipPaths = [
        'C:\\Program Files\\7-Zip\\7z.exe',
        'C:\\Program Files (x86)\\7-Zip\\7z.exe',
        '7z'
    ];

    let sevenZipExe = null;
    for (const p of sevenZipPaths) {
        try {
            if (p === '7z') {
                execSync('7z --help', { stdio: 'ignore' });
                sevenZipExe = '7z';
                break;
            } else if (fs.existsSync(p)) {
                sevenZipExe = p;
                break;
            }
        } catch (e) {}
    }

    if (!sevenZipExe) {
        console.error('错误: 未找到 7-Zip，请先安装 7-Zip');
        console.log('下载地址: https://www.7-zip.org/');
        process.exit(1);
    }

    console.log('\n解压配置:');
    console.log('  源文件:', absZipPath);
    console.log('  输出目录:', absOutputDir);
    console.log('  多线程: 启用');
    console.log('\n开始解压...\n');

    try {
        const cmd = `"${sevenZipExe}" x -mmt=on -o"${absOutputDir}" "${absZipPath}" -y`;
        const result = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });

        // 解析输出获取文件信息
        const filesMatch = result.match(/(\d+)\s*files/);

        console.log('✓ 解压完成!');
        console.log('  输出目录:', absOutputDir);
        if (filesMatch) {
            console.log('  文件数量:', filesMatch[1]);
        }
        console.log();
    } catch (e) {
        console.error('解压失败:', e.message);
        process.exit(1);
    }
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
                            result = { models: readModels() };
                            break;
                        case 'get-config-template':
                            result = getConfigTemplate(params || {});
                            break;
                        case 'apply-config-template':
                            result = applyConfigTemplate(params || {});
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
                        case 'apply-env':
                            result = applyToSystemEnv(params.config);
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
                        case 'export-session':
                            result = await exportSessionData(params);
                            break;
                        case 'session-detail':
                            result = await readSessionDetail(params);
                            break;
                        case 'delete-session':
                            result = deleteSessionFile(params);
                            break;
                        case 'delete-sessions':
                            result = deleteSessionFilesBatch(params);
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

    server.listen(PORT, () => {
        console.log('\n✓ Web UI 已启动: http://localhost:' + PORT);
        console.log('  按 Ctrl+C 退出\n');

        // 打开浏览器
        const platform = process.platform;
        let command;
        const url = `http://localhost:${PORT}`;

        if (platform === 'win32') {
            command = `start "" "${url}"`;
        } else if (platform === 'darwin') {
            command = `open "${url}"`;
        } else {
            command = `xdg-open "${url}"`;
        }

        exec(command, (error) => {
            if (error) console.warn('无法自动打开浏览器，请手动访问:', url);
        });
    });
}

// ============================================================================
// 主程序
// ============================================================================
function main() {
    const bootstrap = ensureManagedConfigBootstrap();
    if (bootstrap && bootstrap.notice) {
        console.log(`\n[Init] ${bootstrap.notice}`);
    }

    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('\nCodex Mate - Codex 提供商管理工具');
        console.log('\n用法:');
        console.log('  codexmate status           显示当前状态');
        console.log('  codexmate list             列出所有提供商');
        console.log('  codexmate models           列出所有模型');
        console.log('  codexmate switch <名称>    切换提供商');
        console.log('  codexmate use <模型>       切换模型');
        console.log('  codexmate add <名称> <URL> [密钥]');
        console.log('  codexmate delete <名称>    删除提供商');
        console.log('  codexmate add-model <模型> 添加模型');
        console.log('  codexmate delete-model <模型> 删除模型');
        console.log('  codexmate start            启动 Web 界面');
        console.log('  codexmate zip <路径> [--max:级别]  多线程压缩');
        console.log('  codexmate unzip <zip文件> [输出目录]  多线程解压');
        console.log('');
        process.exit(0);
    }

    const command = args[0];

    switch (command) {
        case 'status': cmdStatus(); break;
        case 'list': cmdList(); break;
        case 'models': cmdModels(); break;
        case 'switch': cmdSwitch(args[1]); break;
        case 'use': cmdUseModel(args[1]); break;
        case 'add': cmdAdd(args[1], args[2], args[3]); break;
        case 'delete': cmdDelete(args[1]); break;
        case 'add-model': cmdAddModel(args[1]); break;
        case 'delete-model': cmdDeleteModel(args[1]); break;
        case 'start': cmdStart(); break;
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
            cmdZip(targetPath, zipOptions);
            break;
        }
        case 'unzip': cmdUnzip(args[1], args[2]); break;
        default:
            console.error('错误: 未知命令:', command);
            console.log('运行 "codexmate" 查看帮助');
            process.exit(1);
    }
}

main();
