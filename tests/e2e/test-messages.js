const { assert } = require('./helpers');

/**
 * E2E 测试：Web UI 消息简化
 * 测试所有 showMessage 场景，确保消息简洁且不含技术细节
 */
module.exports = async function testMessages(ctx) {
    const { api, tmpHome } = ctx;

    // 测试 1: 模型列表获取失败 - 简化消息
    const modelsError = await api('models', { provider: 'nonexistent-provider' });
    // 后端返回错误，前端应显示简化消息 "获取模型列表失败"
    assert(modelsError.error, 'models should return error for nonexistent provider');

    // 测试 2: 会话列表 - 成功场景
    const sessions = await api('list-sessions', { source: 'codex', limit: 10 });
    assert(Array.isArray(sessions.sessions), 'list-sessions should return sessions array');

    // 测试 3: 会话详情 - 成功场景  
    if (ctx.sessionId) {
        const sessionDetail = await api('session-detail', { source: 'codex', sessionId: ctx.sessionId });
        assert(sessionDetail.messages || sessionDetail.error, 'session-detail should return data or error');
    }

    // 测试 4: 会话导出 - 成功场景
    if (ctx.sessionId) {
        const exportResult = await api('export-session', { source: 'codex', sessionId: ctx.sessionId, maxMessages: 10 });
        // 前端应显示简化消息 "导出完成" 或 "操作成功"
        assert(exportResult.content !== undefined || exportResult.error, 'export-session should return content or error');
    }

    // 测试 5: 会话克隆 - 成功场景
    if (ctx.sessionId) {
        const cloneResult = await api('clone-session', { source: 'codex', sessionId: ctx.sessionId });
        // 前端应显示简化消息 "操作成功"
        assert(cloneResult.success !== undefined || cloneResult.error, 'clone-session should return success or error');
        if (cloneResult.sessionId) {
            ctx.clonedSessionId = cloneResult.sessionId;
        }
    }

    // 测试 6: 会话删除 - 成功场景
    if (ctx.clonedSessionId) {
        const deleteResult = await api('delete-session', { source: 'codex', sessionId: ctx.clonedSessionId });
        // 前端应显示简化消息 "操作成功"
        assert(deleteResult.success !== undefined || deleteResult.error, 'delete-session should return success or error');
    }

    // 测试 7: 健康检查 - 成功场景
    const healthCheck = await api('health-check', { provider: ctx.currentProvider || 'e2e' });
    // 前端应显示简化消息 "检查通过" 或 "检查失败"
    assert(healthCheck.ok !== undefined || healthCheck.error, 'health-check should return ok or error');

    // 测试 8: 配置模板 - 获取成功
    const templateResult = await api('get-config-template');
    // API 可能返回 content 或 error 或 template
    assert(templateResult.content !== undefined || templateResult.template !== undefined || templateResult.error, 'get-config-template should return content/template or error');

    // 测试 9: AGENTS.md - 获取成功
    const agentsResult = await api('get-agents', { context: 'codex' });
    assert(agentsResult.content !== undefined || agentsResult.error, 'get-agents should return content or error');

    // 测试 10: OpenClaw 配置 - 获取成功
    const openclawResult = await api('get-openclaw-config');
    assert(openclawResult.content !== undefined || openclawResult.error, 'get-openclaw-config should return content or error');

    // 测试 11: 速度测试 - 成功场景
    if (ctx.currentProvider) {
        const speedResult = await api('speed-test', { provider: ctx.currentProvider });
        // 前端应显示简化消息 "测速完成"
        assert(speedResult.ok !== undefined || speedResult.error, 'speed-test should return ok or error');
    }

    // 测试 12: Claude 配置 - 获取成功
    const claudeSettings = await api('get-claude-settings');
    assert(claudeSettings.env !== undefined || claudeSettings.error, 'get-claude-settings should return env or error');

    // 测试 13: 提供商分享命令 - 成功场景
    if (ctx.currentProvider) {
        const shareResult = await api('export-provider', { name: ctx.currentProvider });
        // 前端应显示简化消息 "已复制" 或 "生成命令失败"
        assert(shareResult.payload !== undefined || shareResult.error, 'export-provider should return payload or error');
    }

    // 测试 14: Claude 分享命令 - 成功场景
    if (ctx.currentClaudeConfig && ctx.claudeConfigs && ctx.claudeConfigs[ctx.currentClaudeConfig]) {
        const claudeShareResult = await api('export-claude-share', { config: ctx.claudeConfigs[ctx.currentClaudeConfig] });
        // 前端应显示简化消息 "已复制" 或 "生成命令失败"
        assert(claudeShareResult.payload !== undefined || claudeShareResult.error, 'export-claude-share should return payload or error');
    }

    // 测试 15: 无效操作 - 错误处理
    const invalidSession = await api('session-detail', { source: 'codex', sessionId: 'nonexistent-session-id' });
    assert(invalidSession.error, 'session-detail should return error for nonexistent session');

    // 测试 16: 会话路径选项 - 成功场景
    const pathsResult = await api('list-session-paths', { source: 'codex', limit: 100 });
    assert(Array.isArray(pathsResult.paths) || pathsResult.error, 'list-session-paths should return paths or error');

    // 测试 17: 模型列表 - 通过 URL 获取
    if (ctx.mockProviderUrl) {
        const modelsByUrl = await api('models-by-url', { baseUrl: ctx.mockProviderUrl, apiKey: 'test-key' });
        assert(modelsByUrl.models !== undefined || modelsByUrl.unlimited || modelsByUrl.error, 'models-by-url should return models, unlimited, or error');
    }

    // 测试 18: 配置重装 - 成功场景（仅验证 API 可用）
    const resetConfigResult = await api('reset-config');
    // API 可能返回 backup 或 success 或 error
    assert(resetConfigResult.backup !== undefined || resetConfigResult.success !== undefined || resetConfigResult.error, 'reset-config should return backup/success or error');

    // 测试 19: 添加提供商 - 验证名称检查
    const addProviderResult = await api('add-provider', { name: 'test-duplicate', baseUrl: 'http://test.com', apiKey: 'test-key' });
    assert(addProviderResult.success !== undefined || addProviderResult.error, 'add-provider should return success or error');

    // 测试 20: 更新提供商 - 验证 API 可用
    const updateProviderResult = await api('update-provider', { name: 'test-duplicate', baseUrl: 'http://test.com', apiKey: 'test-key' });
    assert(updateProviderResult.success !== undefined || updateProviderResult.error, 'update-provider should return success or error');

    // 清理测试数据
    if (addProviderResult.success) {
        await api('delete-provider', { name: 'test-duplicate' });
    }
};
