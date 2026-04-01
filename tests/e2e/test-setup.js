const path = require('path');
const fs = require('fs');
const {
    assert,
    runSync,
    runWithInput
} = require('./helpers');

module.exports = async function testSetup(ctx) {
    const { env, node, cliPath, mockProviderUrl, noModelsUrl, htmlModelsUrl, authFailUrl, tmpHome } = ctx;

    const setupInput = [
        'e2e',
        mockProviderUrl,
        'sk-test',
        'e2e-model',
        ''
    ].join('\n');

    const setupResult = await runWithInput(node, [cliPath, 'setup'], setupInput, { env });
    if (setupResult.status !== 0) {
        const errorText = setupResult.stderr || setupResult.stdout || '';
        if (errorText.includes('EPERM')) {
            ctx.skipE2E = 'child_process spawn blocked (EPERM) during setup';
            return;
        }
        assert(setupResult.status === 0, `setup failed: ${errorText}`);
    }

    const configPath = path.join(tmpHome, '.codex', 'config.toml');
    assert(fs.existsSync(configPath), 'config.toml missing');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    assert(/model_provider\s*=\s*"e2e"/.test(configContent), 'model_provider not set');
    assert(/model\s*=\s*"e2e-model"/.test(configContent), 'model not set');
    assert(/\[model_providers\.e2e\]/.test(configContent), 'provider block missing');
    assert(configContent.includes(`base_url = "${mockProviderUrl}"`), 'base_url missing or mismatched');

    const authPath = path.join(tmpHome, '.codex', 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    assert(auth.OPENAI_API_KEY === 'sk-test', 'auth api_key mismatch');

    const modelsPath = path.join(tmpHome, '.codex', 'models.json');
    const models = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
    assert(models.includes('e2e-model'), 'custom model not added');

    const statusResult = runSync(node, [cliPath, 'status'], { env });
    assert(statusResult.status === 0, 'status failed');
    assert(statusResult.stdout.includes('e2e'), 'status provider not shown');
    assert(statusResult.stdout.includes('e2e-model'), 'status model not shown');

    const listResult = runSync(node, [cliPath, 'list'], { env });
    assert(listResult.status === 0, 'list failed');
    assert(listResult.stdout.includes('e2e'), 'list missing provider');

    const helpResult = runSync(node, [cliPath], { env });
    assert(helpResult.status === 0, 'help output failed');
    assert(!helpResult.stdout.includes('codexmate proxy'), 'help should not expose removed proxy entry');
    assert(!helpResult.stdout.includes('codexmate auth'), 'help should not expose removed auth entry');
    assert(!helpResult.stdout.includes('内建代理'), 'help should not mention removed builtin proxy');

    const claudeModel = 'claude-e2e';
    const claudeResult = runSync(node, [cliPath, 'claude', mockProviderUrl, 'sk-claude', claudeModel], { env });
    assert(claudeResult.status === 0, `claude command failed: ${claudeResult.stderr || claudeResult.stdout}`);
    const claudeSettingsPath = path.join(tmpHome, '.claude', 'settings.json');
    assert(fs.existsSync(claudeSettingsPath), 'claude settings missing');
    const claudeSettings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'));
    assert(claudeSettings.env && claudeSettings.env.ANTHROPIC_API_KEY === 'sk-claude', 'claude API key mismatch');
    assert(claudeSettings.env.ANTHROPIC_BASE_URL === mockProviderUrl, 'claude base url mismatch');
    assert(claudeSettings.env.ANTHROPIC_MODEL === claudeModel, 'claude model mismatch');

    const sessionsDir = path.join(tmpHome, '.codex', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sessionId = 'e2e-session';
    const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);
    const sessionRecords = [
        {
            type: 'session_meta',
            payload: { id: sessionId, cwd: '/tmp/e2e' },
            timestamp: '2025-01-01T00:00:00.000Z'
        },
        {
            type: 'response_item',
            payload: { type: 'message', role: 'user', content: 'hello' },
            timestamp: '2025-01-01T00:00:01.000Z'
        },
        {
            type: 'response_item',
            payload: { type: 'message', role: 'assistant', content: 'world' },
            timestamp: '2025-01-01T00:00:02.000Z'
        }
    ];
    fs.writeFileSync(sessionPath, sessionRecords.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf-8');

    const daudeSessionId = 'daude-e2e-session';
    const daudeSessionPath = path.join(sessionsDir, `${daudeSessionId}.jsonl`);
    const daudeRecords = [
        {
            type: 'session_meta',
            payload: { id: daudeSessionId, cwd: '/tmp/daude' },
            timestamp: '2025-02-02T00:00:00.000Z'
        },
        {
            type: 'response_item',
            payload: { type: 'message', role: 'user', content: 'daude code quick start 222' },
            timestamp: '2025-02-02T00:00:01.000Z'
        },
        {
            type: 'response_item',
            payload: { type: 'message', role: 'assistant', content: 'sharing daude-code bootstrap' },
            timestamp: '2025-02-02T00:00:02.000Z'
        }
    ];
    fs.writeFileSync(daudeSessionPath, daudeRecords.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf-8');

    const claudeProjectsDir = path.join(tmpHome, '.claude', 'projects');
    const claudeProjectDir = path.join(claudeProjectsDir, 'e2e-project');
    fs.mkdirSync(claudeProjectDir, { recursive: true });
    const claudeSessionId = 'claude-e2e-session';
    const claudeSessionPath = path.join(claudeProjectDir, `${claudeSessionId}.jsonl`);
    const claudeRecords = [
        {
            type: 'user',
            message: { content: 'hello from claude code session' },
            timestamp: '2025-02-01T00:00:00.000Z'
        },
        {
            type: 'assistant',
            message: { content: 'initialized project' },
            timestamp: '2025-02-01T00:00:01.000Z'
        }
    ];
    fs.writeFileSync(claudeSessionPath, claudeRecords.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf-8');
    const claudeIndexPath = path.join(claudeProjectDir, 'sessions-index.json');
    const claudeIndex = {
        entries: [
            {
                sessionId: claudeSessionId,
                projectPath: claudeProjectDir,
                fullPath: claudeSessionPath,
                created: '2025-02-01T00:00:00.000Z',
                modified: '2025-02-01T00:00:01.000Z',
                summary: 'Claude Code sample session',
                provider: 'claude',
                capabilities: { code: true },
                keywords: ['claude_code', 'sample'],
                messageCount: 2
            }
        ]
    };
    fs.writeFileSync(claudeIndexPath, JSON.stringify(claudeIndex, null, 2), 'utf-8');

    Object.assign(ctx, {
        claudeModel,
        sessionId,
        sessionPath,
        daudeSessionId,
        daudeSessionPath,
        claudeSessionId,
        claudeSessionPath,
        noModelsUrl,
        htmlModelsUrl,
        authFailUrl
    });
};
