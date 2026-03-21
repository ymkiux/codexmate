const { spawnSync } = require('child_process');
const { assert } = require('./helpers');

function encodeFrame(payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf-8');
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf-8');
    return Buffer.concat([header, body]);
}

function decodeFrames(stdoutBuffer) {
    const messages = [];
    let offset = 0;

    while (offset < stdoutBuffer.length) {
        const headerEnd = stdoutBuffer.indexOf('\r\n\r\n', offset, 'utf-8');
        assert(headerEnd >= 0, 'mcp stdout contains an incomplete frame header');

        const headerText = stdoutBuffer.slice(offset, headerEnd).toString('utf-8');
        let contentLength = -1;
        for (const line of headerText.split('\r\n')) {
            const idx = line.indexOf(':');
            if (idx <= 0) continue;
            const key = line.slice(0, idx).trim().toLowerCase();
            if (key !== 'content-length') continue;
            contentLength = Number.parseInt(line.slice(idx + 1).trim(), 10);
            break;
        }
        assert(Number.isFinite(contentLength) && contentLength >= 0, 'invalid content-length in mcp response');

        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + contentLength;
        assert(bodyEnd <= stdoutBuffer.length, 'mcp stdout contains an incomplete frame body');

        const bodyText = stdoutBuffer.slice(bodyStart, bodyEnd).toString('utf-8');
        let payload = null;
        try {
            payload = JSON.parse(bodyText);
        } catch (error) {
            throw new Error(`invalid mcp json payload: ${error.message || error}`);
        }
        messages.push(payload);
        offset = bodyEnd;
    }

    return messages;
}

function runMcpExchange(node, cliPath, env, args, requests) {
    const input = Buffer.concat((requests || []).map(encodeFrame));
    const result = spawnSync(node, [cliPath, 'mcp', 'serve', ...(args || [])], {
        env,
        input,
        encoding: 'buffer',
        maxBuffer: 5 * 1024 * 1024
    });

    if (result.error) {
        throw result.error;
    }

    const stderrText = Buffer.isBuffer(result.stderr)
        ? result.stderr.toString('utf-8')
        : String(result.stderr || '');
    assert(result.status === 0, `mcp command failed (${result.status}): ${stderrText}`);

    const stdoutBuffer = Buffer.isBuffer(result.stdout)
        ? result.stdout
        : Buffer.from(result.stdout || '', 'utf-8');
    assert(stdoutBuffer.length > 0, 'mcp command produced empty stdout');

    return decodeFrames(stdoutBuffer);
}

module.exports = async function testMcp(ctx) {
    const { env, node, cliPath } = ctx;

    const readOnlyRequests = [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'codexmate://sessions?source=all' } },
        {
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: {
                name: 'codexmate.session.list',
                arguments: { source: 'CODEX', forceRefresh: true, limit: 20 }
            }
        },
        {
            jsonrpc: '2.0',
            id: 5,
            method: 'tools/call',
            params: {
                name: 'codexmate.claude.settings.get',
                arguments: {}
            }
        },
        {
            jsonrpc: '2.0',
            id: 6,
            method: 'resources/read',
            params: { uri: 'codexmate://workflows' }
        },
        {
            jsonrpc: '2.0',
            id: 7,
            method: 'tools/call',
            params: {
                name: 'codexmate.workflow.list',
                arguments: {}
            }
        },
        {
            jsonrpc: '2.0',
            id: 8,
            method: 'tools/call',
            params: {
                name: 'codexmate.workflow.run',
                arguments: {
                    id: 'diagnose-config',
                    input: {}
                }
            }
        },
        {
            jsonrpc: '2.0',
            id: 9,
            method: 'tools/call',
            params: {
                name: 'codexmate.workflow.run',
                arguments: {
                    id: 'safe-provider-switch',
                    input: {
                        provider: 'e2e',
                        apply: true
                    }
                }
            }
        },
        {
            jsonrpc: '2.0',
            id: 10,
            method: 'resources/read',
            params: { uri: 'codexmate://workflow-runs?limit=5' }
        }
    ];
    const readOnlyResponses = runMcpExchange(node, cliPath, env, ['--read-only'], readOnlyRequests);
    const readOnlyById = new Map(readOnlyResponses.map((item) => [item.id, item]));

    assert(readOnlyById.has(1), 'mcp initialize response missing');
    assert(readOnlyById.has(2), 'mcp tools/list response missing');
    assert(readOnlyById.has(3), 'mcp resources/read response missing');
    assert(readOnlyById.has(4), 'mcp session.list response missing');
    assert(readOnlyById.has(5), 'mcp claude.settings.get response missing');
    assert(readOnlyById.has(6), 'mcp workflows resource response missing');
    assert(readOnlyById.has(7), 'mcp workflow.list response missing');
    assert(readOnlyById.has(8), 'mcp workflow.run diagnose-config response missing');
    assert(readOnlyById.has(9), 'mcp workflow.run write-guard response missing');
    assert(readOnlyById.has(10), 'mcp workflow-runs resource response missing');

    const initResult = readOnlyById.get(1).result || {};
    assert(initResult.protocolVersion === '2025-11-25', 'mcp protocol version mismatch');

    const tools = Array.isArray((readOnlyById.get(2).result || {}).tools)
        ? readOnlyById.get(2).result.tools
        : [];
    const toolNames = new Set(tools.map((item) => item && item.name).filter(Boolean));
    assert(toolNames.has('codexmate.status.get'), 'mcp read-only tools missing codexmate.status.get');
    assert(!toolNames.has('codexmate.provider.add'), 'mcp read-only tools should not expose write tool');
    assert(toolNames.has('codexmate.workflow.list'), 'mcp read-only tools missing codexmate.workflow.list');
    assert(toolNames.has('codexmate.workflow.get'), 'mcp read-only tools missing codexmate.workflow.get');
    assert(toolNames.has('codexmate.workflow.validate'), 'mcp read-only tools missing codexmate.workflow.validate');
    assert(toolNames.has('codexmate.workflow.run'), 'mcp read-only tools missing codexmate.workflow.run');

    const sessionResource = readOnlyById.get(3).result || {};
    assert(Array.isArray(sessionResource.contents), 'mcp resources/read should return contents');
    const workflowResource = readOnlyById.get(6).result || {};
    assert(Array.isArray(workflowResource.contents), 'mcp workflows resource should return contents');
    const workflowResourcePayload = JSON.parse((workflowResource.contents[0] || {}).text || '{}');
    assert(Array.isArray(workflowResourcePayload.workflows), 'mcp workflows resource should contain workflows');
    assert(
        workflowResourcePayload.workflows.some((item) => item && item.id === 'diagnose-config'),
        'mcp workflows resource should include diagnose-config'
    );

    const sessionListPayload = ((readOnlyById.get(4).result || {}).structuredContent) || {};
    assert(sessionListPayload.source === 'codex', 'mcp session.list should normalize source to codex');
    assert(Array.isArray(sessionListPayload.sessions), 'mcp session.list should return sessions');
    assert(sessionListPayload.sessions.length > 0, 'mcp session.list should return codex sessions');
    assert(
        sessionListPayload.sessions.every((item) => item && item.source === 'codex'),
        'mcp session.list should not include claude sessions when source=CODEX'
    );

    const claudeSettingsPayload = ((readOnlyById.get(5).result || {}).structuredContent) || {};
    assert(claudeSettingsPayload.redacted === true, 'mcp claude.settings.get should mark payload as redacted');
    assert(claudeSettingsPayload.apiKey !== 'sk-claude', 'mcp claude.settings.get should not return plain api key');
    assert(
        typeof claudeSettingsPayload.apiKey === 'string' && !claudeSettingsPayload.apiKey.includes('sk-claude'),
        'mcp claude.settings.get apiKey should be masked'
    );
    assert(
        typeof ((claudeSettingsPayload.env || {}).ANTHROPIC_API_KEY) === 'string'
            && !String((claudeSettingsPayload.env || {}).ANTHROPIC_API_KEY).includes('sk-claude'),
        'mcp claude.settings.get env.ANTHROPIC_API_KEY should be masked'
    );

    const workflowListPayload = ((readOnlyById.get(7).result || {}).structuredContent) || {};
    assert(Array.isArray(workflowListPayload.workflows), 'mcp workflow.list should return workflows array');
    assert(
        workflowListPayload.workflows.some((item) => item && item.id === 'safe-provider-switch'),
        'mcp workflow.list should include safe-provider-switch'
    );

    const workflowRunPayload = ((readOnlyById.get(8).result || {}).structuredContent) || {};
    assert(workflowRunPayload.success === true, 'mcp workflow.run diagnose-config should succeed');
    assert(Array.isArray(workflowRunPayload.steps), 'mcp workflow.run should include steps');
    assert(workflowRunPayload.steps.length >= 3, 'mcp workflow.run diagnose-config should execute builtin steps');

    const workflowWriteBlockedPayload = ((readOnlyById.get(9).result || {}).structuredContent) || {};
    assert(workflowWriteBlockedPayload.success === false, 'mcp workflow.run should block write step in read-only mode');
    assert(
        typeof workflowWriteBlockedPayload.error === 'string'
            && workflowWriteBlockedPayload.error.includes('allowWrite'),
        'mcp workflow.run should include allowWrite guard error in read-only mode'
    );

    const workflowRunsResource = readOnlyById.get(10).result || {};
    assert(Array.isArray(workflowRunsResource.contents), 'mcp workflow-runs resource should return contents');
    const workflowRunsPayload = JSON.parse((workflowRunsResource.contents[0] || {}).text || '{}');
    assert(Array.isArray(workflowRunsPayload.runs), 'mcp workflow-runs resource should contain runs array');
    assert(workflowRunsPayload.runs.length > 0, 'mcp workflow-runs resource should include run records');

    const writeEnabledRequests = [
        { jsonrpc: '2.0', id: 11, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 12, method: 'tools/list', params: {} }
    ];
    const writeEnabledResponses = runMcpExchange(node, cliPath, {
        ...env,
        CODEXMATE_MCP_ALLOW_WRITE: '1'
    }, [], writeEnabledRequests);
    const writeById = new Map(writeEnabledResponses.map((item) => [item.id, item]));
    const writeTools = Array.isArray((writeById.get(12).result || {}).tools)
        ? writeById.get(12).result.tools
        : [];
    const writeToolNames = new Set(writeTools.map((item) => item && item.name).filter(Boolean));
    assert(writeToolNames.has('codexmate.provider.add'), 'mcp write mode should expose codexmate.provider.add');
};
