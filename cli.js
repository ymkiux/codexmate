#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const toml = require('@iarna/toml');
const JSON5 = require('json5');
const zipLib = require('zip-lib');
const yauzl = require('yauzl');
const { exec, execSync, spawn, spawnSync } = require('child_process');
const http = require('http');
const https = require('https');
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
const { buildLineDiff } = require('./lib/text-diff');
const {
    extractModelNames,
    hasModelsListPayload,
    buildModelsCacheKey,
    buildModelProbeSpec,
    buildModelConversationSpecs,
    extractModelResponseText,
    normalizeWireApi,
    getSupplementalModelsForBaseUrl,
    mergeModelCatalog
} = require('./lib/cli-models-utils');
const {
    probeUrl,
    probeJsonPost
} = require('./lib/cli-network-utils');
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
const {
    truncateText: truncateTaskText,
    buildTaskPlan,
    validateTaskPlan,
    executeTaskPlan
} = require('./lib/task-orchestrator');
const { buildConfigHealthReport: buildConfigHealthReportCore } = require('./cli/config-health');
const {
    createAuthProfileController
} = require('./cli/auth-profiles');
const {
    createBuiltinProxyRuntimeController
} = require('./cli/builtin-proxy');
const {
    createBuiltinClaudeProxyRuntimeController
} = require('./cli/claude-proxy');
const {
    createOpenclawConfigController
} = require('./cli/openclaw-config');
const {
    createConfigBootstrapController
} = require('./cli/config-bootstrap');
const {
    createAgentsFileController
} = require('./cli/agents-files');
const {
    createArchiveHelperController
} = require('./cli/archive-helpers');
const {
    createZipCommandController
} = require('./cli/zip-commands');
const {
    readBundledWebUiCss,
    readBundledWebUiHtml,
    readExecutableBundledJavaScriptModule,
    readExecutableBundledWebUiScript
} = require('./web-ui/source-bundle.cjs');

const DEFAULT_WEB_PORT = 3737;
const DEFAULT_WEB_HOST = '0.0.0.0';
const DEFAULT_WEB_OPEN_HOST = '127.0.0.1';

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
const BUILTIN_CLAUDE_PROXY_SETTINGS_FILE = path.join(CONFIG_DIR, 'codexmate-claude-proxy.json');
const CODEX_SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
const SESSION_TRASH_DIR = path.join(CONFIG_DIR, 'codexmate-session-trash');
const SESSION_TRASH_FILES_DIR = path.join(SESSION_TRASH_DIR, 'files');
const SESSION_TRASH_INDEX_FILE = path.join(SESSION_TRASH_DIR, 'index.json');
const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const OPENCLAW_CONFIG_FILE = path.join(OPENCLAW_DIR, 'openclaw.json');
const OPENCLAW_WORKSPACE_DIR = path.join(OPENCLAW_DIR, 'workspace');
const OPENCLAW_DEFAULT_AGENT_ID = 'main';
const OPENCLAW_AUTH_PROFILES_FILE_NAME = 'auth-profiles.json';
const OPENCLAW_AUTH_STATE_FILE_NAME = 'auth-state.json';
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const RECENT_CONFIGS_FILE = path.join(CONFIG_DIR, 'recent-configs.json');
const WORKFLOW_DEFINITIONS_FILE = path.join(CONFIG_DIR, 'codexmate-workflows.json');
const WORKFLOW_RUNS_FILE = path.join(CONFIG_DIR, 'codexmate-workflow-runs.jsonl');
const TASK_QUEUE_FILE = path.join(CONFIG_DIR, 'codexmate-task-queue.json');
const TASK_RUNS_FILE = path.join(CONFIG_DIR, 'codexmate-task-runs.jsonl');
const TASK_RUN_DETAILS_DIR = path.join(CONFIG_DIR, 'codexmate-task-runs');
const TASK_QUEUE_WORKER_FILE = path.join(CONFIG_DIR, 'codexmate-task-queue-worker.json');
const DEFAULT_CLAUDE_MODEL = 'glm-4.7';
const DEFAULT_MODEL_CONTEXT_WINDOW = 190000;
const DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT = 185000;
const CODEX_BACKUP_NAME = 'codex-config';

const DEFAULT_MODELS = ['gpt-5.3-codex', 'gpt-5.1-codex-max', 'gpt-4-turbo', 'gpt-4'];
const SPEED_TEST_TIMEOUT_MS = 8000;
const MAX_SESSION_LIST_SIZE = 300;
const MAX_SESSION_TRASH_LIST_SIZE = 500;
const MAX_EXPORT_MESSAGES = 1000;
const DEFAULT_SESSION_DETAIL_MESSAGES = 300;
const MAX_SESSION_DETAIL_MESSAGES = 1000;
const SESSION_TITLE_READ_BYTES = 64 * 1024;
const CODEXMATE_MANAGED_MARKER = '# codexmate-managed: true';
const SESSION_LIST_CACHE_TTL_MS = 4000;
const SESSION_SUMMARY_READ_BYTES = 256 * 1024;
const SESSION_CONTENT_READ_BYTES = SESSION_SUMMARY_READ_BYTES;
const SESSION_PREVIEW_MESSAGE_TEXT_MAX_LENGTH = 4000;
const EXACT_MESSAGE_COUNT_CACHE_MAX_ENTRIES = 800;
const DEFAULT_CONTENT_SCAN_LIMIT = 50;
const SESSION_SCAN_FACTOR = 4;
const SESSION_SCAN_MIN_FILES = 800;
const SESSION_BROWSE_SCAN_FACTOR = 2;
const SESSION_BROWSE_MIN_FILES = 120;
const SESSION_BROWSE_SUMMARY_READ_BYTES = 64 * 1024;
const SESSION_USAGE_TAIL_READ_BYTES = 64 * 1024;
const SESSION_INVENTORY_CACHE_MAX_ENTRIES = 12;
const MAX_SESSION_PATH_LIST_SIZE = 2000;
const MAX_SESSION_USAGE_LIST_SIZE = 2000;
const FAST_SESSION_DETAIL_PREVIEW_FILE_BYTES = 256 * 1024;
const FAST_SESSION_DETAIL_PREVIEW_CHUNK_BYTES = 64 * 1024;
const FAST_SESSION_DETAIL_PREVIEW_MAX_BYTES = 1024 * 1024;
const AGENTS_FILE_NAME = 'AGENTS.md';
const CODEX_SKILLS_DIR = path.join(CONFIG_DIR, 'skills');
const CLAUDE_SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');
const AGENTS_SKILLS_DIR = path.join(os.homedir(), '.agents', 'skills');
const SKILL_TARGETS = Object.freeze([
    Object.freeze({ app: 'codex', label: 'Codex', dir: getCodexSkillsDir() }),
    Object.freeze({ app: 'claude', label: 'Claude Code', dir: getClaudeSkillsDir() })
]);
const SKILL_IMPORT_SOURCES = Object.freeze([
    ...SKILL_TARGETS,
    Object.freeze({ app: 'agents', label: 'Agents', dir: AGENTS_SKILLS_DIR })
]);
const MODELS_CACHE_TTL_MS = 60 * 1000;
const MODELS_NEGATIVE_CACHE_TTL_MS = 5 * 1000;
const MODELS_CACHE_MAX_ENTRIES = 50;
const MODELS_RESPONSE_MAX_BYTES = 1024 * 1024;
const MAX_RECENT_CONFIGS = 3;
const MAX_UPLOAD_SIZE = 200 * 1024 * 1024;
const MAX_SKILLS_ZIP_UPLOAD_SIZE = 20 * 1024 * 1024;
const MAX_API_BODY_SIZE = 4 * 1024 * 1024;
const MAX_SKILLS_ZIP_ENTRY_COUNT = 2000;
const MAX_SKILLS_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const DEFAULT_EXTRACT_SUFFIXES = Object.freeze(['.json']);
const DOWNLOAD_ARTIFACT_TTL_MS = 10 * 60 * 1000;
const g_downloadArtifacts = new Map();
const g_taskRunControllers = new Map();
let g_taskQueueProcessor = null;
const BUILTIN_PROXY_PROVIDER_NAME = 'codexmate-proxy';
const DEFAULT_BUILTIN_PROXY_SETTINGS = Object.freeze({
    enabled: false,
    host: '127.0.0.1',
    port: 8318,
    provider: '',
    authSource: 'provider',
    timeoutMs: 30000
});
const DEFAULT_BUILTIN_CLAUDE_PROXY_SETTINGS = Object.freeze({
    enabled: false,
    host: '127.0.0.1',
    port: 8328,
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

function resolveWebPort() {
    const raw = process.env.CODEXMATE_PORT;
    if (!raw) return DEFAULT_WEB_PORT;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WEB_PORT;
    return parsed;
}

// #region releaseRunPortIfNeeded
function releaseRunPortIfNeeded(port, host, deps = {}) {
    const numericPort = parseInt(String(port), 10);
    if (numericPort !== DEFAULT_WEB_PORT) {
        return { attempted: false, released: false, pids: [], reason: 'non-default-port' };
    }

    const processRef = deps.process || process;
    const runSpawnSync = deps.spawnSync || spawnSync;
    const logger = deps.logger || console;
    const killProcess = typeof deps.kill === 'function'
        ? deps.kill
        : (typeof processRef.kill === 'function' ? processRef.kill.bind(processRef) : null);
    const seenPids = new Set();
    const candidatePids = new Set();
    const currentPid = Number(processRef.pid);
    const normalizedHost = typeof host === 'string' ? host.trim().toLowerCase() : '';
    let released = false;
    const windowsCommandLineCache = new Map();

    const isManagedRunCommand = (commandLine) => {
        const normalizedLine = ` ${String(commandLine || '').replace(/\s+/g, ' ').trim()} `;
        return /(^|[\/\\\s])codexmate(?:\.cmd|\.exe)? run(\s|$)/i.test(normalizedLine)
            || /(^|[\/\\\s])cli\.js run(\s|$)/i.test(normalizedLine);
    };

    const normalizeListenerHost = (value) => {
        const trimmed = String(value || '').trim().toLowerCase();
        if (!trimmed) {
            return '';
        }
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            return trimmed.slice(1, -1);
        }
        return trimmed.startsWith('::ffff:') ? trimmed.slice('::ffff:'.length) : trimmed;
    };

    const extractListenerHost = (localAddress) => {
        const trimmed = String(localAddress || '').trim();
        if (!trimmed) {
            return '';
        }
        if (trimmed.startsWith('[')) {
            const closingBracket = trimmed.indexOf(']');
            if (closingBracket > 0) {
                return normalizeListenerHost(trimmed.slice(1, closingBracket));
            }
        }
        const lastColon = trimmed.lastIndexOf(':');
        if (lastColon <= 0) {
            return normalizeListenerHost(trimmed);
        }
        return normalizeListenerHost(trimmed.slice(0, lastColon));
    };

    const isMatchingWindowsListenerAddress = (localAddress) => {
        const listenerHost = extractListenerHost(localAddress);
        if (!listenerHost || !normalizedHost) {
            return false;
        }
        if (normalizedHost === 'localhost') {
            return listenerHost === '127.0.0.1' || listenerHost === '::1';
        }
        if (normalizedHost === '0.0.0.0' || normalizedHost === '::') {
            return listenerHost === normalizedHost;
        }
        return listenerHost === normalizeListenerHost(normalizedHost);
    };

    const addPidsFromText = (text, targetSet = seenPids) => {
        if (!targetSet) {
            return;
        }
        const lines = String(text || '').split(/\r?\n/);
        for (const line of lines) {
            const tokens = line.trim().split(/\s+/).filter(Boolean);
            for (const token of tokens) {
                if (!/^\d+$/.test(token)) {
                    continue;
                }
                targetSet.add(Number(token));
            }
        }
    };

    const runCommand = (command, args, options = {}) => {
        const {
            stdoutPidSet = seenPids,
            stderrPidSet = seenPids
        } = options;
        const result = runSpawnSync(command, args, { encoding: 'utf8' });
        if (result && result.stdout) addPidsFromText(result.stdout, stdoutPidSet);
        if (result && result.stderr) addPidsFromText(result.stderr, stderrPidSet);
        return result || {};
    };

    const addManagedRunPidsFromPs = (text, allowedPids = null) => {
        const lines = String(text || '').split(/\r?\n/);
        for (const line of lines) {
            const normalizedLine = ` ${line.replace(/\s+/g, ' ').trim()} `;
            if (!/(^|[\/\s])codexmate run(\s|$)/.test(normalizedLine) && !/(^|[\/\s])cli\.js run(\s|$)/.test(normalizedLine)) {
                continue;
            }
            const pidMatch = line.match(/^\S+\s+(\d+)\s+/);
            if (!pidMatch) {
                continue;
            }
            const pid = Number(pidMatch[1]);
            if (!Number.isFinite(pid) || pid <= 0 || pid === currentPid) {
                continue;
            }
            if (allowedPids && !allowedPids.has(pid)) {
                continue;
            }
            seenPids.add(pid);
        }
    };

    const getWindowsProcessCommandLine = (pid) => {
        if (windowsCommandLineCache.has(pid)) {
            return windowsCommandLineCache.get(pid);
        }
        const result = runCommand(
            'powershell',
            [
                '-NoProfile',
                '-Command',
                `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($p) { $p.CommandLine }`
            ],
            { stdoutPidSet: null, stderrPidSet: null }
        );
        const commandLine = !result.error && result.status === 0
            ? String(result.stdout || '').trim()
            : '';
        windowsCommandLineCache.set(pid, commandLine);
        return commandLine;
    };

    if (processRef.platform === 'win32') {
        const netstatResult = runCommand('netstat', ['-ano', '-p', 'tcp'], { stdoutPidSet: null, stderrPidSet: null });
        if (!(netstatResult && netstatResult.error)) {
            const lines = String(netstatResult.stdout || '').split(/\r?\n/);
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 5) {
                    continue;
                }
                const localAddress = parts[1];
                const state = parts[3];
                const pidText = parts[4];
                if (state !== 'LISTENING' || !localAddress.endsWith(`:${numericPort}`) || !/^\d+$/.test(pidText)) {
                    continue;
                }
                if (!isMatchingWindowsListenerAddress(localAddress)) {
                    continue;
                }
                candidatePids.add(Number(pidText));
            }
            for (const pid of candidatePids) {
                if (pid === currentPid) {
                    continue;
                }
                if (!isManagedRunCommand(getWindowsProcessCommandLine(pid))) {
                    continue;
                }
                seenPids.add(pid);
                const taskkillResult = runCommand(
                    'taskkill',
                    ['/PID', String(pid), '/F'],
                    { stdoutPidSet: null, stderrPidSet: null }
                );
                if (!taskkillResult.error && taskkillResult.status === 0) {
                    released = true;
                }
            }
        }
    } else {
        let psResult = null;
        const readPsResult = () => {
            if (psResult) {
                return psResult;
            }
            psResult = runCommand('ps', ['-ef'], { stdoutPidSet: null, stderrPidSet: null });
            return psResult;
        };

        const lsofResult = runCommand(
            'lsof',
            ['-ti', `tcp:${numericPort}`],
            { stdoutPidSet: candidatePids, stderrPidSet: null }
        );
        const shouldTryFuser = !!(lsofResult && lsofResult.error && lsofResult.error.code === 'ENOENT');
        if (shouldTryFuser && candidatePids.size === 0) {
            runCommand(
                'fuser',
                [`${numericPort}/tcp`],
                { stdoutPidSet: candidatePids, stderrPidSet: candidatePids }
            );
        }
        if (candidatePids.size > 0) {
            const managedPsResult = readPsResult();
            if (!(managedPsResult && managedPsResult.error)) {
                addManagedRunPidsFromPs(managedPsResult.stdout, candidatePids);
            }
        }
    }

    if (processRef.platform !== 'win32' && killProcess && !released && seenPids.size > 0) {
        for (const pid of seenPids) {
            if (pid === currentPid) {
                continue;
            }
            try {
                killProcess(pid, 'SIGKILL');
                released = true;
            } catch (_) {}
        }
    }

    if (released) {
        logger.log(`~ 已释放端口 ${numericPort} 占用`);
    }

    return {
        attempted: true,
        released,
        pids: Array.from(seenPids)
            .filter((pid) => pid !== currentPid)
            .sort((a, b) => a - b)
    };
}
// #endregion releaseRunPortIfNeeded

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
model_context_window = ${DEFAULT_MODEL_CONTEXT_WINDOW}
model_auto_compact_token_limit = ${DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT}
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

let g_sessionListCache = new Map();
let g_sessionInventoryCache = new Map();
let g_sessionFileLookupCache = {
    codex: new Map(),
    claude: new Map()
};
let g_exactMessageCountCache = new Map();
let g_modelsCache = new Map();
let g_modelsInFlight = new Map();

function isBuiltinProxyProvider(providerName) {
    return typeof providerName === 'string' && providerName.trim().toLowerCase() === BUILTIN_PROXY_PROVIDER_NAME.toLowerCase();
}

function isReservedProviderNameForCreation(providerName) {
    return false;
}

function isBuiltinManagedProvider(providerName) {
    return isBuiltinProxyProvider(providerName);
}

function isNonDeletableProvider(providerName) {
    return isBuiltinManagedProvider(providerName);
}

function isNonEditableProvider(providerName) {
    return isBuiltinManagedProvider(providerName);
}

// ============================================================================
// 工具函数
// ============================================================================
function ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

function createConfigLoadError(type, message, detail) {
    const err = new Error(detail || message);
    err.configErrorType = type || 'read';
    err.configPublicReason = message || '读取 config.toml 失败';
    err.configDetail = detail || message || '';
    return err;
}

function readConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        throw createConfigLoadError(
            'missing',
            '未检测到 config.toml',
            `配置文件不存在: ${CONFIG_FILE}`
        );
    }

    let content = '';
    try {
        content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    } catch (e) {
        throw createConfigLoadError(
            'read',
            '读取 config.toml 失败',
            `读取配置文件失败: ${e && e.message ? e.message : e}`
        );
    }

    let parsed;
    try {
        parsed = toml.parse(content);
    } catch (e) {
        throw createConfigLoadError(
            'parse',
            'config.toml 解析失败',
            `配置文件解析失败: ${e && e.message ? e.message : e}`
        );
    }

    if (isPlainObject(parsed) && isPlainObject(parsed.model_providers)) {
        const providerHeaderSegmentKeySet = collectModelProviderHeaderSegmentKeySet(content);
        parsed.model_providers = normalizeLegacyModelProviders(parsed.model_providers, providerHeaderSegmentKeySet);
    }
    return parsed;
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
const RECOVERABLE_PROVIDER_SIGNAL_KEYS = [...PROVIDER_CONFIG_KEYS].filter((key) => key !== 'name' && key !== 'base_url');

function looksLikeProviderConfig(value) {
    if (!isPlainObject(value)) return false;
    return Object.keys(value).some((key) => PROVIDER_CONFIG_KEYS.has(key));
}

function isRecoverableNestedProviderConfig(value) {
    if (!isPlainObject(value)) return false;
    const hasBaseUrl = typeof value.base_url === 'string' && value.base_url.trim() !== '';
    if (!hasBaseUrl) return false;
    const hasName = typeof value.name === 'string' && value.name.trim() !== '';
    const hasProviderSignals = RECOVERABLE_PROVIDER_SIGNAL_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key));
    return hasName || hasProviderSignals;
}

function collectNestedProviderConfigs(node, pathSegments, collector) {
    if (!isPlainObject(node)) return;
    const segments = Array.isArray(pathSegments) ? pathSegments : [String(pathSegments || '')];
    const lastSegment = segments.length > 0 ? segments[segments.length - 1] : '';
    if (segments.length > 1 && lastSegment === 'metadata') {
        return;
    }
    if (isRecoverableNestedProviderConfig(node)) {
        collector.push({
            name: segments.join('.'),
            segments: segments.slice(),
            provider: node
        });
    }
    for (const [childKey, childValue] of Object.entries(node)) {
        if (!isPlainObject(childValue)) continue;
        collectNestedProviderConfigs(childValue, [...segments, childKey], collector);
    }
}

function normalizeLegacySegments(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return null;
    return segments.map((item) => String(item));
}

function buildLegacySegmentsKey(segments) {
    const normalized = normalizeLegacySegments(segments);
    return normalized ? JSON.stringify(normalized) : '';
}

function appendLegacySegmentsVariant(provider, segments) {
    if (!isPlainObject(provider)) return;
    const normalized = normalizeLegacySegments(segments);
    if (!normalized) return;

    const variants = [];
    const seen = new Set();
    const pushVariant = (candidate) => {
        const key = buildLegacySegmentsKey(candidate);
        if (!key || seen.has(key)) return;
        seen.add(key);
        variants.push(normalizeLegacySegments(candidate));
    };

    if (Array.isArray(provider.__codexmate_legacy_segments)) {
        pushVariant(provider.__codexmate_legacy_segments);
    }
    if (Array.isArray(provider.__codexmate_legacy_segment_variants)) {
        for (const candidate of provider.__codexmate_legacy_segment_variants) {
            pushVariant(candidate);
        }
    }
    pushVariant(normalized);

    try {
        if (!Array.isArray(provider.__codexmate_legacy_segments)) {
            Object.defineProperty(provider, '__codexmate_legacy_segments', {
                value: normalized,
                enumerable: false,
                configurable: true,
                writable: true
            });
        }
        Object.defineProperty(provider, '__codexmate_legacy_segment_variants', {
            value: variants,
            enumerable: false,
            configurable: true,
            writable: true
        });
    } catch (e) {}
}

function setLegacySegmentsMetadata(provider, segments) {
    appendLegacySegmentsVariant(provider, segments);
}

function normalizeLegacyModelProviders(modelProviders, providerHeaderSegmentKeySet = null) {
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
        const segmentKey = buildLegacySegmentsKey(segments);
        if (providerHeaderSegmentKeySet instanceof Set && segmentKey && !providerHeaderSegmentKeySet.has(segmentKey)) {
            return;
        }
        const existing = Object.prototype.hasOwnProperty.call(normalized, name)
            ? normalized[name]
            : (Object.prototype.hasOwnProperty.call(modelProviders, name) ? modelProviders[name] : null);
        if (isPlainObject(existing)) {
            if (!Array.isArray(existing.__codexmate_legacy_segments)) {
                setLegacySegmentsMetadata(existing, [name]);
            }
            appendLegacySegmentsVariant(existing, segments);
            return;
        }
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
        delete normalized[name];
        changed = true;
        for (const recoveredEntry of recovered) {
            addRecovered(recoveredEntry);
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

function collectTomlMultilineStringRanges(text) {
    const source = typeof text === 'string' ? text : '';
    const ranges = [];
    let i = 0;
    let inMultilineBasic = false;
    let inMultilineLiteral = false;
    let rangeStart = -1;

    while (i < source.length) {
        if (inMultilineBasic) {
            if (source.slice(i, i + 3) === '"""') {
                let slashCount = 0;
                for (let j = i - 1; j >= 0 && source[j] === '\\'; j--) {
                    slashCount++;
                }
                if (slashCount % 2 === 0) {
                    let runEnd = i + 3;
                    while (runEnd < source.length && source[runEnd] === '"') runEnd++;
                    ranges.push({ start: rangeStart, end: runEnd });
                    inMultilineBasic = false;
                    rangeStart = -1;
                    i = runEnd;
                    continue;
                }
            }
            i++;
            continue;
        }

        if (inMultilineLiteral) {
            if (source.slice(i, i + 3) === "'''") {
                let runEnd = i + 3;
                while (runEnd < source.length && source[runEnd] === '\'') runEnd++;
                ranges.push({ start: rangeStart, end: runEnd });
                inMultilineLiteral = false;
                rangeStart = -1;
                i = runEnd;
                continue;
            }
            i++;
            continue;
        }

        const ch = source[i];
        if (ch === '#') {
            while (i < source.length && source[i] !== '\n') i++;
            continue;
        }

        if (source.slice(i, i + 3) === '"""') {
            inMultilineBasic = true;
            rangeStart = i;
            i += 3;
            continue;
        }

        if (source.slice(i, i + 3) === "'''") {
            inMultilineLiteral = true;
            rangeStart = i;
            i += 3;
            continue;
        }

        if (ch === '"') {
            i++;
            while (i < source.length) {
                if (source[i] === '\\') {
                    i += 2;
                    continue;
                }
                if (source[i] === '"' || source[i] === '\n') {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }

        if (ch === '\'') {
            i++;
            while (i < source.length) {
                if (source[i] === '\'' || source[i] === '\n') {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }

        i++;
    }

    if (rangeStart >= 0) {
        ranges.push({ start: rangeStart, end: source.length });
    }
    return ranges;
}

function isIndexInRanges(index, ranges) {
    for (const range of ranges) {
        if (index < range.start) return false;
        if (index >= range.start && index < range.end) return true;
    }
    return false;
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
    const multilineStringRanges = collectTomlMultilineStringRanges(text);
    const sectionLineRegex = /^[ \t]*\[(?!\[)([^\]\n]+)\][ \t]*(?:#.*)?$/gm;
    let match;
    while ((match = sectionLineRegex.exec(text)) !== null) {
        const start = match.index;
        if (isIndexInRanges(start, multilineStringRanges)) {
            continue;
        }
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
    const exactMatches = ranges.filter((range) => range.priority === -3);
    return exactMatches.length > 0 ? exactMatches : ranges;
}

function doesSegmentsStartWith(segments, prefix) {
    if (!Array.isArray(segments) || !Array.isArray(prefix) || prefix.length === 0 || segments.length < prefix.length) {
        return false;
    }
    for (let i = 0; i < prefix.length; i++) {
        if (String(segments[i]) !== String(prefix[i])) return false;
    }
    return true;
}

function findProviderDescendantSectionRanges(content, prefixSegments) {
    const text = typeof content === 'string' ? content : '';
    const prefix = Array.isArray(prefixSegments) ? prefixSegments.map((item) => String(item)) : [];
    if (!text || prefix.length === 0) return [];

    const allHeaders = [];
    const parsedProviderSegmentsByStart = new Map();
    const multilineStringRanges = collectTomlMultilineStringRanges(text);
    const sectionLineRegex = /^[ \t]*\[(?!\[)([^\]\n]+)\][ \t]*(?:#.*)?$/gm;
    let match;
    while ((match = sectionLineRegex.exec(text)) !== null) {
        const start = match.index;
        if (isIndexInRanges(start, multilineStringRanges)) {
            continue;
        }
        allHeaders.push(start);
        const headerExpr = String(match[1] || '').trim();
        const parsedSegments = parseTomlDottedKeyExpression(headerExpr);
        if (!Array.isArray(parsedSegments) || parsedSegments.length < 2 || parsedSegments[0] !== 'model_providers') {
            continue;
        }
        parsedProviderSegmentsByStart.set(start, parsedSegments.slice(1));
    }

    const ranges = [];
    for (let i = 0; i < allHeaders.length; i++) {
        const start = allHeaders[i];
        const providerSegments = parsedProviderSegmentsByStart.get(start);
        if (!providerSegments) continue;
        if (!doesSegmentsStartWith(providerSegments, prefix)) continue;
        if (providerSegments.length <= prefix.length) continue;
        const end = i + 1 < allHeaders.length ? allHeaders[i + 1] : text.length;
        ranges.push({ start, end, priority: 0 });
    }
    return ranges;
}

function collectModelProviderHeaderSegmentKeySet(content) {
    const text = typeof content === 'string' ? content : '';
    const keys = new Set();
    if (!text) return keys;

    const multilineStringRanges = collectTomlMultilineStringRanges(text);
    const sectionLineRegex = /^[ \t]*\[(?!\[)([^\]\n]+)\][ \t]*(?:#.*)?$/gm;
    let match;
    while ((match = sectionLineRegex.exec(text)) !== null) {
        const start = match.index;
        if (isIndexInRanges(start, multilineStringRanges)) {
            continue;
        }
        const headerExpr = String(match[1] || '').trim();
        const parsedSegments = parseTomlDottedKeyExpression(headerExpr);
        if (!Array.isArray(parsedSegments) || parsedSegments.length < 2 || parsedSegments[0] !== 'model_providers') {
            continue;
        }
        const key = buildLegacySegmentsKey(parsedSegments.slice(1));
        if (key) keys.add(key);
    }
    return keys;
}

const {
    listAuthProfilesInfo,
    importAuthProfileFromFile,
    importAuthProfileFromUpload,
    switchAuthProfile,
    deleteAuthProfile,
    resolveAuthTokenFromCurrentProfile
} = createAuthProfileController({
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
});

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
        const supplementalModels = getSupplementalModelsForBaseUrl(baseUrl);
        const mergedModels = mergeModelCatalog(result && Array.isArray(result.models) ? result.models : [], supplementalModels);
        const finalResult = mergedModels.length > 0
            ? {
                models: mergedModels,
                unlimited: false,
                source: (result && result.error) ? 'catalog' : (result && result.source ? result.source : 'catalog')
            }
            : result;
        writeModelsCacheEntry(cacheKey, finalResult);
        return finalResult;
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

// buildAgentsDiff keeps the metaOnly optimization inside cli/agents-files.js.
const {
    resolveAgentsFilePath,
    validateAgentsBaseDir,
    readAgentsFile,
    applyAgentsFile,
    normalizeDiffText,
    buildAgentsDiff
} = createAgentsFileController({
    fs,
    path,
    os,
    stripUtf8Bom,
    detectLineEnding,
    normalizeLineEnding,
    ensureUtf8Bom,
    buildLineDiff,
    CONFIG_DIR,
    AGENTS_FILE_NAME,
    readOpenclawAgentsFile() {
        return readOpenclawAgentsFile(...arguments);
    },
    readOpenclawWorkspaceFile() {
        return readOpenclawWorkspaceFile(...arguments);
    }
});

const {
    readOpenclawConfigFile,
    applyOpenclawConfig,
    readOpenclawAgentsFile,
    applyOpenclawAgentsFile,
    readOpenclawWorkspaceFile,
    applyOpenclawWorkspaceFile
} = createOpenclawConfigController({
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
});

const {
    normalizeRecentConfigs,
    readRecentConfigs,
    writeRecentConfigs,
    recordRecentConfig,
    sanitizeRemovedBuiltinProxyProvider,
    readConfigOrVirtualDefault,
    printConfigLoadErrorAndMarkExit,
    ensureManagedConfigBootstrap,
    resetConfigToDefault,
    consumeInitNotice
} = createConfigBootstrapController({
    fs,
    path,
    readJsonFile,
    readJsonArrayFile,
    writeJsonAtomic,
    formatTimestampForFileName,
    isPlainObject,
    ensureConfigDir,
    readConfig,
    removePersistedBuiltinProxyProviderFromConfig() {
        return removePersistedBuiltinProxyProviderFromConfig();
    },
    writeConfig,
    readModels,
    writeModels,
    readCurrentModels,
    writeCurrentModels,
    updateAuthJson,
    CONFIG_DIR,
    CONFIG_FILE,
    AUTH_FILE,
    MODELS_FILE,
    RECENT_CONFIGS_FILE,
    INIT_MARK_FILE,
    MAX_RECENT_CONFIGS,
    DEFAULT_MODELS,
    DEFAULT_MODEL_CONTEXT_WINDOW,
    DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT,
    CODEXMATE_MANAGED_MARKER,
    BUILTIN_PROXY_PROVIDER_NAME,
    EMPTY_CONFIG_FALLBACK_TEMPLATE
});

const {
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

const {
    cmdZip,
    cmdUnzip,
    cmdUnzipExt,
    splitExtractSuffixInput,
    parseZipCommandArgs,
    parseUnzipExtCommandArgs
} = createZipCommandController({
    fs,
    path,
    execSync,
    process,
    yauzl,
    formatTimestampForFileName,
    inspectZipArchiveLimits,
    resolveZipTool,
    resolveUnzipTool,
    zipWithLibrary,
    unzipWithLibrary,
    DEFAULT_EXTRACT_SUFFIXES,
    MAX_SKILLS_ZIP_ENTRY_COUNT,
    MAX_SKILLS_ZIP_UNCOMPRESSED_BYTES,
    ensureDir
});

async function buildConfigHealthReport(params = {}) {
    return buildConfigHealthReportCore(params, {
        readConfigOrVirtualDefault,
        readModels
    });
}

function hasConfigLoadError(result) {
    return !!(result
        && result.isVirtual
        && (result.errorType === 'parse' || result.errorType === 'read'));
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

function normalizePositiveIntegerParam(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const text = typeof value === 'number'
        ? String(value)
        : (typeof value === 'string' ? value.trim() : String(value).trim());
    if (!text) {
        return null;
    }
    if (!/^\d+$/.test(text)) {
        return null;
    }
    const parsed = Number.parseInt(text, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        return null;
    }
    return parsed;
}

function applyPositiveIntegerConfigToTemplate(template, key, value) {
    let content = typeof template === 'string' ? template : '';
    const normalized = normalizePositiveIntegerParam(value);
    if (!key || normalized === null) {
        return content;
    }

    const hasBom = content.charCodeAt(0) === 0xFEFF;
    const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
    if (hasBom) {
        content = content.slice(1);
    }
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^\\s*${escapedKey}\\s*=\\s*[^\\n]*\\n?`, 'gmi');
    content = content.replace(pattern, '');
    content = content.replace(new RegExp(`^(?:[\\t ]*${lineEnding})+`), '');
    return `${hasBom ? '\uFEFF' : ''}${key} = ${normalized}${lineEnding}${content}`;
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
    if (
        params.modelAutoCompactTokenLimit !== undefined
        && params.modelAutoCompactTokenLimit !== null
        && normalizePositiveIntegerParam(params.modelAutoCompactTokenLimit) === null
    ) {
        return { error: 'modelAutoCompactTokenLimit must be a positive integer' };
    }
    if (
        params.modelContextWindow !== undefined
        && params.modelContextWindow !== null
        && normalizePositiveIntegerParam(params.modelContextWindow) === null
    ) {
        return { error: 'modelContextWindow must be a positive integer' };
    }
    const selectedProvider = typeof params.provider === 'string' ? params.provider.trim() : '';
    const selectedModel = typeof params.model === 'string' ? params.model.trim() : '';
    let template = normalizeTopLevelConfigWithTemplate(content, selectedProvider, selectedModel);
    if (typeof params.serviceTier === 'string') {
        template = applyServiceTierToTemplate(template, params.serviceTier);
    }
    if (typeof params.reasoningEffort === 'string') {
        template = applyReasoningEffortToTemplate(template, params.reasoningEffort);
    }
    if (!/^\s*model_auto_compact_token_limit\s*=.*$/m.test(template)) {
        template = applyPositiveIntegerConfigToTemplate(
            template,
            'model_auto_compact_token_limit',
            DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT
        );
    }
    if (!/^\s*model_context_window\s*=.*$/m.test(template)) {
        template = applyPositiveIntegerConfigToTemplate(
            template,
            'model_context_window',
            DEFAULT_MODEL_CONTEXT_WINDOW
        );
    }
    if (params.modelAutoCompactTokenLimit !== undefined) {
        template = applyPositiveIntegerConfigToTemplate(
            template,
            'model_auto_compact_token_limit',
            params.modelAutoCompactTokenLimit
        );
    }
    if (params.modelContextWindow !== undefined) {
        template = applyPositiveIntegerConfigToTemplate(
            template,
            'model_context_window',
            params.modelContextWindow
        );
    }
    return {
        template
    };
}

function readPositiveIntegerConfigValue(config, key) {
    const options = arguments[2] && typeof arguments[2] === 'object' ? arguments[2] : {};
    const useDefaultsWhenMissing = options.useDefaultsWhenMissing !== false;
    if (!config || typeof config !== 'object' || !key) {
        return '';
    }
    const raw = config[key];
    if (raw === undefined && useDefaultsWhenMissing) {
        if (key === 'model_context_window') return DEFAULT_MODEL_CONTEXT_WINDOW;
        if (key === 'model_auto_compact_token_limit') return DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT;
    }
    const normalized = normalizePositiveIntegerParam(raw);
    return normalized === null ? '' : normalized;
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

    if (
        Object.prototype.hasOwnProperty.call(parsed, 'model_context_window')
        && normalizePositiveIntegerParam(parsed.model_context_window) === null
    ) {
        return { error: '模板中的 model_context_window 必须是正整数' };
    }

    if (
        Object.prototype.hasOwnProperty.call(parsed, 'model_auto_compact_token_limit')
        && normalizePositiveIntegerParam(parsed.model_auto_compact_token_limit) === null
    ) {
        return { error: '模板中的 model_auto_compact_token_limit 必须是正整数' };
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
    const normalizedUrl = normalizeBaseUrl(url);

    if (!name) return { error: '名称不能为空' };
    if (!url) return { error: 'URL 不能为空' };
    if (!isValidProviderName(name)) {
        return { error: '名称仅支持字母/数字/._-' };
    }
    if (!isValidHttpUrl(normalizedUrl)) {
        return { error: 'URL 仅支持 http/https' };
    }
    if (isReservedProviderNameForCreation(name)) {
        return { error: '提供商名称不可用' };
    }
    if (isBuiltinProxyProvider(name) && !allowManaged) {
        return { error: 'codexmate-proxy 为保留名称，不可手动添加' };
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

    const providerHeaderSegmentKeySet = collectModelProviderHeaderSegmentKeySet(content);
    const normalizedProviders = isPlainObject(parsed.model_providers)
        ? normalizeLegacyModelProviders(parsed.model_providers, providerHeaderSegmentKeySet)
        : {};
    if (normalizedProviders && normalizedProviders[name]) {
        return { error: '提供商已存在' };
    }

    const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
    const safeName = escapeTomlBasicString(name);
    const safeUrl = escapeTomlBasicString(normalizedUrl);
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
    if (url && !isValidHttpUrl(normalizeBaseUrl(url))) {
        return { error: 'URL 仅支持 http/https' };
    }
    if (isNonEditableProvider(name) && !allowManaged) {
        return { error: 'codexmate-proxy 为保留名称，不可编辑' };
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
        return { error: 'codexmate-proxy 为保留名称，不可删除' };
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
        const msg = 'codexmate-proxy 为保留名称，不可删除';
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
    const providerSegmentVariants = (() => {
        const variants = [];
        const seen = new Set();
        const pushVariant = (segments) => {
            const normalized = normalizeLegacySegments(segments);
            const key = buildLegacySegmentsKey(normalized);
            if (!key || seen.has(key)) return;
            seen.add(key);
            variants.push(normalized);
        };
        if (providerConfig && Array.isArray(providerConfig.__codexmate_legacy_segments)) {
            pushVariant(providerConfig.__codexmate_legacy_segments);
        }
        if (providerConfig && Array.isArray(providerConfig.__codexmate_legacy_segment_variants)) {
            for (const segments of providerConfig.__codexmate_legacy_segment_variants) {
                pushVariant(segments);
            }
        }
        if (providerSegments) {
            pushVariant(providerSegments);
        }
        if (variants.length === 0) {
            pushVariant(String(name || '').split('.').filter((item) => item));
        }
        return variants;
    })();

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
    const combinedRanges = [];
    for (const segments of providerSegmentVariants) {
        combinedRanges.push(...findProviderSectionRanges(content, name, segments));
        combinedRanges.push(...findProviderDescendantSectionRanges(content, segments));
    }
    if (combinedRanges.length === 0) {
        combinedRanges.push(...findProviderSectionRanges(content, name, providerSegments));
    }
    if (combinedRanges.length > 0) {
        const sorted = combinedRanges.sort((a, b) => b.start - a.start || b.end - a.end);
        const seen = new Set();
        let removedContent = content;
        for (const range of sorted) {
            const rangeKey = `${range.start}:${range.end}`;
            if (seen.has(rangeKey)) continue;
            seen.add(rangeKey);
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

function getFileTailText(filePath, maxBytes = SESSION_USAGE_TAIL_READ_BYTES) {
    let fd;
    try {
        fd = fs.openSync(filePath, 'r');
        const stat = fs.fstatSync(fd);
        const size = Math.min(maxBytes, stat.size);
        if (size <= 0) {
            return '';
        }

        const start = Math.max(0, stat.size - size);
        const buffer = Buffer.alloc(size);
        fs.readSync(fd, buffer, 0, size, start);
        let text = buffer.toString('utf-8');
        if (start > 0) {
            const newlineIndex = text.indexOf('\n');
            text = newlineIndex >= 0 ? text.slice(newlineIndex + 1) : '';
        }
        return text;
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

function parseJsonlTailRecords(filePath, maxBytes = SESSION_USAGE_TAIL_READ_BYTES) {
    const tailText = getFileTailText(filePath, maxBytes);
    if (!tailText) {
        return [];
    }

    return parseJsonlContent(tailText);
}

function buildClaudeStoredIndexMessageCount(messageCount) {
    const safeCount = Number.isFinite(Number(messageCount))
        ? Math.max(0, Math.floor(Number(messageCount)))
        : 0;
    return safeCount + 1;
}

function getFileStatSafe(filePath) {
    try {
        return fs.statSync(filePath);
    } catch (e) {
        return null;
    }
}

function getFileMtimeMs(filePath, stat = null) {
    const fileStat = stat || getFileStatSafe(filePath);
    if (!fileStat || !Number.isFinite(Number(fileStat.mtimeMs))) {
        return 0;
    }
    return Math.max(0, Math.floor(Number(fileStat.mtimeMs)));
}

function isSessionSummaryMessageCountExact(stat, maxBytes = SESSION_SUMMARY_READ_BYTES) {
    if (!stat || !Number.isFinite(Number(stat.size))) {
        return false;
    }
    return Number(stat.size) <= maxBytes;
}

function buildExactMessageCountCacheKey(filePath, source, stat = null) {
    const validSource = source === 'claude' ? 'claude' : (source === 'codex' ? 'codex' : '');
    if (!validSource || !filePath) {
        return '';
    }
    const mtimeMs = getFileMtimeMs(filePath, stat);
    if (!mtimeMs) {
        return '';
    }
    return `${validSource}:${path.resolve(filePath)}:${mtimeMs}`;
}

function readExactMessageCountCache(filePath, source, stat = null) {
    const cacheKey = buildExactMessageCountCacheKey(filePath, source, stat);
    if (!cacheKey) {
        return null;
    }
    if (!g_exactMessageCountCache.has(cacheKey)) {
        return null;
    }
    const cached = g_exactMessageCountCache.get(cacheKey);
    g_exactMessageCountCache.delete(cacheKey);
    g_exactMessageCountCache.set(cacheKey, cached);
    return Number.isFinite(Number(cached)) ? Math.max(0, Math.floor(Number(cached))) : null;
}

function writeExactMessageCountCache(filePath, source, messageCount, stat = null) {
    const cacheKey = buildExactMessageCountCacheKey(filePath, source, stat);
    const safeCount = Number.isFinite(Number(messageCount))
        ? Math.max(0, Math.floor(Number(messageCount)))
        : null;
    if (!cacheKey || safeCount === null) {
        return;
    }
    if (g_exactMessageCountCache.has(cacheKey)) {
        g_exactMessageCountCache.delete(cacheKey);
    }
    g_exactMessageCountCache.set(cacheKey, safeCount);
    if (g_exactMessageCountCache.size <= EXACT_MESSAGE_COUNT_CACHE_MAX_ENTRIES) {
        return;
    }
    const firstKey = g_exactMessageCountCache.keys().next().value;
    if (firstKey) {
        g_exactMessageCountCache.delete(firstKey);
    }
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
        return [];
    }
    const safeConcurrency = Math.max(1, Math.min(Math.floor(Number(concurrency)) || 1, list.length));
    const results = new Array(list.length);
    let nextIndex = 0;
    const workers = Array.from({ length: safeConcurrency }, async () => {
        while (nextIndex < list.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await mapper(list[currentIndex], currentIndex);
        }
    });
    await Promise.all(workers);
    return results.filter((item) => item !== undefined);
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

async function countConversationMessagesInFile(filePath, source) {
    const fileStat = getFileStatSafe(filePath);
    const cached = readExactMessageCountCache(filePath, source, fileStat);
    if (cached !== null) {
        return cached;
    }

    let stream;
    let rl;
    let messageCount = 0;
    let leadingSystem = true;

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

            let role = '';
            let text = '';
            if (source === 'codex') {
                if (record.type === 'response_item' && record.payload && record.payload.type === 'message') {
                    role = normalizeRole(record.payload.role);
                    text = extractMessageText(record.payload.content);
                }
            } else {
                role = normalizeRole(record.type);
                if (role === 'assistant' || role === 'user' || role === 'system') {
                    const content = record.message ? record.message.content : '';
                    text = extractMessageText(content);
                } else {
                    role = '';
                }
            }
            if (!role) {
                continue;
            }

            const hasText = text.length > 0;
            if (leadingSystem && (role === 'system' || (hasText && isBootstrapLikeText(text)))) {
                continue;
            }

            leadingSystem = false;
            messageCount += 1;
        }
        const safeCount = Math.max(0, messageCount);
        writeExactMessageCountCache(filePath, source, safeCount, fileStat);
        return safeCount;
    } catch (e) {
        const safeCount = countConversationMessagesInRecords(readJsonlRecords(filePath), source);
        writeExactMessageCountCache(filePath, source, safeCount, fileStat);
        return safeCount;
    } finally {
        if (rl) {
            try { rl.close(); } catch (e) {}
        }
        if (stream && !stream.destroyed && stream.destroy) {
            try { stream.destroy(); } catch (e) {}
        }
    }
}

function appendSessionDetailTailMessage(state, record, source, lineIndex = -1) {
    if (!state || typeof state !== 'object') {
        return;
    }

    const message = extractMessageFromRecord(record, source);
    if (!message) {
        return;
    }

    const role = normalizeRole(message.role);
    const text = typeof message.text === 'string' ? message.text : '';
    if (!role || !text) {
        return;
    }

    if (state.leadingSystem && (role === 'system' || isBootstrapLikeText(text))) {
        return;
    }

    state.leadingSystem = false;
    state.totalMessages += 1;
    if (!Number.isFinite(state.tailLimit) || state.tailLimit <= 0) {
        return;
    }

    if (state.messages.length >= state.tailLimit) {
        state.messages.shift();
    }
    state.messages.push({
        role,
        text,
        timestamp: toIsoTime(record && record.timestamp, ''),
        recordLineIndex: Number.isInteger(lineIndex) ? lineIndex : -1
    });
}

function applySessionDetailRecordMetadata(record, source, state) {
    if (!state || typeof state !== 'object' || !record) {
        return;
    }

    if (record.timestamp) {
        state.updatedAt = toIsoTime(record.timestamp, state.updatedAt);
    }

    if (source === 'codex') {
        if (record.type === 'session_meta' && record.payload) {
            state.sessionId = record.payload.id || state.sessionId;
            state.cwd = record.payload.cwd || state.cwd;
        }
        return;
    }

    if (!state.sessionId && record.sessionId) {
        state.sessionId = record.sessionId;
    }
    if (!state.cwd && record.cwd) {
        state.cwd = record.cwd;
    }
}

function extractSessionDetailPreviewFromRecords(records, source, messageLimit) {
    const safeMessageLimit = Number.isFinite(Number(messageLimit))
        ? Math.max(1, Math.floor(Number(messageLimit)))
        : DEFAULT_SESSION_DETAIL_MESSAGES;
    const state = {
        sessionId: '',
        cwd: '',
        updatedAt: '',
        messages: [],
        tailLimit: safeMessageLimit,
        totalMessages: 0,
        leadingSystem: true
    };

    for (let lineIndex = 0; lineIndex < records.length; lineIndex++) {
        const record = records[lineIndex];
        applySessionDetailRecordMetadata(record, source, state);
        appendSessionDetailTailMessage(state, record, source, lineIndex);
    }

    return state;
}

function extractSessionDetailPreviewFromTailText(text, source, messageLimit) {
    const safeMessageLimit = Number.isFinite(Number(messageLimit))
        ? Math.max(1, Math.floor(Number(messageLimit)))
        : DEFAULT_SESSION_DETAIL_MESSAGES;
    const state = {
        sessionId: '',
        cwd: '',
        updatedAt: '',
        messages: [],
        tailLimit: safeMessageLimit,
        totalMessages: null,
        clipped: false
    };
    const lines = typeof text === 'string' && text
        ? text.split(/\r?\n/)
        : [];

    for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
        const trimmed = lines[lineIndex].trim();
        if (!trimmed) {
            continue;
        }

        let record;
        try {
            record = JSON.parse(trimmed);
        } catch (_) {
            continue;
        }

        if (record && record.timestamp && !state.updatedAt) {
            state.updatedAt = toIsoTime(record.timestamp, '');
        }
        if ((!state.sessionId || !state.cwd) && record) {
            applySessionDetailRecordMetadata(record, source, state);
        }

        const message = extractMessageFromRecord(record, source);
        if (!message) {
            continue;
        }

        const role = normalizeRole(message.role);
        const textValue = typeof message.text === 'string' ? message.text : '';
        if (!role || !textValue) {
            continue;
        }

        if (state.messages.length >= safeMessageLimit) {
            state.clipped = true;
            break;
        }

        state.messages.unshift({
            role,
            text: textValue,
            timestamp: toIsoTime(record && record.timestamp, ''),
            recordLineIndex: -1
        });
    }

    return state;
}

function extractSessionDetailPreviewFromFileFast(filePath, source, messageLimit) {
    const fileStat = getFileStatSafe(filePath);
    if (!fileStat || !Number.isFinite(fileStat.size) || fileStat.size <= FAST_SESSION_DETAIL_PREVIEW_FILE_BYTES) {
        return null;
    }
    const safeMessageLimit = Number.isFinite(Number(messageLimit))
        ? Math.max(1, Math.floor(Number(messageLimit)))
        : DEFAULT_SESSION_DETAIL_MESSAGES;

    let fd = null;
    let position = fileStat.size;
    let totalBytesRead = 0;
    let combined = Buffer.alloc(0);
    let latest = {
        sessionId: '',
        cwd: '',
        updatedAt: '',
        messages: [],
        totalMessages: null,
        clipped: false
    };

    try {
        fd = fs.openSync(filePath, 'r');
        while (position > 0 && totalBytesRead < FAST_SESSION_DETAIL_PREVIEW_MAX_BYTES) {
            const remainingBudget = FAST_SESSION_DETAIL_PREVIEW_MAX_BYTES - totalBytesRead;
            const chunkSize = Math.min(FAST_SESSION_DETAIL_PREVIEW_CHUNK_BYTES, position, remainingBudget);
            if (chunkSize <= 0) {
                break;
            }

            position -= chunkSize;
            const chunk = Buffer.allocUnsafe(chunkSize);
            const bytesRead = fs.readSync(fd, chunk, 0, chunkSize, position);
            if (bytesRead <= 0) {
                break;
            }

            totalBytesRead += bytesRead;
            combined = Buffer.concat([chunk.subarray(0, bytesRead), combined]);
            latest = extractSessionDetailPreviewFromTailText(combined.toString('utf-8'), source, safeMessageLimit);
            if (latest.messages.length >= safeMessageLimit) {
                latest.clipped = latest.clipped || position > 0;
                return latest;
            }
        }

        if (position > 0) {
            latest.clipped = latest.clipped || position > 0;
            return latest;
        }
        const normalizedMessages = removeLeadingSystemMessage(latest.messages);
        latest.messages = normalizedMessages.length > safeMessageLimit
            ? normalizedMessages.slice(-safeMessageLimit)
            : normalizedMessages;
        latest.totalMessages = normalizedMessages.length;
        latest.clipped = latest.totalMessages > latest.messages.length;
        return latest;
    } catch (_) {
        return null;
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (e) {}
        }
    }
}

async function extractSessionDetailPreviewFromFile(filePath, source, messageLimit, options = {}) {
    if (options && options.preview) {
        const fastPreview = extractSessionDetailPreviewFromFileFast(filePath, source, messageLimit);
        if (fastPreview && (!fastPreview.clipped || fastPreview.messages.length > 0)) {
            return fastPreview;
        }
    }

    const safeMessageLimit = Number.isFinite(Number(messageLimit))
        ? Math.max(1, Math.floor(Number(messageLimit)))
        : DEFAULT_SESSION_DETAIL_MESSAGES;
    const state = {
        sessionId: '',
        cwd: '',
        updatedAt: '',
        messages: [],
        tailLimit: safeMessageLimit,
        totalMessages: 0,
        leadingSystem: true
    };

    let stream;
    let rl;
    try {
        stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
        rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

        let lineIndex = 0;
        for await (const line of rl) {
            const currentLineIndex = lineIndex;
            lineIndex += 1;

            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            let record;
            try {
                record = JSON.parse(trimmed);
            } catch (e) {
                continue;
            }

            applySessionDetailRecordMetadata(record, source, state);
            appendSessionDetailTailMessage(state, record, source, currentLineIndex);
        }
        return state;
    } catch (e) {
        return extractSessionDetailPreviewFromRecords(readJsonlRecords(filePath), source, safeMessageLimit);
    } finally {
        if (rl) {
            try { rl.close(); } catch (e) {}
        }
        if (stream && !stream.destroyed && stream.destroy) {
            try { stream.destroy(); } catch (e) {}
        }
    }
}

async function resolveSessionTrashEntryExactMessageCount(entry) {
    const normalizedEntry = normalizeSessionTrashEntry(entry);
    if (!normalizedEntry) {
        return null;
    }
    const trashFilePath = resolveSessionTrashFilePath(normalizedEntry);
    if (!trashFilePath || !fs.existsSync(trashFilePath)) {
        return normalizedEntry;
    }
    const trashFileStat = getFileStatSafe(trashFilePath);
    const trashFileMtimeMs = getFileMtimeMs(trashFilePath, trashFileStat);
    if (
        Number.isFinite(Number(normalizedEntry.messageCount))
        && normalizedEntry.messageCount >= 0
        && trashFileMtimeMs > 0
        && normalizedEntry.messageCountMtimeMs === trashFileMtimeMs
    ) {
        return normalizedEntry;
    }

    const exactMessageCount = await countConversationMessagesInFile(trashFilePath, normalizedEntry.source);
    if (!Number.isFinite(Number(exactMessageCount))) {
        return normalizedEntry;
    }

    const safeMessageCount = Math.max(0, Math.floor(Number(exactMessageCount)));
    if (
        normalizedEntry.messageCount === safeMessageCount
        && normalizedEntry.messageCountMtimeMs === trashFileMtimeMs
    ) {
        return normalizedEntry;
    }

    return {
        ...normalizedEntry,
        messageCount: safeMessageCount,
        messageCountMtimeMs: trashFileMtimeMs
    };
}

async function hydrateSessionTrashEntries(entries, options = {}) {
    const source = options.source === 'claude' ? 'claude' : (options.source === 'codex' ? 'codex' : 'all');
    const hydratedEntries = await mapWithConcurrency(Array.isArray(entries) ? entries : [], 8, async (entry) => {
        const normalizedEntry = normalizeSessionTrashEntry(entry);
        if (!normalizedEntry) {
            return undefined;
        }
        return await resolveSessionTrashEntryExactMessageCount(normalizedEntry);
    });

    if (source === 'codex' || source === 'claude') {
        return hydratedEntries.filter((entry) => entry.source === source);
    }
    return hydratedEntries;
}

async function hydrateSessionItemsExactMessageCount(items) {
    return await mapWithConcurrency(Array.isArray(items) ? items : [], 8, async (item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return undefined;
        }
        if (item.__messageCountExact === true) {
            return item;
        }
        const source = item.source === 'claude' ? 'claude' : (item.source === 'codex' ? 'codex' : '');
        const filePath = typeof item.filePath === 'string' ? item.filePath : '';
        if (!source || !filePath || !fs.existsSync(filePath)) {
            return item;
        }

        const exactMessageCount = await countConversationMessagesInFile(filePath, source);
        if (!Number.isFinite(Number(exactMessageCount))) {
            return item;
        }

        const safeMessageCount = Math.max(0, Math.floor(Number(exactMessageCount)));
        if (Number(item.messageCount) === safeMessageCount) {
            return {
                ...item,
                __messageCountExact: true
            };
        }

        return {
            ...item,
            messageCount: safeMessageCount,
            __messageCountExact: true
        };
    });
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

function createSessionQueryScanState(tokens, options = {}) {
    const mode = normalizeQueryMode(options.mode);
    const roleFilter = normalizeRoleFilter(options.roleFilter);
    const maxMatches = Number.isFinite(Number(options.maxMatches))
        ? Math.max(1, Number(options.maxMatches))
        : 1;
    const snippetLimit = Number.isFinite(Number(options.snippetLimit))
        ? Math.max(0, Number(options.snippetLimit))
        : 0;

    return {
        tokens,
        mode,
        roleFilter,
        maxMatches,
        snippetLimit,
        count: 0,
        snippets: [],
        leadingSystem: roleFilter !== 'system'
    };
}

function consumeSessionQueryMessage(state, message) {
    if (!state || typeof state !== 'object' || !message) {
        return false;
    }

    const role = normalizeRole(message.role);
    const text = typeof message.text === 'string' ? message.text : '';
    if (!role || !text) {
        return false;
    }

    if (state.leadingSystem && (role === 'system' || isBootstrapLikeText(text))) {
        return false;
    }
    state.leadingSystem = false;

    if (state.roleFilter !== 'all' && role !== state.roleFilter) {
        return false;
    }
    if (!matchTokensInText(text, state.tokens, state.mode)) {
        return false;
    }

    state.count += 1;
    if (state.snippetLimit > 0 && state.snippets.length < state.snippetLimit) {
        state.snippets.push(truncateText(text));
    }
    return state.count >= state.maxMatches;
}

function buildSessionQueryScanResult(state) {
    return {
        hit: !!(state && state.count > 0),
        count: state && Number.isFinite(state.count) ? state.count : 0,
        snippets: state && Array.isArray(state.snippets) ? state.snippets : []
    };
}

function scanSessionContentForQueryInRecords(records, source, state) {
    if (!Array.isArray(records) || !state) {
        return buildSessionQueryScanResult(state);
    }

    for (const record of records) {
        const message = extractMessageFromRecord(record, source);
        if (!message) {
            continue;
        }
        if (consumeSessionQueryMessage(state, message)) {
            break;
        }
    }

    return buildSessionQueryScanResult(state);
}

async function scanSessionContentForQuery(session, tokens, options = {}) {
    if (!session || !Array.isArray(tokens) || tokens.length === 0) {
        return { hit: false, count: 0, snippets: [] };
    }

    const filePath = resolveSessionFilePath(session.source, session.filePath, session.sessionId);
    if (!filePath) {
        return { hit: false, count: 0, snippets: [] };
    }

    const rawMaxBytes = Number(options.maxBytes);
    const maxBytes = Number.isFinite(rawMaxBytes) && rawMaxBytes > 0
        ? Math.max(1024, rawMaxBytes)
        : 0;
    const state = createSessionQueryScanState(tokens, options);
    let stream;
    let rl;
    try {
        stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
        rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

        let bytesRead = 0;
        for await (const line of rl) {
            if (maxBytes > 0 && bytesRead >= maxBytes) {
                break;
            }

            bytesRead += Buffer.byteLength(line, 'utf-8') + 1;
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            let record;
            try {
                record = JSON.parse(trimmed);
            } catch (e) {
                continue;
            }

            const message = extractMessageFromRecord(record, session.source);
            if (!message) {
                continue;
            }
            if (consumeSessionQueryMessage(state, message)) {
                break;
            }
        }

        return buildSessionQueryScanResult(state);
    } catch (e) {
        return scanSessionContentForQueryInRecords(readJsonlRecords(filePath), session.source, state);
    } finally {
        if (rl) {
            try { rl.close(); } catch (e) {}
        }
        if (stream && !stream.destroyed && stream.destroy) {
            try { stream.destroy(); } catch (e) {}
        }
    }
}

async function applySessionQueryFilter(sessions, options = {}) {
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
        : 0;

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
            contentInfo = await scanSessionContentForQuery(session, tokens, {
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

function buildSessionInventoryCacheKey(source, limit, options = {}) {
    const normalizedSource = source === 'claude' ? 'claude' : 'codex';
    const normalizedLimit = Number.isFinite(Number(limit))
        ? Math.max(1, Math.floor(Number(limit)))
        : 1;
    const scanFactor = Number.isFinite(Number(options.scanFactor))
        ? Math.max(1, Number(options.scanFactor))
        : '';
    const minFiles = Number.isFinite(Number(options.minFiles))
        ? Math.max(1, Math.floor(Number(options.minFiles)))
        : '';
    const targetCount = Number.isFinite(Number(options.targetCount))
        ? Math.max(1, Math.floor(Number(options.targetCount)))
        : '';
    const scanCount = Number.isFinite(Number(options.scanCount))
        ? Math.max(1, Math.floor(Number(options.scanCount)))
        : '';
    const maxFilesScanned = Number.isFinite(Number(options.maxFilesScanned))
        ? Math.max(1, Math.floor(Number(options.maxFilesScanned)))
        : '';
    const summaryReadBytes = Number.isFinite(Number(options.summaryReadBytes))
        ? Math.max(1024, Math.floor(Number(options.summaryReadBytes)))
        : '';
    const titleReadBytes = Number.isFinite(Number(options.titleReadBytes))
        ? Math.max(1024, Math.floor(Number(options.titleReadBytes)))
        : '';
    return [
        'inventory',
        normalizedSource,
        normalizedLimit,
        scanFactor,
        minFiles,
        targetCount,
        scanCount,
        maxFilesScanned,
        summaryReadBytes,
        titleReadBytes
    ].join(':');
}

function cloneSessionInventoryCacheValue(value) {
    if (!Array.isArray(value)) {
        return null;
    }
    return value.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return item;
        }
        const cloned = { ...item };
        if (item.match && typeof item.match === 'object' && !Array.isArray(item.match)) {
            cloned.match = {
                ...item.match,
                snippets: Array.isArray(item.match.snippets)
                    ? [...item.match.snippets]
                    : []
            };
        }
        return cloned;
    });
}

function getSessionInventoryCache(cacheKey, forceRefresh = false) {
    if (forceRefresh) {
        g_sessionInventoryCache.delete(cacheKey);
        return null;
    }

    const cached = g_sessionInventoryCache.get(cacheKey);
    if (!cached) {
        return null;
    }

    if ((Date.now() - cached.timestamp) > SESSION_LIST_CACHE_TTL_MS) {
        g_sessionInventoryCache.delete(cacheKey);
        return null;
    }

    const clonedValue = cloneSessionInventoryCacheValue(cached.value);
    if (!Array.isArray(clonedValue)) {
        g_sessionInventoryCache.delete(cacheKey);
        return null;
    }

    return clonedValue;
}

function registerSessionFileLookupEntries(source, sessions = []) {
    const normalizedSource = source === 'claude' ? 'claude' : 'codex';
    const store = g_sessionFileLookupCache[normalizedSource];
    if (!(store instanceof Map) || !Array.isArray(sessions)) {
        return;
    }
    for (const session of sessions) {
        if (!session || typeof session !== 'object' || Array.isArray(session)) {
            continue;
        }
        const sessionId = typeof session.sessionId === 'string' ? session.sessionId.trim().toLowerCase() : '';
        const filePath = typeof session.filePath === 'string' ? session.filePath.trim() : '';
        if (!sessionId || !filePath) {
            continue;
        }
        store.set(sessionId, filePath);
    }
}

function setSessionInventoryCache(cacheKey, source, value) {
    const storedValue = cloneSessionInventoryCacheValue(value);
    if (!Array.isArray(storedValue)) {
        return;
    }
    g_sessionInventoryCache.set(cacheKey, {
        timestamp: Date.now(),
        source,
        value: storedValue
    });
    registerSessionFileLookupEntries(source, storedValue);

    if (g_sessionInventoryCache.size > SESSION_INVENTORY_CACHE_MAX_ENTRIES) {
        const firstKey = g_sessionInventoryCache.keys().next().value;
        if (firstKey) {
            g_sessionInventoryCache.delete(firstKey);
        }
    }
}

function listSessionInventoryBySource(source, limit, scanOptions = {}, options = {}) {
    const normalizedSource = source === 'claude' ? 'claude' : 'codex';
    const forceRefresh = !!options.forceRefresh;
    const cacheKey = buildSessionInventoryCacheKey(normalizedSource, limit, scanOptions);
    const cached = getSessionInventoryCache(cacheKey, forceRefresh);
    if (cached) {
        return cached;
    }

    const sessions = normalizedSource === 'claude'
        ? listClaudeSessions(limit, scanOptions)
        : listCodexSessions(limit, scanOptions);
    setSessionInventoryCache(cacheKey, normalizedSource, sessions);
    return sessions;
}

function invalidateSessionListCache() {
    g_sessionListCache.clear();
    g_sessionInventoryCache.clear();
    g_sessionFileLookupCache = {
        codex: new Map(),
        claude: new Map()
    };
}

function readNonNegativeInteger(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        return null;
    }
    return Math.floor(numeric);
}

function readTotalTokensFromUsage(usage) {
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
        return null;
    }
    const explicitTotal = readNonNegativeInteger(usage.total_tokens ?? usage.totalTokens);
    if (explicitTotal !== null) {
        return explicitTotal;
    }
    const inputTokens = readNonNegativeInteger(usage.input_tokens ?? usage.inputTokens);
    const outputTokens = readNonNegativeInteger(usage.output_tokens ?? usage.outputTokens);
    const reasoningOutputTokens = readNonNegativeInteger(usage.reasoning_output_tokens ?? usage.reasoningOutputTokens);
    if (inputTokens === null && outputTokens === null && reasoningOutputTokens === null) {
        return null;
    }
    return (inputTokens || 0) + (outputTokens || 0) + (reasoningOutputTokens || 0);
}

function readUsageTotalsFromUsage(usage) {
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
        return null;
    }
    const inputTokens = readNonNegativeInteger(usage.input_tokens ?? usage.inputTokens);
    const cachedInputTokens = readNonNegativeInteger(usage.cached_input_tokens ?? usage.cachedInputTokens);
    const outputTokens = readNonNegativeInteger(usage.output_tokens ?? usage.outputTokens);
    const reasoningOutputTokens = readNonNegativeInteger(usage.reasoning_output_tokens ?? usage.reasoningOutputTokens);
    const totalTokens = readNonNegativeInteger(usage.total_tokens ?? usage.totalTokens)
        ?? ((inputTokens === null && cachedInputTokens === null && outputTokens === null && reasoningOutputTokens === null)
            ? null
            : ((inputTokens || 0) + (outputTokens || 0) + (reasoningOutputTokens || 0)));
    if (inputTokens === null && cachedInputTokens === null && outputTokens === null && reasoningOutputTokens === null && totalTokens === null) {
        return null;
    }
    return {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens
    };
}

function readContextWindowValue(target) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
        return null;
    }
    return readNonNegativeInteger(
        target.model_context_window
        ?? target.modelContextWindow
        ?? target.context_window
        ?? target.contextWindow
    );
}

function applyUsageTotalsToState(state, usageTotals) {
    if (!state || typeof state !== 'object' || !usageTotals || typeof usageTotals !== 'object' || Array.isArray(usageTotals)) {
        return;
    }
    const pairs = [
        ['inputTokens', usageTotals.inputTokens],
        ['cachedInputTokens', usageTotals.cachedInputTokens],
        ['outputTokens', usageTotals.outputTokens],
        ['reasoningOutputTokens', usageTotals.reasoningOutputTokens],
        ['totalTokens', usageTotals.totalTokens]
    ];
    for (const [key, value] of pairs) {
        const normalized = readNonNegativeInteger(value);
        if (normalized === null) {
            continue;
        }
        state[key] = Math.max(readNonNegativeInteger(state[key]) || 0, normalized);
    }
}

function readSessionModelsFromRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return [];
    }
    const models = [];

    const pushModel = (candidate) => {
        if (Array.isArray(candidate)) {
            for (const item of candidate) {
                pushModel(item);
            }
            return;
        }
        if (typeof candidate !== 'string') {
            return;
        }
        const normalized = candidate.trim();
        if (!normalized || models.includes(normalized)) {
            return;
        }
        models.push(normalized);
    };

    const shouldReadModelKey = (key) => {
        const normalized = typeof key === 'string'
            ? key.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
            : '';
        if (!normalized || normalized.includes('provider')) {
            return false;
        }
        return normalized === 'model'
            || normalized === 'models'
            || normalized.endsWith('model')
            || normalized.endsWith('models')
            || normalized.includes('modelname')
            || normalized.includes('modelid')
            || normalized.includes('modelslug')
            || normalized.includes('selectedmodel')
            || normalized.includes('defaultmodel')
            || normalized.includes('modelconfig');
    };

    const pushObjectModelCandidates = (value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return;
        }
        pushModel(value.model);
        pushModel(value.models);
        pushModel(value.name);
        pushModel(value.id);
        pushModel(value.slug);
        pushModel(value.model_name);
        pushModel(value.model_id);
        pushModel(value.modelId);
        pushModel(value.model_slug);
        pushModel(value.modelSlug);
        pushModel(value.default_model);
        pushModel(value.defaultModel);
        pushModel(value.selected_model);
        pushModel(value.selectedModel);
    };

    const seen = new Set();
    const visit = (value, keyHint = '') => {
        if (Array.isArray(value)) {
            if (shouldReadModelKey(keyHint)) {
                pushModel(value);
            }
            for (const item of value) {
                visit(item, keyHint);
            }
            return;
        }
        if (!value || typeof value !== 'object') {
            if (shouldReadModelKey(keyHint)) {
                pushModel(value);
            }
            return;
        }
        if (seen.has(value)) {
            return;
        }
        seen.add(value);
        if (shouldReadModelKey(keyHint)) {
            pushObjectModelCandidates(value);
        }
        for (const [childKey, childValue] of Object.entries(value)) {
            visit(childValue, childKey);
        }
    };

    visit(record);
    return models;
}

function readSessionModelFromRecord(record) {
    const models = readSessionModelsFromRecord(record);
    return models[0] || '';
}

function readExplicitSessionProviderFromRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return '';
    }
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
        ? record.payload
        : null;
    const message = record.message && typeof record.message === 'object' && !Array.isArray(record.message)
        ? record.message
        : null;
    const candidates = [
        payload && payload.model_provider,
        payload && payload.modelProvider,
        payload && payload.provider,
        payload && payload.provider_name,
        payload && payload.providerName,
        message && message.provider,
        record.provider,
        record.provider_name,
        record.providerName
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }
    return '';
}

function readSessionProviderFromRecord(record, source = '') {
    const provider = readExplicitSessionProviderFromRecord(record);
    if (provider) {
        return provider;
    }
    return source === 'claude' ? 'claude' : 'codex';
}

function applySessionUsageSummaryFromRecord(state, record, source) {
    if (!state || typeof state !== 'object' || !record || typeof record !== 'object' || Array.isArray(record)) {
        return;
    }

    let totalTokens = null;
    let contextWindow = null;
    let usageTotals = null;

    if (source === 'codex') {
        const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
            ? record.payload
            : null;
        const info = payload && payload.info && typeof payload.info === 'object' && !Array.isArray(payload.info)
            ? payload.info
            : null;
        usageTotals = readUsageTotalsFromUsage(info && info.total_token_usage)
            ?? readUsageTotalsFromUsage(payload && payload.total_token_usage)
            ?? readUsageTotalsFromUsage(payload && payload.usage);
        totalTokens = readTotalTokensFromUsage(info && info.total_token_usage)
            ?? readTotalTokensFromUsage(payload && payload.total_token_usage)
            ?? readTotalTokensFromUsage(payload && payload.usage);
        contextWindow = readContextWindowValue(info)
            ?? readContextWindowValue(payload);
    } else {
        const message = record.message && typeof record.message === 'object' && !Array.isArray(record.message)
            ? record.message
            : null;
        const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
            ? record.payload
            : null;
        usageTotals = readUsageTotalsFromUsage(record.usage)
            ?? readUsageTotalsFromUsage(message && message.usage)
            ?? readUsageTotalsFromUsage(payload && payload.usage);
        totalTokens = readTotalTokensFromUsage(record.usage)
            ?? readTotalTokensFromUsage(message && message.usage)
            ?? readTotalTokensFromUsage(payload && payload.usage);
        contextWindow = readContextWindowValue(record)
            ?? readContextWindowValue(message)
            ?? readContextWindowValue(payload);
    }

    applyUsageTotalsToState(state, usageTotals);

    if (totalTokens !== null) {
        state.totalTokens = Math.max(readNonNegativeInteger(state.totalTokens) || 0, totalTokens);
    }
    if (contextWindow !== null) {
        state.contextWindow = Math.max(readNonNegativeInteger(state.contextWindow) || 0, contextWindow);
    }
}

function applySessionUsageSummaryFromIndexEntry(state, entry) {
    if (!state || typeof state !== 'object' || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return;
    }
    const totalTokens = readNonNegativeInteger(entry.totalTokens)
        ?? readTotalTokensFromUsage(entry.totalTokenUsage)
        ?? readTotalTokensFromUsage(entry.usage);
    const usageTotals = readUsageTotalsFromUsage(entry.totalTokenUsage)
        ?? readUsageTotalsFromUsage(entry.usage);
    const contextWindow = readContextWindowValue(entry);
    applyUsageTotalsToState(state, usageTotals);
    if (totalTokens !== null) {
        state.totalTokens = Math.max(readNonNegativeInteger(state.totalTokens) || 0, totalTokens);
    }
    if (contextWindow !== null) {
        state.contextWindow = Math.max(readNonNegativeInteger(state.contextWindow) || 0, contextWindow);
    }
}

function parseCodexSessionSummary(filePath, options = {}) {
    const summaryReadBytes = Number.isFinite(Number(options.summaryReadBytes))
        ? Math.max(1024, Math.floor(Number(options.summaryReadBytes)))
        : SESSION_SUMMARY_READ_BYTES;
    const titleReadBytes = Number.isFinite(Number(options.titleReadBytes))
        ? Math.max(1024, Math.floor(Number(options.titleReadBytes)))
        : SESSION_TITLE_READ_BYTES;
    const records = parseJsonlHeadRecords(filePath, summaryReadBytes);
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
    let totalTokens = 0;
    let contextWindow = 0;
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let outputTokens = 0;
    let reasoningOutputTokens = 0;
    let provider = 'codex';
    let model = '';
    const models = [];
    const usageState = { totalTokens, contextWindow, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens };
    const previewMessages = [];

    for (const record of records) {
        if (record.timestamp) {
            updatedAt = updateLatestIso(updatedAt, record.timestamp);
        }

        applySessionUsageSummaryFromRecord(usageState, record, 'codex');
        totalTokens = usageState.totalTokens || 0;
        contextWindow = usageState.contextWindow || 0;
        inputTokens = usageState.inputTokens || 0;
        cachedInputTokens = usageState.cachedInputTokens || 0;
        outputTokens = usageState.outputTokens || 0;
        reasoningOutputTokens = usageState.reasoningOutputTokens || 0;

        if (record.type === 'session_meta' && record.payload) {
            sessionId = record.payload.id || sessionId;
            cwd = record.payload.cwd || cwd;
            createdAt = toIsoTime(record.payload.timestamp || record.timestamp, createdAt);
            provider = readSessionProviderFromRecord(record, 'codex') || provider;
            continue;
        }
        const recordModels = readSessionModelsFromRecord(record);
        for (const recordModel of recordModels) {
            if (!models.includes(recordModel)) {
                models.push(recordModel);
            }
        }
        model = recordModels[0] || model;

        if (record.type === 'response_item' && record.payload && record.payload.type === 'message') {
            const role = normalizeRole(record.payload.role);
            if (role === 'user' || role === 'assistant' || role === 'system') {
                const text = extractMessageText(record.payload.content);
                previewMessages.push({ role, text });
            }
        }
    }

    const tailRecords = parseJsonlTailRecords(filePath, summaryReadBytes);
    for (const record of tailRecords) {
        applySessionUsageSummaryFromRecord(usageState, record, 'codex');
        totalTokens = usageState.totalTokens || 0;
        contextWindow = usageState.contextWindow || 0;
        inputTokens = usageState.inputTokens || 0;
        cachedInputTokens = usageState.cachedInputTokens || 0;
        outputTokens = usageState.outputTokens || 0;
        reasoningOutputTokens = usageState.reasoningOutputTokens || 0;
        provider = readExplicitSessionProviderFromRecord(record) || provider;
        const recordModels = readSessionModelsFromRecord(record);
        for (const recordModel of recordModels) {
            if (!models.includes(recordModel)) {
                models.push(recordModel);
            }
        }
        model = recordModels[0] || model;
    }

    const filteredPreviewMessages = removeLeadingSystemMessage(previewMessages);
    messageCount = filteredPreviewMessages.length;
    const firstUser = filteredPreviewMessages.find(item => item.role === 'user' && item.text);
    if (firstUser) {
        firstPrompt = truncateText(firstUser.text);
    }

    if (!firstPrompt) {
        const titleRecords = parseJsonlHeadRecords(filePath, titleReadBytes);
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
        provider,
        model,
        models,
        sessionId,
        title: firstPrompt || sessionId,
        cwd,
        createdAt,
        updatedAt,
        messageCount,
        totalTokens,
        contextWindow,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        __messageCountExact: isSessionSummaryMessageCountExact(stat, summaryReadBytes),
        filePath,
        keywords: [],
        capabilities: {}
    };
}

function parseClaudeSessionSummary(filePath, options = {}) {
    const summaryReadBytes = Number.isFinite(Number(options.summaryReadBytes))
        ? Math.max(1024, Math.floor(Number(options.summaryReadBytes)))
        : SESSION_SUMMARY_READ_BYTES;
    const titleReadBytes = Number.isFinite(Number(options.titleReadBytes))
        ? Math.max(1024, Math.floor(Number(options.titleReadBytes)))
        : SESSION_TITLE_READ_BYTES;
    const records = parseJsonlHeadRecords(filePath, summaryReadBytes);
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
    let totalTokens = 0;
    let contextWindow = 0;
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let outputTokens = 0;
    let reasoningOutputTokens = 0;
    let provider = 'claude';
    let model = '';
    const models = [];
    const usageState = { totalTokens, contextWindow, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens };
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

        applySessionUsageSummaryFromRecord(usageState, record, 'claude');
        totalTokens = usageState.totalTokens || 0;
        contextWindow = usageState.contextWindow || 0;
        inputTokens = usageState.inputTokens || 0;
        cachedInputTokens = usageState.cachedInputTokens || 0;
        outputTokens = usageState.outputTokens || 0;
        reasoningOutputTokens = usageState.reasoningOutputTokens || 0;

        if (!cwd && record.cwd) {
            cwd = record.cwd;
        }

        provider = readExplicitSessionProviderFromRecord(record) || provider;
        const recordModels = readSessionModelsFromRecord(record);
        for (const recordModel of recordModels) {
            if (!models.includes(recordModel)) {
                models.push(recordModel);
            }
        }
        model = recordModels[0] || model;

        const role = normalizeRole(record.type);
        if (role === 'assistant' || role === 'user' || role === 'system') {
            const userContent = record.message ? record.message.content : '';
            previewMessages.push({
                role,
                text: extractMessageText(userContent)
            });
        }
    }

    const tailRecords = parseJsonlTailRecords(filePath, summaryReadBytes);
    for (const record of tailRecords) {
        applySessionUsageSummaryFromRecord(usageState, record, 'claude');
        totalTokens = usageState.totalTokens || 0;
        contextWindow = usageState.contextWindow || 0;
        inputTokens = usageState.inputTokens || 0;
        cachedInputTokens = usageState.cachedInputTokens || 0;
        outputTokens = usageState.outputTokens || 0;
        reasoningOutputTokens = usageState.reasoningOutputTokens || 0;
        provider = readExplicitSessionProviderFromRecord(record) || provider;
        const recordModels = readSessionModelsFromRecord(record);
        for (const recordModel of recordModels) {
            if (!models.includes(recordModel)) {
                models.push(recordModel);
            }
        }
        model = recordModels[0] || model;
    }

    const filteredPreviewMessages = removeLeadingSystemMessage(previewMessages);
    messageCount = filteredPreviewMessages.length;
    const firstUser = filteredPreviewMessages.find(item => item.role === 'user' && item.text);
    if (firstUser) {
        firstPrompt = truncateText(firstUser.text);
    }

    if (!firstPrompt) {
        const titleRecords = parseJsonlHeadRecords(filePath, titleReadBytes);
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
        provider,
        model,
        models,
        sessionId,
        title: firstPrompt || sessionId,
        cwd,
        createdAt,
        updatedAt,
        messageCount,
        totalTokens,
        contextWindow,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        __messageCountExact: isSessionSummaryMessageCountExact(stat, summaryReadBytes),
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
    const summaryReadBytes = Number.isFinite(Number(options.summaryReadBytes))
        ? Math.max(1024, Math.floor(Number(options.summaryReadBytes)))
        : SESSION_SUMMARY_READ_BYTES;
    const titleReadBytes = Number.isFinite(Number(options.titleReadBytes))
        ? Math.max(1024, Math.floor(Number(options.titleReadBytes)))
        : SESSION_TITLE_READ_BYTES;
    const files = collectRecentJsonlFiles(codexSessionsDir, {
        returnCount: scanCount,
        maxFilesScanned
    });
    const sessions = [];

    for (const filePath of files) {
        const summary = parseCodexSessionSummary(filePath, {
            summaryReadBytes,
            titleReadBytes
        });
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
    const summaryReadBytes = Number.isFinite(Number(options.summaryReadBytes))
        ? Math.max(1024, Math.floor(Number(options.summaryReadBytes)))
        : SESSION_SUMMARY_READ_BYTES;
    const titleReadBytes = Number.isFinite(Number(options.titleReadBytes))
        ? Math.max(1024, Math.floor(Number(options.titleReadBytes)))
        : SESSION_TITLE_READ_BYTES;

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

            const fileStat = getFileStatSafe(filePath);
            if (!fileStat) {
                continue;
            }

            const updatedAt = toIsoTime(entry.modified || entry.fileMtime, '');
            const createdAt = toIsoTime(entry.created, '');
            let title = truncateText(entry.summary || entry.firstPrompt || sessionId, 120);
            let messageCount = Number.isFinite(entry.messageCount) ? Math.max(0, entry.messageCount - 1) : 0;
            let totalTokens = 0;
            let contextWindow = 0;
            let inputTokens = 0;
            let cachedInputTokens = 0;
            let outputTokens = 0;
            let reasoningOutputTokens = 0;
            let model = typeof entry.model === 'string' ? entry.model.trim() : '';
            const models = model ? [model] : [];

            const usageState = { totalTokens, contextWindow, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens };
            applySessionUsageSummaryFromIndexEntry(usageState, entry);
            totalTokens = usageState.totalTokens || 0;
            contextWindow = usageState.contextWindow || 0;
            inputTokens = usageState.inputTokens || 0;
            cachedInputTokens = usageState.cachedInputTokens || 0;
            outputTokens = usageState.outputTokens || 0;
            reasoningOutputTokens = usageState.reasoningOutputTokens || 0;

            const quickRecords = parseJsonlHeadRecords(filePath, summaryReadBytes);
            if (quickRecords.length > 0) {
                const filteredCount = countConversationMessagesInRecords(quickRecords, 'claude');
                if (filteredCount > 0 || messageCount === 0) {
                    messageCount = filteredCount;
                }

                const quickMessages = [];
                for (const record of quickRecords) {
                    applySessionUsageSummaryFromRecord(usageState, record, 'claude');
                    const recordModels = readSessionModelsFromRecord(record);
                    for (const recordModel of recordModels) {
                        if (!models.includes(recordModel)) {
                            models.push(recordModel);
                        }
                    }
                    model = recordModels[0] || model;
                    const role = normalizeRole(record.type);
                    if (role === 'assistant' || role === 'user' || role === 'system') {
                        const content = record.message ? record.message.content : '';
                        quickMessages.push({ role, text: extractMessageText(content) });
                    }
                }
                totalTokens = usageState.totalTokens || 0;
                contextWindow = usageState.contextWindow || 0;
                inputTokens = usageState.inputTokens || 0;
                cachedInputTokens = usageState.cachedInputTokens || 0;
                outputTokens = usageState.outputTokens || 0;
                reasoningOutputTokens = usageState.reasoningOutputTokens || 0;
                const filteredQuickMessages = removeLeadingSystemMessage(quickMessages);
                const firstUser = filteredQuickMessages.find(item => item.role === 'user' && item.text);
                if (firstUser) {
                    title = truncateText(firstUser.text, 120);
                }
            }

            const tailRecords = parseJsonlTailRecords(filePath, summaryReadBytes);
            for (const record of tailRecords) {
                applySessionUsageSummaryFromRecord(usageState, record, 'claude');
                const recordModels = readSessionModelsFromRecord(record);
                for (const recordModel of recordModels) {
                    if (!models.includes(recordModel)) {
                        models.push(recordModel);
                    }
                }
                model = recordModels[0] || model;
            }
            totalTokens = usageState.totalTokens || 0;
            contextWindow = usageState.contextWindow || 0;
            inputTokens = usageState.inputTokens || 0;
            cachedInputTokens = usageState.cachedInputTokens || 0;
            outputTokens = usageState.outputTokens || 0;
            reasoningOutputTokens = usageState.reasoningOutputTokens || 0;

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
                totalTokens,
                contextWindow,
                inputTokens,
                cachedInputTokens,
                outputTokens,
                reasoningOutputTokens,
                model,
                models,
                __messageCountExact: quickRecords.length > 0 && isSessionSummaryMessageCountExact(fileStat, summaryReadBytes),
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
            const summary = parseClaudeSessionSummary(filePath, {
                summaryReadBytes,
                titleReadBytes
            });
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

async function listAllSessions(params = {}) {
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
    const browseLightweight = params.browseLightweight === true && !hasQuery && !hasPathFilter;
    const cacheKey = hasQuery ? '' : `${browseLightweight ? 'browse' : 'default'}:${source}:${limit}:${normalizedPathFilter}`;
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
        : (browseLightweight
            ? {
                scanFactor: SESSION_BROWSE_SCAN_FACTOR,
                minFiles: SESSION_BROWSE_MIN_FILES,
                summaryReadBytes: SESSION_BROWSE_SUMMARY_READ_BYTES,
                titleReadBytes: SESSION_BROWSE_SUMMARY_READ_BYTES
            }
            : {});

    let sessions = [];
    if (source === 'all' || source === 'codex') {
        sessions = sessions.concat(listSessionInventoryBySource('codex', limit, scanOptions, { forceRefresh }));
    }
    if (source === 'all' || source === 'claude') {
        sessions = sessions.concat(listSessionInventoryBySource('claude', limit, scanOptions, { forceRefresh }));
    }

    if (hasPathFilter) {
        sessions = sessions.filter(item => matchesSessionPathFilter(item, normalizedPathFilter));
    }

    let result = sessions;
    if (hasQuery) {
        result = await applySessionQueryFilter(result, {
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

async function listAllSessionsData(params = {}) {
    const source = params.source === 'codex' || params.source === 'claude'
        ? params.source
        : 'all';
    const rawLimit = Number(params.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(rawLimit, MAX_SESSION_LIST_SIZE))
        : 120;
    const forceRefresh = !!params.forceRefresh;
    const normalizedPathFilter = normalizeSessionPathFilter(params.pathFilter);
    const queryTokens = expandSessionQueryTokens(normalizeQueryTokens(params.query));
    const hasQuery = queryTokens.length > 0;
    const cacheKey = hasQuery ? '' : `exact:${source}:${limit}:${normalizedPathFilter}`;
    if (!hasQuery) {
        const cached = getSessionListCache(cacheKey, forceRefresh);
        if (cached) {
            return cached;
        }
    }

    const sessions = await listAllSessions(params);
    const hydratedSessions = await hydrateSessionItemsExactMessageCount(sessions);
    const result = hydratedSessions.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return item;
        }
        const normalized = { ...item };
        delete normalized.__messageCountExact;
        return normalized;
    });
    if (!hasQuery) {
        setSessionListCache(cacheKey, result);
    }
    return result;
}

async function listSessionBrowse(params = {}) {
    const sessions = await listAllSessions({
        ...params,
        browseLightweight: true
    });
    return Array.isArray(sessions)
        ? sessions.map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                return item;
            }
            const normalized = { ...item };
            delete normalized.__messageCountExact;
            return normalized;
        })
        : [];
}

async function listSessionUsage(params = {}) {
    function isConcreteSessionModelName(value) {
        if (typeof value !== 'string') {
            return false;
        }
        const normalized = value.trim();
        if (!normalized) {
            return false;
        }
        return normalized.toLowerCase() !== '<synthetic>';
    }

    function normalizeSessionModelList(values = []) {
        const models = [];
        for (const value of values) {
            if (!isConcreteSessionModelName(value)) {
                continue;
            }
            const normalized = value.trim();
            if (models.includes(normalized)) {
                continue;
            }
            models.push(normalized);
        }
        return models;
    }

    function readSessionModelsFromFile(filePath) {
        const targetPath = typeof filePath === 'string' ? filePath.trim() : '';
        if (!targetPath) {
            return [];
        }

        const cache = listSessionUsage.__modelsByFileCache instanceof Map
            ? listSessionUsage.__modelsByFileCache
            : new Map();
        listSessionUsage.__modelsByFileCache = cache;

        let stat;
        try {
            stat = fs.statSync(targetPath);
        } catch (e) {
            return [];
        }

        const cacheKey = `${targetPath}:${stat.size}:${stat.mtimeMs}`;
        if (cache.has(cacheKey)) {
            return [...cache.get(cacheKey)];
        }

        let content = '';
        try {
            content = fs.readFileSync(targetPath, 'utf-8');
        } catch (e) {
            return [];
        }

        const models = [];
        const pushModel = (value) => {
            if (!isConcreteSessionModelName(value)) {
                return;
            }
            const normalized = value.trim();
            if (models.includes(normalized)) {
                return;
            }
            models.push(normalized);
        };

        for (const line of content.split(/\r?\n/)) {
            if (!line.trim()) {
                continue;
            }
            let record;
            try {
                record = JSON.parse(line);
            } catch (e) {
                continue;
            }
            if (!record || typeof record !== 'object' || Array.isArray(record)) {
                continue;
            }
            const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
                ? record.payload
                : null;
            const info = payload && payload.info && typeof payload.info === 'object' && !Array.isArray(payload.info)
                ? payload.info
                : null;
            const collaborationMode = payload && payload.collaboration_mode && typeof payload.collaboration_mode === 'object' && !Array.isArray(payload.collaboration_mode)
                ? payload.collaboration_mode
                : null;
            const collaborationSettings = collaborationMode && collaborationMode.settings && typeof collaborationMode.settings === 'object' && !Array.isArray(collaborationMode.settings)
                ? collaborationMode.settings
                : null;
            const message = record.message && typeof record.message === 'object' && !Array.isArray(record.message)
                ? record.message
                : null;
            const candidates = [
                payload && payload.model,
                payload && payload.model_name,
                payload && payload.model_id,
                payload && payload.modelId,
                info && info.model,
                info && info.model_name,
                info && info.model_id,
                info && info.modelId,
                collaborationSettings && collaborationSettings.model,
                collaborationSettings && collaborationSettings.model_name,
                collaborationSettings && collaborationSettings.model_id,
                collaborationSettings && collaborationSettings.modelId,
                message && message.model,
                message && message.model_name,
                message && message.model_id,
                message && message.modelId,
                record.model,
                record.modelName,
                record.model_name,
                record.model_id,
                record.modelId
            ];
            for (const candidate of candidates) {
                pushModel(candidate);
            }
        }

        cache.set(cacheKey, models);
        if (cache.size > 500) {
            const firstKey = cache.keys().next().value;
            if (firstKey) {
                cache.delete(firstKey);
            }
        }
        return [...models];
    }

    const source = params.source === 'codex' || params.source === 'claude'
        ? params.source
        : 'all';
    const rawLimit = Number(params.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(rawLimit, MAX_SESSION_USAGE_LIST_SIZE))
        : MAX_SESSION_USAGE_LIST_SIZE;
    const sessions = await listSessionBrowse({
        source,
        limit,
        forceRefresh: !!params.forceRefresh
    });
    return Array.isArray(sessions)
        ? sessions.map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                return null;
            }
            const normalized = { ...item };
            delete normalized.__messageCountExact;
            const filePath = typeof normalized.filePath === 'string' ? normalized.filePath.trim() : '';
            const fullFileModels = filePath ? readSessionModelsFromFile(filePath) : [];
            const mergedModels = normalizeSessionModelList([
                ...(Array.isArray(normalized.models) ? normalized.models : []),
                ...fullFileModels,
                normalized.model,
                normalized.modelName,
                normalized.modelId
            ]);
            if (mergedModels.length > 0) {
                normalized.models = mergedModels;
                normalized.model = mergedModels[0];
            }
            if (mergedModels.length > 0) {
                return normalized;
            }
            if (!filePath) {
                return null;
            }

            const summaryOptions = {
                summaryReadBytes: SESSION_BROWSE_SUMMARY_READ_BYTES,
                titleReadBytes: SESSION_BROWSE_SUMMARY_READ_BYTES
            };
            let summary = null;
            try {
                summary = normalized.source === 'claude'
                    ? parseClaudeSessionSummary(filePath, summaryOptions)
                    : parseCodexSessionSummary(filePath, summaryOptions);
            } catch (e) {
                summary = null;
            }

            if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
                return null;
            }
            const summaryModels = Array.isArray(summary.models) ? summary.models : [];
            const allModels = normalizeSessionModelList([
                ...summaryModels,
                ...fullFileModels,
                summary.model,
                normalized.model,
                normalized.modelName,
                normalized.modelId
            ]);
            if (allModels.length === 0) {
                return null;
            }
            normalized.models = allModels;
            normalized.model = allModels[0];
            if ((!normalized.provider || !String(normalized.provider).trim()) && typeof summary.provider === 'string' && summary.provider.trim()) {
                normalized.provider = summary.provider.trim();
            }
            return normalized;
        }).filter(Boolean)
        : [];
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
        targetCount: Math.max(gatherLimit * 2, 1000),
        summaryReadBytes: SESSION_BROWSE_SUMMARY_READ_BYTES,
        titleReadBytes: SESSION_BROWSE_SUMMARY_READ_BYTES
    };

    let sessions = [];
    if (validSource === 'all' || validSource === 'codex') {
        sessions = sessions.concat(listSessionInventoryBySource('codex', gatherLimit, scanOptions, { forceRefresh }));
    }
    if (validSource === 'all' || validSource === 'claude') {
        sessions = sessions.concat(listSessionInventoryBySource('claude', gatherLimit, scanOptions, { forceRefresh }));
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
        const lookupStore = g_sessionFileLookupCache[source === 'claude' ? 'claude' : 'codex'];
        if (lookupStore instanceof Map && lookupStore.has(targetId)) {
            const cachedPath = lookupStore.get(targetId);
            if (cachedPath && fs.existsSync(cachedPath) && isPathInside(cachedPath, root)) {
                return cachedPath;
            }
            lookupStore.delete(targetId);
        }
        const files = collectJsonlFiles(root, 5000);
        const matchedFile = files.find(item => path.basename(item, '.jsonl').toLowerCase() === targetId);
        if (matchedFile && fs.existsSync(matchedFile)) {
            return matchedFile;
        }
    }

    return '';
}

function getSessionFileArg(params = {}) {
    if (!params || typeof params !== 'object') {
        return '';
    }
    if (typeof params.filePath === 'string' && params.filePath.trim()) {
        return params.filePath.trim();
    }
    if (typeof params.file === 'string' && params.file.trim()) {
        return params.file.trim();
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

const {
    findAvailablePort,
    saveBuiltinProxySettings,
    removePersistedBuiltinProxyProviderFromConfig,
    hasCodexConfigReadyForProxy,
    resolveBuiltinProxyProviderName,
    startBuiltinProxyRuntime,
    stopBuiltinProxyRuntime,
    getBuiltinProxyStatus
} = createBuiltinProxyRuntimeController({
    fs,
    https,
    CONFIG_FILE,
    BUILTIN_PROXY_SETTINGS_FILE,
    DEFAULT_BUILTIN_PROXY_SETTINGS,
    BUILTIN_PROXY_PROVIDER_NAME,
    CODEXMATE_MANAGED_MARKER,
    HTTP_KEEP_ALIVE_AGENT,
    HTTPS_KEEP_ALIVE_AGENT,
    readConfig,
    writeConfig,
    readConfigOrVirtualDefault,
    resolveAuthTokenFromCurrentProfile,
    isPlainObject,
    isBuiltinManagedProvider,
    findProviderSectionRanges,
    findProviderDescendantSectionRanges,
    normalizeLegacySegments,
    buildLegacySegmentsKey,
    formatHostForUrl
});

const {
    startBuiltinClaudeProxyRuntime,
    stopBuiltinClaudeProxyRuntime,
    getBuiltinClaudeProxyStatus
} = createBuiltinClaudeProxyRuntimeController({
    BUILTIN_CLAUDE_PROXY_SETTINGS_FILE,
    DEFAULT_BUILTIN_CLAUDE_PROXY_SETTINGS,
    BUILTIN_PROXY_PROVIDER_NAME,
    MAX_API_BODY_SIZE,
    HTTP_KEEP_ALIVE_AGENT,
    HTTPS_KEEP_ALIVE_AGENT,
    readConfigOrVirtualDefault,
    resolveBuiltinProxyProviderName,
    resolveAuthTokenFromCurrentProfile
});

function applyBuiltinProxyProvider(params = {}) {
    return { error: '该功能已移除' };
}

async function ensureBuiltinProxyForCodexDefault(params = {}) {
    return { error: '该功能已移除' };
}

function removeClaudeSessionIndexEntry(indexPath, sessionFilePath, sessionId) {
    if (!indexPath || !fs.existsSync(indexPath)) {
        return { removed: false, entry: null };
    }
    const index = readJsonFile(indexPath, null);
    if (!index || !Array.isArray(index.entries)) {
        return { removed: false, entry: null };
    }
    const ignoreCase = process.platform === 'win32';
    const resolvedFile = sessionFilePath
        ? normalizePathForCompare(sessionFilePath, { ignoreCase })
        : '';
    let removedEntry = null;
    const filtered = index.entries.filter((entry) => {
        if (!entry || typeof entry !== 'object') {
            return false;
        }
        if (entry.fullPath) {
            const expanded = expandHomePath(entry.fullPath);
            const entryPath = expanded
                ? normalizePathForCompare(expanded, { ignoreCase })
                : '';
            if (entryPath && resolvedFile && entryPath === resolvedFile) {
                if (!removedEntry) {
                    removedEntry = entry;
                }
                return false;
            }
        }
        const entrySessionId = typeof entry.sessionId === 'string' ? entry.sessionId : '';
        if (!resolvedFile && sessionId && entrySessionId === sessionId) {
            if (!removedEntry) {
                removedEntry = entry;
            }
            return false;
        }
        return true;
    });
    if (filtered.length === index.entries.length) {
        return { removed: false, entry: null };
    }
    index.entries = filtered;
    writeJsonAtomic(indexPath, index);
    return {
        removed: true,
        entry: removedEntry && typeof removedEntry === 'object'
            ? JSON.parse(JSON.stringify(removedEntry))
            : null
    };
}

function moveFileSync(sourcePath, targetPath) {
    ensureDir(path.dirname(targetPath));
    try {
        fs.renameSync(sourcePath, targetPath);
        return;
    } catch (error) {
        if (!error || error.code !== 'EXDEV') {
            throw error;
        }
    }

    fs.copyFileSync(sourcePath, targetPath);
    try {
        fs.unlinkSync(sourcePath);
    } catch (error) {
        try {
            fs.unlinkSync(targetPath);
        } catch (_) {}
        throw error;
    }
}

function buildSessionSummaryFallback(source, filePath, sessionId = '') {
    const resolvedSessionId = sessionId || path.basename(filePath, '.jsonl');
    const sourceLabel = source === 'claude' ? 'Claude Code' : 'Codex';
    return {
        source,
        sourceLabel,
        provider: source === 'claude' ? 'claude' : 'codex',
        sessionId: resolvedSessionId,
        title: resolvedSessionId,
        cwd: '',
        createdAt: '',
        updatedAt: '',
        messageCount: 0,
        totalTokens: 0,
        contextWindow: 0,
        filePath,
        keywords: [],
        capabilities: source === 'claude' ? { code: true } : {}
    };
}

function generateSessionTrashId() {
    if (crypto.randomUUID) {
        return `trash-${crypto.randomUUID()}`;
    }
    return `trash-${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
}

function allocateSessionTrashTarget() {
    ensureDir(SESSION_TRASH_FILES_DIR);
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const trashId = generateSessionTrashId();
        const trashFileName = `${trashId}.jsonl`;
        const trashFilePath = path.join(SESSION_TRASH_FILES_DIR, trashFileName);
        if (!fs.existsSync(trashFilePath)) {
            return { trashId, trashFileName, trashFilePath };
        }
    }
    const fallbackId = `trash-${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
    return {
        trashId: fallbackId,
        trashFileName: `${fallbackId}.jsonl`,
        trashFilePath: path.join(SESSION_TRASH_FILES_DIR, `${fallbackId}.jsonl`)
    };
}

function normalizeSessionTrashEntry(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
    }
    const source = entry.source === 'claude' ? 'claude' : (entry.source === 'codex' ? 'codex' : '');
    const trashId = typeof entry.trashId === 'string' ? entry.trashId.trim() : '';
    if (!source || !trashId || trashId.includes('/') || trashId.includes('\\') || trashId.includes('\0')) {
        return null;
    }
    const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId.trim() : '';
    const trashFileNameRaw = typeof entry.trashFileName === 'string' ? entry.trashFileName.trim() : '';
    const trashFileName = path.basename(trashFileNameRaw || `${trashId}.jsonl`);
    if (!trashFileName || trashFileName === '.' || trashFileName === '..' || trashFileName.includes('\0')) {
        return null;
    }
    return {
        trashId,
        trashFileName,
        source,
        sourceLabel: source === 'claude' ? 'Claude Code' : 'Codex',
        sessionId: sessionId || trashId,
        title: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : (sessionId || trashId),
        cwd: typeof entry.cwd === 'string' ? entry.cwd : '',
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
        deletedAt: typeof entry.deletedAt === 'string' ? entry.deletedAt : '',
        messageCount: Number.isFinite(Number(entry.messageCount))
            ? Math.max(0, Math.floor(Number(entry.messageCount)))
            : 0,
        messageCountMtimeMs: Number.isFinite(Number(entry.messageCountMtimeMs))
            ? Math.max(0, Math.floor(Number(entry.messageCountMtimeMs)))
            : 0,
        originalFilePath: typeof entry.originalFilePath === 'string' ? entry.originalFilePath : '',
        provider: typeof entry.provider === 'string' && entry.provider.trim()
            ? entry.provider.trim()
            : (source === 'claude' ? 'claude' : 'codex'),
        keywords: normalizeKeywords(entry.keywords),
        capabilities: normalizeCapabilities(entry.capabilities),
        claudeIndexPath: typeof entry.claudeIndexPath === 'string' ? entry.claudeIndexPath : '',
        claudeIndexEntry: entry.claudeIndexEntry && typeof entry.claudeIndexEntry === 'object' && !Array.isArray(entry.claudeIndexEntry)
            ? entry.claudeIndexEntry
            : null
    };
}

function resolveSessionTrashFilePath(entry) {
    const normalized = normalizeSessionTrashEntry(entry);
    if (!normalized) {
        return '';
    }
    const filePath = path.join(SESSION_TRASH_FILES_DIR, normalized.trashFileName);
    return isPathInside(filePath, SESSION_TRASH_FILES_DIR) ? filePath : '';
}

function writeSessionTrashEntries(entries) {
    writeJsonAtomic(SESSION_TRASH_INDEX_FILE, {
        version: 1,
        updatedAt: new Date().toISOString(),
        entries
    });
}

function readSessionTrashEntries(options = {}) {
    const cleanup = options.cleanup !== false;
    const parsed = readJsonFile(SESSION_TRASH_INDEX_FILE, null);
    if (!parsed || !Array.isArray(parsed.entries)) {
        return [];
    }

    const normalizedEntries = [];
    let dirty = false;
    for (const rawEntry of parsed.entries) {
        const entry = normalizeSessionTrashEntry(rawEntry);
        if (!entry) {
            dirty = true;
            continue;
        }
        const trashFilePath = resolveSessionTrashFilePath(entry);
        if (!trashFilePath || !fs.existsSync(trashFilePath)) {
            dirty = true;
            continue;
        }
        normalizedEntries.push(entry);
    }

    if (dirty && cleanup) {
        writeSessionTrashEntries(normalizedEntries);
    }

    return normalizedEntries;
}

function buildSessionTrashEntry(summary, options = {}) {
    const source = options.source === 'claude' ? 'claude' : 'codex';
    const sessionId = options.sessionId || summary.sessionId || path.basename(options.originalFilePath || summary.filePath || '', '.jsonl');
    const claudeIndexEntry = options.claudeIndexEntry && typeof options.claudeIndexEntry === 'object' && !Array.isArray(options.claudeIndexEntry)
        ? options.claudeIndexEntry
        : null;
    const deletedAt = typeof options.deletedAt === 'string' && options.deletedAt
        ? options.deletedAt
        : new Date().toISOString();
    const sourceLabel = source === 'claude' ? 'Claude Code' : 'Codex';
    const fallbackTitle = truncateText(
        (claudeIndexEntry && (claudeIndexEntry.summary || claudeIndexEntry.firstPrompt)) || sessionId,
        120
    );
    const rawFallbackMessageCount = claudeIndexEntry && claudeIndexEntry.messageCount;
    const fallbackMessageCount = Number.isFinite(Number(rawFallbackMessageCount))
        ? Math.max(0, Number(rawFallbackMessageCount))
        : 0;
    const resolvedMessageCount = Number.isFinite(Number(summary && summary.messageCount))
        ? Math.max(0, Math.floor(Number(summary.messageCount)))
        : fallbackMessageCount;
    const messageCountMtimeMs = getFileMtimeMs(options.trashFilePath);
    const normalizedClaudeKeywords = claudeIndexEntry && Array.isArray(claudeIndexEntry.keywords)
        ? normalizeKeywords(claudeIndexEntry.keywords)
        : [];
    const normalizedClaudeCapabilities = claudeIndexEntry
        ? normalizeCapabilities(claudeIndexEntry.capabilities)
        : {};
    const normalizedSummaryKeywords = normalizeKeywords(summary.keywords);
    const normalizedSummaryCapabilities = normalizeCapabilities(summary.capabilities);
    return {
        trashId: options.trashId,
        trashFileName: options.trashFileName,
        source,
        sourceLabel,
        sessionId,
        title: summary.title || fallbackTitle || sessionId,
        cwd: summary.cwd || (claudeIndexEntry && typeof claudeIndexEntry.projectPath === 'string' ? claudeIndexEntry.projectPath : ''),
        createdAt: summary.createdAt || toIsoTime(claudeIndexEntry && claudeIndexEntry.created, ''),
        updatedAt: summary.updatedAt || toIsoTime(claudeIndexEntry && (claudeIndexEntry.modified || claudeIndexEntry.fileMtime), ''),
        deletedAt,
        messageCount: resolvedMessageCount,
        messageCountMtimeMs,
        originalFilePath: options.originalFilePath || summary.filePath || '',
        provider: (claudeIndexEntry && typeof claudeIndexEntry.provider === 'string' && claudeIndexEntry.provider.trim())
            ? claudeIndexEntry.provider.trim()
            : (summary.provider || (source === 'claude' ? 'claude' : 'codex')),
        keywords: normalizedClaudeKeywords.length > 0 ? normalizedClaudeKeywords : normalizedSummaryKeywords,
        capabilities: Object.keys(normalizedClaudeCapabilities).length > 0
            ? normalizedClaudeCapabilities
            : normalizedSummaryCapabilities,
        claudeIndexPath: typeof options.claudeIndexPath === 'string' ? options.claudeIndexPath : '',
        claudeIndexEntry
    };
}

function resolveSessionRestoreTarget(entry) {
    const normalized = normalizeSessionTrashEntry(entry);
    if (!normalized) {
        return '';
    }
    const root = normalized.source === 'claude' ? getClaudeProjectsDir() : getCodexSessionsDir();
    const originalFilePath = typeof normalized.originalFilePath === 'string' ? normalized.originalFilePath.trim() : '';
    if (!root || !originalFilePath) {
        return '';
    }
    const expanded = expandHomePath(originalFilePath);
    const resolved = expanded ? path.resolve(expanded) : '';
    if (!resolved || !isPathInside(resolved, root)) {
        return '';
    }
    return resolved;
}

function resolveClaudeSessionRestoreIndexPath(entry, targetFilePath) {
    const fallbackIndexPath = findClaudeSessionIndexPath(targetFilePath) || path.join(path.dirname(targetFilePath), 'sessions-index.json');
    const fallbackResolved = fallbackIndexPath ? path.resolve(fallbackIndexPath) : '';
    const candidateRaw = entry && typeof entry.claudeIndexPath === 'string' ? entry.claudeIndexPath.trim() : '';
    if (!candidateRaw) {
        return fallbackResolved;
    }
    const claudeProjectsDir = getClaudeProjectsDir();
    if (!claudeProjectsDir) {
        return fallbackResolved;
    }
    const candidateIndexPath = path.resolve(candidateRaw);
    if (path.basename(candidateIndexPath).toLowerCase() !== 'sessions-index.json') {
        return fallbackResolved;
    }
    if (!isPathInside(candidateIndexPath, claudeProjectsDir)) {
        return fallbackResolved;
    }
    if (!isPathInside(targetFilePath, path.dirname(candidateIndexPath))) {
        return fallbackResolved;
    }
    return candidateIndexPath;
}

function buildClaudeSessionIndexEntry(entry, sessionFilePath) {
    const normalized = normalizeSessionTrashEntry(entry);
    const stored = normalized && normalized.claudeIndexEntry && typeof normalized.claudeIndexEntry === 'object'
        ? JSON.parse(JSON.stringify(normalized.claudeIndexEntry))
        : {};
    const storedCapabilities = stored && stored.capabilities && typeof stored.capabilities === 'object' && !Array.isArray(stored.capabilities)
        ? stored.capabilities
        : null;
    const storedKeywords = Array.isArray(stored && stored.keywords)
        ? stored.keywords
        : null;
    const normalizedMessageCount = Number(normalized && normalized.messageCount);
    const storedMessageCount = Number(stored && stored.messageCount);
    let modifiedAt = '';
    try {
        modifiedAt = fs.statSync(sessionFilePath).mtime.toISOString();
    } catch (e) {
        modifiedAt = normalized && normalized.updatedAt ? normalized.updatedAt : new Date().toISOString();
    }
    const projectDir = path.dirname(sessionFilePath);
    return {
        ...stored,
        sessionId: normalized.sessionId,
        fullPath: sessionFilePath,
        projectPath: (stored && typeof stored.projectPath === 'string' && stored.projectPath.trim())
            ? stored.projectPath.trim()
            : projectDir,
        created: (stored && typeof stored.created === 'string' && stored.created.trim())
            ? stored.created.trim()
            : (normalized.createdAt || modifiedAt),
        modified: modifiedAt,
        summary: (stored && typeof stored.summary === 'string' && stored.summary.trim())
            ? stored.summary.trim()
            : (normalized.title || normalized.sessionId),
        provider: (stored && typeof stored.provider === 'string' && stored.provider.trim())
            ? stored.provider.trim()
            : (normalized.provider || 'claude'),
        capabilities: normalizeCapabilities(
            storedCapabilities && Object.keys(storedCapabilities).length > 0
                ? storedCapabilities
                : normalized.capabilities
        ),
        keywords: normalizeKeywords(
            storedKeywords && storedKeywords.length > 0
                ? storedKeywords
                : normalized.keywords
        ),
        messageCount: Number.isFinite(normalizedMessageCount)
            ? buildClaudeStoredIndexMessageCount(normalizedMessageCount)
            : (
                Number.isFinite(storedMessageCount)
                    ? Math.max(0, Math.floor(storedMessageCount))
                    : buildClaudeStoredIndexMessageCount(normalized && normalized.messageCount)
            )
    };
}

function upsertClaudeSessionIndexEntry(indexPath, sessionFilePath, entry) {
    if (!indexPath) {
        return;
    }
    const parsed = readJsonFile(indexPath, null);
    const index = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    const entries = Array.isArray(index.entries) ? index.entries : [];
    const ignoreCase = process.platform === 'win32';
    const resolvedFile = normalizePathForCompare(sessionFilePath, { ignoreCase });
    const normalizedEntry = normalizeSessionTrashEntry(entry);
    const filtered = entries.filter((item) => {
        if (!item || typeof item !== 'object') {
            return false;
        }
        if (typeof item.fullPath === 'string' && item.fullPath) {
            const expanded = expandHomePath(item.fullPath);
            const itemPath = expanded
                ? normalizePathForCompare(expanded, { ignoreCase })
                : '';
            if (itemPath && itemPath === resolvedFile) {
                return false;
            }
        }
        const itemSessionId = typeof item.sessionId === 'string' ? item.sessionId : '';
        if (!resolvedFile && normalizedEntry.sessionId && itemSessionId === normalizedEntry.sessionId) {
            return false;
        }
        return true;
    });
    filtered.unshift(buildClaudeSessionIndexEntry(normalizedEntry, sessionFilePath));
    index.entries = filtered;
    if (!index.originalPath) {
        index.originalPath = path.dirname(indexPath);
    }
    writeJsonAtomic(indexPath, index);
}

async function listSessionTrashItems(params = {}) {
    const source = params.source === 'claude' ? 'claude' : (params.source === 'codex' ? 'codex' : 'all');
    const countOnly = params.countOnly === true;
    const rawLimit = Number(params.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(rawLimit, MAX_SESSION_TRASH_LIST_SIZE))
        : 200;
    const allEntries = readSessionTrashEntries();
    let items = source === 'codex' || source === 'claude'
        ? allEntries.filter((entry) => entry.source === source)
        : allEntries.slice();
    items.sort((a, b) => {
        const aTime = Date.parse(a.deletedAt || a.updatedAt || '') || 0;
        const bTime = Date.parse(b.deletedAt || b.updatedAt || '') || 0;
        return bTime - aTime;
    });
    const totalCount = items.length;
    if (countOnly) {
        return {
            totalCount,
            items: []
        };
    }
    const visibleEntries = items.slice(0, limit);
    const hydratedVisibleEntries = await hydrateSessionTrashEntries(visibleEntries, { source });
    const updatedEntriesById = new Map();
    for (let index = 0; index < visibleEntries.length; index += 1) {
        const originalEntry = visibleEntries[index];
        const hydratedEntry = hydratedVisibleEntries[index];
        if (!originalEntry || !hydratedEntry) {
            continue;
        }
        if (
            originalEntry.messageCount !== hydratedEntry.messageCount
            || originalEntry.messageCountMtimeMs !== hydratedEntry.messageCountMtimeMs
        ) {
            updatedEntriesById.set(originalEntry.trashId, hydratedEntry);
        }
    }
    if (updatedEntriesById.size > 0) {
        const latestEntries = readSessionTrashEntries({ cleanup: false });
        writeSessionTrashEntries(latestEntries.map((entry) => updatedEntriesById.get(entry.trashId) || entry));
    }
    return {
        totalCount,
        items: hydratedVisibleEntries.map((item) => ({
            ...item,
            trashFilePath: resolveSessionTrashFilePath(item)
        }))
    };
}

async function restoreSessionTrashItem(params = {}) {
    const trashId = typeof params.trashId === 'string' ? params.trashId.trim() : '';
    if (!trashId) {
        return { error: '请先选择要恢复的回收站记录' };
    }

    const entries = readSessionTrashEntries();
    const entry = entries.find((item) => item.trashId === trashId);
    if (!entry) {
        return { error: '回收站记录不存在' };
    }
    const hydratedEntry = await resolveSessionTrashEntryExactMessageCount(entry);
    if (!hydratedEntry) {
        return { error: '回收站记录不存在' };
    }

    const trashFilePath = resolveSessionTrashFilePath(hydratedEntry);
    if (!trashFilePath || !fs.existsSync(trashFilePath)) {
        return { error: '回收站文件不存在' };
    }

    const targetFilePath = resolveSessionRestoreTarget(hydratedEntry);
    if (!targetFilePath) {
        return { error: '原始会话路径非法，无法恢复' };
    }
    if (fs.existsSync(targetFilePath)) {
        return { error: '原始会话路径已存在同名文件，请先手动处理冲突' };
    }

    let claudeIndexPath = '';
    try {
        const latestEntries = readSessionTrashEntries({ cleanup: false });
        const latestEntry = latestEntries.find((item) => item && item.trashId === trashId);
        if (!latestEntry) {
            return { error: '回收站记录不存在' };
        }
        const remainingEntries = latestEntries.filter((item) => item.trashId !== trashId);
        moveFileSync(trashFilePath, targetFilePath);
        if (hydratedEntry.source === 'claude') {
            claudeIndexPath = resolveClaudeSessionRestoreIndexPath(hydratedEntry, targetFilePath);
            upsertClaudeSessionIndexEntry(claudeIndexPath, targetFilePath, hydratedEntry);
        }
        writeSessionTrashEntries(remainingEntries);
    } catch (e) {
        let rollbackSucceeded = false;
        if (fs.existsSync(targetFilePath) && !fs.existsSync(trashFilePath)) {
            try {
                moveFileSync(targetFilePath, trashFilePath);
                rollbackSucceeded = true;
            } catch (_) {}
        }
        if (rollbackSucceeded && entry.source === 'claude' && claudeIndexPath && fs.existsSync(claudeIndexPath)) {
            try {
                removeClaudeSessionIndexEntry(claudeIndexPath, targetFilePath, entry.sessionId);
            } catch (_) {}
        }
        return { error: `恢复会话失败: ${e.message}` };
    }

    invalidateSessionListCache();

    return {
        success: true,
        restored: true,
        trashId,
        source: entry.source,
        sessionId: entry.sessionId,
        filePath: targetFilePath
    };
}

async function purgeSessionTrashItems(params = {}) {
    const entries = readSessionTrashEntries();
    if (entries.length === 0) {
        return { success: true, purged: [], count: 0 };
    }

    const all = params.all === true;
    const trashIds = Array.isArray(params.trashIds)
        ? params.trashIds
            .map((item) => (typeof item === 'string' ? item.trim() : ''))
            .filter(Boolean)
        : [];
    const singleTrashId = typeof params.trashId === 'string' ? params.trashId.trim() : '';
    const targetIds = all
        ? new Set(entries.map((item) => item.trashId))
        : new Set(singleTrashId ? [singleTrashId, ...trashIds] : trashIds);

    if (targetIds.size === 0) {
        return { error: '请先选择要彻底删除的回收站记录' };
    }

    const purged = [];
    const remaining = [];
    let purgeError = null;
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!targetIds.has(entry.trashId)) {
            remaining.push(entry);
            continue;
        }
        const trashFilePath = resolveSessionTrashFilePath(entry);
        if (trashFilePath && fs.existsSync(trashFilePath)) {
            try {
                fs.unlinkSync(trashFilePath);
            } catch (e) {
                if (!purgeError) purgeError = e;
                remaining.push(entry);
                continue;
            }
        }
        purged.push({
            trashId: entry.trashId,
            source: entry.source,
            sessionId: entry.sessionId
        });
    }

    try {
        writeSessionTrashEntries(remaining);
    } catch (e) {
        return { error: `回收站索引更新失败: ${e.message}` };
    }

    if (purgeError) {
        return { error: `彻底删除失败: ${purgeError.message}` };
    }

    return {
        success: true,
        purged,
        count: purged.length
    };
}

async function trashSessionData(params = {}) {
    const source = params.source === 'claude' ? 'claude' : (params.source === 'codex' ? 'codex' : '');
    if (!source) {
        return { error: 'Invalid source' };
    }

    const filePath = resolveSessionFilePath(source, getSessionFileArg(params), params.sessionId);
    if (!filePath) {
        return { error: 'Session file not found' };
    }

    const summary = (source === 'claude' ? parseClaudeSessionSummary(filePath) : parseCodexSessionSummary(filePath))
        || buildSessionSummaryFallback(source, filePath, params.sessionId);
    const exactMessageCount = await countConversationMessagesInFile(filePath, source);
    if (Number.isFinite(Number(exactMessageCount))) {
        summary.messageCount = Math.max(0, Math.floor(Number(exactMessageCount)));
    }
    const sessionId = summary.sessionId || params.sessionId || path.basename(filePath, '.jsonl');
    const { trashId, trashFileName, trashFilePath } = allocateSessionTrashTarget();
    const deletedAt = new Date().toISOString();
    const claudeIndexPath = source === 'claude' ? findClaudeSessionIndexPath(filePath) : '';
    let removedClaudeIndexEntry = null;

    try {
        moveFileSync(filePath, trashFilePath);
    } catch (e) {
        return { error: `移入回收站失败: ${e.message}` };
    }

    try {
        if (source === 'claude' && claudeIndexPath) {
            const removal = removeClaudeSessionIndexEntry(claudeIndexPath, filePath, sessionId);
            removedClaudeIndexEntry = removal && removal.entry ? removal.entry : null;
        }
        const entry = buildSessionTrashEntry(summary, {
            trashId,
            trashFileName,
            trashFilePath,
            source,
            sessionId,
            deletedAt,
            originalFilePath: filePath,
            claudeIndexPath,
            claudeIndexEntry: removedClaudeIndexEntry
        });
        const entries = readSessionTrashEntries({ cleanup: false });
        const totalCount = entries.length + 1;
        const nextEntries = [entry, ...entries].slice(0, MAX_SESSION_TRASH_LIST_SIZE);
        writeSessionTrashEntries(nextEntries);
        summary.totalCount = Math.min(totalCount, MAX_SESSION_TRASH_LIST_SIZE);
    } catch (e) {
        let rollbackSucceeded = false;
        if (fs.existsSync(trashFilePath) && !fs.existsSync(filePath)) {
            try {
                moveFileSync(trashFilePath, filePath);
                rollbackSucceeded = true;
            } catch (_) {}
        }
        if (rollbackSucceeded && source === 'claude' && claudeIndexPath && removedClaudeIndexEntry) {
            try {
                upsertClaudeSessionIndexEntry(claudeIndexPath, filePath, {
                    source,
                    sessionId,
                    title: summary.title,
                    messageCount: summary.messageCount,
                    capabilities: summary.capabilities,
                    keywords: summary.keywords,
                    updatedAt: summary.updatedAt,
                    createdAt: summary.createdAt,
                    claudeIndexEntry: removedClaudeIndexEntry,
                    originalFilePath: filePath,
                    trashId,
                    trashFileName
                });
            } catch (_) {}
        }
        if (!rollbackSucceeded && fs.existsSync(trashFilePath)) {
            try { fs.unlinkSync(trashFilePath); } catch (_) {}
        }
        return { error: `移入回收站失败: ${e.message}` };
    }

    invalidateSessionListCache();

    return {
        success: true,
        source,
        sessionId,
        filePath,
        trashed: true,
        trashId,
        deletedAt,
        totalCount: Number.isFinite(Number(summary && summary.totalCount))
            ? Math.max(0, Math.floor(Number(summary.totalCount)))
            : undefined,
        messageCount: Number.isFinite(Number(summary && summary.messageCount))
            ? Math.max(0, Math.floor(Number(summary.messageCount)))
            : 0
    };
}

async function deleteSessionData(params = {}) {
    const source = params.source === 'claude' ? 'claude' : (params.source === 'codex' ? 'codex' : '');
    if (!source) {
        return { error: 'Invalid source' };
    }

    const filePath = resolveSessionFilePath(source, getSessionFileArg(params), params.sessionId);
    if (!filePath) {
        return { error: 'Session file not found' };
    }

    const sessionId = params.sessionId || path.basename(filePath, '.jsonl');
    let fileDeleted = false;
    try {
        fs.unlinkSync(filePath);
        fileDeleted = true;
    } catch (e) {
        return { error: `删除会话失败: ${e.message}` };
    }

    if (source === 'claude') {
        const indexPath = findClaudeSessionIndexPath(filePath);
        if (indexPath) {
            try {
                removeClaudeSessionIndexEntry(indexPath, filePath, sessionId);
            } catch (e) {
                console.warn('删除会话索引失败:', e && e.message ? e.message : e);
                if (!fileDeleted) {
                    return { error: `删除会话失败: ${e.message || e}` };
                }
            }
        }
    }

    invalidateSessionListCache();

    return {
        success: true,
        source,
        sessionId,
        filePath,
        deleted: true
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

    const filePath = resolveSessionFilePath(source, getSessionFileArg(params), params.sessionId);
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

    const filePath = resolveSessionFilePath(source, getSessionFileArg(params), params.sessionId);
    if (!filePath) {
        return { error: 'Session file not found' };
    }

    const rawMaxMessages = Number(params.maxMessages);
    const rawLimit = Number.isFinite(rawMaxMessages) ? rawMaxMessages : Number(params.messageLimit);
    const messageLimit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(rawLimit, MAX_SESSION_DETAIL_MESSAGES))
        : DEFAULT_SESSION_DETAIL_MESSAGES;
    const preview = params.preview === true || params.preview === 'true';

    const extracted = await extractSessionDetailPreviewFromFile(filePath, source, messageLimit, { preview });
    const sessionId = extracted.sessionId || params.sessionId || path.basename(filePath, '.jsonl');
    const sourceLabel = source === 'codex' ? 'Codex' : 'Claude Code';
    const clippedMessages = Array.isArray(extracted.messages) ? extracted.messages : [];
    const hasExactTotalMessages = Number.isFinite(extracted.totalMessages);
    const startIndex = hasExactTotalMessages
        ? Math.max(0, extracted.totalMessages - clippedMessages.length)
        : 0;
    const indexedMessages = clippedMessages.map((message, messageIndex) => {
        const normalizedMessage = {
            ...message,
            messageIndex: startIndex + messageIndex
        };
        if (preview && typeof normalizedMessage.text === 'string') {
            normalizedMessage.text = truncateText(normalizedMessage.text, SESSION_PREVIEW_MESSAGE_TEXT_MAX_LENGTH);
        }
        return normalizedMessage;
    });

    return {
        source,
        sourceLabel,
        sessionId,
        cwd: extracted.cwd || '',
        updatedAt: extracted.updatedAt || '',
        totalMessages: hasExactTotalMessages ? extracted.totalMessages : null,
        clipped: typeof extracted.clipped === 'boolean'
            ? extracted.clipped
            : (hasExactTotalMessages ? extracted.totalMessages > indexedMessages.length : false),
        messageLimit,
        messages: indexedMessages,
        filePath
    };
}

async function readSessionPlain(params = {}) {
    const source = params.source === 'claude' ? 'claude' : (params.source === 'codex' ? 'codex' : '');
    if (!source) {
        return { error: 'Invalid source' };
    }

    const filePath = resolveSessionFilePath(source, getSessionFileArg(params), params.sessionId);
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
    const filePath = resolveSessionFilePath(source, getSessionFileArg(params), params.sessionId);
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
        if (isBuiltinManagedProvider(name)) {
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
        ? provider.preferred_auth_method.trim()
        : '';
    const currentModels = readCurrentModels();
    const savedModel = currentModels && typeof currentModels[name] === 'string'
        ? currentModels[name].trim()
        : '';
    const activeProvider = typeof config.model_provider === 'string' ? config.model_provider.trim() : '';
    const activeModel = typeof config.model === 'string' ? config.model.trim() : '';
    const model = savedModel || (activeProvider === name ? activeModel : '');

    if (!baseUrl) {
        return { error: `提供商 ${name} 缺少 base_url` };
    }

    return {
        payload: {
            name,
            baseUrl,
            apiKey,
            model
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
        if (isBuiltinManagedProvider(name)) {
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
            if (isBuiltinManagedProvider(name)) continue;
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
        const currentModel = typeof config.model === 'string' ? config.model.trim() : '';
        const probeSpec = buildModelProbeSpec(provider, currentModel, provider.base_url);
        if (probeSpec && probeSpec.url) {
            return {
                method: 'POST',
                url: probeSpec.url,
                body: probeSpec.body,
                apiKey: provider.preferred_auth_method || ''
            };
        }
        return {
            method: 'GET',
            url: provider.base_url,
            apiKey: provider.preferred_auth_method || ''
        };
    }

    if (params.url) {
        return {
            method: 'GET',
            url: params.url,
            apiKey: typeof params.apiKey === 'string' ? params.apiKey : ''
        };
    }

    return { error: 'Missing name or url' };
}

function extractApiPayloadErrorMessage(payload) {
    if (!payload || typeof payload !== 'object') {
        return '';
    }
    if (typeof payload.error === 'string' && payload.error.trim()) {
        return payload.error.trim();
    }
    if (!payload.error || typeof payload.error !== 'object') {
        return '';
    }
    if (typeof payload.error.message === 'string' && payload.error.message.trim()) {
        return payload.error.message.trim();
    }
    if (typeof payload.error.code === 'string' && payload.error.code.trim()) {
        return payload.error.code.trim();
    }
    return '';
}

function resolveProviderChatTarget(params) {
    const providerName = typeof (params && params.name) === 'string' ? params.name.trim() : '';
    const prompt = typeof (params && params.prompt) === 'string' ? params.prompt.trim() : '';
    if (!providerName) {
        return { error: 'Provider name is required' };
    }
    if (!prompt) {
        return { error: 'Prompt is required' };
    }

    const { config } = readConfigOrVirtualDefault();
    const providers = config.model_providers || {};
    const provider = providers[providerName];
    if (!provider || typeof provider !== 'object') {
        return { error: `Provider not found: ${providerName}` };
    }

    const baseUrl = typeof provider.base_url === 'string' ? provider.base_url.trim() : '';
    if (!baseUrl) {
        return { error: `Provider ${providerName} missing URL` };
    }

    const currentModels = readCurrentModels();
    const savedModel = currentModels && typeof currentModels[providerName] === 'string'
        ? currentModels[providerName].trim()
        : '';
    const activeProvider = typeof config.model_provider === 'string' ? config.model_provider.trim() : '';
    const activeModel = typeof config.model === 'string' ? config.model.trim() : '';
    const model = savedModel || (activeProvider === providerName ? activeModel : '');
    if (!model) {
        return { error: `Provider ${providerName} missing current model` };
    }

    const specs = buildModelConversationSpecs(provider, model, baseUrl, prompt, {
        maxOutputTokens: 256
    });
    if (!specs.length) {
        return { error: `Provider ${providerName} missing available conversation endpoint` };
    }

    return {
        providerName,
        provider,
        model,
        prompt,
        specs,
        apiKey: typeof provider.preferred_auth_method === 'string'
            ? provider.preferred_auth_method.trim()
            : ''
    };
}

async function runProviderChatCheck(params = {}) {
    const target = resolveProviderChatTarget(params);
    if (target.error) {
        return { ok: false, error: target.error };
    }

    const timeoutMs = Number.isFinite(params.timeoutMs)
        ? Math.max(1000, Number(params.timeoutMs))
        : 30000;
    let finalSpec = target.specs[0];
    let result = null;

    for (let index = 0; index < target.specs.length; index += 1) {
        const candidate = target.specs[index];
        const probeResult = await probeJsonPost(candidate.url, candidate.body, {
            apiKey: target.apiKey,
            timeoutMs,
            maxBytes: 512 * 1024
        });
        finalSpec = candidate;
        result = probeResult;
        const shouldTryNextCandidate = index < target.specs.length - 1
            && (!probeResult.ok || probeResult.status === 404);
        if (!shouldTryNextCandidate) {
            break;
        }
    }

    if (!result || !result.ok) {
        return {
            ok: false,
            provider: target.providerName,
            model: target.model,
            url: finalSpec.url,
            status: Number.isFinite(result && result.status) ? result.status : 0,
            durationMs: Number.isFinite(result && result.durationMs) ? result.durationMs : 0,
            reply: '',
            rawPreview: '',
            error: result && result.error ? result.error : 'request failed'
        };
    }

    let payload = null;
    try {
        payload = result.body ? JSON.parse(result.body) : null;
    } catch (e) {
        payload = null;
    }

    const payloadError = extractApiPayloadErrorMessage(payload);
    if (result.status >= 400 || payloadError) {
        return {
            ok: false,
            provider: target.providerName,
            model: target.model,
            url: finalSpec.url,
            status: Number.isFinite(result.status) ? result.status : 0,
            durationMs: Number.isFinite(result.durationMs) ? result.durationMs : 0,
            reply: '',
            rawPreview: result.body ? truncateText(result.body, 600) : '',
            error: payloadError || `HTTP ${result.status}`
        };
    }

    const reply = extractModelResponseText(payload);
    return {
        ok: true,
        provider: target.providerName,
        model: target.model,
        url: finalSpec.url,
        status: Number.isFinite(result.status) ? result.status : 0,
        durationMs: Number.isFinite(result.durationMs) ? result.durationMs : 0,
        reply,
        rawPreview: reply ? '' : (result.body ? truncateText(result.body, 600) : ''),
        error: ''
    };
}

function runSpeedTest(targetUrl, apiKey, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs)
        ? Math.max(1000, Number(options.timeoutMs))
        : SPEED_TEST_TIMEOUT_MS;
    const method = typeof options.method === 'string' ? options.method.toUpperCase() : 'GET';
    if (method === 'POST') {
        return probeJsonPost(targetUrl, options.body || {}, {
            apiKey,
            timeoutMs,
            maxBytes: 256 * 1024
        }).then((result) => ({
            ok: !!result.ok,
            status: Number.isFinite(result.status) ? result.status : 0,
            durationMs: Number.isFinite(result.durationMs) ? result.durationMs : 0,
            error: result.ok ? '' : (result.error || '')
        }));
    }
    return probeUrl(targetUrl, {
        apiKey,
        timeoutMs,
        maxBytes: 256 * 1024
    }).then((result) => ({
        ok: !!result.ok,
        status: Number.isFinite(result.status) ? result.status : 0,
        durationMs: Number.isFinite(result.durationMs) ? result.durationMs : 0,
        error: result.ok ? '' : (result.error || '')
    }));
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
        const currentProvider = typeof config.model_provider === 'string' ? config.model_provider.trim() : '';
        const defaultProvider = currentProvider || providerNames[0] || '';
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
    const configResult = readConfigOrVirtualDefault();
    if (hasConfigLoadError(configResult)) {
        printConfigLoadErrorAndMarkExit(configResult);
        return;
    }
    const { config, isVirtual } = configResult;
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
    const configResult = readConfigOrVirtualDefault();
    if (hasConfigLoadError(configResult)) {
        printConfigLoadErrorAndMarkExit(configResult);
        return;
    }
    const { config, isVirtual } = configResult;
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
    const config = sanitizeRemovedBuiltinProxyProvider(readConfig());
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
    const providerBaseUrl = normalizeBaseUrl(baseUrl);

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
        if (!silent) console.error('错误: 提供商名称不可用');
        throw new Error('提供商名称不可用');
    }
    if (isBuiltinProxyProvider(providerName)) {
        if (!silent) console.error('错误: codexmate-proxy 为保留名称，不可手动添加');
        throw new Error('codexmate-proxy 为保留名称，不可手动添加');
    }
    if (!isValidHttpUrl(providerBaseUrl)) {
        if (!silent) console.error('错误: URL 仅支持 http/https');
        throw new Error('URL 仅支持 http/https');
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
    const normalizedBaseUrl = baseUrl === undefined ? undefined : normalizeBaseUrl(baseUrl);
    if (!name) {
        if (!silent) console.error('错误: 提供商名称必填');
        throw new Error('提供商名称必填');
    }
    if (isNonEditableProvider(name) && !allowManaged) {
        const msg = 'codexmate-proxy 为保留名称，不可编辑';
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
    if (normalizedBaseUrl !== undefined && !isValidHttpUrl(normalizedBaseUrl)) {
        if (!silent) console.error('错误: URL 仅支持 http/https');
        throw new Error('URL 仅支持 http/https');
    }

    const replaceTomlStringField = (block, fieldName, rawValue) => {
        const safeValue = escapeTomlBasicString(rawValue);
        const escapedFieldName = escapeRegex(fieldName);
        const multilineRanges = collectTomlMultilineStringRanges(block);
        const tripleStartRegex = new RegExp(`^(\\s*${escapedFieldName}\\s*=\\s*)(\"\"\"|''')`, 'mg');
        let tripleStartMatch = null;
        let tripleCandidate;
        while ((tripleCandidate = tripleStartRegex.exec(block)) !== null) {
            if (isIndexInRanges(tripleCandidate.index, multilineRanges)) {
                continue;
            }
            tripleStartMatch = tripleCandidate;
            break;
        }
        if (tripleStartMatch) {
            const prefixStart = tripleStartMatch.index;
            const prefixEnd = prefixStart + tripleStartMatch[1].length;
            const tripleQuote = tripleStartMatch[2];
            const valueStart = prefixEnd + tripleQuote.length;
            const quoteChar = tripleQuote[0];
            let valueEnd = -1;
            let closingRunLength = 0;
            for (let i = valueStart; i < block.length; i++) {
                if (block[i] !== quoteChar) continue;
                let runEnd = i + 1;
                while (runEnd < block.length && block[runEnd] === quoteChar) {
                    runEnd++;
                }
                const runLength = runEnd - i;
                if (runLength < tripleQuote.length) {
                    i = runEnd - 1;
                    continue;
                }
                if (tripleQuote === '"""') {
                    let slashCount = 0;
                    for (let j = i - 1; j >= valueStart && block[j] === '\\'; j--) {
                        slashCount++;
                    }
                    if (slashCount % 2 !== 0) {
                        continue;
                    }
                }
                valueEnd = i;
                closingRunLength = runLength;
                break;
            }
            if (valueEnd === -1) {
                throw new Error(`${fieldName} 使用了未闭合的多行 TOML 字符串，无法安全更新`);
            }
            const lineEndIndex = block.indexOf('\n', valueEnd + closingRunLength);
            let tailEnd = lineEndIndex === -1 ? block.length : lineEndIndex;
            if (lineEndIndex > 0 && block[lineEndIndex - 1] === '\r') {
                tailEnd = lineEndIndex - 1;
            }
            const tail = block.slice(valueEnd + closingRunLength, tailEnd);
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
            'mg'
        );
        let replaced = false;
        let next = block.replace(
            withCommentRegex,
            (full, prefix, suffix = '', offset) => {
                if (replaced || isIndexInRanges(offset, multilineRanges)) {
                    return full;
                }
                replaced = true;
                return `${prefix}"${safeValue}"${suffix}`;
            }
        );
        if (!replaced) {
            const fallbackRegex = new RegExp(`^(\\s*${escapedFieldName}\\s*=\\s*)(.*?)(\\s+#.*)?$`, 'mg');
            let fallbackReplaced = false;
            const multilineRangesForNext = collectTomlMultilineStringRanges(next);
            let fallbackMatch;
            let fallbackCandidate;
            while ((fallbackCandidate = fallbackRegex.exec(next)) !== null) {
                if (isIndexInRanges(fallbackCandidate.index, multilineRangesForNext)) {
                    continue;
                }
                fallbackMatch = fallbackCandidate;
                break;
            }
            if (fallbackMatch) {
                const existingValue = String(fallbackMatch[2] || '').trim();
                const looksLikeMultilineArray = existingValue.startsWith('[') && !existingValue.endsWith(']');
                const looksLikeMultilineInlineTable = existingValue.startsWith('{') && !existingValue.endsWith('}');
                if (looksLikeMultilineArray || looksLikeMultilineInlineTable) {
                    throw new Error(`${fieldName} 当前值是多行 TOML 结构，无法安全更新`);
                }
                const prefix = fallbackMatch[1];
                const suffix = fallbackMatch[3] || '';
                const replacement = `${prefix}"${safeValue}"${suffix}`;
                next = `${next.slice(0, fallbackMatch.index)}${replacement}${next.slice(fallbackMatch.index + fallbackMatch[0].length)}`;
                fallbackReplaced = true;
            }
            if (!fallbackReplaced) {
                const keyIndentMatch = block.match(/^(\s*)[A-Za-z0-9_.-]+\s*=/m);
                const indent = keyIndentMatch ? keyIndentMatch[1] : '';
                const lineEnding = block.includes('\r\n') ? '\r\n' : '\n';
                const tailMatch = block.match(/(\s*)$/);
                const tail = tailMatch ? tailMatch[1] : '';
                const body = block.slice(0, block.length - tail.length);
                const separator = body.endsWith('\n') || body.endsWith('\r') ? '' : lineEnding;
                next = `${body}${separator}${indent}${fieldName} = "${safeValue}"${tail}`;
            }
        }
        return next;
    };

    let newContent = content;
    const sorted = ranges.sort((a, b) => b.start - a.start);
    for (const range of sorted) {
        const providerBlock = newContent.slice(range.start, range.end);
        let updatedBlock = providerBlock;
        if (normalizedBaseUrl) {
            updatedBlock = replaceTomlStringField(updatedBlock, 'base_url', normalizedBaseUrl);
        }
        if (apiKey !== undefined) {
            updatedBlock = replaceTomlStringField(updatedBlock, 'preferred_auth_method', apiKey);
        }
        newContent = newContent.slice(0, range.start) + updatedBlock + newContent.slice(range.end);
    }

    const finalContent = newContent.trim();
    try {
        toml.parse(finalContent);
    } catch (e) {
        throw new Error(`更新后的 config.toml 无效: ${e.message}`);
    }
    writeConfig(finalContent);

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
        authToken: typeof env.ANTHROPIC_AUTH_TOKEN === 'string' ? env.ANTHROPIC_AUTH_TOKEN : '',
        useKey: typeof env.CLAUDE_CODE_USE_KEY === 'string' ? env.CLAUDE_CODE_USE_KEY : '',
        baseUrl: typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL : '',
        model: typeof env.ANTHROPIC_MODEL === 'string' ? env.ANTHROPIC_MODEL : '',
        env
    };
}

function registerDownloadArtifact(filePath, options = {}) {
    const token = crypto.randomBytes(16).toString('hex');
    const fileName = typeof options.fileName === 'string' && options.fileName.trim()
        ? options.fileName.trim()
        : path.basename(filePath || '');
    const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0
        ? Math.floor(options.ttlMs)
        : DOWNLOAD_ARTIFACT_TTL_MS;
    const expiresAt = Date.now() + ttlMs;
    const deleteAfterDownload = options.deleteAfterDownload !== false;

    g_downloadArtifacts.set(token, {
        filePath,
        fileName,
        deleteAfterDownload,
        expiresAt
    });

    setTimeout(() => {
        const artifact = g_downloadArtifacts.get(token);
        if (!artifact) return;
        if (Date.now() < artifact.expiresAt) return;
        g_downloadArtifacts.delete(token);
        if (artifact.deleteAfterDownload && artifact.filePath && fs.existsSync(artifact.filePath)) {
            try {
                fs.unlinkSync(artifact.filePath);
            } catch (_) {}
        }
    }, ttlMs + 2000);

    return {
        token,
        fileName,
        downloadPath: `/download/${encodeURIComponent(token)}`
    };
}

function resolveDownloadArtifact(tokenOrFileName, options = {}) {
    if (!tokenOrFileName) return null;
    const token = typeof tokenOrFileName === 'string' ? tokenOrFileName.trim() : '';
    if (!token) return null;

    const artifact = g_downloadArtifacts.get(token);
    if (!artifact) {
        return null;
    }
    if (Date.now() > artifact.expiresAt) {
        g_downloadArtifacts.delete(token);
        if (artifact.deleteAfterDownload && artifact.filePath && fs.existsSync(artifact.filePath)) {
            try {
                fs.unlinkSync(artifact.filePath);
            } catch (_) {}
        }
        return null;
    }
    if (options && options.consume === true) {
        g_downloadArtifacts.delete(token);
    }
    return {
        token,
        ...artifact
    };
}

// API: 打包 Claude 配置目录（系统 zip 可用则使用，否则回退 zip-lib）
async function prepareClaudeDirDownload() {
    return await prepareDirectoryDownload(CLAUDE_DIR, {
        missingMessage: 'Claude 配置目录不存在',
        fileNamePrefix: 'claude-config'
    });
}

// API: 打包 Codex 配置目录（同策略）
async function prepareCodexDirDownload() {
    return await prepareDirectoryDownload(CONFIG_DIR, {
        missingMessage: 'Codex 配置目录不存在',
        fileNamePrefix: CODEX_BACKUP_NAME
    });
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

function resolveSpawnCommand(command) {
    if (!command) return '';
    if (process.platform === 'win32') {
        return command;
    }
    return resolveCommandPath(command) || command;
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
    const options = { host: '', noBrowser: false };
    if (!Array.isArray(args)) {
        return options;
    }

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;
        if (arg === '--no-browser') {
            options.noBrowser = true;
            continue;
        }
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

// #region watchPathsForRestart
function watchPathsForRestart(targets, onChange) {
    const debounceMs = 300;
    let timer = null;
    const watcherEntries = new Map();
    const getPathApi = (targetPath) => {
        const value = typeof targetPath === 'string' ? targetPath.trim() : '';
        return value.includes('/') && !value.includes('\\') && path.posix ? path.posix : path;
    };
    const getPathSeparator = (targetPath) => {
        const pathApi = getPathApi(targetPath);
        return pathApi.sep || (pathApi === path.posix ? '/' : path.sep);
    };

    const trigger = (info) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            onChange(info);
        }, debounceMs);
    };

    const closeWatcher = (watchKey) => {
        const entry = watcherEntries.get(watchKey);
        if (!entry) return;
        watcherEntries.delete(watchKey);
        try {
            entry.watcher.close();
        } catch (_) {}
    };

    const listDirectoryTree = (rootDir) => {
        const queue = [rootDir];
        const directories = [];
        const seen = new Set();
        const pathApi = getPathApi(rootDir);
        while (queue.length) {
            const current = queue.shift();
            if (!current || seen.has(current) || !fs.existsSync(current)) {
                continue;
            }
            seen.add(current);
            let stat = null;
            try {
                stat = fs.statSync(current);
            } catch (_) {
                continue;
            }
            if (!stat || !stat.isDirectory()) {
                continue;
            }
            directories.push(current);
            let entries = [];
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch (_) {
                continue;
            }
            for (const entry of entries) {
                if (entry && typeof entry.isDirectory === 'function' && entry.isDirectory()) {
                    queue.push(pathApi.join(current, entry.name));
                }
            }
        }
        return directories;
    };

    const isSameOrNestedPath = (candidate, rootDir) => {
        const separator = getPathSeparator(rootDir);
        return candidate === rootDir || candidate.startsWith(`${rootDir}${separator}`);
    };

    const addWatcher = (target, recursive, isDirectory = false) => {
        if (!fs.existsSync(target)) return;
        const watchKey = `${recursive ? 'recursive' : 'plain'}:${target}`;
        if (watcherEntries.has(watchKey)) {
            return true;
        }
        try {
            const pathApi = getPathApi(target);
            const basename = isDirectory ? '' : pathApi.basename(target);
            const watchTarget = isDirectory ? target : pathApi.dirname(target);
            const watcher = fs.watch(watchTarget, { recursive }, (eventType, filename) => {
                if (isDirectory && !recursive && eventType === 'rename') {
                    syncDirectoryTree(target);
                }
                if (!filename) return;
                let normalizedFilename = String(filename).replace(/\\/g, '/');
                if (!isDirectory) {
                    const fileNameOnly = normalizedFilename.split('/').pop();
                    if (fileNameOnly !== basename) {
                        return;
                    }
                    normalizedFilename = basename;
                }
                const lower = normalizedFilename.toLowerCase();
                if (!(/\.(html|js|mjs|cjs|css)$/.test(lower))) return;
                trigger({ target, eventType, filename: normalizedFilename });
            });
            watcher.on('error', () => {
                closeWatcher(watchKey);
                if (isDirectory && recursive && !fs.existsSync(target)) {
                    syncDirectoryTree(target);
                    addMissingDirectoryWatcher(target);
                    return;
                }
                if (isDirectory && !recursive) {
                    syncDirectoryTree(target);
                } else if (fs.existsSync(target)) {
                    addWatcher(target, recursive, isDirectory);
                }
            });
            watcherEntries.set(watchKey, {
                watcher,
                target,
                recursive,
                isDirectory
            });
            return true;
        } catch (e) {
            return false;
        }
    };

    const addMissingDirectoryWatcher = (target) => {
        const pathApi = getPathApi(target);
        const parentDir = pathApi.dirname(target);
        if (!parentDir || parentDir === target || !fs.existsSync(parentDir)) {
            return false;
        }
        const watchKey = `missing-dir:${target}`;
        if (watcherEntries.has(watchKey)) {
            return true;
        }
        const basename = path.basename(target);
        try {
            const watcher = fs.watch(parentDir, { recursive: false }, (_eventType, filename) => {
                if (!filename) return;
                const fileNameOnly = String(filename).replace(/\\/g, '/').split('/').pop();
                if (fileNameOnly !== basename) {
                    return;
                }
                if (!fs.existsSync(target)) {
                    syncDirectoryTree(target);
                    return;
                }
                closeWatcher(watchKey);
                const ok = addWatcher(target, true, true);
                if (!ok) {
                    syncDirectoryTree(target);
                }
            });
            watcher.on('error', () => {
                closeWatcher(watchKey);
                if (fs.existsSync(parentDir) && !fs.existsSync(target)) {
                    addMissingDirectoryWatcher(target);
                }
            });
            watcherEntries.set(watchKey, {
                watcher,
                target: parentDir,
                recursive: false,
                isDirectory: false
            });
            return true;
        } catch (_) {
            return false;
        }
    };

    const syncDirectoryTree = (rootDir) => {
        const directories = listDirectoryTree(rootDir);
        const existingDirectorySet = new Set(directories);
        for (const [watchKey, entry] of Array.from(watcherEntries.entries())) {
            if (!entry.isDirectory || entry.recursive) {
                continue;
            }
            if (!isSameOrNestedPath(entry.target, rootDir)) {
                continue;
            }
            if (!existingDirectorySet.has(entry.target)) {
                closeWatcher(watchKey);
            }
        }
        for (const directory of directories) {
            addWatcher(directory, false, true);
        }
    };

    for (const target of targets) {
        if (!fs.existsSync(target)) continue;
        let stat = null;
        try {
            stat = fs.statSync(target);
        } catch (_) {
            continue;
        }
        if (stat && stat.isDirectory()) {
            const ok = addWatcher(target, true, true);
            if (!ok) {
                syncDirectoryTree(target);
            }
            continue;
        }
        const ok = addWatcher(target, true, false);
        if (!ok) {
            addWatcher(target, false, false);
        }
    }

    return () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        for (const watchKey of Array.from(watcherEntries.keys())) {
            closeWatcher(watchKey);
        }
    };
}
// #endregion watchPathsForRestart

function writeJsonResponse(res, statusCode, payload) {
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body, 'utf-8')
    });
    res.end(body, 'utf-8');
}

function streamZipDownloadResponse(res, filePath, options = {}) {
    if (!filePath || !fs.existsSync(filePath)) {
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
    const downloadName = typeof options.fileName === 'string' && options.fileName.trim()
        ? options.fileName.trim()
        : path.basename(filePath);
    const deleteAfterDownload = !!options.deleteAfterDownload;
    const onAfterComplete = typeof options.onAfterComplete === 'function'
        ? options.onAfterComplete
        : null;
    res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${path.basename(downloadName)}"`,
        'Content-Length': stat.size
    });

    const stream = fs.createReadStream(filePath);
    let finished = false;
    const finalize = () => {
        if (finished) return;
        finished = true;
        if (deleteAfterDownload && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (_) {}
        }
        if (onAfterComplete) {
            try {
                onAfterComplete();
            } catch (_) {}
        }
    };
    stream.on('error', () => {
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Download Error');
        } else {
            try {
                res.destroy();
            } catch (_) {}
        }
        finalize();
    });
    res.on('finish', finalize);
    res.on('close', finalize);
    stream.pipe(res);
}

function resolveUploadFileNameFromRequest(req, fallbackName = 'codex-skills.zip') {
    const rawHeader = req.headers['x-codexmate-file-name'];
    const source = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const fallback = typeof fallbackName === 'string' && fallbackName.trim()
        ? fallbackName.trim()
        : 'codex-skills.zip';
    if (!source || typeof source !== 'string') {
        return fallback;
    }
    const decoded = (() => {
        try {
            return decodeURIComponent(source);
        } catch (_) {
            return source;
        }
    })();
    const normalized = path.basename(decoded.trim());
    return normalized || fallback;
}

function resolveSkillTargetAppFromRequest(req, fallbackApp = 'codex') {
    const fallbackTarget = resolveSkillTarget({}, fallbackApp);
    const fallback = fallbackTarget ? fallbackTarget.app : 'codex';
    try {
        const parsed = new URL(req.url || '/', 'http://localhost');
        const hasTargetApp = parsed.searchParams.has('targetApp');
        const hasTarget = parsed.searchParams.has('target');
        if (hasTargetApp || hasTarget) {
            const target = resolveSkillTarget({
                ...(hasTargetApp ? { targetApp: parsed.searchParams.get('targetApp') } : {}),
                ...(hasTarget ? { target: parsed.searchParams.get('target') } : {})
            }, fallback);
            return target ? target.app : null;
        }
        return fallback;
    } catch (_) {
        return fallback;
    }
}

async function handleImportSkillsZipUpload(req, res, options = {}) {
    if (req.method !== 'POST') {
        if (req && typeof req.resume === 'function') {
            req.resume();
        }
        writeJsonResponse(res, 405, { error: 'Method Not Allowed' });
        return;
    }
    try {
        const forcedTargetApp = normalizeSkillTargetApp(options && options.targetApp ? options.targetApp : '');
        const targetApp = forcedTargetApp || resolveSkillTargetAppFromRequest(req, 'codex');
        if (!targetApp) {
            if (req && typeof req.resume === 'function') {
                req.resume();
            }
            writeJsonResponse(res, 400, { error: '目标宿主不支持' });
            return;
        }
        const fileName = resolveUploadFileNameFromRequest(req, `${targetApp}-skills.zip`);
        const upload = await writeUploadZipStream(
            req,
            'codex-skills-import',
            fileName,
            MAX_SKILLS_ZIP_UPLOAD_SIZE
        );
        const result = await importSkillsFromZipFile(upload.zipPath, {
            tempDir: upload.tempDir,
            fallbackName: fileName,
            targetApp
        });
        writeJsonResponse(res, 200, result || {});
    } catch (e) {
        const message = e && e.message ? e.message : '上传失败';
        writeJsonResponse(res, 400, { error: message });
    }
}

const PUBLIC_WEB_UI_DYNAMIC_ASSETS = new Map([
    ['app.js', {
        mime: 'application/javascript; charset=utf-8',
        reader: readExecutableBundledWebUiScript
    }],
    ['index.html', {
        mime: 'text/html; charset=utf-8',
        reader: readBundledWebUiHtml
    }],
    ['logic.mjs', {
        mime: 'application/javascript; charset=utf-8',
        reader: readExecutableBundledJavaScriptModule
    }],
    ['styles.css', {
        mime: 'text/css; charset=utf-8',
        reader: readBundledWebUiCss
    }]
]);

const PUBLIC_WEB_UI_STATIC_ASSETS = new Set([
    'modules/config-mode.computed.mjs',
    'modules/skills.computed.mjs',
    'modules/skills.methods.mjs',
    'session-helpers.mjs'
]);

function createWebServer({ htmlPath, assetsDir, webDir, host, port, openBrowser }) {
    const connections = new Set();
    const probeWebUiReadiness = (callback) => {
        const payload = JSON.stringify({ action: 'health-check', params: {} });
        const requestOptions = {
            hostname: openHost,
            port,
            path: '/api',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(payload, 'utf-8')
            }
        };
        let settled = false;
        const finish = (ready) => {
            if (settled) return;
            settled = true;
            callback(ready);
        };
        const req = http.request(requestOptions, (probeRes) => {
            if (typeof probeRes.resume === 'function') {
                probeRes.resume();
            }
            probeRes.on('end', () => {
                finish(probeRes.statusCode === 200);
            });
        });
        req.on('error', () => finish(false));
        req.setTimeout(1000, () => {
            try { req.destroy(); } catch (_) {}
            finish(false);
        });
        req.end(payload, 'utf-8');
    };
    const openBrowserAfterReady = (url) => {
        const maxAttempts = 40;
        const retryDelayMs = 150;
        let finished = false;

        const finish = (ready) => {
            if (finished) return;
            finished = true;
            if (!ready) {
                console.warn('! Web UI 就绪探测超时，未自动打开浏览器，请手动访问:', url);
                return;
            }

            const platform = process.platform;
            const commandSpec = platform === 'win32'
                ? { command: 'cmd', args: ['/c', 'start', '', url] }
                : (platform === 'darwin'
                    ? { command: 'open', args: [url] }
                    : { command: 'xdg-open', args: [url] });

            try {
                const child = spawn(commandSpec.command, commandSpec.args, {
                    stdio: 'ignore',
                    detached: true,
                    windowsHide: true
                });
                child.on('error', () => {
                    console.warn('无法自动打开浏览器，请手动访问:', url);
                });
                if (typeof child.unref === 'function') {
                    child.unref();
                }
            } catch (_) {
                console.warn('无法自动打开浏览器，请手动访问:', url);
            }
        };
        const scheduleProbe = (attempt) => {
            probeWebUiReadiness((ready) => {
                if (ready) {
                    finish(true);
                    return;
                }
                if (attempt >= maxAttempts) {
                    finish(false);
                    return;
                }
                setTimeout(() => scheduleProbe(attempt + 1), retryDelayMs);
            });
        };

        scheduleProbe(1);
    };
    const writeWebUiAssetError = (res, requestPath, error) => {
        const message = error && error.message ? error.message : String(error);
        console.error(`! Web UI 资源读取失败 [${requestPath}]:`, message);
        if (res.headersSent) {
            try {
                res.destroy(error);
            } catch (_) {}
            return;
        }
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
    };

    const server = http.createServer((req, res) => {
        const requestPath = (req.url || '/').split('?')[0];
        if (requestPath === '/api/import-skills-zip') {
            void handleImportSkillsZipUpload(req, res);
            return;
        }
        if (requestPath === '/api/import-codex-skills-zip') {
            void handleImportSkillsZipUpload(req, res, { targetApp: 'codex' });
            return;
        }
        if (requestPath === '/api') {
            let body = '';
            let bodySize = 0;
            let bodyTooLarge = false;
            req.on('data', chunk => {
                if (bodyTooLarge) return;
                bodySize += chunk.length;
                if (bodySize > MAX_API_BODY_SIZE) {
                    bodyTooLarge = true;
                    writeJsonResponse(res, 413, {
                        error: `请求体过大（>${Math.floor(MAX_API_BODY_SIZE / 1024 / 1024)}MB）`
                    });
                    req.destroy();
                    return;
                }
                body += chunk;
            });
            req.on('end', async () => {
                if (bodyTooLarge) return;
                try {
                    const { action, params } = JSON.parse(body);
                    let result;

                    switch (action) {
                        case 'health-check':
                            result = { ok: true };
                            break;
                        case 'status': {
                            const statusConfigResult = readConfigOrVirtualDefault();
                            const config = statusConfigResult.config;
                            const serviceTier = typeof config.service_tier === 'string' ? config.service_tier.trim() : '';
                            const modelReasoningEffort = typeof config.model_reasoning_effort === 'string' ? config.model_reasoning_effort.trim() : '';
                            const budgetReadOptions = {
                                useDefaultsWhenMissing: !hasConfigLoadError(statusConfigResult)
                            };
                            const modelContextWindow = readPositiveIntegerConfigValue(
                                config,
                                'model_context_window',
                                budgetReadOptions
                            );
                            const modelAutoCompactTokenLimit = readPositiveIntegerConfigValue(
                                config,
                                'model_auto_compact_token_limit',
                                budgetReadOptions
                            );
                            result = {
                                provider: config.model_provider || '未设置',
                                model: config.model || '未设置',
                                serviceTier,
                                modelReasoningEffort,
                                modelContextWindow,
                                modelAutoCompactTokenLimit,
                                configReady: !statusConfigResult.isVirtual,
                                configErrorType: statusConfigResult.errorType || '',
                                configNotice: statusConfigResult.reason || '',
                                initNotice: consumeInitNotice()
                            };
                            break;
                        }
                        case 'install-status':
                            result = buildInstallStatusReport();
                            break;
                        case 'list':
                            result = buildMcpProviderListPayload();
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
                        case 'preview-agents-diff':
                            result = buildAgentsDiff(params || {});
                            break;
                        case 'list-skills':
                            result = listSkills(params || {});
                            break;
                        case 'delete-skills':
                            result = deleteSkills(params || {});
                            break;
                        case 'scan-unmanaged-skills':
                            result = scanUnmanagedSkills(params || {});
                            break;
                        case 'import-skills':
                            result = importSkills(params || {});
                            break;
                        case 'export-skills':
                            result = await exportSkills(params || {});
                            break;
                        case 'list-codex-skills':
                            result = listCodexSkills();
                            break;
                        case 'delete-codex-skills':
                            result = deleteCodexSkills(params || {});
                            break;
                        case 'scan-unmanaged-codex-skills':
                            result = scanUnmanagedCodexSkills();
                            break;
                        case 'import-codex-skills':
                            result = importCodexSkills(params || {});
                            break;
                        case 'export-codex-skills':
                            result = await exportCodexSkills(params || {});
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
                            result = await runSpeedTest(target.url, target.apiKey, target);
                            break;
                        }
                        case 'provider-chat-check': {
                            result = await runProviderChatCheck(params || {});
                            break;
                        }
                        case 'list-sessions':
                            {
                                const source = typeof params.source === 'string' ? params.source.trim().toLowerCase() : '';
                                if (source && source !== 'codex' && source !== 'claude' && source !== 'all') {
                                    result = { error: 'Invalid source. Must be codex, claude, or all' };
                                } else {
                                    result = {
                                        sessions: await listSessionBrowse(params),
                                        source: source || 'all'
                                    };
                                }
                            }
                            break;
                        case 'list-sessions-usage':
                            {
                                const usageParams = isPlainObject(params) ? params : {};
                                const source = typeof usageParams.source === 'string' ? usageParams.source.trim().toLowerCase() : '';
                                if (source && source !== 'codex' && source !== 'claude' && source !== 'all') {
                                    result = { error: 'Invalid source. Must be codex, claude, or all' };
                                } else {
                                    result = {
                                        sessions: await listSessionUsage({
                                            ...usageParams,
                                            source: source || 'all'
                                        }),
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
                        case 'list-session-trash':
                            result = await listSessionTrashItems(params || {});
                            break;
                        case 'restore-session-trash':
                            result = await restoreSessionTrashItem(params || {});
                            break;
                        case 'purge-session-trash':
                            result = await purgeSessionTrashItems(params || {});
                            break;
                        case 'trash-session':
                            result = await trashSessionData(params || {});
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
                        case 'claude-proxy-status':
                            result = getBuiltinClaudeProxyStatus();
                            break;
                        case 'claude-proxy-start':
                            result = await startBuiltinClaudeProxyRuntime(params || {});
                            break;
                        case 'claude-proxy-stop':
                            result = await stopBuiltinClaudeProxyRuntime();
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
                        case 'task-overview':
                            result = buildTaskOverviewPayload(params || {});
                            break;
                        case 'task-plan':
                            {
                                const plan = coerceTaskPlanPayload(params || {});
                                const validation = validatePreparedTaskPlan(plan);
                                result = {
                                    ok: validation.ok,
                                    plan,
                                    issues: validation.issues || [],
                                    warnings: validation.warnings || []
                                };
                                if (!validation.ok) {
                                    result.error = validation.error || 'task plan validation failed';
                                }
                            }
                            break;
                        case 'task-run':
                            {
                                const detach = !!(params && params.detach);
                                if (detach) {
                                    const plan = coerceTaskPlanPayload(params || {});
                                    const validation = validatePreparedTaskPlan(plan);
                                    if (!validation.ok) {
                                        result = {
                                            ok: false,
                                            error: validation.error || 'task plan validation failed',
                                            issues: validation.issues || [],
                                            warnings: validation.warnings || []
                                        };
                                        break;
                                    }
                                    const taskId = typeof params.taskId === 'string' && params.taskId.trim() ? params.taskId.trim() : createTaskId();
                                    const runId = createTaskRunId();
                                    runTaskPlanInternal(plan, { taskId, runId }).catch(() => {});
                                    result = {
                                        ok: true,
                                        started: true,
                                        detached: true,
                                        taskId,
                                        runId,
                                        warnings: validation.warnings || []
                                    };
                                } else {
                                    result = await runTaskNow(params || {});
                                }
                            }
                            break;
                        case 'task-runs':
                            {
                                const rawLimit = params && Number.isFinite(params.limit) ? params.limit : parseInt(params && params.limit, 10);
                                const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.floor(rawLimit)) : 20;
                                result = {
                                    runs: listTaskRunRecords(limit),
                                    limit
                                };
                            }
                            break;
                        case 'task-run-detail':
                            {
                                const runIdValidation = validateTaskRunId(params && typeof params.runId === 'string' ? params.runId : '');
                                if (!runIdValidation.ok) {
                                    result = { error: runIdValidation.error };
                                    break;
                                }
                                const detail = readTaskRunDetail(runIdValidation.runId);
                                result = detail || { error: `task run not found: ${runIdValidation.runId}` };
                            }
                            break;
                        case 'task-queue-add':
                            result = addTaskToQueue(params || {});
                            break;
                        case 'task-queue-list':
                            {
                                const rawLimit = params && Number.isFinite(params.limit) ? params.limit : parseInt(params && params.limit, 10);
                                const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.floor(rawLimit)) : 50;
                                result = {
                                    tasks: listTaskQueueItems({ limit, status: params && params.status }),
                                    limit
                                };
                            }
                            break;
                        case 'task-queue-show':
                            {
                                const taskId = params && typeof params.taskId === 'string' ? params.taskId.trim() : '';
                                if (!taskId) {
                                    result = { error: 'taskId is required' };
                                    break;
                                }
                                result = getTaskQueueItem(taskId) || { error: `task not found: ${taskId}` };
                            }
                            break;
                        case 'task-queue-start':
                            result = await startTaskQueueProcessing(params || {});
                            break;
                        case 'task-retry':
                            result = await retryTaskRun(params || {});
                            break;
                        case 'task-cancel':
                            result = cancelTaskRunOrQueue(params || {});
                            break;
                        case 'task-logs':
                            result = getTaskLogs(params || {});
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
        } else if (requestPath === '/web-ui') {
            try {
                const html = readBundledWebUiHtml(htmlPath);
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(html);
            } catch (error) {
                writeWebUiAssetError(res, requestPath, error);
            }
        } else if (requestPath.startsWith('/web-ui/')) {
            const normalized = path.normalize(requestPath).replace(/^([\\.\\/])+/, '');
            const filePath = path.join(__dirname, normalized);
            if (!isPathInside(filePath, webDir)) {
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Forbidden');
                return;
            }
            const relativePath = path.relative(webDir, filePath).replace(/\\/g, '/');
            const dynamicAsset = PUBLIC_WEB_UI_DYNAMIC_ASSETS.get(relativePath);
            if (dynamicAsset) {
                try {
                    const assetBody = dynamicAsset.reader(filePath);
                    res.writeHead(200, { 'Content-Type': dynamicAsset.mime });
                    res.end(assetBody, 'utf-8');
                } catch (error) {
                    writeWebUiAssetError(res, requestPath, error);
                }
                return;
            }
            if (!PUBLIC_WEB_UI_STATIC_ASSETS.has(relativePath)) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Not Found');
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
            let decodedFileName = '';
            try {
                decodedFileName = decodeURIComponent(fileName);
            } catch (_) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Bad Request');
                return;
            }

            const artifact = resolveDownloadArtifact(decodedFileName, { consume: true });
            if (artifact) {
                streamZipDownloadResponse(res, artifact.filePath, {
                    fileName: artifact.fileName,
                    deleteAfterDownload: artifact.deleteAfterDownload !== false
                });
                return;
            }

            const tempDir = os.tmpdir();
            const legacyFilePath = path.join(tempDir, decodedFileName);
            if (!isPathInside(legacyFilePath, tempDir)) {
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Forbidden');
                return;
            }
            streamZipDownloadResponse(res, legacyFilePath, {
                fileName: path.basename(legacyFilePath),
                deleteAfterDownload: false
            });
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
            try {
                const html = readBundledWebUiHtml(htmlPath);
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(html);
            } catch (error) {
                writeWebUiAssetError(res, requestPath, error);
            }
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

    const openHost = host === '::'
        ? '::1'
        : (host === '0.0.0.0' ? DEFAULT_WEB_OPEN_HOST : host);
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
            const url = openUrl;
            openBrowserAfterReady(url);
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

// Region markers are used by unit tests that extract these helpers directly.
// #region createSerializedWebUiRestartHandler
function createSerializedWebUiRestartHandler(runRestart) {
    let restartQueued = false;
    let latestRestartInfo = null;
    let restartInFlight = null;

    const drainRestartQueue = async () => {
        try {
            while (restartQueued) {
                restartQueued = false;
                await runRestart(latestRestartInfo);
            }
        } finally {
            restartInFlight = null;
            if (restartQueued) {
                restartInFlight = drainRestartQueue();
                return restartInFlight;
            }
        }
    };

    return (info) => {
        latestRestartInfo = info;
        restartQueued = true;
        if (!restartInFlight) {
            restartInFlight = drainRestartQueue();
        }
        return restartInFlight;
    };
}
// #endregion createSerializedWebUiRestartHandler

// #region restartWebUiServerAfterFrontendChange
async function restartWebUiServerAfterFrontendChange({
    serverHandle,
    serverOptions,
    createServer = createWebServer,
    delayMs = 3000,
    wait = setTimeout,
    logger = console
}) {
    logger.log('  正在停止旧服务...');
    try {
        await serverHandle.stop();
        logger.log('  旧服务已停止');
    } catch (e) {
        logger.warn('! 停止旧服务失败:', e.message || e);
    }

    await new Promise((resolve) => wait(resolve, delayMs));

    try {
        const nextServerHandle = await createServer(serverOptions);
        logger.log('✓ 已重启 Web UI 服务\n');
        return nextServerHandle;
    } catch (e) {
        logger.error('! 重启失败:', e.message || e);
        return serverHandle;
    }
}
// #endregion restartWebUiServerAfterFrontendChange

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
    releaseRunPortIfNeeded(port, host);

    let serverHandle = createWebServer({
        htmlPath,
        assetsDir,
        webDir,
        host,
        port,
        openBrowser: !options.noBrowser
    });

    const requestWebUiRestart = createSerializedWebUiRestartHandler(async (info) => {
            const fileLabel = info && info.filename ? info.filename : (info && info.target ? path.basename(info.target) : 'unknown');
            console.log(`\n~ 侦测到前端变更 (${fileLabel})，重启中...`);
            serverHandle = await restartWebUiServerAfterFrontendChange({
                serverHandle,
                serverOptions: {
                    htmlPath,
                    assetsDir,
                    webDir,
                    host,
                    port,
                    openBrowser: false
                }
            });
        });

    const stopWatch = watchPathsForRestart(
        [webDir, legacyHtmlPath],
        (info) => {
            void requestWebUiRestart(info).catch((err) => {
                console.error('! 重启 Web UI 失败:', err && err.message ? err.message : err);
            });
        }
    );

    const handleExit = () => {
        stopWatch();
        Promise.allSettled([
            serverHandle.stop(),
            stopBuiltinProxyRuntime(),
            stopBuiltinClaudeProxyRuntime()
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
    void args;
    throw new Error('该功能已移除');
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

function printTaskHelp() {
    console.log('\n用法: codexmate task <plan|run|runs|queue|retry|cancel|logs> [参数]');
    console.log('  codexmate task plan --target "实现任务编排 Tab" --follow-up "继续处理 review"');
    console.log('  codexmate task run --target "修复失败测试" --allow-write --concurrency 2');
    console.log('  codexmate task run --target "检查请求链路" --dry-run --plan-only');
    console.log('  codexmate task runs --limit 20');
    console.log('  codexmate task queue add --target "整理 workflow 入口" --allow-write');
    console.log('  codexmate task queue list');
    console.log('  codexmate task queue show <taskId>');
    console.log('  codexmate task queue start [<taskId>] [--detach]');
    console.log('  codexmate task retry <runId>');
    console.log('  codexmate task cancel <taskId|runId>');
    console.log('  codexmate task logs <runId>');
    console.log('参数:');
    console.log('  --target <文本>         任务目标文本');
    console.log('  --title <文本>          任务标题');
    console.log('  --notes <文本>          附加说明');
    console.log('  --plan <JSON|@file>     直接提供任务计划对象');
    console.log('  --workflow-id <ID>      复用现有 workflow（可重复）');
    console.log('  --follow-up <文本>      追加 follow-up（可重复）');
    console.log('  --allow-write           允许写入工作区');
    console.log('  --dry-run               仅计划/预演，不执行写入');
    console.log('  --plan-only             仅输出计划，不执行');
    console.log('  --engine <codex|workflow>  选择编排引擎');
    console.log('  --concurrency <N>       并发度');
    console.log('  --auto-fix-rounds <N>   自动修复回合数');
    console.log('  --limit <N>             runs/queue list 数量');
    console.log('  --task-id <ID>          指定任务 ID');
    console.log('  --run-id <ID>           指定运行 ID');
    console.log('  --status <状态>         queue list 状态过滤');
    console.log('  --detach                后台启动任务或队列');
    console.log('  --json                  以 JSON 输出');
    console.log();
}

function parseTaskCliOptions(args = []) {
    const options = {
        title: '',
        target: '',
        notes: '',
        planRaw: '',
        workflowIds: [],
        followUps: [],
        allowWrite: false,
        dryRun: false,
        planOnly: false,
        engine: 'codex',
        concurrency: 2,
        autoFixRounds: 1,
        limit: 20,
        taskId: '',
        runId: '',
        status: '',
        detach: false,
        json: false,
        explicit: {}
    };
    const rest = [];
    const pushValue = (key, value, optionName) => {
        const text = value === undefined || value === null ? '' : String(value).trim();
        if (!text) {
            throw new Error(`${optionName} 需要提供非空内容`);
        }
        options[key].push(text);
    };
    for (let i = 0; i < args.length; i += 1) {
        const arg = String(args[i] || '');
        if (!arg) continue;
        if (arg === '--allow-write') {
            options.allowWrite = true;
            options.explicit.allowWrite = true;
            continue;
        }
        if (arg === '--dry-run') {
            options.dryRun = true;
            options.explicit.dryRun = true;
            continue;
        }
        if (arg === '--plan-only') {
            options.planOnly = true;
            continue;
        }
        if (arg === '--detach') {
            options.detach = true;
            continue;
        }
        if (arg === '--json') {
            options.json = true;
            continue;
        }
        if (arg === '--title') {
            options.title = String(args[i + 1] || '').trim();
            options.explicit.title = true;
            i += 1;
            continue;
        }
        if (arg.startsWith('--title=')) {
            options.title = arg.slice('--title='.length).trim();
            options.explicit.title = true;
            continue;
        }
        if (arg === '--target') {
            options.target = String(args[i + 1] || '').trim();
            options.explicit.target = true;
            i += 1;
            continue;
        }
        if (arg.startsWith('--target=')) {
            options.target = arg.slice('--target='.length).trim();
            options.explicit.target = true;
            continue;
        }
        if (arg === '--notes') {
            options.notes = String(args[i + 1] || '').trim();
            options.explicit.notes = true;
            i += 1;
            continue;
        }
        if (arg.startsWith('--notes=')) {
            options.notes = arg.slice('--notes='.length).trim();
            options.explicit.notes = true;
            continue;
        }
        if (arg === '--plan') {
            options.planRaw = String(args[i + 1] || '').trim();
            options.explicit.planRaw = true;
            i += 1;
            continue;
        }
        if (arg.startsWith('--plan=')) {
            options.planRaw = arg.slice('--plan='.length).trim();
            options.explicit.planRaw = true;
            continue;
        }
        if (arg === '--workflow-id') {
            pushValue('workflowIds', args[i + 1], '--workflow-id');
            options.explicit.workflowIds = true;
            i += 1;
            continue;
        }
        if (arg.startsWith('--workflow-id=')) {
            pushValue('workflowIds', arg.slice('--workflow-id='.length), '--workflow-id');
            options.explicit.workflowIds = true;
            continue;
        }
        if (arg === '--follow-up') {
            pushValue('followUps', args[i + 1], '--follow-up');
            options.explicit.followUps = true;
            i += 1;
            continue;
        }
        if (arg.startsWith('--follow-up=')) {
            pushValue('followUps', arg.slice('--follow-up='.length), '--follow-up');
            options.explicit.followUps = true;
            continue;
        }
        if (arg === '--engine') {
            options.engine = normalizeTaskEngine(args[i + 1]);
            options.explicit.engine = true;
            i += 1;
            continue;
        }
        if (arg.startsWith('--engine=')) {
            options.engine = normalizeTaskEngine(arg.slice('--engine='.length));
            options.explicit.engine = true;
            continue;
        }
        if (arg === '--concurrency') {
            const value = parseInt(args[i + 1], 10);
            if (Number.isFinite(value)) options.concurrency = value;
            options.explicit.concurrency = true;
            i += 1;
            continue;
        }
        if (arg.startsWith('--concurrency=')) {
            const value = parseInt(arg.slice('--concurrency='.length), 10);
            if (Number.isFinite(value)) options.concurrency = value;
            options.explicit.concurrency = true;
            continue;
        }
        if (arg === '--auto-fix-rounds') {
            const value = parseInt(args[i + 1], 10);
            if (Number.isFinite(value)) options.autoFixRounds = value;
            options.explicit.autoFixRounds = true;
            i += 1;
            continue;
        }
        if (arg.startsWith('--auto-fix-rounds=')) {
            const value = parseInt(arg.slice('--auto-fix-rounds='.length), 10);
            if (Number.isFinite(value)) options.autoFixRounds = value;
            options.explicit.autoFixRounds = true;
            continue;
        }
        if (arg === '--limit') {
            const value = parseInt(args[i + 1], 10);
            if (Number.isFinite(value)) options.limit = value;
            i += 1;
            continue;
        }
        if (arg.startsWith('--limit=')) {
            const value = parseInt(arg.slice('--limit='.length), 10);
            if (Number.isFinite(value)) options.limit = value;
            continue;
        }
        if (arg === '--task-id') {
            options.taskId = String(args[i + 1] || '').trim();
            options.explicit.taskId = true;
            i += 1;
            continue;
        }
        if (arg.startsWith('--task-id=')) {
            options.taskId = arg.slice('--task-id='.length).trim();
            options.explicit.taskId = true;
            continue;
        }
        if (arg === '--run-id') {
            options.runId = String(args[i + 1] || '').trim();
            options.explicit.runId = true;
            i += 1;
            continue;
        }
        if (arg.startsWith('--run-id=')) {
            options.runId = arg.slice('--run-id='.length).trim();
            options.explicit.runId = true;
            continue;
        }
        if (arg === '--status') {
            options.status = String(args[i + 1] || '').trim().toLowerCase();
            i += 1;
            continue;
        }
        if (arg.startsWith('--status=')) {
            options.status = arg.slice('--status='.length).trim().toLowerCase();
            continue;
        }
        rest.push(arg);
    }
    return { options, rest };
}

function buildTaskCliPayload(options = {}, rest = []) {
    const explicit = options && options.explicit && typeof options.explicit === 'object' ? options.explicit : {};
    const payload = {};
    if (explicit.title && options.title) payload.title = options.title;
    if (explicit.target && options.target) payload.target = options.target;
    if (explicit.notes && options.notes) payload.notes = options.notes;
    if (explicit.workflowIds && Array.isArray(options.workflowIds)) payload.workflowIds = options.workflowIds.slice();
    if (explicit.followUps && Array.isArray(options.followUps)) payload.followUps = options.followUps.slice();
    if (explicit.allowWrite) payload.allowWrite = options.allowWrite === true;
    if (explicit.dryRun) payload.dryRun = options.dryRun === true;
    if (explicit.engine) payload.engine = options.engine || 'codex';
    if (explicit.concurrency) payload.concurrency = options.concurrency;
    if (explicit.autoFixRounds) payload.autoFixRounds = options.autoFixRounds;
    if (explicit.taskId && options.taskId) payload.taskId = options.taskId;
    if (explicit.runId && options.runId) payload.runId = options.runId;
    if (!payload.target && Array.isArray(rest) && rest.length > 0) {
        payload.target = rest.join(' ').trim();
    }
    if (options.planRaw) {
        payload.plan = parseWorkflowInputArg(options.planRaw);
    }
    return payload;
}

function printTaskPlanSummary(plan, warnings = []) {
    console.log(`\n任务计划: ${plan.title || '(untitled)'}`);
    console.log(`  engine: ${plan.engine || 'codex'}`);
    console.log(`  allowWrite: ${plan.allowWrite === true ? 'yes' : 'no'}`);
    console.log(`  dryRun: ${plan.dryRun === true ? 'yes' : 'no'}`);
    console.log(`  concurrency: ${plan.concurrency || 1}`);
    if (plan.target) {
        console.log(`  target: ${truncateTaskText(plan.target, 200)}`);
    }
    const waves = Array.isArray(plan.waves) ? plan.waves : [];
    console.log(`  waves: ${waves.length}`);
    for (const wave of waves) {
        const ids = Array.isArray(wave.nodeIds) ? wave.nodeIds.join(', ') : '';
        console.log(`    - ${wave.label || `Wave ${wave.index + 1}`}: ${ids}`);
    }
    const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
    for (const node of nodes) {
        console.log(`  - ${node.id} [${node.kind}] ${node.title || ''}`.trim());
        if (node.workflowId) {
            console.log(`    workflowId: ${node.workflowId}`);
        }
        if (Array.isArray(node.dependsOn) && node.dependsOn.length > 0) {
            console.log(`    dependsOn: ${node.dependsOn.join(', ')}`);
        }
    }
    if (Array.isArray(warnings) && warnings.length > 0) {
        console.log('  warnings:');
        warnings.forEach((item) => console.log(`    - ${item}`));
    }
    console.log();
}

function printTaskRunSummary(detail = {}) {
    const run = detail.run && typeof detail.run === 'object' ? detail.run : {};
    console.log(`\n任务执行 ${run.status === 'success' ? '完成' : '结束'}: ${detail.title || detail.taskId || ''}`.trim());
    console.log(`  taskId: ${detail.taskId || ''}`);
    console.log(`  runId: ${detail.runId || ''}`);
    console.log(`  status: ${run.status || detail.status || 'unknown'}`);
    console.log(`  duration: ${run.durationMs || 0}ms`);
    if (run.summary) {
        console.log(`  summary: ${run.summary}`);
    }
    if (run.error) {
        console.log(`  error: ${run.error}`);
    }
    const nodes = Array.isArray(run.nodes) ? run.nodes : [];
    for (const node of nodes) {
        console.log(`  - ${node.id}: ${node.status || 'unknown'} attempts=${node.attemptCount || 0}`);
        if (node.summary) {
            console.log(`    ${node.summary}`);
        }
        if (node.error && node.error !== node.summary) {
            console.log(`    error: ${node.error}`);
        }
    }
    console.log();
}

async function cmdTask(args = []) {
    const argv = Array.isArray(args) ? args : [];
    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
        printTaskHelp();
        return;
    }
    const subcommand = String(argv[0] || '').trim().toLowerCase();
    const parsed = parseTaskCliOptions(argv.slice(1));
    const options = parsed.options;
    const rest = parsed.rest;

    if (subcommand === 'plan') {
        const payload = buildTaskCliPayload(options, rest);
        const plan = coerceTaskPlanPayload(payload);
        const validation = validatePreparedTaskPlan(plan);
        const result = {
            ok: validation.ok,
            plan,
            issues: validation.issues || [],
            warnings: validation.warnings || []
        };
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            if (!validation.ok) {
                throw new Error(validation.error || 'task plan validation failed');
            }
            printTaskPlanSummary(plan, validation.warnings || []);
        }
        if (!validation.ok) {
            throw new Error(validation.error || 'task plan validation failed');
        }
        return;
    }

    if (subcommand === 'runs') {
        const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : 20;
        const runs = listTaskRunRecords(limit);
        if (options.json) {
            console.log(JSON.stringify({ runs, limit }, null, 2));
            return;
        }
        console.log(`\n最近任务运行（${runs.length}/${limit}）:`);
        for (const item of runs) {
            console.log(`  - [${item.status || 'unknown'}] ${item.title || item.taskId || ''} runId=${item.runId || ''} duration=${item.durationMs || 0}ms`);
            if (item.summary) {
                console.log(`    ${item.summary}`);
            }
            if (item.error) {
                console.log(`    error: ${item.error}`);
            }
        }
        console.log();
        return;
    }

    if (subcommand === 'queue') {
        const queueSubcommand = String(rest[0] || '').trim().toLowerCase();
        const tail = rest.slice(1);
        if (!queueSubcommand) {
            throw new Error('queue 子命令不能为空');
        }
        if (queueSubcommand === 'add') {
            const payload = buildTaskCliPayload(options, tail);
            const result = addTaskToQueue(payload);
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                if (result.error) {
                    throw new Error(result.error);
                }
                console.log(`✓ 已加入队列: ${result.task.taskId}`);
                console.log(`  ${result.task.title || result.task.target || ''}`);
                console.log();
            }
            if (result.error) {
                throw new Error(result.error);
            }
            return;
        }
        if (queueSubcommand === 'list') {
            const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : 20;
            const tasks = listTaskQueueItems({ limit, status: options.status || '' });
            if (options.json) {
                console.log(JSON.stringify({ tasks, limit }, null, 2));
                return;
            }
            console.log(`\n任务队列（${tasks.length}/${limit}）:`);
            for (const item of tasks) {
                console.log(`  - [${item.status}] ${item.taskId} ${item.title || item.target || ''}`.trim());
                if (item.lastSummary) {
                    console.log(`    ${item.lastSummary}`);
                }
            }
            console.log();
            return;
        }
        if (queueSubcommand === 'show') {
            const taskId = options.taskId || String(tail[0] || '').trim();
            if (!taskId) {
                throw new Error('taskId is required');
            }
            const task = getTaskQueueItem(taskId);
            if (!task) {
                throw new Error(`task not found: ${taskId}`);
            }
            console.log(JSON.stringify(task, null, 2));
            return;
        }
        if (queueSubcommand === 'start') {
            const taskId = options.taskId || String(tail[0] || '').trim();
            const result = await startTaskQueueProcessing({ taskId, detach: options.detach });
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else if (result.error) {
                throw new Error(result.error);
            } else if (result.detached) {
                console.log('✓ 队列处理已在后台启动');
                console.log();
            } else if (result.detail) {
                printTaskRunSummary(result.detail);
            } else {
                console.log('队列中暂无可执行任务');
                console.log();
            }
            if (result.error) {
                throw new Error(result.error);
            }
            return;
        }
        throw new Error(`未知 queue 子命令: ${queueSubcommand}`);
    }

    if (subcommand === 'run') {
        const payload = buildTaskCliPayload(options, rest);
        if (options.planOnly) {
            const plan = coerceTaskPlanPayload(payload);
            const validation = validatePreparedTaskPlan(plan);
            const result = {
                ok: validation.ok,
                plan,
                issues: validation.issues || [],
                warnings: validation.warnings || []
            };
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                if (!validation.ok) {
                    throw new Error(validation.error || 'task plan validation failed');
                }
                printTaskPlanSummary(plan, validation.warnings || []);
            }
            if (!validation.ok) {
                throw new Error(validation.error || 'task plan validation failed');
            }
            return;
        }
        if (options.detach) {
            const plan = coerceTaskPlanPayload(payload);
            const validation = validatePreparedTaskPlan(plan);
            if (!validation.ok) {
                throw new Error(validation.error || 'task plan validation failed');
            }
            const taskId = options.taskId || createTaskId();
            const runId = createTaskRunId();
            spawnDetachedTaskWorker({
                type: 'run-plan',
                plan,
                taskId,
                runId
            });
            const result = { ok: true, detached: true, taskId, runId, warnings: validation.warnings || [] };
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log(`✓ 后台任务已启动: taskId=${taskId} runId=${runId}`);
                console.log();
            }
            return;
        }
        const detail = await runTaskNow(payload);
        if (options.json) {
            console.log(JSON.stringify(detail, null, 2));
        } else {
            printTaskRunSummary(detail);
        }
        if (detail.error || (detail.run && detail.run.status && detail.run.status !== 'success')) {
            throw new Error(detail.error || (detail.run && detail.run.error) || 'task run failed');
        }
        return;
    }

    if (subcommand === 'retry') {
        const runId = options.runId || String(rest[0] || '').trim();
        if (options.detach) {
            const detail = readTaskRunDetail(runId);
            if (!detail || !detail.plan) {
                throw new Error(`task run not found: ${runId}`);
            }
            const nextRunId = createTaskRunId();
            spawnDetachedTaskWorker({
                type: 'run-plan',
                plan: cloneJson(detail.plan, {}),
                taskId: detail.taskId || createTaskId(),
                runId: nextRunId
            });
            const result = {
                ok: true,
                started: true,
                detached: true,
                runId: nextRunId,
                taskId: detail.taskId || ''
            };
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log(`✓ 已后台重试: runId=${result.runId}`);
                console.log();
            }
            return;
        }
        const result = await retryTaskRun({ runId, detach: options.detach });
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
        } else if (result.detached) {
            console.log(`✓ 已后台重试: runId=${result.runId}`);
            console.log();
        } else {
            printTaskRunSummary(result);
        }
        if (result.error) {
            throw new Error(result.error);
        }
        if (!result.detached && result.run && result.run.status === 'failed') {
            throw new Error(result.run.error || 'task retry failed');
        }
        return;
    }

    if (subcommand === 'cancel') {
        const result = cancelTaskRunOrQueue({
            target: String(rest[0] || '').trim(),
            taskId: options.taskId,
            runId: options.runId
        });
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            if (result.error) {
                throw new Error(result.error);
            }
            console.log('✓ 已发出取消请求');
            console.log();
        }
        if (result.error) {
            throw new Error(result.error);
        }
        return;
    }

    if (subcommand === 'logs') {
        const runId = options.runId || String(rest[0] || '').trim();
        const result = getTaskLogs({ runId });
        if (result.error) {
            throw new Error(result.error);
        }
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(result.logs || '(no logs)');
            console.log();
        }
        return;
    }

    throw new Error(`未知 task 子命令: ${subcommand}`);
}

// #region parseCodexProxyOptions
function parseCodexProxyOptions(args = []) {
    const options = {
        passthroughArgs: [],
        queuedFollowUps: []
    };
    const argv = Array.isArray(args) ? args : [];

    const pushFollowUp = (value, optionName) => {
        const raw = value === undefined || value === null ? '' : String(value);
        if (!raw.trim()) {
            throw new Error(`${optionName} 需要提供非空内容`);
        }
        options.queuedFollowUps.push(raw);
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === undefined || arg === null) {
            continue;
        }
        const text = String(arg);
        if (text === '--') {
            options.passthroughArgs.push(...argv.slice(i).map((item) => String(item)));
            break;
        }
        if (text === '--queued-follow-up' || text === '--follow-up') {
            const next = argv[i + 1];
            if (next === undefined) {
                throw new Error(`${text} 需要提供内容`);
            }
            pushFollowUp(next, text);
            i += 1;
            continue;
        }
        if (text.startsWith('--queued-follow-up=')) {
            pushFollowUp(text.slice('--queued-follow-up='.length), '--queued-follow-up');
            continue;
        }
        if (text.startsWith('--follow-up=')) {
            pushFollowUp(text.slice('--follow-up='.length), '--follow-up');
            continue;
        }
        options.passthroughArgs.push(text);
    }

    return options;
}
// #endregion parseCodexProxyOptions

function shellEscapePosixArg(value) {
    const text = value === undefined || value === null ? '' : String(value);
    return `'${text.replace(/'/g, `'\"'\"'`)}'`;
}

// #region buildScriptCommandArgs
function buildScriptCommandArgs(commandLine) {
    const platform = process.platform;
    // util-linux script needs -e/--return to propagate child exit code.
    if (platform === 'linux' || platform === 'android') {
        return ['-q', '-e', '-c', commandLine, '/dev/null'];
    }
    // NetBSD supports -e/-c, matching util-linux style contract.
    if (platform === 'netbsd') {
        return ['-q', '-e', '-c', commandLine, '/dev/null'];
    }
    // OpenBSD supports "-c <command>" with a trailing output file path.
    if (platform === 'openbsd') {
        return ['-c', commandLine, '/dev/null'];
    }
    // BSD/macOS script does not support util-linux "-c <cmd>" syntax.
    if (platform === 'darwin' || platform === 'freebsd') {
        return ['-q', '/dev/null', 'sh', '-lc', commandLine];
    }
    throw new Error(`当前平台暂不支持 --follow-up 自动排队（platform=${platform}）`);
}
// #endregion buildScriptCommandArgs

// #region runProxyCommandWithQueuedFollowUps
async function runProxyCommandWithQueuedFollowUps(selectedBin, finalArgs = [], queuedFollowUps = []) {
    if (!process.stdin || !process.stdin.isTTY) {
        throw new Error('当前 stdin 不是 TTY，无法使用 --follow-up 自动排队。');
    }

    const scriptPath = resolveCommandPath('script');
    if (!scriptPath) {
        throw new Error('未找到 script 命令，无法自动注入 queued follow-up 消息。');
    }

    const commandLine = [selectedBin, ...finalArgs].map((item) => shellEscapePosixArg(item)).join(' ');
    const scriptArgs = buildScriptCommandArgs(commandLine);

    return new Promise((resolve, reject) => {
        let settled = false;
        const child = spawn(scriptPath, scriptArgs, {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const stdin = process.stdin;
        const hadRawMode = !!stdin.isRaw;
        let cleanedUp = false;
        let waitingDrain = false;
        let followUpsFlushed = false;
        let outputReadyDetected = false;
        const timers = [];
        const pendingWrites = [];
        let onChildStdinDrain = null;
        let onChildStdinError = null;
        const resolveOnce = (code) => {
            if (settled) return;
            settled = true;
            resolve(code);
        };
        const rejectOnce = (error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        const handleWriteFailure = (error) => {
            const err = error instanceof Error ? error : new Error(String(error || 'unknown'));
            cleanup();
            try {
                if (!child.killed) {
                    child.kill('SIGTERM');
                }
            } catch (_) {
                // Ignore failure to terminate child after stdin write failure.
            }
            rejectOnce(new Error(`写入 ${selectedBin} stdin 失败: ${err.message}`));
        };
        const flushPendingWrites = () => {
            if (cleanedUp || child.stdin.destroyed) {
                pendingWrites.length = 0;
                return;
            }
            while (pendingWrites.length > 0) {
                const chunk = pendingWrites[0];
                let canContinue = true;
                try {
                    canContinue = child.stdin.write(chunk, (error) => {
                        if (error) {
                            handleWriteFailure(error);
                        }
                    });
                } catch (error) {
                    handleWriteFailure(error);
                    return;
                }
                pendingWrites.shift();
                if (!canContinue) {
                    waitingDrain = true;
                    try {
                        stdin.pause();
                    } catch (_) {
                        // Ignore stdin pause failures.
                    }
                    return;
                }
            }
            waitingDrain = false;
            try {
                stdin.resume();
            } catch (_) {
                // Ignore stdin resume failures.
            }
        };
        const enqueueWrite = (chunk) => {
            if (cleanedUp) return;
            pendingWrites.push(chunk);
            flushPendingWrites();
        };
        const onInput = (chunk) => {
            if (!child.stdin.destroyed) {
                enqueueWrite(chunk);
            }
        };
        const flushQueuedFollowUps = () => {
            if (followUpsFlushed) return;
            followUpsFlushed = true;
            queuedFollowUps.forEach((message, index) => {
                const timer = setTimeout(() => {
                    if (!child.stdin.destroyed) {
                        // PTY submit should use CR instead of LF.
                        enqueueWrite(`${message}\r`);
                    }
                }, index * 80);
                timers.push(timer);
            });
        };
        const markOutputReady = () => {
            if (outputReadyDetected) return;
            outputReadyDetected = true;
            timers.push(setTimeout(() => {
                flushQueuedFollowUps();
            }, 120));
        };
        const onStdoutData = (chunk) => {
            process.stdout.write(chunk);
            markOutputReady();
        };
        const onStderrData = (chunk) => {
            process.stderr.write(chunk);
            markOutputReady();
        };
        const onProcessExit = () => {
            cleanup();
        };
        const onProcessSigint = () => {
            cleanup();
            try {
                if (!child.killed) {
                    child.kill('SIGINT');
                }
            } catch (_) {
                // Ignore forwarding failures and keep exit path deterministic.
            }
            process.exit(130);
        };
        const onProcessSigterm = () => {
            cleanup();
            try {
                if (!child.killed) {
                    child.kill('SIGTERM');
                }
            } catch (_) {
                // Ignore forwarding failures and keep exit path deterministic.
            }
            process.exit(143);
        };
        const cleanup = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            stdin.removeListener('data', onInput);
            process.removeListener('exit', onProcessExit);
            process.removeListener('SIGINT', onProcessSigint);
            process.removeListener('SIGTERM', onProcessSigterm);
            child.stdout.removeListener('data', onStdoutData);
            child.stderr.removeListener('data', onStderrData);
            if (onChildStdinDrain) {
                child.stdin.removeListener('drain', onChildStdinDrain);
            }
            if (onChildStdinError) {
                child.stdin.removeListener('error', onChildStdinError);
            }
            while (timers.length > 0) {
                clearTimeout(timers.pop());
            }
            try {
                if (typeof stdin.setRawMode === 'function' && !hadRawMode) {
                    stdin.setRawMode(false);
                }
            } catch (_) {
                // Ignore raw mode restore failures at shutdown.
            }
        };

        process.on('exit', onProcessExit);
        process.on('SIGINT', onProcessSigint);
        process.on('SIGTERM', onProcessSigterm);
        child.stdout.on('data', onStdoutData);
        child.stderr.on('data', onStderrData);
        onChildStdinDrain = () => {
            waitingDrain = false;
            flushPendingWrites();
        };
        onChildStdinError = (error) => {
            handleWriteFailure(error);
        };
        child.stdin.on('drain', onChildStdinDrain);
        child.stdin.on('error', onChildStdinError);
        try {
            if (typeof stdin.setRawMode === 'function' && !hadRawMode) {
                stdin.setRawMode(true);
            }
        } catch (_) {
            // Keep graceful fallback if raw mode toggle is not supported.
        }

        stdin.resume();
        stdin.on('data', onInput);
        // Fallback in case the child stays silent before prompt render.
        timers.push(setTimeout(() => {
            flushQueuedFollowUps();
        }, 1500));

        child.on('error', (err) => {
            cleanup();
            rejectOnce(new Error(`运行 ${selectedBin} 失败: ${err.message}`));
        });

        child.on('close', (code, signal) => {
            cleanup();
            if (typeof code === 'number') {
                resolveOnce(code);
                return;
            }
            if (signal === 'SIGINT') {
                resolveOnce(130);
                return;
            }
            if (signal === 'SIGTERM') {
                resolveOnce(143);
                return;
            }
            resolveOnce(1);
        });
    });
}
// #endregion runProxyCommandWithQueuedFollowUps

async function runProxyCommand(displayName, binNames, args = [], installTip = '', runtimeOptions = {}) {
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

    const queuedFollowUps = runtimeOptions && Array.isArray(runtimeOptions.queuedFollowUps)
        ? runtimeOptions.queuedFollowUps.filter((item) => typeof item === 'string' && item.trim())
        : [];

    if (queuedFollowUps.length > 0) {
        return runProxyCommandWithQueuedFollowUps(selectedBin, finalArgs, queuedFollowUps);
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
    const parsed = parseCodexProxyOptions(args);
    return runProxyCommand('Codex', 'codex', parsed.passthroughArgs, '', {
        queuedFollowUps: parsed.queuedFollowUps
    });
}

async function cmdQwen(args = []) {
    return runProxyCommand('Qwen', ['qwen', 'qwen-code'], args, 'npm install -g @qwen-code/qwen-code');
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
    const budgetReadOptions = {
        useDefaultsWhenMissing: !hasConfigLoadError(statusConfigResult)
    };
    const modelContextWindow = readPositiveIntegerConfigValue(
        config,
        'model_context_window',
        budgetReadOptions
    );
    const modelAutoCompactTokenLimit = readPositiveIntegerConfigValue(
        config,
        'model_auto_compact_token_limit',
        budgetReadOptions
    );
    return {
        provider: config.model_provider || '未设置',
        model: config.model || '未设置',
        serviceTier,
        modelReasoningEffort,
        modelContextWindow,
        modelAutoCompactTokenLimit,
        configReady: !statusConfigResult.isVirtual,
        configErrorType: statusConfigResult.errorType || '',
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
        configErrorType: listConfigResult.errorType || '',
        configNotice: listConfigResult.reason || '',
        providers: Object.entries(providers).map(([name, p]) => ({
            name,
            url: p.base_url || '',
            key: maskKey(p.preferred_auth_method || ''),
            hasKey: !!(p.preferred_auth_method && p.preferred_auth_method.trim()),
            models: Array.isArray(p.models)
                ? p.models
                    .filter((model) => model && typeof model === 'object' && !Array.isArray(model))
                    .map((model) => ({
                        id: typeof model.id === 'string' ? model.id : '',
                        name: typeof model.name === 'string' ? model.name : '',
                        cost: model.cost && typeof model.cost === 'object' && !Array.isArray(model.cost)
                            ? {
                                input: model.cost.input,
                                output: model.cost.output,
                                cacheRead: model.cost.cacheRead,
                                cacheWrite: model.cost.cacheWrite
                            }
                            : null,
                        contextWindow: model.contextWindow,
                        maxTokens: model.maxTokens
                    }))
                    .filter((model) => model.id)
                : [],
            current: name === current,
            readOnly: isBuiltinManagedProvider(name),
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
                modelContextWindow: { type: ['string', 'number'] },
                modelAutoCompactTokenLimit: { type: ['string', 'number'] },
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
                    reasoningEffort: '{{input.reasoningEffort}}',
                    modelContextWindow: '{{input.modelContextWindow}}',
                    modelAutoCompactTokenLimit: '{{input.modelAutoCompactTokenLimit}}'
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
                    sessions: await listSessionBrowse({
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

function createTaskId() {
    return `task-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function createTaskRunId() {
    return `tr-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function validateTaskRunId(value) {
    const runId = typeof value === 'string' ? value.trim() : '';
    if (!runId) {
        return { ok: false, error: 'runId is required', runId: '' };
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) {
        return { ok: false, error: 'runId contains unsupported characters', runId: '' };
    }
    return { ok: true, error: '', runId };
}

function normalizeTaskEngine(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized === 'workflow' ? 'workflow' : 'codex';
}

function normalizeTaskFollowUps(input = []) {
    const seen = new Set();
    const result = [];
    for (const item of Array.isArray(input) ? input : []) {
        const text = typeof item === 'string' ? item.trim() : '';
        if (!text || seen.has(text)) continue;
        seen.add(text);
        result.push(text);
    }
    return result;
}

function buildTaskWorkflowCatalog() {
    const listed = listWorkflowDefinitions();
    return {
        workflows: Array.isArray(listed.workflows)
            ? listed.workflows.map((item) => ({
                id: item.id,
                name: item.name,
                description: item.description,
                readOnly: item.readOnly !== false,
                stepCount: item.stepCount || 0
            }))
            : [],
        warnings: Array.isArray(listed.warnings) ? listed.warnings : []
    };
}

function normalizeTaskPlanRequest(params = {}) {
    const source = params && typeof params === 'object' ? params : {};
    const rawWorkflowIds = Array.isArray(source.workflowIds)
        ? source.workflowIds
        : (typeof source.workflowId === 'string' && source.workflowId.trim() ? [source.workflowId.trim()] : []);
    const rawFollowUps = Array.isArray(source.followUps)
        ? source.followUps
        : (typeof source.followUp === 'string' && source.followUp.trim() ? [source.followUp.trim()] : []);
    return {
        id: typeof source.id === 'string' ? source.id.trim() : '',
        title: typeof source.title === 'string' ? source.title.trim() : '',
        target: typeof source.target === 'string' ? source.target.trim() : '',
        notes: typeof source.notes === 'string' ? source.notes.trim() : '',
        cwd: typeof source.cwd === 'string' ? source.cwd.trim() : process.cwd(),
        engine: normalizeTaskEngine(source.engine),
        allowWrite: source.allowWrite === true,
        dryRun: source.dryRun === true,
        concurrency: Number.isFinite(source.concurrency) ? source.concurrency : parseInt(source.concurrency, 10),
        autoFixRounds: Number.isFinite(source.autoFixRounds) ? source.autoFixRounds : parseInt(source.autoFixRounds, 10),
        workflowIds: rawWorkflowIds,
        followUps: normalizeTaskFollowUps(rawFollowUps)
    };
}

function coerceTaskPlanPayload(params = {}) {
    if (params && params.plan && typeof params.plan === 'object' && !Array.isArray(params.plan)) {
        const plan = cloneJson(params.plan, {});
        const overrideKeys = ['id', 'title', 'target', 'notes', 'cwd', 'engine', 'allowWrite', 'dryRun', 'concurrency', 'autoFixRounds', 'workflowIds', 'followUps'];
        for (const key of overrideKeys) {
            if (Object.prototype.hasOwnProperty.call(params, key) && params[key] !== undefined) {
                plan[key] = cloneJson(params[key], params[key]);
            }
        }
        plan.engine = normalizeTaskEngine(plan.engine);
        plan.workflowIds = normalizeTaskFollowUps(plan.workflowIds || []).map((id) => normalizeWorkflowId(id)).filter(Boolean);
        plan.followUps = normalizeTaskFollowUps(plan.followUps || []);
        plan.waves = computePlanWaves(Array.isArray(plan.nodes) ? plan.nodes : []);
        return plan;
    }
    const request = normalizeTaskPlanRequest(params || {});
    const catalog = buildTaskWorkflowCatalog();
    const plan = buildTaskPlan(request, {
        workflowCatalog: catalog.workflows,
        cwd: request.cwd || process.cwd()
    });
    return {
        ...plan,
        engine: normalizeTaskEngine(request.engine || plan.engine)
    };
}

function validatePreparedTaskPlan(plan) {
    const catalog = buildTaskWorkflowCatalog();
    const validation = validateTaskPlan(plan, {
        workflowCatalog: catalog.workflows
    });
    return {
        ...validation,
        warnings: catalog.warnings || []
    };
}

function normalizeTaskQueueItem(raw = {}) {
    const plan = raw.plan && typeof raw.plan === 'object' && !Array.isArray(raw.plan)
        ? cloneJson(raw.plan, {})
        : {};
    const taskId = typeof raw.taskId === 'string' ? raw.taskId.trim() : '';
    return {
        taskId: taskId || createTaskId(),
        title: typeof raw.title === 'string' ? raw.title.trim() : (typeof plan.title === 'string' ? plan.title.trim() : ''),
        target: typeof raw.target === 'string' ? raw.target.trim() : (typeof plan.target === 'string' ? plan.target.trim() : ''),
        status: typeof raw.status === 'string' ? raw.status.trim().toLowerCase() : 'queued',
        createdAt: toIsoTime(raw.createdAt || Date.now(), ''),
        updatedAt: toIsoTime(raw.updatedAt || raw.createdAt || Date.now(), ''),
        engine: normalizeTaskEngine(raw.engine || plan.engine),
        allowWrite: raw.allowWrite === true || plan.allowWrite === true,
        dryRun: raw.dryRun === true || plan.dryRun === true,
        concurrency: Number.isFinite(raw.concurrency) ? raw.concurrency : (Number.isFinite(plan.concurrency) ? plan.concurrency : 2),
        autoFixRounds: Number.isFinite(raw.autoFixRounds) ? raw.autoFixRounds : (Number.isFinite(plan.autoFixRounds) ? plan.autoFixRounds : 1),
        lastRunId: typeof raw.lastRunId === 'string' ? raw.lastRunId.trim() : '',
        lastSummary: typeof raw.lastSummary === 'string' ? raw.lastSummary.trim() : '',
        plan,
        runStatus: typeof raw.runStatus === 'string' ? raw.runStatus.trim().toLowerCase() : ''
    };
}

function readTaskQueueState() {
    const parsed = readJsonObjectFromFile(TASK_QUEUE_FILE, {});
    if (!parsed.ok || !parsed.exists) {
        return {
            tasks: []
        };
    }
    const source = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
    const tasks = Array.isArray(source.tasks) ? source.tasks.map((item) => normalizeTaskQueueItem(item)) : [];
    return { tasks };
}

function writeTaskQueueState(state = {}) {
    ensureDir(path.dirname(TASK_QUEUE_FILE));
    writeJsonAtomic(TASK_QUEUE_FILE, {
        tasks: Array.isArray(state.tasks) ? state.tasks.map((item) => normalizeTaskQueueItem(item)) : []
    });
}

function upsertTaskQueueItem(item) {
    const state = readTaskQueueState();
    const next = normalizeTaskQueueItem(item || {});
    const index = state.tasks.findIndex((entry) => entry.taskId === next.taskId);
    if (index >= 0) {
        state.tasks[index] = next;
    } else {
        state.tasks.push(next);
    }
    writeTaskQueueState(state);
    return next;
}

function getTaskQueueItem(taskId) {
    const id = typeof taskId === 'string' ? taskId.trim() : '';
    if (!id) return null;
    return readTaskQueueState().tasks.find((item) => item.taskId === id) || null;
}

function listTaskQueueItems(options = {}) {
    const state = readTaskQueueState();
    const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : 50;
    const statusFilter = typeof options.status === 'string' ? options.status.trim().toLowerCase() : '';
    const statusRank = {
        running: 0,
        queued: 1,
        failed: 2,
        completed: 3,
        cancelled: 4
    };
    return state.tasks
        .filter((item) => !statusFilter || item.status === statusFilter)
        .sort((a, b) => {
            const rankDiff = (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99);
            if (rankDiff !== 0) return rankDiff;
            return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        })
        .slice(0, limit);
}

function appendTaskRunRecord(record) {
    ensureDir(path.dirname(TASK_RUNS_FILE));
    fs.appendFileSync(TASK_RUNS_FILE, `${JSON.stringify(record)}\n`, { encoding: 'utf-8', mode: 0o600 });
}

function listTaskRunRecords(limit = 20) {
    const max = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 20;
    if (!fs.existsSync(TASK_RUNS_FILE)) {
        return [];
    }
    let content = '';
    try {
        content = fs.readFileSync(TASK_RUNS_FILE, 'utf-8');
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
            parsed.push(JSON.parse(rows[i]));
            if (parsed.length >= max) {
                break;
            }
        } catch (_) {}
    }
    return parsed;
}

function getTaskRunDetailPath(runId) {
    const validation = validateTaskRunId(runId);
    if (!validation.ok) {
        return '';
    }
    const baseDir = path.resolve(TASK_RUN_DETAILS_DIR);
    const detailPath = path.resolve(baseDir, `${validation.runId}.json`);
    if (!(detailPath === baseDir || detailPath.startsWith(`${baseDir}${path.sep}`))) {
        return '';
    }
    return detailPath;
}

function writeTaskRunDetail(detail = {}) {
    const detailPath = getTaskRunDetailPath(detail.runId);
    if (!detailPath) return;
    ensureDir(path.dirname(detailPath));
    writeJsonAtomic(detailPath, detail);
}

function readTaskRunDetail(runId) {
    const detailPath = getTaskRunDetailPath(runId);
    if (!detailPath) {
        return null;
    }
    const parsed = readJsonObjectFromFile(detailPath, {});
    if (!parsed.ok || !parsed.exists) {
        return null;
    }
    return parsed.data && typeof parsed.data === 'object' ? parsed.data : null;
}

function collectTaskRunSummary(detail = {}) {
    const run = detail.run && typeof detail.run === 'object' ? detail.run : {};
    const nodes = Array.isArray(run.nodes) ? run.nodes : [];
    return {
        runId: detail.runId || '',
        taskId: detail.taskId || '',
        title: detail.title || '',
        target: detail.target || '',
        engine: detail.engine || '',
        allowWrite: detail.allowWrite === true,
        dryRun: detail.dryRun === true,
        concurrency: detail.concurrency || 0,
        status: run.status || detail.status || '',
        startedAt: run.startedAt || detail.startedAt || '',
        endedAt: run.endedAt || detail.endedAt || '',
        durationMs: run.durationMs || 0,
        summary: run.summary || detail.summary || '',
        error: run.error || detail.error || '',
        nodeCount: nodes.length,
        successCount: nodes.filter((node) => node.status === 'success').length,
        failedCount: nodes.filter((node) => node.status === 'failed').length,
        blockedCount: nodes.filter((node) => node.status === 'blocked').length,
        cancelledCount: nodes.filter((node) => node.status === 'cancelled').length
    };
}

function buildTaskOverviewPayload(options = {}) {
    const queueLimit = Number.isFinite(options.queueLimit) ? Math.max(1, Math.floor(options.queueLimit)) : 20;
    const runLimit = Number.isFinite(options.runLimit) ? Math.max(1, Math.floor(options.runLimit)) : 20;
    const workflowCatalog = buildTaskWorkflowCatalog();
    const queue = listTaskQueueItems({ limit: queueLimit });
    const runs = listTaskRunRecords(runLimit);
    return {
        workflows: workflowCatalog.workflows,
        warnings: workflowCatalog.warnings,
        queue,
        runs,
        activeRunIds: Array.from(g_taskRunControllers.keys())
    };
}

function summarizeTaskLogs(logs = [], limit = 80) {
    return (Array.isArray(logs) ? logs : [])
        .slice(0, limit)
        .map((item) => {
            if (!item || typeof item !== 'object') {
                return String(item || '');
            }
            const at = item.at ? `[${item.at}] ` : '';
            const level = item.level ? `${String(item.level).toUpperCase()} ` : '';
            const message = item.message ? String(item.message) : '';
            return `${at}${level}${message}`.trim();
        })
        .filter(Boolean)
        .join('\n');
}

function findCodexSessionId(value, depth = 0) {
    if (depth > 6 || value === null || value === undefined) {
        return '';
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findCodexSessionId(item, depth + 1);
            if (found) return found;
        }
        return '';
    }
    if (typeof value !== 'object') {
        return '';
    }
    const candidateKeys = ['session_id', 'sessionId', 'conversation_id', 'conversationId', 'thread_id', 'threadId'];
    for (const key of candidateKeys) {
        const candidate = value[key];
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }
    for (const item of Object.values(value)) {
        const found = findCodexSessionId(item, depth + 1);
        if (found) return found;
    }
    return '';
}

function readCodexLastMessageFile(filePath) {
    if (!filePath) return '';
    try {
        return fs.readFileSync(filePath, 'utf-8').trim();
    } catch (_) {
        return '';
    }
}

async function runCodexExecTaskNode(node, context = {}) {
    const codexPath = resolveSpawnCommand('codex');
    const codexProbeCommand = process.platform === 'win32' ? 'codex' : codexPath;
    if (!commandExists(codexProbeCommand, '--version')) {
        return {
            success: false,
            error: '未找到 codex CLI，请先安装并确保 PATH 可用',
            summary: 'codex CLI 不可用',
            output: null,
            logs: [{ at: toIsoTime(Date.now()), level: 'error', message: 'codex CLI 不可用' }]
        };
    }
    const allowWrite = context.allowWrite === true && node.write === true;
    const cwd = typeof context.cwd === 'string' && context.cwd.trim() ? context.cwd.trim() : process.cwd();
    const dependencyResults = Array.isArray(context.dependencyResults) ? context.dependencyResults : [];
    const dependencyLines = dependencyResults
        .map((item) => {
            const summary = item && (item.summary || item.error) ? String(item.summary || item.error) : '';
            return summary ? `- ${item.id}: ${summary}` : '';
        })
        .filter(Boolean);
    const previousAttempts = Array.isArray(context.previousAttempts) ? context.previousAttempts : [];
    const lastAttempt = previousAttempts.length > 0 ? previousAttempts[previousAttempts.length - 1] : null;
    const attempt = Number.isFinite(context.attempt) ? context.attempt : 1;
    const promptParts = [String(node.prompt || '').trim()];
    if (dependencyLines.length > 0) {
        promptParts.push(`前置节点摘要:\n${dependencyLines.join('\n')}`);
    }
    if (attempt > 1 && lastAttempt) {
        promptParts.push(`上一轮失败摘要:\n${String(lastAttempt.error || lastAttempt.summary || '').trim()}`);
        promptParts.push('请在保持目标不变的前提下修复上一轮失败并继续完成当前节点。');
    }
    const finalPrompt = promptParts.filter(Boolean).join('\n\n');
    const tempRoot = path.join(TASK_RUN_DETAILS_DIR, 'tmp');
    ensureDir(tempRoot);
    const tempDir = fs.mkdtempSync(path.join(tempRoot, 'codex-'));
    const outputFile = path.join(tempDir, 'last-message.txt');
    const args = [
        '-a', 'never',
        '-s', allowWrite ? 'workspace-write' : 'read-only',
        '-C', cwd,
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--output-last-message', outputFile,
        finalPrompt
    ];
    const stdoutLines = [];
    const stderrLines = [];
    const parsedEvents = [];
    let sessionId = '';
    let stdoutPartial = '';
    let stderrPartial = '';
    const processCapturedLine = (bucket, line) => {
        const normalizedLine = String(line || '').trim();
        if (!normalizedLine) {
            return;
        }
        if (bucket.length < 120) {
            bucket.push(truncateTaskText(normalizedLine, 1200));
        }
        try {
            const payload = JSON.parse(normalizedLine);
            if (parsedEvents.length < 120) {
                parsedEvents.push(payload);
            }
            if (!sessionId) {
                sessionId = findCodexSessionId(payload);
            }
        } catch (_) {}
    };
    const captureLines = (bucket, text, stream) => {
        const currentPartial = stream === 'stderr' ? stderrPartial : stdoutPartial;
        const merged = `${currentPartial}${String(text || '')}`;
        const pieces = merged.split(/\r?\n/g);
        const nextPartial = pieces.pop() || '';
        if (stream === 'stderr') {
            stderrPartial = nextPartial;
        } else {
            stdoutPartial = nextPartial;
        }
        for (const line of pieces) {
            processCapturedLine(bucket, line);
        }
    };
    const flushCapturedPartial = (bucket, stream) => {
        const partial = stream === 'stderr' ? stderrPartial : stdoutPartial;
        if (stream === 'stderr') {
            stderrPartial = '';
        } else {
            stdoutPartial = '';
        }
        processCapturedLine(bucket, partial);
    };
    const exit = await new Promise((resolve) => {
        const child = spawn(codexPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            shell: process.platform === 'win32'
        });
        if (typeof context.registerAbort === 'function') {
            context.registerAbort(() => {
                try {
                    child.kill('SIGTERM');
                } catch (_) {}
            });
        }
        child.stdout.on('data', (chunk) => {
            captureLines(stdoutLines, chunk, 'stdout');
        });
        child.stderr.on('data', (chunk) => {
            captureLines(stderrLines, chunk, 'stderr');
        });
        child.on('error', (error) => {
            resolve({ code: 1, signal: '', error: error && error.message ? error.message : String(error || 'spawn failed') });
        });
        child.on('close', (code, signal) => {
            flushCapturedPartial(stdoutLines, 'stdout');
            flushCapturedPartial(stderrLines, 'stderr');
            resolve({ code: typeof code === 'number' ? code : 1, signal: signal || '', error: '' });
        });
    });
    const lastMessage = readCodexLastMessageFile(outputFile);
    try {
        if (fs.rmSync) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } else {
            fs.rmdirSync(tempDir, { recursive: true });
        }
    } catch (_) {}
    const success = exit.code === 0;
    const errorMessage = success
        ? ''
        : (exit.error || stderrLines[stderrLines.length - 1] || stdoutLines[stdoutLines.length - 1] || `codex exec exited with code ${exit.code}`);
    const summary = truncateTaskText(lastMessage || (success ? 'Codex 执行完成' : errorMessage), 400);
    return {
        success,
        error: errorMessage,
        summary,
        output: {
            exitCode: exit.code,
            signal: exit.signal || '',
            sessionId,
            lastMessage,
            events: parsedEvents,
            stdoutPreview: stdoutLines,
            stderrPreview: stderrLines
        },
        logs: [
            ...stdoutLines.map((line) => ({ at: toIsoTime(Date.now()), level: 'info', message: line })),
            ...stderrLines.map((line) => ({ at: toIsoTime(Date.now()), level: 'warn', message: line }))
        ]
    };
}

async function executeTaskNodeAdapter(node, context = {}) {
    if (node.kind === 'workflow') {
        const input = {
            ...(node.input && typeof node.input === 'object' && !Array.isArray(node.input) ? cloneJson(node.input, {}) : {}),
            task: {
                title: context.plan && context.plan.title ? context.plan.title : '',
                target: context.plan && context.plan.target ? context.plan.target : '',
                dependencyResults: cloneJson(context.dependencyResults || [], [])
            }
        };
        const result = await runWorkflowById(node.workflowId, input, {
            allowWrite: context.allowWrite === true,
            dryRun: context.dryRun === true
        });
        return {
            success: result && result.success === true,
            error: result && result.error ? result.error : '',
            summary: truncateTaskText(
                result && result.error
                    ? result.error
                    : `${result && result.workflowName ? result.workflowName : node.workflowId} ${result && result.success === true ? '完成' : '失败'}`,
                400
            ),
            output: cloneJson(result, null),
            logs: Array.isArray(result && result.steps)
                ? result.steps.map((step) => ({
                    at: step.startedAt || toIsoTime(Date.now()),
                    level: step.status === 'failed' ? 'error' : (step.status === 'skipped' ? 'warn' : 'info'),
                    message: `${step.id || step.tool || 'step'}: ${step.status || 'unknown'}${step.error ? ` (${step.error})` : ''}`
                }))
                : []
        };
    }
    return runCodexExecTaskNode(node, context);
}

async function runTaskPlanInternal(plan, options = {}) {
    const validation = validatePreparedTaskPlan(plan);
    if (!validation.ok) {
        return {
            error: validation.error || 'task plan validation failed',
            issues: validation.issues || [],
            warnings: validation.warnings || []
        };
    }
    const taskId = typeof options.taskId === 'string' && options.taskId.trim() ? options.taskId.trim() : (plan.id || createTaskId());
    const runId = typeof options.runId === 'string' && options.runId.trim() ? options.runId.trim() : createTaskRunId();
    const controller = new AbortController();
    const baseDetail = {
        runId,
        taskId,
        workerPid: process.pid,
        title: plan.title || '',
        target: plan.target || '',
        engine: normalizeTaskEngine(plan.engine),
        allowWrite: plan.allowWrite === true,
        dryRun: plan.dryRun === true,
        concurrency: Number.isFinite(plan.concurrency) ? plan.concurrency : 2,
        createdAt: toIsoTime(Date.now()),
        updatedAt: toIsoTime(Date.now()),
        warnings: validation.warnings || [],
        plan: cloneJson(plan, {})
    };
    writeTaskRunDetail({
        ...baseDetail,
        status: 'running',
        run: {
            status: 'running',
            startedAt: toIsoTime(Date.now()),
            endedAt: '',
            durationMs: 0,
            nodes: [],
            logs: []
        }
    });
    g_taskRunControllers.set(runId, {
        runId,
        taskId,
        controller,
        abort() {
            try {
                controller.abort();
            } catch (_) {}
        }
    });
    if (options.queueItem) {
        upsertTaskQueueItem({
            ...options.queueItem,
            taskId,
            status: 'running',
            runStatus: 'running',
            lastRunId: runId,
            lastSummary: '',
            updatedAt: toIsoTime(Date.now()),
            plan
        });
    }
    try {
        const run = await executeTaskPlan(plan, {
            concurrency: plan.concurrency,
            signal: controller.signal,
            executeNode: async (node, nodeContext) => executeTaskNodeAdapter(node, {
                ...nodeContext,
                plan,
                taskId,
                runId,
                allowWrite: plan.allowWrite === true,
                dryRun: plan.dryRun === true,
                cwd: plan.cwd || process.cwd()
            }),
            onUpdate: async (snapshot) => {
                const nextDetail = {
                    ...baseDetail,
                    updatedAt: toIsoTime(Date.now()),
                    status: snapshot.status || 'running',
                    run: snapshot
                };
                writeTaskRunDetail(nextDetail);
                if (options.queueItem) {
                    upsertTaskQueueItem({
                        ...options.queueItem,
                        taskId,
                        status: snapshot.status === 'success'
                            ? 'completed'
                            : (snapshot.status === 'failed' ? 'failed' : (snapshot.status === 'cancelled' ? 'cancelled' : 'running')),
                        runStatus: snapshot.status || 'running',
                        lastRunId: runId,
                        lastSummary: snapshot.summary || '',
                        updatedAt: toIsoTime(Date.now()),
                        plan
                    });
                }
            }
        });
        const detail = {
            ...baseDetail,
            updatedAt: toIsoTime(Date.now()),
            status: run.status || 'failed',
            run
        };
        writeTaskRunDetail(detail);
        appendTaskRunRecord(collectTaskRunSummary(detail));
        if (options.queueItem) {
            upsertTaskQueueItem({
                ...options.queueItem,
                taskId,
                status: run.status === 'success'
                    ? 'completed'
                    : (run.status === 'cancelled' ? 'cancelled' : 'failed'),
                runStatus: run.status || '',
                lastRunId: runId,
                lastSummary: run.summary || run.error || '',
                updatedAt: toIsoTime(Date.now()),
                plan
            });
        }
        return detail;
    } finally {
        g_taskRunControllers.delete(runId);
    }
}

function addTaskToQueue(params = {}) {
    const plan = coerceTaskPlanPayload(params || {});
    const validation = validatePreparedTaskPlan(plan);
    if (!validation.ok) {
        return {
            error: validation.error || 'task plan validation failed',
            issues: validation.issues || [],
            warnings: validation.warnings || []
        };
    }
    const taskId = typeof params.taskId === 'string' && params.taskId.trim() ? params.taskId.trim() : createTaskId();
    const item = upsertTaskQueueItem({
        taskId,
        title: plan.title,
        target: plan.target,
        status: 'queued',
        createdAt: toIsoTime(Date.now()),
        updatedAt: toIsoTime(Date.now()),
        engine: plan.engine,
        allowWrite: plan.allowWrite === true,
        dryRun: plan.dryRun === true,
        concurrency: plan.concurrency || 2,
        autoFixRounds: plan.autoFixRounds || 1,
        lastRunId: '',
        lastSummary: '',
        runStatus: '',
        plan
    });
    return {
        ok: true,
        task: item,
        warnings: validation.warnings || []
    };
}

async function runTaskNow(params = {}) {
    const rawRunId = params && typeof params.runId === 'string' ? params.runId.trim() : '';
    const runIdValidation = rawRunId
        ? validateTaskRunId(rawRunId)
        : { ok: true, runId: createTaskRunId(), error: '' };
    if (!runIdValidation.ok) {
        return { error: runIdValidation.error };
    }
    const plan = coerceTaskPlanPayload(params || {});
    const detail = await runTaskPlanInternal(plan, {
        taskId: typeof params.taskId === 'string' && params.taskId.trim() ? params.taskId.trim() : createTaskId(),
        runId: runIdValidation.runId
    });
    return detail;
}

async function runTaskQueueProcessingInternal(options = {}) {
    const taskId = typeof options.taskId === 'string' ? options.taskId.trim() : '';
    let latestDetail = null;
    while (true) {
        const queue = listTaskQueueItems({ limit: 200, status: 'queued' });
        const nextItem = taskId
            ? queue.find((item) => item.taskId === taskId)
            : queue[queue.length - 1];
        if (!nextItem) {
            break;
        }
        latestDetail = await runTaskPlanInternal(nextItem.plan, {
            taskId: nextItem.taskId,
            runId: createTaskRunId(),
            queueItem: nextItem
        });
        if (taskId) {
            break;
        }
    }
    return latestDetail;
}

async function startTaskQueueProcessing(options = {}) {
    const taskId = typeof options.taskId === 'string' ? options.taskId.trim() : '';
    const detach = options.detach === true;
    const queueItemById = taskId ? getTaskQueueItem(taskId) : null;
    if (taskId && !queueItemById) {
        return { error: `task not found: ${taskId}` };
    }
    if (queueItemById && queueItemById.status !== 'queued') {
        return { error: `task is not queued: ${taskId}` };
    }
    const detachedWorker = readTaskQueueWorkerState();
    const runner = async () => runTaskQueueProcessingInternal({ taskId });
    if (detach) {
        if (g_taskQueueProcessor || detachedWorker) {
            return {
                ok: true,
                started: false,
                alreadyRunning: true
            };
        }
        spawnDetachedTaskWorker({
            type: 'queue-runner',
            taskId
        });
        return {
            ok: true,
            started: true,
            detached: true
        };
    }
    if (detachedWorker) {
        return {
            ok: true,
            started: false,
            alreadyRunning: true
        };
    }
    if (g_taskQueueProcessor) {
        const detail = await g_taskQueueProcessor;
        return {
            ok: true,
            started: false,
            detached: false,
            detail,
            alreadyRunning: true
        };
    }
    g_taskQueueProcessor = runner()
        .catch(() => null)
        .finally(() => {
            g_taskQueueProcessor = null;
        });
    const detail = await g_taskQueueProcessor;
    return {
        ok: true,
        started: true,
        detached: false,
        detail
    };
}

async function retryTaskRun(params = {}) {
    const runIdValidation = validateTaskRunId(params && typeof params.runId === 'string' ? params.runId : '');
    if (!runIdValidation.ok) {
        return { error: runIdValidation.error };
    }
    const detail = readTaskRunDetail(runIdValidation.runId);
    if (!detail || !detail.plan) {
        return { error: `task run not found: ${runIdValidation.runId}` };
    }
    const plan = cloneJson(detail.plan, {});
    const detach = params.detach === true;
    const nextRunId = createTaskRunId();
    if (detach) {
        spawnDetachedTaskWorker({
            type: 'run-plan',
            plan,
            taskId: detail.taskId || createTaskId(),
            runId: nextRunId
        });
        return {
            ok: true,
            started: true,
            detached: true,
            runId: nextRunId,
            taskId: detail.taskId || ''
        };
    }
    return runTaskPlanInternal(plan, {
        taskId: detail.taskId || createTaskId(),
        runId: nextRunId
    });
}

function cancelTaskRunOrQueue(params = {}) {
    const rawTarget = typeof params.target === 'string' ? params.target.trim() : '';
    const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
    const taskId = typeof params.taskId === 'string' ? params.taskId.trim() : '';
    const target = rawTarget || runId || taskId;
    if (!target) {
        return { error: 'taskId or runId is required' };
    }
    const controllerByRun = g_taskRunControllers.get(target)
        || Array.from(g_taskRunControllers.values()).find((entry) => entry && entry.taskId === target);
    if (controllerByRun) {
        controllerByRun.abort();
        return {
            ok: true,
            cancelled: true,
            runId: controllerByRun.runId,
            taskId: controllerByRun.taskId,
            mode: 'running'
        };
    }
    const queueItem = getTaskQueueItem(target);
    if (queueItem) {
        if (queueItem.status === 'queued') {
            const next = upsertTaskQueueItem({
                ...queueItem,
                status: 'cancelled',
                runStatus: 'cancelled',
                updatedAt: toIsoTime(Date.now()),
                lastSummary: queueItem.lastSummary || '已取消'
            });
            return {
                ok: true,
                cancelled: true,
                task: next,
                mode: 'queued'
            };
        }
        if (queueItem.lastRunId && g_taskRunControllers.has(queueItem.lastRunId)) {
            const active = g_taskRunControllers.get(queueItem.lastRunId);
            active.abort();
            return {
                ok: true,
                cancelled: true,
                runId: active.runId,
                taskId: active.taskId,
                mode: 'running'
            };
        }
        if (queueItem.lastRunId) {
            const detachedResult = signalDetachedTaskWorker(readTaskRunDetail(queueItem.lastRunId) || {});
            if (!detachedResult.error) {
                return detachedResult;
            }
        }
        return {
            error: `task cannot be cancelled in current status: ${queueItem.status}`
        };
    }
    const detail = readTaskRunDetail(target);
    if (detail && g_taskRunControllers.has(detail.runId)) {
        const active = g_taskRunControllers.get(detail.runId);
        active.abort();
        return {
            ok: true,
            cancelled: true,
            runId: active.runId,
            taskId: active.taskId,
            mode: 'running'
        };
    }
    if (detail) {
        const detachedResult = signalDetachedTaskWorker(detail);
        if (!detachedResult.error) {
            return detachedResult;
        }
    }
    const detailByTaskId = findRunningTaskRunDetailByTaskId(target);
    if (detailByTaskId) {
        const detachedResult = signalDetachedTaskWorker(detailByTaskId);
        if (!detachedResult.error) {
            return detachedResult;
        }
    }
    return { error: `task/run not found: ${target}` };
}

function getTaskLogs(params = {}) {
    const runIdValidation = validateTaskRunId(params && typeof params.runId === 'string' ? params.runId : '');
    if (!runIdValidation.ok) {
        return { error: runIdValidation.error };
    }
    const detail = readTaskRunDetail(runIdValidation.runId);
    if (!detail) {
        return { error: `task run not found: ${runIdValidation.runId}` };
    }
    const run = detail.run && typeof detail.run === 'object' ? detail.run : {};
    const lines = [];
    for (const node of Array.isArray(run.nodes) ? run.nodes : []) {
        lines.push(`# ${node.id}${node.title ? ` ${node.title}` : ''}`);
        const body = summarizeTaskLogs(node.logs || [], 120);
        if (body) {
            lines.push(body);
        } else {
            lines.push('(no logs)');
        }
        lines.push('');
    }
    return {
        runId: runIdValidation.runId,
        logs: lines.join('\n').trim(),
        detail
    };
}

function writeDetachedTaskWorkerPayload(payload = {}) {
    const tempRoot = path.join(TASK_RUN_DETAILS_DIR, 'tmp');
    ensureDir(tempRoot);
    const payloadPath = path.join(tempRoot, `task-worker-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.json`);
    writeJsonAtomic(payloadPath, payload);
    return payloadPath;
}

function readDetachedTaskWorkerPayload(payloadPath = '') {
    const filePath = typeof payloadPath === 'string' ? payloadPath.trim() : '';
    if (!filePath) {
        return { error: 'task worker payload path is required' };
    }
    const parsed = readJsonObjectFromFile(filePath, {});
    try {
        fs.unlinkSync(filePath);
    } catch (_) {}
    if (!parsed.ok || !parsed.exists) {
        return { error: parsed.error || 'task worker payload not found' };
    }
    return { payload: parsed.data && typeof parsed.data === 'object' ? parsed.data : {} };
}

function spawnDetachedTaskWorker(payload = {}) {
    const payloadPath = writeDetachedTaskWorkerPayload(payload);
    const child = spawn(process.execPath, [__filename, '__task-worker', payloadPath], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true
    });
    child.on('error', () => {});
    if (typeof child.unref === 'function') {
        child.unref();
    }
    return {
        ok: true,
        detached: true,
        pid: child.pid || 0
    };
}

function isLiveProcessId(value) {
    const pid = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0;
    if (!pid) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (_) {
        return false;
    }
}

function readTaskQueueWorkerState() {
    const parsed = readJsonObjectFromFile(TASK_QUEUE_WORKER_FILE, {});
    if (!parsed.ok || !parsed.exists || !parsed.data || typeof parsed.data !== 'object') {
        return null;
    }
    const state = parsed.data;
    if (!isLiveProcessId(state.pid)) {
        try {
            fs.unlinkSync(TASK_QUEUE_WORKER_FILE);
        } catch (_) {}
        return null;
    }
    return state;
}

function writeTaskQueueWorkerState(state = {}) {
    ensureDir(path.dirname(TASK_QUEUE_WORKER_FILE));
    writeJsonAtomic(TASK_QUEUE_WORKER_FILE, {
        pid: process.pid,
        taskId: typeof state.taskId === 'string' ? state.taskId.trim() : '',
        startedAt: state.startedAt || toIsoTime(Date.now())
    });
}

function clearTaskQueueWorkerState() {
    try {
        fs.unlinkSync(TASK_QUEUE_WORKER_FILE);
    } catch (_) {}
}

function findRunningTaskRunDetailByTaskId(taskId = '') {
    const normalizedTaskId = typeof taskId === 'string' ? taskId.trim() : '';
    if (!normalizedTaskId || !fs.existsSync(TASK_RUN_DETAILS_DIR)) {
        return null;
    }
    let entries = [];
    try {
        entries = fs.readdirSync(TASK_RUN_DETAILS_DIR, { withFileTypes: true });
    } catch (_) {
        return null;
    }
    const candidates = [];
    for (const entry of entries) {
        if (!entry || !entry.isFile() || !entry.name.endsWith('.json')) {
            continue;
        }
        const detail = readTaskRunDetail(entry.name.slice(0, -5));
        if (!detail || detail.taskId !== normalizedTaskId) {
            continue;
        }
        const status = detail.run && detail.run.status ? detail.run.status : detail.status;
        if (status !== 'running') {
            continue;
        }
        candidates.push(detail);
    }
    candidates.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    return candidates[0] || null;
}

function signalDetachedTaskWorker(detail = {}) {
    const workerPid = Number.isFinite(Number(detail && detail.workerPid)) ? Math.floor(Number(detail.workerPid)) : 0;
    if (!workerPid) {
        return { error: 'task worker pid is missing' };
    }
    try {
        process.kill(workerPid, 'SIGTERM');
        return {
            ok: true,
            cancelled: true,
            runId: detail.runId || '',
            taskId: detail.taskId || '',
            workerPid,
            mode: 'running'
        };
    } catch (error) {
        return {
            error: error && error.code === 'ESRCH'
                ? `task worker is not running: ${workerPid}`
                : (error && error.message ? error.message : 'failed to signal task worker')
        };
    }
}

async function cmdTaskWorker(args = []) {
    const payloadResult = readDetachedTaskWorkerPayload(args[0] || '');
    if (payloadResult.error) {
        throw new Error(payloadResult.error);
    }
    const payload = payloadResult.payload || {};
    if (payload.type === 'run-plan') {
        const runId = typeof payload.runId === 'string' ? payload.runId.trim() : '';
        const taskId = typeof payload.taskId === 'string' ? payload.taskId.trim() : '';
        let cancelRequested = false;
        const cancelHandler = () => {
            if (cancelRequested) return;
            cancelRequested = true;
            cancelTaskRunOrQueue({ runId, taskId });
        };
        process.once('SIGTERM', cancelHandler);
        process.once('SIGINT', cancelHandler);
        try {
            const detail = await runTaskPlanInternal(payload.plan || {}, { taskId, runId });
            if (detail && detail.error) {
                throw new Error(detail.error);
            }
            if (detail && detail.run && detail.run.status === 'failed') {
                throw new Error(detail.run.error || 'task run failed');
            }
            return;
        } finally {
            process.removeListener('SIGTERM', cancelHandler);
            process.removeListener('SIGINT', cancelHandler);
        }
    }
    if (payload.type === 'queue-runner') {
        writeTaskQueueWorkerState({ taskId: payload.taskId || '', startedAt: toIsoTime(Date.now()) });
        try {
            await runTaskQueueProcessingInternal({ taskId: payload.taskId || '' });
            return;
        } finally {
            clearTaskQueueWorkerState();
        }
    }
    throw new Error(`unknown task worker payload type: ${payload.type || ''}`);
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
        description: 'Get Codex config template with optional provider/model/service tier/reasoning effort/context budget.',
        readOnly: true,
        inputSchema: {
            type: 'object',
            properties: {
                provider: { type: 'string' },
                model: { type: 'string' },
                serviceTier: { type: 'string' },
                reasoningEffort: { type: 'string' },
                modelContextWindow: { type: ['string', 'number'] },
                modelAutoCompactTokenLimit: { type: ['string', 'number'] }
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
                sessions: await listSessionBrowse(normalizedInput),
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
        name: 'codexmate.claude_proxy.status',
        description: 'Get builtin Claude-compatible proxy runtime status and persisted config.',
        readOnly: true,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => getBuiltinClaudeProxyStatus()
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
        name: 'codexmate.session.trash',
        description: 'Move one entire session file into session trash.',
        readOnly: false,
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string' },
                sessionId: { type: 'string' },
                filePath: { type: 'string' },
                file: { type: 'string' }
            },
            additionalProperties: true
        },
        handler: async (args = {}) => trashSessionData(args || {})
    });

    pushTool({
        name: 'codexmate.session.delete',
        description: 'Permanently delete one entire session file.',
        readOnly: false,
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string' },
                sessionId: { type: 'string' },
                filePath: { type: 'string' },
                file: { type: 'string' }
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
        name: 'codexmate.claude_proxy.start',
        description: 'Start builtin Claude-compatible proxy runtime with optional overrides.',
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
        handler: async (args = {}) => startBuiltinClaudeProxyRuntime(args || {})
    });

    pushTool({
        name: 'codexmate.proxy.stop',
        description: 'Stop builtin proxy runtime.',
        readOnly: false,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => stopBuiltinProxyRuntime()
    });

    pushTool({
        name: 'codexmate.claude_proxy.stop',
        description: 'Stop builtin Claude-compatible proxy runtime.',
        readOnly: false,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => stopBuiltinClaudeProxyRuntime()
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
                    sessions: await listSessionBrowse({
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
            Promise.allSettled([
                stopBuiltinProxyRuntime(),
                stopBuiltinClaudeProxyRuntime()
            ]).finally(() => resolve());
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
        console.log('  codexmate workflow <list|get|validate|run|runs>  MCP 工作流中心');
        console.log('  codexmate task <plan|run|runs|queue|retry|cancel|logs>  本地任务编排');
        console.log('  codexmate run [--host <HOST>] [--no-browser]    启动 Web 界面');
        console.log('  codexmate codex [参数...] [--follow-up <文本>|--queued-follow-up <文本> 可重复]  等同于 codex --yolo');
        console.log('    注: follow-up 自动排队仅支持 linux/android/netbsd/openbsd/darwin/freebsd 且 stdin 必须是 TTY，其他平台会报错');
        console.log('  codexmate qwen [参数...]   等同于 qwen --yolo');
        console.log('  codexmate mcp [serve] [--transport stdio] [--allow-write|--read-only]');
        console.log('  codexmate export-session --source <codex|claude> (--session-id <ID>|--file <PATH>) [--output <PATH>] [--max-messages <N|all|Infinity>]');
        console.log('  codexmate zip <路径> [--max:级别]  压缩（系统 zip 优先，其次 zip-lib）');
        console.log('  codexmate unzip <zip文件> [输出目录]  解压（zip-lib）');
        console.log('  codexmate unzip-ext <zip目录> [输出目录] [--ext:后缀[,后缀...]] [--no-recursive]  批量提取 ZIP 指定后缀文件（默认递归）');
        console.log('');
        process.exit(0);
    }

    switch (command) {
        case '__task-worker': await cmdTaskWorker(args.slice(1)); break;
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
        case 'task': await cmdTask(args.slice(1)); break;
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
        case 'mcp': await cmdMcp(args.slice(1)); break;
        case 'export-session': await cmdExportSession(args.slice(1)); break;
        case 'zip': {
            const { targetPath, options } = parseZipCommandArgs(args.slice(1));
            await cmdZip(targetPath, options);
            break;
        }
        case 'unzip': await cmdUnzip(args[1], args[2]); break;
        case 'unzip-ext': {
            const { zipDirPath, outputDir, options } = parseUnzipExtCommandArgs(args.slice(1));
            await cmdUnzipExt(zipDirPath, outputDir, options);
            break;
        }
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
