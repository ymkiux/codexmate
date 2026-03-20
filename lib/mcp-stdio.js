const DEFAULT_PROTOCOL_VERSION = '2025-11-25';

function jsonRpcError(code, message, data) {
    const error = {
        code,
        message: String(message || 'Unknown error')
    };
    if (data !== undefined) {
        error.data = data;
    }
    return error;
}

function createToolMap(tools = []) {
    const map = new Map();
    for (const tool of Array.isArray(tools) ? tools : []) {
        if (!tool || typeof tool !== 'object') continue;
        const name = typeof tool.name === 'string' ? tool.name.trim() : '';
        if (!name) continue;
        map.set(name, {
            name,
            description: typeof tool.description === 'string' ? tool.description : '',
            inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object'
                ? tool.inputSchema
                : { type: 'object', properties: {}, additionalProperties: false },
            annotations: tool.annotations && typeof tool.annotations === 'object' ? tool.annotations : undefined,
            handler: typeof tool.handler === 'function' ? tool.handler : async () => ({})
        });
    }
    return map;
}

function createResourceMap(resources = []) {
    const map = new Map();
    for (const resource of Array.isArray(resources) ? resources : []) {
        if (!resource || typeof resource !== 'object') continue;
        const uri = typeof resource.uri === 'string' ? resource.uri.trim() : '';
        if (!uri) continue;
        map.set(uri, {
            uri,
            name: typeof resource.name === 'string' ? resource.name : uri,
            description: typeof resource.description === 'string' ? resource.description : '',
            mimeType: typeof resource.mimeType === 'string' ? resource.mimeType : 'application/json',
            read: typeof resource.read === 'function'
                ? resource.read
                : async () => ({ contents: [] })
        });
    }
    return map;
}

function createPromptMap(prompts = []) {
    const map = new Map();
    for (const prompt of Array.isArray(prompts) ? prompts : []) {
        if (!prompt || typeof prompt !== 'object') continue;
        const name = typeof prompt.name === 'string' ? prompt.name.trim() : '';
        if (!name) continue;
        map.set(name, {
            name,
            description: typeof prompt.description === 'string' ? prompt.description : '',
            arguments: Array.isArray(prompt.arguments) ? prompt.arguments : [],
            get: typeof prompt.get === 'function'
                ? prompt.get
                : async () => ({ messages: [] })
        });
    }
    return map;
}

function createMcpRequestRouter(options = {}) {
    const protocolVersion = typeof options.protocolVersion === 'string' && options.protocolVersion.trim()
        ? options.protocolVersion.trim()
        : DEFAULT_PROTOCOL_VERSION;
    const serverInfo = options.serverInfo && typeof options.serverInfo === 'object'
        ? options.serverInfo
        : { name: 'mcp-server', version: '0.0.0' };
    const logger = typeof options.logger === 'function' ? options.logger : () => {};

    const tools = createToolMap(options.tools);
    const resources = createResourceMap(options.resources);
    const prompts = createPromptMap(options.prompts);

    const listTools = () => Array.from(tools.values()).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations ? { annotations: tool.annotations } : {})
    }));

    const listResources = () => Array.from(resources.values()).map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType
    }));

    const listPrompts = () => Array.from(prompts.values()).map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments
    }));

    const capabilities = {};
    if (tools.size > 0) {
        capabilities.tools = { listChanged: false };
    }
    if (resources.size > 0) {
        capabilities.resources = { listChanged: false, subscribe: false };
    }
    if (prompts.size > 0) {
        capabilities.prompts = { listChanged: false };
    }

    const withToolError = (error) => ({
        content: [{ type: 'text', text: `Error: ${error.message || error}` }],
        isError: true
    });

    const normalizeResourceResult = (uri, resource, result) => {
        if (result && Array.isArray(result.contents)) {
            return { contents: result.contents };
        }
        if (result && typeof result === 'object' && typeof result.text === 'string') {
            return {
                contents: [{
                    uri,
                    mimeType: result.mimeType || resource.mimeType,
                    text: result.text
                }]
            };
        }
        const text = typeof result === 'string'
            ? result
            : JSON.stringify(result === undefined ? {} : result, null, 2);
        return {
            contents: [{
                uri,
                mimeType: resource.mimeType,
                text
            }]
        };
    };

    const resolveResourceByUri = (uri) => {
        const exact = resources.get(uri);
        if (exact) {
            return exact;
        }
        try {
            const parsed = new URL(uri);
            parsed.search = '';
            parsed.hash = '';
            const baseUri = parsed.toString();
            if (baseUri && resources.has(baseUri)) {
                return resources.get(baseUri);
            }
        } catch (_) {}
        return null;
    };

    const handleRequest = async (request) => {
        if (!request || typeof request !== 'object') {
            throw jsonRpcError(-32600, 'Invalid Request');
        }
        const method = typeof request.method === 'string' ? request.method : '';
        const params = request.params && typeof request.params === 'object' ? request.params : {};

        if (method === 'initialize') {
            return {
                protocolVersion,
                capabilities,
                serverInfo: {
                    name: serverInfo.name || 'codexmate-mcp',
                    version: serverInfo.version || '0.0.0'
                }
            };
        }

        if (method === 'ping') {
            return {};
        }

        if (method === 'tools/list') {
            return { tools: listTools() };
        }

        if (method === 'tools/call') {
            const name = typeof params.name === 'string' ? params.name.trim() : '';
            if (!name) {
                throw jsonRpcError(-32602, 'Missing tool name');
            }
            const tool = tools.get(name);
            if (!tool) {
                throw jsonRpcError(-32602, `Unknown tool: ${name}`);
            }
            try {
                const args = params.arguments && typeof params.arguments === 'object'
                    ? params.arguments
                    : {};
                const result = await tool.handler(args, request);
                if (result && Array.isArray(result.content)) {
                    return result;
                }
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(result === undefined ? {} : result, null, 2)
                    }],
                    structuredContent: result === undefined ? {} : result
                };
            } catch (error) {
                logger('error', `tools/call failed (${name}): ${error && error.message ? error.message : error}`);
                return withToolError(error || new Error('Tool execution failed'));
            }
        }

        if (method === 'resources/list') {
            return { resources: listResources() };
        }

        if (method === 'resources/read') {
            const uri = typeof params.uri === 'string' ? params.uri.trim() : '';
            if (!uri) {
                throw jsonRpcError(-32602, 'Missing resource uri');
            }
            const resource = resolveResourceByUri(uri);
            if (!resource) {
                throw jsonRpcError(-32602, `Unknown resource: ${uri}`);
            }
            try {
                const result = await resource.read(params, request);
                return normalizeResourceResult(uri, resource, result);
            } catch (error) {
                throw jsonRpcError(-32000, `Resource read failed: ${error && error.message ? error.message : error}`);
            }
        }

        if (method === 'prompts/list') {
            return { prompts: listPrompts() };
        }

        if (method === 'prompts/get') {
            const name = typeof params.name === 'string' ? params.name.trim() : '';
            if (!name) {
                throw jsonRpcError(-32602, 'Missing prompt name');
            }
            const prompt = prompts.get(name);
            if (!prompt) {
                throw jsonRpcError(-32602, `Unknown prompt: ${name}`);
            }
            try {
                const args = params.arguments && typeof params.arguments === 'object'
                    ? params.arguments
                    : {};
                const result = await prompt.get(args, request);
                return {
                    description: prompt.description,
                    messages: Array.isArray(result && result.messages) ? result.messages : []
                };
            } catch (error) {
                throw jsonRpcError(-32000, `Prompt get failed: ${error && error.message ? error.message : error}`);
            }
        }

        if (method === 'notifications/initialized') {
            return null;
        }

        throw jsonRpcError(-32601, `Method not found: ${method}`);
    };

    return {
        handleRequest
    };
}

function createMcpStdioServer(options = {}) {
    const logger = typeof options.logger === 'function' ? options.logger : () => {};
    const stdin = options.stdin || process.stdin;
    const stdout = options.stdout || process.stdout;
    const router = createMcpRequestRouter(options);
    const jsonRpcVersion = '2.0';

    let buffer = Buffer.alloc(0);
    let started = false;
    let stopped = false;

    const writeMessage = (payload) => {
        const text = JSON.stringify(payload);
        const body = Buffer.from(text, 'utf-8');
        const header = Buffer.from(`Content-Length: ${body.length}\r\nContent-Type: application/json\r\n\r\n`, 'utf-8');
        stdout.write(Buffer.concat([header, body]));
    };

    const writeResponse = (id, result) => {
        writeMessage({
            jsonrpc: jsonRpcVersion,
            id,
            result
        });
    };

    const writeError = (id, error) => {
        const normalized = error && typeof error === 'object' && Number.isFinite(error.code)
            ? error
            : jsonRpcError(-32000, error && error.message ? error.message : String(error || 'Unknown error'));
        writeMessage({
            jsonrpc: jsonRpcVersion,
            id,
            error: normalized
        });
    };

    const processMessage = async (rawText) => {
        let message = null;
        try {
            message = JSON.parse(rawText);
        } catch (error) {
            writeError(null, jsonRpcError(-32700, 'Parse error'));
            return;
        }

        if (!message || typeof message !== 'object') {
            writeError(null, jsonRpcError(-32600, 'Invalid Request'));
            return;
        }

        if (Array.isArray(message)) {
            writeError(null, jsonRpcError(-32600, 'Batch request is not supported'));
            return;
        }

        const hasMethod = typeof message.method === 'string' && message.method.trim().length > 0;
        const hasId = Object.prototype.hasOwnProperty.call(message, 'id');

        if (!hasMethod) {
            if (hasId) {
                writeError(message.id, jsonRpcError(-32600, 'Invalid Request'));
            } else {
                writeError(null, jsonRpcError(-32600, 'Invalid Request'));
            }
            return;
        }

        try {
            const result = await router.handleRequest(message);
            if (hasId) {
                writeResponse(message.id, result === null ? {} : result);
            }
        } catch (error) {
            if (hasId) {
                writeError(message.id, error);
            } else {
                logger('error', `MCP notification handling failed: ${error && error.message ? error.message : error}`);
            }
        }
    };

    const parseBuffer = async () => {
        while (buffer.length > 0) {
            const headerEnd = buffer.indexOf('\r\n\r\n');
            if (headerEnd < 0) {
                return;
            }

            const headerText = buffer.slice(0, headerEnd).toString('utf-8');
            const headers = {};
            for (const line of headerText.split('\r\n')) {
                const idx = line.indexOf(':');
                if (idx <= 0) continue;
                const key = line.slice(0, idx).trim().toLowerCase();
                const value = line.slice(idx + 1).trim();
                headers[key] = value;
            }

            const length = Number.parseInt(headers['content-length'] || '', 10);
            if (!Number.isFinite(length) || length < 0) {
                buffer = Buffer.alloc(0);
                writeError(null, jsonRpcError(-32600, 'Invalid Content-Length header'));
                return;
            }

            const bodyOffset = headerEnd + 4;
            const frameLength = bodyOffset + length;
            if (buffer.length < frameLength) {
                return;
            }

            const body = buffer.slice(bodyOffset, frameLength);
            buffer = buffer.slice(frameLength);
            await processMessage(body.toString('utf-8'));
        }
    };

    const onData = async (chunk) => {
        if (stopped) return;
        buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
        try {
            await parseBuffer();
        } catch (error) {
            logger('error', `MCP stdio parse failed: ${error && error.message ? error.message : error}`);
            writeError(null, jsonRpcError(-32000, 'Internal parse failure'));
        }
    };

    const onError = (error) => {
        logger('error', `MCP stdio stream error: ${error && error.message ? error.message : error}`);
    };

    const start = () => {
        if (started || stopped) return;
        started = true;
        stdin.on('data', onData);
        stdin.on('error', onError);
        stdout.on('error', onError);
        if (stdin.isTTY) {
            stdin.resume();
        }
    };

    const stop = () => {
        if (stopped) return;
        stopped = true;
        stdin.removeListener('data', onData);
        stdin.removeListener('error', onError);
        stdout.removeListener('error', onError);
    };

    return {
        start,
        stop
    };
}

module.exports = {
    DEFAULT_PROTOCOL_VERSION,
    jsonRpcError,
    createMcpRequestRouter,
    createMcpStdioServer
};
