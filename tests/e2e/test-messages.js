const { assert, fs, path, os } = require('./helpers');
const zipLib = require('zip-lib');

/**
 * E2E 测试：Web UI 消息简化
 * 测试所有 showMessage 场景，确保消息简洁且不含技术细节
 */
module.exports = async function testMessages(ctx) {
    const { api, tmpHome } = ctx;

    // ========== 模型列表测试 ==========
    const modelsError = await api('models', { provider: 'nonexistent-provider' });
    assert(modelsError.error, 'models should return error for nonexistent provider');

    const modelsEmptyProvider = await api('models', { provider: '' });
    assert(modelsEmptyProvider.error, 'models should return error for empty provider');

    // ========== 会话列表测试 ==========
    const sessions = await api('list-sessions', { source: 'codex', limit: 10 });
    assert(Array.isArray(sessions.sessions), 'list-sessions should return sessions array');

    const sessionsClaude = await api('list-sessions', { source: 'claude', limit: 10 });
    assert(Array.isArray(sessionsClaude.sessions), 'list-sessions(claude) should return sessions array');

    const sessionsAll = await api('list-sessions', { source: 'all', limit: 10 });
    assert(Array.isArray(sessionsAll.sessions), 'list-sessions(all) should return sessions array');

    // ========== 会话详情测试 ==========
    if (ctx.sessionId) {
        const sessionDetail = await api('session-detail', { source: 'codex', sessionId: ctx.sessionId });
        assert(sessionDetail.messages || sessionDetail.error, 'session-detail should return data or error');
    }

    if (ctx.claudeSessionId) {
        const sessionDetailClaude = await api('session-detail', { source: 'claude', sessionId: ctx.claudeSessionId });
        assert(sessionDetailClaude.messages || sessionDetailClaude.error, 'session-detail(claude) should return data or error');
    }

    // ========== 会话导出测试 ==========
    if (ctx.sessionId) {
        const exportResult = await api('export-session', { source: 'codex', sessionId: ctx.sessionId, maxMessages: 10 });
        assert(exportResult.content !== undefined || exportResult.error, 'export-session should return content or error');
    }

    // ========== 会话克隆测试 ==========
    if (ctx.sessionId) {
        const cloneResult = await api('clone-session', { source: 'codex', sessionId: ctx.sessionId });
        assert(cloneResult.success !== undefined || cloneResult.error, 'clone-session should return success or error');
        if (cloneResult.sessionId) {
            ctx.clonedSessionId = cloneResult.sessionId;
        }
    }

    // ========== 会话删除测试 ==========
    if (ctx.clonedSessionId) {
        const deleteResult = await api('delete-session', { source: 'codex', sessionId: ctx.clonedSessionId });
        assert(deleteResult.success !== undefined || deleteResult.error, 'delete-session should return success or error');
    }

    // ========== 健康检查测试 ==========
    const healthCheck = await api('config-health-check', { remote: false });
    assert(healthCheck.ok !== undefined || healthCheck.error, 'health-check should return ok or error');

    const healthCheckRemote = await api('config-health-check', { remote: true });
    assert(healthCheckRemote.ok !== undefined || healthCheckRemote.error, 'health-check(remote) should return ok or error');

    // ========== 配置模板测试 ==========
    const templateResult = await api('get-config-template');
    assert(templateResult.content !== undefined || templateResult.template !== undefined || templateResult.error, 'get-config-template should return content/template or error');

    const templateWithProvider = await api('get-config-template', { provider: 'e2e', model: 'e2e-model' });
    assert(templateWithProvider.template !== undefined || templateWithProvider.error, 'get-config-template(with provider) should return template or error');

    // ========== AGENTS.md 测试 ==========
    const agentsResult = await api('get-agents-file', { context: 'codex' });
    assert(agentsResult.content !== undefined || agentsResult.error, 'get-agents-file should return content or error');

    const agentsOpenclaw = await api('get-openclaw-agents-file');
    assert(agentsOpenclaw.content !== undefined || agentsOpenclaw.error, 'get-openclaw-agents-file should return content or error');

    // ========== Skills 管理测试 ==========
    const skillsRoot = path.join(tmpHome, '.codex', 'skills');
    const skillAlpha = path.join(skillsRoot, 'e2e-skill-alpha');
    const skillBeta = path.join(skillsRoot, 'e2e-skill-beta');
    fs.mkdirSync(skillAlpha, { recursive: true });
    fs.mkdirSync(skillBeta, { recursive: true });
    fs.writeFileSync(path.join(skillAlpha, 'SKILL.md'), '---\nname: Alpha Skill\ndescription: alpha description\n---\n# alpha', 'utf-8');
    fs.writeFileSync(path.join(skillBeta, 'SKILL.md'), '# beta', 'utf-8');

    const skillsList = await api('list-codex-skills');
    assert(Array.isArray(skillsList.items), 'list-codex-skills should return items array');
    assert(skillsList.items.some((item) => item && item.name === 'e2e-skill-alpha'), 'list-codex-skills should include alpha');
    assert(skillsList.items.some((item) => item && item.name === 'e2e-skill-beta'), 'list-codex-skills should include beta');
    const alphaItem = skillsList.items.find((item) => item && item.name === 'e2e-skill-alpha');
    assert(alphaItem && alphaItem.displayName === 'Alpha Skill', 'list-codex-skills should expose displayName from SKILL.md');
    assert(alphaItem && alphaItem.description === 'alpha description', 'list-codex-skills should expose description from SKILL.md');

    const claudeSkillsRoot = path.join(tmpHome, '.claude', 'skills');
    const importableFromClaude = path.join(claudeSkillsRoot, 'e2e-importable-skill');
    fs.mkdirSync(importableFromClaude, { recursive: true });
    fs.writeFileSync(path.join(importableFromClaude, 'SKILL.md'), '# importable', 'utf-8');
    const agentsSkillsRoot = path.join(tmpHome, '.agents', 'skills');
    const importableFromAgents = path.join(agentsSkillsRoot, 'e2e-agents-skill');
    fs.mkdirSync(importableFromAgents, { recursive: true });
    fs.writeFileSync(path.join(importableFromAgents, 'SKILL.md'), '# agents-importable', 'utf-8');

    const unmanaged = await api('scan-unmanaged-codex-skills');
    assert(Array.isArray(unmanaged.items), 'scan-unmanaged-codex-skills should return items array');
    assert(unmanaged.items.some((item) => item && item.name === 'e2e-importable-skill' && item.sourceApp === 'claude'), 'scan-unmanaged-codex-skills should include claude source skills');
    assert(unmanaged.items.some((item) => item && item.name === 'e2e-agents-skill' && item.sourceApp === 'agents'), 'scan-unmanaged-codex-skills should include agents source skills');

    const importNoSelection = await api('import-codex-skills', { items: [] });
    assert(importNoSelection.error, 'import-codex-skills should fail for empty items');

    const importSkills = await api('import-codex-skills', { items: [{ name: 'e2e-importable-skill', sourceApp: 'claude' }] });
    assert(Array.isArray(importSkills.imported), 'import-codex-skills should return imported list');
    assert(importSkills.imported.some((item) => item && item.name === 'e2e-importable-skill'), 'import-codex-skills should import selected skill');
    assert(fs.existsSync(path.join(skillsRoot, 'e2e-importable-skill')), 'imported skill should exist in codex skills root');
    const importAgentsSkills = await api('import-codex-skills', { items: [{ name: 'e2e-agents-skill', sourceApp: 'agents' }] });
    assert(Array.isArray(importAgentsSkills.imported), 'import-codex-skills should return imported list for agents source');
    assert(importAgentsSkills.imported.some((item) => item && item.name === 'e2e-agents-skill'), 'import-codex-skills should import agents source skill');
    assert(fs.existsSync(path.join(skillsRoot, 'e2e-agents-skill')), 'agents source skill should exist in codex skills root');

    const zipImportWorkspace = path.join(tmpHome, '.zip-import');
    const zipSkillSourceRoot = path.join(zipImportWorkspace, 'bundle');
    const zipSkillDir = path.join(zipSkillSourceRoot, 'e2e-zip-skill');
    fs.mkdirSync(zipSkillDir, { recursive: true });
    fs.writeFileSync(path.join(zipSkillDir, 'SKILL.md'), '# zip-skill', 'utf-8');
    const zipPath = path.join(zipImportWorkspace, 'e2e-skills.zip');
    await zipLib.archiveFolder(zipSkillSourceRoot, zipPath);
    const importZipSkills = await api('import-codex-skills-zip', {
        fileName: 'e2e-skills.zip',
        fileBase64: fs.readFileSync(zipPath).toString('base64')
    });
    assert(Array.isArray(importZipSkills.imported), 'import-codex-skills-zip should return imported list');
    assert(importZipSkills.imported.some((item) => item && item.name === 'e2e-zip-skill'), 'import-codex-skills-zip should import skill from zip');
    assert(fs.existsSync(path.join(skillsRoot, 'e2e-zip-skill')), 'zip imported skill should exist in codex skills root');

    const exportNoSelection = await api('export-codex-skills', { names: [] });
    assert(exportNoSelection.error, 'export-codex-skills should fail for empty names');
    const exportSkills = await api('export-codex-skills', { names: ['e2e-skill-alpha', 'e2e-zip-skill'] });
    assert(Array.isArray(exportSkills.exported), 'export-codex-skills should return exported list');
    assert(exportSkills.exported.some((item) => item && item.name === 'e2e-skill-alpha'), 'export-codex-skills should export alpha');
    assert(exportSkills.fileName && typeof exportSkills.fileName === 'string', 'export-codex-skills should return downloadable fileName');
    const exportedZipPath = path.join(os.tmpdir(), exportSkills.fileName);
    assert(fs.existsSync(exportedZipPath), 'exported zip should exist in tmp directory');
    assert(fs.statSync(exportedZipPath).size > 0, 'exported zip should be non-empty');
    fs.rmSync(exportedZipPath, { force: true });

    const deleteNoSelection = await api('delete-codex-skills', { names: [] });
    assert(deleteNoSelection.error, 'delete-codex-skills should fail for empty names');

    const deleteSkills = await api('delete-codex-skills', { names: ['e2e-skill-alpha', 'e2e-skill-beta', 'e2e-importable-skill', 'e2e-agents-skill', 'e2e-zip-skill'] });
    assert(Array.isArray(deleteSkills.deleted), 'delete-codex-skills should return deleted list');
    assert(deleteSkills.deleted.includes('e2e-skill-alpha'), 'delete-codex-skills should delete alpha');
    assert(deleteSkills.deleted.includes('e2e-skill-beta'), 'delete-codex-skills should delete beta');
    assert(deleteSkills.deleted.includes('e2e-importable-skill'), 'delete-codex-skills should delete imported skill');
    assert(deleteSkills.deleted.includes('e2e-agents-skill'), 'delete-codex-skills should delete agents imported skill');
    assert(deleteSkills.deleted.includes('e2e-zip-skill'), 'delete-codex-skills should delete zip imported skill');
    assert(!fs.existsSync(skillAlpha), 'alpha skill directory should be removed');
    assert(!fs.existsSync(skillBeta), 'beta skill directory should be removed');
    assert(!fs.existsSync(path.join(skillsRoot, 'e2e-importable-skill')), 'imported skill directory should be removed');
    assert(!fs.existsSync(path.join(skillsRoot, 'e2e-agents-skill')), 'agents imported skill directory should be removed');
    assert(!fs.existsSync(path.join(skillsRoot, 'e2e-zip-skill')), 'zip imported skill directory should be removed');

    // ========== OpenClaw 配置测试 ==========
    const openclawResult = await api('get-openclaw-config');
    assert(openclawResult.content !== undefined || openclawResult.error, 'get-openclaw-config should return content or error');

    // ========== 速度测试 ==========
    if (ctx.currentProvider) {
        const speedResult = await api('speed-test', { provider: ctx.currentProvider });
        assert(speedResult.ok !== undefined || speedResult.error, 'speed-test should return ok or error');
    }

    const speedByUrl = await api('speed-test', { url: ctx.mockProviderUrl });
    assert(speedByUrl.ok !== undefined || speedByUrl.error, 'speed-test(url) should return ok or error');

    // ========== Claude 配置测试 ==========
    const claudeSettings = await api('get-claude-settings');
    assert(claudeSettings.env !== undefined || claudeSettings.error, 'get-claude-settings should return env or error');

    // ========== 提供商分享命令测试 ==========
    if (ctx.currentProvider) {
        const shareResult = await api('export-provider', { name: ctx.currentProvider });
        assert(shareResult.payload !== undefined || shareResult.error, 'export-provider should return payload or error');
    }

    const shareMissing = await api('export-provider', { name: 'nonexistent' });
    assert(shareMissing.error, 'export-provider should fail for nonexistent provider');

    // ========== Claude 分享命令测试 ==========
    if (ctx.claudeConfigs && Object.keys(ctx.claudeConfigs).length > 0) {
        const firstConfigName = Object.keys(ctx.claudeConfigs)[0];
        const claudeShareResult = await api('export-claude-share', { config: ctx.claudeConfigs[firstConfigName] });
        assert(claudeShareResult.payload !== undefined || claudeShareResult.error, 'export-claude-share should return payload or error');
    }

    // ========== 无效操作测试 ==========
    const invalidSession = await api('session-detail', { source: 'codex', sessionId: 'nonexistent-session-id' });
    assert(invalidSession.error, 'session-detail should return error for nonexistent session');

    // ========== 会话路径选项测试 ==========
    const pathsResult = await api('list-session-paths', { source: 'codex', limit: 100 });
    assert(Array.isArray(pathsResult.paths) || pathsResult.error, 'list-session-paths should return paths or error');

    const pathsClaude = await api('list-session-paths', { source: 'claude', limit: 100 });
    assert(Array.isArray(pathsClaude.paths) || pathsClaude.error, 'list-session-paths(claude) should return paths or error');

    // ========== 模型列表 - 通过 URL 获取 ==========
    if (ctx.mockProviderUrl) {
        const modelsByUrl = await api('models-by-url', { baseUrl: ctx.mockProviderUrl, apiKey: 'test-key' });
        assert(modelsByUrl.models !== undefined || modelsByUrl.unlimited || modelsByUrl.error, 'models-by-url should return models, unlimited, or error');
    }

    const modelsByUrlInvalid = await api('models-by-url', { baseUrl: 'not-a-url' });
    assert(modelsByUrlInvalid.error, 'models-by-url should fail for invalid url');

    // ========== 配置重装测试 ==========
    const resetConfigResult = await api('reset-config');
    assert(resetConfigResult.backup !== undefined || resetConfigResult.success !== undefined || resetConfigResult.error, 'reset-config should return backup/success or error');

    // ========== 添加提供商测试 ==========
    const addProviderResult = await api('add-provider', { name: 'test-duplicate', url: 'http://test.com', key: 'test-key' });
    assert(addProviderResult.success !== undefined || addProviderResult.error, 'add-provider should return success or error');

    const addProviderDupName = await api('add-provider', { name: '', url: 'http://test.com' });
    assert(addProviderDupName.error, 'add-provider should fail for empty name');

    const addProviderDupUrl = await api('add-provider', { name: 'test-empty-url', url: '' });
    assert(addProviderDupUrl.error, 'add-provider should fail for empty url');

    // ========== 更新提供商测试 ==========
    const updateProviderResult = await api('update-provider', { name: 'test-duplicate', url: 'http://test.com', key: 'test-key' });
    assert(updateProviderResult.success !== undefined || updateProviderResult.error, 'update-provider should return success or error');

    const updateProviderMissing = await api('update-provider', { name: 'nonexistent', url: 'http://test.com' });
    assert(updateProviderMissing.error, 'update-provider should fail for missing provider');

    // ========== 删除提供商测试 ==========
    const deleteProviderMissing = await api('delete-provider', { name: 'nonexistent' });
    assert(deleteProviderMissing.error, 'delete-provider should fail for missing provider');

    const deleteProviderEmpty = await api('delete-provider', { name: '' });
    assert(deleteProviderEmpty.error, 'delete-provider should fail for empty name');

    // ========== 获取最近配置测试 ==========
    const recentConfigsResult = await api('get-recent-configs');
    assert(Array.isArray(recentConfigsResult.items), 'get-recent-configs should return array');

    // ========== 导出配置测试 ==========
    const exportConfigKeys = await api('export-config', { includeKeys: true });
    assert(exportConfigKeys.data !== undefined || exportConfigKeys.error, 'export-config(with keys) should return data or error');

    const exportConfigNoKeys = await api('export-config', { includeKeys: false });
    assert(exportConfigNoKeys.data !== undefined || exportConfigNoKeys.error, 'export-config(no keys) should return data or error');

    // ========== 导入配置测试 ==========
    const importConfigInvalid = await api('import-config', { payload: null });
    assert(importConfigInvalid.error, 'import-config should fail for null payload');

    const importConfigEmpty = await api('import-config', { payload: {} });
    assert(importConfigEmpty.error, 'import-config should fail for empty payload');

    // ========== 会话 plain 测试 ==========
    if (ctx.sessionId) {
        const sessionPlain = await api('session-plain', { source: 'codex', sessionId: ctx.sessionId });
        assert(sessionPlain.text !== undefined || sessionPlain.error, 'session-plain should return text or error');
    }

    // ========== 清理测试数据 ==========
    if (addProviderResult.success) {
        await api('delete-provider', { name: 'test-duplicate' });
    }
};
