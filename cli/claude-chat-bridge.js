const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const { createInterface } = require('readline');
const EventEmitter = require('events');
const { URL } = require('url');

function createUuid() {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }
    const bytes = crypto.randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch (_) {
        return null;
    }
}

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeBase64ProjectParam(value) {
    const raw = normalizeText(value);
    if (!raw) return '';
    try {
        return Buffer.from(raw, 'base64').toString('utf-8');
    } catch (_) {
        return raw;
    }
}

function resolveMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.js') return 'application/javascript; charset=utf-8';
    if (ext === '.css') return 'text/css; charset=utf-8';
    if (ext === '.html') return 'text/html; charset=utf-8';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.png') return 'image/png';
    if (ext === '.json') return 'application/json; charset=utf-8';
    if (ext === '.woff2') return 'font/woff2';
    if (ext === '.woff') return 'font/woff';
    return 'application/octet-stream';
}

function isWebSocketUpgrade(req) {
    const upgrade = (req.headers.upgrade || '').toLowerCase();
    const connection = (req.headers.connection || '').toLowerCase();
    return upgrade === 'websocket' && connection.includes('upgrade');
}

function createWebSocketAccept(key) {
    const magic = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    return crypto.createHash('sha1').update(`${key}${magic}`, 'binary').digest('base64');
}

function writeWebSocketFrame(socket, opcode, payload) {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '');
    const length = body.length;
    let header;
    if (length < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x80 | (opcode & 0x0f);
        header[1] = length;
    } else if (length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | (opcode & 0x0f);
        header[1] = 126;
        header.writeUInt16BE(length, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | (opcode & 0x0f);
        header[1] = 127;
        header.writeUInt32BE(0, 2);
        header.writeUInt32BE(length, 6);
    }
    socket.write(Buffer.concat([header, body]));
}

function createWebSocketConnection(socket) {
    let buffer = Buffer.alloc(0);
    let open = true;
    const messageHandlers = new Set();
    const closeHandlers = new Set();

    const sendText = (text) => {
        if (!open) return;
        writeWebSocketFrame(socket, 0x1, Buffer.from(String(text || ''), 'utf8'));
    };

    const close = () => {
        if (!open) return;
        open = false;
        try {
            writeWebSocketFrame(socket, 0x8, Buffer.alloc(0));
        } catch (_) {}
        try {
            socket.end();
        } catch (_) {}
    };

    const fireClose = () => {
        if (!open) return;
        open = false;
        for (const handler of closeHandlers) {
            try {
                handler();
            } catch (_) {}
        }
        closeHandlers.clear();
        messageHandlers.clear();
    };

    const feed = (chunk) => {
        if (!open) return;
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
            const first = buffer[0];
            const second = buffer[1];
            const opcode = first & 0x0f;
            const masked = (second & 0x80) === 0x80;
            let length = second & 0x7f;
            let offset = 2;
            if (length === 126) {
                if (buffer.length < offset + 2) return;
                length = buffer.readUInt16BE(offset);
                offset += 2;
            } else if (length === 127) {
                if (buffer.length < offset + 8) return;
                const high = buffer.readUInt32BE(offset);
                const low = buffer.readUInt32BE(offset + 4);
                if (high !== 0) {
                    close();
                    return;
                }
                length = low;
                offset += 8;
            }
            let maskKey = null;
            if (masked) {
                if (buffer.length < offset + 4) return;
                maskKey = buffer.slice(offset, offset + 4);
                offset += 4;
            }
            const frameEnd = offset + length;
            if (buffer.length < frameEnd) return;
            let payload = buffer.slice(offset, frameEnd);
            buffer = buffer.slice(frameEnd);
            if (masked && maskKey) {
                payload = Buffer.from(payload);
                for (let i = 0; i < payload.length; i += 1) {
                    payload[i] ^= maskKey[i % 4];
                }
            }

            if (opcode === 0x8) {
                close();
                fireClose();
                return;
            }
            if (opcode === 0x9) {
                writeWebSocketFrame(socket, 0xa, payload);
                continue;
            }
            if (opcode === 0x1) {
                const text = payload.toString('utf8');
                for (const handler of messageHandlers) {
                    try {
                        handler(text);
                    } catch (_) {}
                }
            }
        }
    };

    socket.on('data', feed);
    socket.on('end', fireClose);
    socket.on('close', fireClose);
    socket.on('error', fireClose);

    return {
        get isOpen() {
            return open;
        },
        send(text) {
            sendText(text);
        },
        sendJson(payload) {
            sendText(JSON.stringify(payload));
        },
        onMessage(handler) {
            if (typeof handler === 'function') {
                messageHandlers.add(handler);
            }
        },
        onClose(handler) {
            if (typeof handler === 'function') {
                closeHandlers.add(handler);
            }
        },
        close
    };
}

function detectClaudeExtensionDirs() {
    const home = os.homedir();
    const candidates = [];
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || '';
        const userProfile = process.env.USERPROFILE || home;
        for (const base of [appData, userProfile]) {
            if (!base) continue;
            candidates.push(path.join(base, 'Code', 'User', 'globalStorage'));
        }
    }
    candidates.push(path.join(home, '.vscode', 'extensions'));
    candidates.push(path.join(home, '.vscode-insiders', 'extensions'));
    candidates.push(path.join(home, '.vscode-server', 'extensions'));
    candidates.push(path.join(home, '.vscode-server-insiders', 'extensions'));
    candidates.push(path.join(home, '.cursor', 'extensions'));
    candidates.push(path.join(home, '.windsurf', 'extensions'));
    return candidates;
}

function resolveClaudeExtensionPath() {
    const roots = detectClaudeExtensionDirs();
    const matches = [];
    for (const root of roots) {
        try {
            const entries = fs.readdirSync(root, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const name = entry.name || '';
                if (!name.startsWith('anthropic.claude-code-')) continue;
                const full = path.join(root, name);
                const webviewDir = path.join(full, 'webview');
                const resourcesDir = path.join(full, 'resources');
                if (!fs.existsSync(webviewDir) || !fs.existsSync(resourcesDir)) {
                    continue;
                }
                const stat = fs.statSync(full);
                matches.push({ dir: full, mtimeMs: stat.mtimeMs });
            }
        } catch (_) {}
    }
    matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return matches[0] ? matches[0].dir : '';
}

function resolveClaudeBinaryPath(extensionPath) {
    const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const candidate = extensionPath
        ? path.join(extensionPath, 'resources', 'native-binary', binaryName)
        : '';
    if (candidate) {
        try {
            if (fs.existsSync(candidate)) {
                execSync(`"${candidate}" --version`, { timeout: 5000, stdio: 'ignore' });
                return candidate;
            }
        } catch (_) {}
    }
    try {
        if (process.platform !== 'win32') {
            const resolved = execSync('which claude', { timeout: 5000, encoding: 'utf-8' }).trim();
            if (resolved) {
                return resolved;
            }
        }
    } catch (_) {}
    return 'claude';
}

class ClaudeProcess extends EventEmitter {
    constructor(claudeBinaryPath) {
        super();
        this.claudeBinaryPath = claudeBinaryPath;
        this.process = null;
        this.exited = false;
    }

    spawn(options) {
        const args = [
            '-p',
            '--output-format', 'stream-json',
            '--input-format', 'stream-json',
            '--verbose',
            '--allow-dangerously-skip-permissions',
            '--permission-prompt-tool', 'stdio'
        ];
        if (options.model) {
            args.push('--model', options.model);
        }
        if (options.permissionMode) {
            args.push('--permission-mode', options.permissionMode);
        }
        if (options.resume) {
            args.push('--resume', options.resume);
        }
        if (options.thinkingLevel) {
            args.push('--thinking', options.thinkingLevel);
        }
        this.process = spawn(this.claudeBinaryPath, args, {
            cwd: options.cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            env: { ...process.env }
        });

        const stdoutRl = createInterface({ input: this.process.stdout });
        stdoutRl.on('line', (line) => {
            const trimmed = String(line || '').trim();
            if (!trimmed) return;
            const parsed = safeJsonParse(trimmed);
            if (parsed) {
                this.emit('message', parsed);
            } else {
                this.emit('stderr', trimmed);
            }
        });

        const stderrRl = createInterface({ input: this.process.stderr });
        stderrRl.on('line', (line) => {
            const trimmed = String(line || '').trim();
            if (trimmed) {
                this.emit('stderr', trimmed);
            }
        });

        this.process.on('exit', (code, signal) => {
            this.exited = true;
            this.emit('exit', code, signal);
        });

        this.process.on('error', (error) => {
            this.exited = true;
            this.emit('error', error);
        });
    }

    writeStdin(message) {
        if (!this.process || this.exited) return;
        try {
            this.process.stdin.write(`${JSON.stringify(message)}\n`);
        } catch (_) {}
    }

    interrupt() {
        if (!this.process || this.exited) return;
        this.writeStdin({
            type: 'control_request',
            request_id: createUuid(),
            request: { subtype: 'interrupt' }
        });
    }

    kill() {
        if (!this.process || this.exited) return;
        try {
            this.process.kill();
        } catch (_) {}
        this.exited = true;
    }
}

class SessionManager {
    constructor(options = {}) {
        this.sessions = new Map();
        this.claudeBinaryPath = options.claudeBinaryPath || 'claude';
        this.defaultPermissionMode = options.defaultPermissionMode || 'bypassPermissions';
        this.defaultModel = options.defaultModel || '';
    }

    createSession(channelId, projectPath, options = {}) {
        if (this.sessions.has(channelId)) {
            this.destroySession(channelId);
        }
        const proc = new ClaudeProcess(this.claudeBinaryPath);
        const session = {
            channelId,
            projectPath,
            process: proc,
            connections: new Set(),
            permissionMode: options.permissionMode || this.defaultPermissionMode,
            model: options.model || this.defaultModel,
            state: 'running',
            pendingControlRequests: new Map(),
            claudeConfig: null,
            claudeConfigResolvers: [],
            pendingOutboundControl: new Map(),
            resumeId: options.resume || '',
            idleTimer: null
        };

        this.sessions.set(channelId, session);
        if (options.initialConnection) {
            session.connections.add(options.initialConnection);
        }

        proc.spawn({
            cwd: projectPath,
            model: session.model,
            permissionMode: session.permissionMode,
            resume: options.resume,
            thinkingLevel: options.thinkingLevel
        });

        proc.writeStdin({
            type: 'control_request',
            request_id: createUuid(),
            request: { subtype: 'initialize' }
        });

        proc.on('message', (msg) => {
            if (msg && msg.type === 'control_response') {
                const reqId = msg.response && msg.response.request_id ? msg.response.request_id : '';
                const pending = reqId ? session.pendingOutboundControl.get(reqId) : null;
                if (pending) {
                    session.pendingOutboundControl.delete(reqId);
                    if (msg.response && msg.response.subtype === 'success') {
                        pending.resolve(msg.response);
                    } else {
                        pending.reject(new Error(msg.response && msg.response.error ? msg.response.error : 'control_request failed'));
                    }
                    return;
                }
                if (msg.response && msg.response.subtype === 'success' && msg.response.response && msg.response.response.commands) {
                    session.claudeConfig = msg.response.response;
                    if (msg.response.response.permission_mode) {
                        session.permissionMode = msg.response.response.permission_mode;
                    }
                    const resolvers = session.claudeConfigResolvers.slice();
                    session.claudeConfigResolvers.length = 0;
                    for (const resolve of resolvers) {
                        try {
                            resolve(session.claudeConfig);
                        } catch (_) {}
                    }
                    return;
                }
                return;
            }
            if (msg && msg.type === 'control_request') {
                this.handleControlRequest(session, msg);
                return;
            }
            if (msg && msg.session_id && !session.resumeId) {
                session.resumeId = msg.session_id;
            }
            this.broadcastToSession(channelId, {
                type: 'from-extension',
                message: { type: 'io_message', channelId, message: msg, done: false }
            });
            if (msg && msg.type === 'system' && msg.subtype === 'init') {
                this.broadcastToSession(channelId, {
                    type: 'from-extension',
                    message: {
                        type: 'io_message',
                        channelId,
                        message: { type: 'system', subtype: 'status', permissionMode: session.permissionMode },
                        done: false
                    }
                });
            }
        });

        proc.on('exit', (code) => {
            session.state = 'closed';
            const resolvers = session.claudeConfigResolvers.slice();
            session.claudeConfigResolvers.length = 0;
            for (const resolve of resolvers) {
                try {
                    resolve(null);
                } catch (_) {}
            }
            this.broadcastToSession(channelId, {
                type: 'from-extension',
                message: {
                    type: 'io_message',
                    channelId,
                    message: { type: 'result', subtype: code === 0 ? 'success' : 'error', is_error: code !== 0 },
                    done: true
                }
            });
            if (session.connections.size === 0 && this.sessions.get(channelId) === session) {
                this.clearIdleTimer(session);
                this.sessions.delete(channelId);
            }
        });

        return session;
    }

    attachConnection(channelId, connection) {
        const session = this.sessions.get(channelId);
        if (!session) return;
        this.clearIdleTimer(session);
        session.connections.add(connection);
    }

    detachConnection(channelId, connection) {
        const session = this.sessions.get(channelId);
        if (!session) return;
        session.connections.delete(connection);
        if (session.connections.size === 0 && session.state !== 'closed') {
            this.startIdleTimer(session);
        }
    }

    startIdleTimer(session) {
        this.clearIdleTimer(session);
        session.idleTimer = setTimeout(() => {
            if (this.sessions.get(session.channelId) !== session) return;
            this.destroySession(session.channelId);
        }, 30 * 60 * 1000);
    }

    clearIdleTimer(session) {
        if (session.idleTimer) {
            clearTimeout(session.idleTimer);
            session.idleTimer = null;
        }
    }

    broadcastToSession(channelId, payload) {
        const session = this.sessions.get(channelId);
        if (!session) return;
        const message = JSON.stringify(payload);
        for (const conn of session.connections) {
            try {
                if (conn && conn.isOpen) {
                    conn.send(message);
                }
            } catch (_) {}
        }
    }

    getSession(channelId) {
        return this.sessions.get(channelId);
    }

    findRunningSessionByResumeId(resumeId) {
        const normalized = normalizeText(resumeId);
        if (!normalized) return null;
        for (const session of this.sessions.values()) {
            if (session.state !== 'closed' && session.resumeId === normalized) {
                return session;
            }
        }
        return null;
    }

    findSessionByControlRequestId(serverReqId) {
        const normalized = normalizeText(serverReqId);
        if (!normalized) return null;
        for (const session of this.sessions.values()) {
            if (session.pendingControlRequests.has(normalized)) {
                return session;
            }
        }
        return null;
    }

    async waitForClaudeConfig(session, timeoutMs = 30000) {
        if (session.claudeConfig) {
            return session.claudeConfig;
        }
        return await new Promise((resolve) => {
            const timer = setTimeout(() => {
                const idx = session.claudeConfigResolvers.indexOf(wrapper);
                if (idx >= 0) session.claudeConfigResolvers.splice(idx, 1);
                resolve(null);
            }, timeoutMs);
            const wrapper = (config) => {
                clearTimeout(timer);
                resolve(config);
            };
            session.claudeConfigResolvers.push(wrapper);
        });
    }

    handleControlRequest(session, msg) {
        const serverReqId = createUuid();
        session.pendingControlRequests.set(serverReqId, msg.request_id);
        const req = msg.request || {};
        this.broadcastToSession(session.channelId, {
            type: 'from-extension',
            message: {
                type: 'request',
                channelId: session.channelId,
                requestId: serverReqId,
                request: {
                    type: 'tool_permission_request',
                    toolName: req.tool_name || req.toolName || '',
                    inputs: req.input || req.inputs || {},
                    suggestions: req.suggestions || []
                }
            }
        });
    }

    respondToControlRequest(session, serverReqId, response) {
        const claudeReqId = session.pendingControlRequests.get(serverReqId);
        if (!claudeReqId) return;
        session.pendingControlRequests.delete(serverReqId);
        session.process.writeStdin({
            type: 'control_response',
            response: {
                subtype: 'success',
                request_id: claudeReqId,
                response
            }
        });
    }

    sendControlRequest(session, request, timeoutMs = 10000) {
        const requestId = createUuid();
        session.process.writeStdin({
            type: 'control_request',
            request_id: requestId,
            request
        });
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                session.pendingOutboundControl.delete(requestId);
                reject(new Error(`control_request timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            session.pendingOutboundControl.set(requestId, {
                resolve: (resp) => {
                    clearTimeout(timer);
                    resolve(resp);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                }
            });
        });
    }

    destroySession(channelId) {
        const session = this.sessions.get(channelId);
        if (!session) return;
        this.clearIdleTimer(session);
        session.process.kill();
        session.state = 'closed';
        this.sessions.delete(channelId);
    }

    listDiskSessions(projectPath) {
        const encoded = this.encodeProjectPath(projectPath);
        const projectDir = this.findProjectDir(encoded);
        if (!projectDir) return [];
        const sessions = [];
        let files;
        try {
            files = fs.readdirSync(projectDir, { withFileTypes: true });
        } catch (_) {
            return [];
        }
        for (const entry of files) {
            if (!entry.isFile()) continue;
            if (!entry.name.endsWith('.jsonl')) continue;
            const id = entry.name.slice(0, -5);
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) continue;
            const filePath = path.join(projectDir, entry.name);
            try {
                const stat = fs.statSync(filePath);
                if (!stat || stat.size <= 0) continue;
                sessions.push({
                    id,
                    lastModified: stat.mtime.getTime(),
                    fileSize: stat.size,
                    summary: null,
                    gitBranch: null,
                    isCurrentWorkspace: true
                });
            } catch (_) {}
        }
        sessions.sort((a, b) => b.lastModified - a.lastModified);
        return sessions;
    }

    encodeProjectPath(projectPath) {
        return path.normalize(projectPath).replace(/[^a-zA-Z0-9]/g, '-');
    }

    findProjectDir(encoded) {
        const projectsDir = path.join(os.homedir(), '.claude', 'projects');
        const exact = path.join(projectsDir, encoded);
        try {
            if (fs.existsSync(exact) && fs.statSync(exact).isDirectory()) {
                return exact;
            }
        } catch (_) {}
        if (encoded.length <= 200) return '';
        const prefix = encoded.slice(0, 200);
        try {
            const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (entry.name.startsWith(`${prefix}-`)) {
                    return path.join(projectsDir, entry.name);
                }
            }
        } catch (_) {}
        return '';
    }
}

function buildInitResponse(channelId, cwd, sessionManager) {
    const session = channelId ? sessionManager.getSession(channelId) : null;
    return {
        type: 'init_response',
        state: {
            defaultCwd: (session && session.projectPath) ? session.projectPath : (cwd || ''),
            openNewInTab: false,
            showTerminalBanner: false,
            showReviewUpsellBanner: false,
            isOnboardingEnabled: false,
            isOnboardingDismissed: true,
            authStatus: { isLoggedIn: true },
            modelSetting: session ? session.model : sessionManager.defaultModel,
            thinkingLevel: 'adaptive',
            initialPermissionMode: session ? session.permissionMode : sessionManager.defaultPermissionMode,
            allowDangerouslySkipPermissions: true,
            platform: process.platform,
            speechToTextEnabled: false,
            marketplaceType: 'none',
            useCtrlEnterToSend: false,
            chromeMcpState: { status: 'disconnected' },
            browserIntegrationSupported: false,
            debuggerMcpState: { status: 'disconnected' },
            jupyterMcpState: { status: 'disconnected' },
            remoteControlState: { enabled: false },
            spinnerVerbsConfig: null,
            settings: { permissions: { allow: [], deny: [], ask: [] } },
            claudeSettings: {
                effective: { permissions: { allow: [], deny: [], ask: [] } },
                permissions: { allow: [], deny: [], ask: [] }
            },
            currentRepo: null,
            experimentGates: {}
        }
    };
}

function createMessageHandler(sessionManager) {
    const respondEnvelope = (conn, requestId, response) => {
        conn.sendJson({
            type: 'from-extension',
            message: { type: 'response', requestId, response }
        });
    };

    const handleLaunch = (conn, msg) => {
        const webviewChannelId = normalizeText(msg.channelId) || createUuid();
        const resume = normalizeText(msg.resume);
        const cwd = normalizeText(msg.cwd) || process.cwd();
        const model = normalizeText(msg.model);
        const permissionMode = normalizeText(msg.permissionMode) || sessionManager.defaultPermissionMode;
        const thinkingLevel = normalizeText(msg.thinkingLevel);

        let existing = sessionManager.getSession(webviewChannelId);
        if ((!existing || existing.state === 'closed') && resume) {
            existing = sessionManager.findRunningSessionByResumeId(resume);
        }
        if (existing && existing.state !== 'closed') {
            const serverChannelId = existing.channelId;
            sessionManager.attachConnection(serverChannelId, conn);
            if (webviewChannelId !== serverChannelId) {
                conn.sendJson({
                    type: 'channel_remap',
                    webviewChannelId,
                    serverChannelId
                });
            }
            if (existing.claudeConfig) {
                const initState = buildInitResponse(serverChannelId, cwd, sessionManager);
                initState.state.initialPermissionMode = existing.permissionMode;
                conn.sendJson({
                    type: 'from-extension',
                    message: {
                        type: 'request',
                        channelId: serverChannelId,
                        requestId: createUuid(),
                        request: {
                            type: 'update_state',
                            state: initState.state,
                            config: existing.claudeConfig
                        }
                    }
                });
            }
            conn.sendJson({
                type: 'from-extension',
                message: {
                    type: 'io_message',
                    channelId: serverChannelId,
                    message: { type: 'system', subtype: 'status', permissionMode: existing.permissionMode },
                    done: false
                }
            });
            return serverChannelId;
        }

        const session = sessionManager.createSession(webviewChannelId, cwd, {
            model: model || sessionManager.defaultModel,
            permissionMode,
            resume: resume || '',
            thinkingLevel,
            initialConnection: conn
        });

        sessionManager.waitForClaudeConfig(session).then((claudeConfig) => {
            const effectiveConfig = claudeConfig || { commands: [], models: [], agents: [] };
            const initState = buildInitResponse(webviewChannelId, cwd, sessionManager);
            initState.state.initialPermissionMode = permissionMode;
            sessionManager.broadcastToSession(webviewChannelId, {
                type: 'from-extension',
                message: {
                    type: 'request',
                    channelId: webviewChannelId,
                    requestId: createUuid(),
                    request: {
                        type: 'update_state',
                        state: initState.state,
                        config: effectiveConfig
                    }
                }
            });
            if (resume) {
                sessionManager.broadcastToSession(webviewChannelId, {
                    type: 'from-extension',
                    message: {
                        type: 'io_message',
                        channelId: webviewChannelId,
                        message: { type: 'system', subtype: 'status', permissionMode },
                        done: false
                    }
                });
            }
        }).catch(() => {});

        return webviewChannelId;
    };

    const handleRequest = (conn, msg) => {
        const requestId = normalizeText(msg.requestId);
        const channelId = normalizeText(msg.channelId);
        const request = msg.request || {};
        const cwd = normalizeText(msg.cwd);

        const respond = (payload) => {
            respondEnvelope(conn, requestId, payload);
        };

        if (request.type === 'init') {
            respond(buildInitResponse(channelId, cwd, sessionManager));
            return;
        }

        if (request.type === 'list_sessions_request') {
            const session = channelId ? sessionManager.getSession(channelId) : null;
            const projectPath = (session && session.projectPath) ? session.projectPath : (normalizeText(request.cwd) || cwd || '');
            respond({
                type: 'list_sessions_response',
                sessions: projectPath ? sessionManager.listDiskSessions(projectPath) : []
            });
            return;
        }

        if (request.type === 'get_asset_uris') {
            respond({ type: 'get_asset_uris_response', uris: {} });
            return;
        }

        if (request.type === 'get_claude_state') {
            const session = channelId ? sessionManager.getSession(channelId) : null;
            respond({ type: 'get_claude_state_response', config: session ? session.claudeConfig : null, state: {} });
            return;
        }

        if (request.type === 'set_permission_mode') {
            const session = channelId ? sessionManager.getSession(channelId) : null;
            if (session) {
                session.permissionMode = request.mode;
                sessionManager.sendControlRequest(session, { subtype: 'set_permission_mode', mode: request.mode }).catch(() => {});
            }
            respond({ type: 'set_permission_mode_response', success: true });
            return;
        }

        if (request.type === 'set_model') {
            const session = channelId ? sessionManager.getSession(channelId) : null;
            if (session) {
                session.model = request.model;
                sessionManager.sendControlRequest(session, { subtype: 'set_model', model: request.model }).catch(() => {});
            }
            respond({ type: 'set_model_response', success: true });
            return;
        }

        respond({ type: `${request.type || 'unknown'}_response`, success: true });
    };

    const handleResponse = (msg) => {
        const requestId = normalizeText(msg.requestId);
        const channelId = normalizeText(msg.channelId);
        const response = msg.response || {};
        if (response.type !== 'tool_permission_response') {
            return;
        }
        let session = channelId ? sessionManager.getSession(channelId) : null;
        if (!session) {
            session = sessionManager.findSessionByControlRequestId(requestId);
        }
        if (!session) return;
        sessionManager.respondToControlRequest(session, requestId, response.result || response);
    };

    return {
        handleInbound(conn, msg) {
            const type = normalizeText(msg && msg.type);
            if (type === 'launch_claude') {
                return handleLaunch(conn, msg);
            }
            if (type === 'io_message') {
                const session = sessionManager.getSession(normalizeText(msg.channelId));
                if (session && msg.message) {
                    session.process.writeStdin(msg.message);
                }
                return '';
            }
            if (type === 'interrupt_claude') {
                const session = sessionManager.getSession(normalizeText(msg.channelId));
                if (session) session.process.interrupt();
                return '';
            }
            if (type === 'close_channel') {
                sessionManager.destroySession(normalizeText(msg.channelId));
                return '';
            }
            if (type === 'request') {
                handleRequest(conn, msg);
                return '';
            }
            if (type === 'response') {
                handleResponse(msg);
                return '';
            }
            return '';
        }
    };
}

function createClaudeChatBridge(options = {}) {
    const projectRoot = options.projectRoot || path.join(__dirname, '..');
    const extensionPath = resolveClaudeExtensionPath();
    const claudeBinaryPath = resolveClaudeBinaryPath(extensionPath);
    const sessionManager = new SessionManager({
        claudeBinaryPath,
        defaultPermissionMode: options.defaultPermissionMode || 'bypassPermissions',
        defaultModel: options.defaultModel || ''
    });
    const messageHandler = createMessageHandler(sessionManager);
    const hostTemplatePath = path.join(projectRoot, 'web-ui', 'claude-chat', 'host.html');
    const shimPath = path.join(projectRoot, 'web-ui', 'claude-chat', 'shim.js');
    const cssVarsPath = path.join(projectRoot, 'web-ui', 'claude-chat', 'css-variables.css');

    const readTextFile = (filePath) => {
        try {
            return fs.readFileSync(filePath, 'utf8');
        } catch (_) {
            return '';
        }
    };

    const resolveWsUrl = (req) => {
        const host = req.headers.host || 'localhost';
        return `ws://${host}/ws`;
    };

    const serveText = (res, statusCode, mime, content) => {
        const body = typeof content === 'string' ? content : String(content || '');
        res.writeHead(statusCode, {
            'Content-Type': mime,
            'Content-Length': Buffer.byteLength(body, 'utf8')
        });
        res.end(body, 'utf8');
    };

    const serveBinary = (res, statusCode, mime, buffer) => {
        res.writeHead(statusCode, {
            'Content-Type': mime,
            'Content-Length': buffer.length
        });
        res.end(buffer);
    };

    const serveFileFromRoot = (res, filePath) => {
        try {
            const data = fs.readFileSync(filePath);
            serveBinary(res, 200, resolveMimeType(filePath), data);
        } catch (_) {
            serveText(res, 404, 'text/plain; charset=utf-8', 'Not Found');
        }
    };

    const serveExtensionFile = (res, relativePath) => {
        if (!extensionPath) {
            serveText(res, 404, 'text/plain; charset=utf-8', 'Claude Code extension not found');
            return;
        }
        const sanitized = path
            .normalize(relativePath)
            .replace(/^([.\\/])+/, '');
        const absolute = path.join(extensionPath, sanitized);
        if (!absolute.startsWith(extensionPath)) {
            serveText(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
            return;
        }
        try {
            const stat = fs.statSync(absolute);
            if (!stat.isFile()) {
                serveText(res, 404, 'text/plain; charset=utf-8', 'Not Found');
                return;
            }
            const data = fs.readFileSync(absolute);
            serveBinary(res, 200, resolveMimeType(absolute), data);
        } catch (_) {
            serveText(res, 404, 'text/plain; charset=utf-8', 'Not Found');
        }
    };

    const serveChatHost = (req, res) => {
        const parsedUrl = new URL(req.url, 'http://localhost');
        const projectParam = parsedUrl.searchParams.get('project') || '';
        const sessionParam = parsedUrl.searchParams.get('session') || '';
        const theme = parsedUrl.searchParams.get('theme') || 'dark';
        const projectPath = projectParam ? normalizeBase64ProjectParam(projectParam) : process.cwd();
        const projectName = projectPath.replace(/\\/g, '/').split('/').pop() || projectPath;
        const themeClass = theme === 'light' ? 'vscode-light' : 'vscode-dark';
        const wsUrl = resolveWsUrl(req);
        const permissionMode = options.defaultPermissionMode || 'bypassPermissions';
        const rootDataAttrs = sessionParam ? `data-initial-session="${String(sessionParam).replace(/"/g, '&quot;')}"` : '';

        let html = readTextFile(hostTemplatePath);
        if (!html) {
            serveText(res, 500, 'text/plain; charset=utf-8', 'Claude chat host template missing');
            return;
        }
        html = html.replaceAll('{{PROJECT_PATH}}', projectPath.replace(/"/g, '&quot;'));
        html = html.replace('{{PROJECT_PATH_JS}}', projectPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
        html = html.replaceAll('{{PROJECT_NAME}}', projectName.replace(/"/g, '&quot;'));
        html = html.replace('{{WS_URL}}', wsUrl);
        html = html.replace('{{PERMISSION_MODE}}', permissionMode);
        html = html.replaceAll('{{THEME_CLASS}}', themeClass);
        html = html.replace('{{ROOT_DATA_ATTRS}}', rootDataAttrs);
        serveText(res, 200, 'text/html; charset=utf-8', html);
    };

    return {
        handleHttpRequest(req, res) {
            const requestPath = (req.url || '/').split('?')[0];
            if (requestPath === '/claude-chat') {
                serveChatHost(req, res);
                return true;
            }
            if (requestPath === '/static/shim.js') {
                serveFileFromRoot(res, shimPath);
                return true;
            }
            if (requestPath === '/static/css-variables.css') {
                serveFileFromRoot(res, cssVarsPath);
                return true;
            }
            if (requestPath.startsWith('/webview/')) {
                serveExtensionFile(res, requestPath.slice(1));
                return true;
            }
            if (requestPath.startsWith('/resources/')) {
                serveExtensionFile(res, requestPath.slice(1));
                return true;
            }
            return false;
        },

        handleWsUpgrade(req, socket, head) {
            const requestPath = (req.url || '/').split('?')[0];
            if (requestPath !== '/ws') {
                return false;
            }
            if (!isWebSocketUpgrade(req)) {
                return false;
            }
            const key = req.headers['sec-websocket-key'];
            if (!key) {
                try { socket.destroy(); } catch (_) {}
                return true;
            }
            const accept = createWebSocketAccept(String(key));
            socket.write(
                [
                    'HTTP/1.1 101 Switching Protocols',
                    'Upgrade: websocket',
                    'Connection: Upgrade',
                    `Sec-WebSocket-Accept: ${accept}`,
                    '',
                    ''
                ].join('\r\n')
            );
            if (head && head.length) {
                socket.unshift(head);
            }
            const connection = createWebSocketConnection(socket);
            const channels = new Set();
            connection.onMessage((text) => {
                const parsed = safeJsonParse(text);
                if (!parsed) {
                    return;
                }
                const resolvedChannelId = messageHandler.handleInbound(connection, parsed);
                const trackId = resolvedChannelId || normalizeText(parsed.channelId);
                if (trackId && !channels.has(trackId)) {
                    channels.add(trackId);
                    sessionManager.attachConnection(trackId, connection);
                }
            });
            connection.onClose(() => {
                for (const channelId of channels) {
                    sessionManager.detachConnection(channelId, connection);
                }
            });
            return true;
        }
    };
}

module.exports = {
    createClaudeChatBridge
};
