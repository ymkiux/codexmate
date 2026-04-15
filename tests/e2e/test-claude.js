const { assert } = require('./helpers');

module.exports = async function testClaude(ctx) {
    const { api, mockProviderUrl, claudeModel } = ctx;

    // ========== Get Claude Settings Tests ==========
    const claudeSettingsInfo = await api('get-claude-settings');
    assert(claudeSettingsInfo.apiKey === 'sk-claude', 'get-claude-settings apiKey mismatch');
    assert(claudeSettingsInfo.baseUrl === mockProviderUrl, 'get-claude-settings baseUrl mismatch');
    assert(claudeSettingsInfo.model === claudeModel, 'get-claude-settings model mismatch');
    assert('exists' in claudeSettingsInfo, 'get-claude-settings missing exists');
    assert(typeof claudeSettingsInfo.targetPath === 'string', 'get-claude-settings missing targetPath');

    // ========== Get Claude Settings - Missing File Tests ==========
    // Note: In E2E context, settings exist from setup, so we test the structure

    // ========== Export Claude Share Tests ==========
    const claudeShareMissing = await api('export-claude-share', { config: { apiKey: 'only-key' } });
    assert(claudeShareMissing.error, 'export-claude-share should fail when baseUrl missing');

    const claudeShareMissingKey = await api('export-claude-share', { config: { baseUrl: mockProviderUrl } });
    assert(claudeShareMissingKey.error, 'export-claude-share should fail when apiKey missing');

    const claudeShareEmptyConfig = await api('export-claude-share', { config: {} });
    assert(claudeShareEmptyConfig.error, 'export-claude-share should fail for empty config');

    const claudeShareNullConfig = await api('export-claude-share', { config: null });
    assert(claudeShareNullConfig.error, 'export-claude-share should fail for null config');

    // ========== Export Claude Share - Success Tests ==========
    const claudeShare = await api('export-claude-share', {
        config: { baseUrl: mockProviderUrl, apiKey: 'sk-claude', model: claudeModel }
    });
    assert(claudeShare.payload, 'export-claude-share missing payload');
    assert(claudeShare.payload.baseUrl === mockProviderUrl, 'export-claude-share baseUrl mismatch');
    assert(claudeShare.payload.apiKey === 'sk-claude', 'export-claude-share apiKey mismatch');
    assert(claudeShare.payload.model === claudeModel, 'export-claude-share model mismatch');

    // ========== Export Claude Share - Default Model Tests ==========
    const claudeShareDefaultModel = await api('export-claude-share', {
        config: { baseUrl: mockProviderUrl, apiKey: 'sk-claude' }
    });
    assert(claudeShareDefaultModel.payload, 'export-claude-share(default model) missing payload');
    assert(claudeShareDefaultModel.payload.model === 'glm-4.7', 'export-claude-share should use default model');

    // ========== Apply Claude Config Tests ==========
    const applyClaudeEmpty = await api('apply-claude-config', { config: {} });
    assert(applyClaudeEmpty.error, 'apply-claude-config should fail for empty config');

    const applyClaudeMissingKey = await api('apply-claude-config', {
        config: { baseUrl: mockProviderUrl, model: 'test' }
    });
    // Should succeed but with empty key
    assert(applyClaudeMissingKey.success || applyClaudeMissingKey.error, 'apply-claude-config should return result');

    const applyClaudeValid = await api('apply-claude-config', {
        config: { baseUrl: mockProviderUrl, apiKey: 'sk-new', model: 'new-model' }
    });
    assert(applyClaudeValid.success === true, 'apply-claude-config failed');

    // ========== Verify Applied Settings ==========
    const claudeSettingsAfter = await api('get-claude-settings');
    assert(claudeSettingsAfter.apiKey === 'sk-new', 'get-claude-settings apiKey not updated');
    assert(claudeSettingsAfter.baseUrl === mockProviderUrl, 'get-claude-settings baseUrl not updated');
    assert(claudeSettingsAfter.model === 'new-model', 'get-claude-settings model not updated');

    // ========== Apply Claude Bedrock Preset (AKSK) ==========
    const applyBedrock = await api('apply-claude-config', {
        config: {
            preset: 'aws-bedrock-aksk',
            awsRegion: 'us-west-2',
            awsAccessKeyId: 'AKIA_TEST',
            awsSecretAccessKey: 'SECRET_TEST',
            model: 'global.anthropic.claude-opus-4-6-v1'
        }
    });
    assert(applyBedrock.success === true, 'apply-claude-config(bedrock aksk) failed');

    const claudeBedrockSettings = await api('get-claude-settings');
    assert(claudeBedrockSettings.apiKey === '', 'bedrock settings should clear apiKey');
    assert(claudeBedrockSettings.env && claudeBedrockSettings.env.CLAUDE_CODE_USE_BEDROCK === '1', 'bedrock env flag missing');
    assert(claudeBedrockSettings.env.AWS_REGION === 'us-west-2', 'bedrock env AWS_REGION mismatch');
    assert(claudeBedrockSettings.env.AWS_ACCESS_KEY_ID === 'AKIA_TEST', 'bedrock env AWS_ACCESS_KEY_ID mismatch');
    assert(claudeBedrockSettings.env.AWS_SECRET_ACCESS_KEY === 'SECRET_TEST', 'bedrock env AWS_SECRET_ACCESS_KEY mismatch');

    // ========== Restore Original Settings ==========
    const restoreClaude = await api('apply-claude-config', {
        config: { baseUrl: mockProviderUrl, apiKey: 'sk-claude', model: claudeModel }
    });
    assert(restoreClaude.success === true, 'restore-claude-config failed');
};
