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
        '2',
        'e2e',
        mockProviderUrl,
        'sk-test',
        'e2e-model',
        ''
    ].join('\n');

    const setupResult = await runWithInput(node, [cliPath, 'setup'], setupInput, { env });
    assert(setupResult.status === 0, `setup failed: ${setupResult.stderr || setupResult.stdout}`);

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

    Object.assign(ctx, {
        claudeModel,
        sessionId,
        sessionPath,
        noModelsUrl,
        htmlModelsUrl,
        authFailUrl
    });
};
