import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const { createMcpRequestRouter } = require(path.join(__dirname, '..', '..', 'lib', 'mcp-stdio.js'));

test('mcp router initialize advertises capabilities', async () => {
    const router = createMcpRequestRouter({
        serverInfo: { name: 'codexmate-mcp', version: '0.0.12' },
        tools: [{
            name: 'status.get',
            description: 'Get status',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            handler: async () => ({ ok: true })
        }],
        resources: [{
            uri: 'codexmate://status',
            name: 'Status',
            read: async () => ({ ok: true })
        }],
        prompts: [{
            name: 'diagnose',
            description: 'Diagnose',
            get: async () => ({ messages: [] })
        }]
    });

    const result = await router.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
    });

    assert.strictEqual(result.serverInfo.name, 'codexmate-mcp');
    assert.strictEqual(result.serverInfo.version, '0.0.12');
    assert.ok(result.capabilities.tools);
    assert.ok(result.capabilities.resources);
    assert.ok(result.capabilities.prompts);
});

test('mcp router supports tools/list and tools/call', async () => {
    const router = createMcpRequestRouter({
        tools: [{
            name: 'status.get',
            description: 'Get status',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true },
            handler: async () => ({ provider: 'local' })
        }]
    });

    const listRes = await router.handleRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
    });
    assert.strictEqual(Array.isArray(listRes.tools), true);
    assert.strictEqual(listRes.tools.length, 1);
    assert.strictEqual(listRes.tools[0].name, 'status.get');

    const callRes = await router.handleRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
            name: 'status.get',
            arguments: {}
        }
    });
    assert.strictEqual(Array.isArray(callRes.content), true);
    assert.deepStrictEqual(callRes.structuredContent, { provider: 'local' });
});

test('mcp router supports resources and prompts', async () => {
    const router = createMcpRequestRouter({
        resources: [{
            uri: 'codexmate://providers',
            name: 'Providers',
            mimeType: 'application/json',
            read: async () => ({
                contents: [{
                    uri: 'codexmate://providers',
                    mimeType: 'application/json',
                    text: '{"items":[]}'
                }]
            })
        }],
        prompts: [{
            name: 'switch_provider_safely',
            description: 'Switch provider safely',
            arguments: [{
                name: 'provider',
                required: true
            }],
            get: async (args) => ({
                messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `Switch to ${args.provider || ''}`
                    }
                }]
            })
        }]
    });

    const resourcesRes = await router.handleRequest({
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/read',
        params: { uri: 'codexmate://providers' }
    });
    assert.strictEqual(Array.isArray(resourcesRes.contents), true);
    assert.strictEqual(resourcesRes.contents[0].uri, 'codexmate://providers');

    const resourcesWithQueryRes = await router.handleRequest({
        jsonrpc: '2.0',
        id: 41,
        method: 'resources/read',
        params: { uri: 'codexmate://providers?source=all' }
    });
    assert.strictEqual(Array.isArray(resourcesWithQueryRes.contents), true);
    assert.strictEqual(resourcesWithQueryRes.contents[0].uri, 'codexmate://providers');

    const promptRes = await router.handleRequest({
        jsonrpc: '2.0',
        id: 5,
        method: 'prompts/get',
        params: {
            name: 'switch_provider_safely',
            arguments: { provider: 'local' }
        }
    });
    assert.strictEqual(Array.isArray(promptRes.messages), true);
    assert.strictEqual(promptRes.messages[0].role, 'user');
});
