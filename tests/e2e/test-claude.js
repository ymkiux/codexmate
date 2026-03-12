const { assert } = require('./helpers');

module.exports = async function testClaude(ctx) {
    const { api, mockProviderUrl, claudeModel } = ctx;

    const claudeSettingsInfo = await api('get-claude-settings');
    assert(claudeSettingsInfo.apiKey === 'sk-claude', 'get-claude-settings apiKey mismatch');
    assert(claudeSettingsInfo.baseUrl === mockProviderUrl, 'get-claude-settings baseUrl mismatch');
    assert(claudeSettingsInfo.model === claudeModel, 'get-claude-settings model mismatch');

    const claudeShareMissing = await api('export-claude-share', { config: { apiKey: 'only-key' } });
    assert(claudeShareMissing.error, 'export-claude-share should fail when baseUrl missing');

    const claudeShare = await api('export-claude-share', {
        config: { baseUrl: mockProviderUrl, apiKey: 'sk-claude', model: claudeModel }
    });
    assert(claudeShare.payload, 'export-claude-share missing payload');
    assert(claudeShare.payload.baseUrl === mockProviderUrl, 'export-claude-share baseUrl mismatch');
    assert(claudeShare.payload.apiKey === 'sk-claude', 'export-claude-share apiKey mismatch');
    assert(claudeShare.payload.model === claudeModel, 'export-claude-share model mismatch');
};
