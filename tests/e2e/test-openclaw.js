const { assert } = require('./helpers');

module.exports = async function testOpenclaw(ctx) {
    const { api } = ctx;

    // ========== Get OpenClaw Config Tests ==========
    const openclawReadEmpty = await api('get-openclaw-config');
    assert(openclawReadEmpty.exists === false, 'openclaw config should not exist initially');
    assert(typeof openclawReadEmpty.path === 'string', 'get-openclaw-config missing path');
    assert('lineEnding' in openclawReadEmpty, 'get-openclaw-config missing lineEnding');

    // ========== Apply OpenClaw Config Tests ==========
    const openclawInvalid = await api('apply-openclaw-config', { content: '', lineEnding: '\n' });
    assert(openclawInvalid.success === false, 'apply-openclaw-config should reject empty content');

    const openclawInvalidJson = await api('apply-openclaw-config', { content: 'not valid json', lineEnding: '\n' });
    assert(openclawInvalid.success === false, 'apply-openclaw-config should reject invalid json');

    const openclawContent = [
        '{',
        '  "agent": { "model": "gpt-4.1" },',
        '  "agents": { "defaults": { "workspace": "~/.openclaw/workspace" } }',
        '}'
    ].join('\n');
    const openclawApply = await api('apply-openclaw-config', { content: openclawContent, lineEnding: '\n' });
    assert(openclawApply.success === true, `apply-openclaw-config failed${openclawApply && openclawApply.error ? `: ${openclawApply.error}` : ''}`);
    assert(typeof openclawApply.targetPath === 'string', 'apply-openclaw-config missing targetPath');
    
    const openclawReadAfter = await api('get-openclaw-config');
    assert(openclawReadAfter.exists === true, 'openclaw config should exist after apply');
    assert(openclawReadAfter.content.includes('gpt-4.1'), 'openclaw config content mismatch');

    // ========== CRLF Line Ending Tests ==========
    const openclawCrlfContent = '{\r\n  "agent": { "model": "gpt-4.2" }\r\n}';
    const openclawApplyCrlf = await api('apply-openclaw-config', { content: openclawCrlfContent, lineEnding: '\r\n' });
    assert(openclawApplyCrlf.success === true, 'apply-openclaw-config(crlf) failed');

    const openclawReadCrlf = await api('get-openclaw-config');
    assert(openclawReadCrlf.lineEnding === '\r\n', 'openclaw config lineEnding should be crlf');

    // ========== Get OpenClaw Agents File Tests ==========
    const openclawAgentsBefore = await api('get-openclaw-agents-file');
    assert(openclawAgentsBefore.path, 'get-openclaw-agents-file missing path');
    assert('exists' in openclawAgentsBefore, 'get-openclaw-agents-file missing exists');
    assert('content' in openclawAgentsBefore, 'get-openclaw-agents-file missing content');
    assert('lineEnding' in openclawAgentsBefore, 'get-openclaw-agents-file missing lineEnding');
    assert('workspaceDir' in openclawAgentsBefore, 'get-openclaw-agents-file missing workspaceDir');

    // ========== Apply OpenClaw Agents File Tests ==========
    const openclawAgentsApply = await api('apply-openclaw-agents-file', { content: 'openclaw-agents', lineEnding: '\n' });
    assert(openclawAgentsApply.success === true, 'apply-openclaw-agents-file failed');
    assert(typeof openclawAgentsApply.path === 'string', 'apply-openclaw-agents-file missing path');

    const openclawAgentsAfter = await api('get-openclaw-agents-file');
    assert(openclawAgentsAfter.exists === true, 'openclaw agents should exist after apply');
    assert(openclawAgentsAfter.content.includes('openclaw-agents'), 'openclaw agents content mismatch');

    // ========== Empty Content Apply Tests ==========
    const openclawAgentsEmpty = await api('apply-openclaw-agents-file', { content: '', lineEnding: '\n' });
    assert(openclawAgentsEmpty.success === true, 'apply-openclaw-agents-file should allow empty content');

    // ========== Apply OpenClaw Workspace File Tests ==========
    const openclawWorkspaceInvalid = await api('apply-openclaw-workspace-file', {
        fileName: 'bad.txt',
        content: 'x',
        lineEnding: '\n'
    });
    assert(openclawWorkspaceInvalid.error, 'apply-openclaw-workspace-file should reject invalid name');

    const openclawWorkspaceNoExtension = await api('apply-openclaw-workspace-file', {
        fileName: 'noextension',
        content: 'x',
        lineEnding: '\n'
    });
    assert(openclawWorkspaceNoExtension.error, 'apply-openclaw-workspace-file should reject file without .md extension');

    const openclawWorkspacePathTraversal = await api('apply-openclaw-workspace-file', {
        fileName: '../escape.md',
        content: 'x',
        lineEnding: '\n'
    });
    assert(openclawWorkspacePathTraversal.error, 'apply-openclaw-workspace-file should reject path traversal');

    const openclawWorkspaceSlash = await api('apply-openclaw-workspace-file', {
        fileName: 'sub/file.md',
        content: 'x',
        lineEnding: '\n'
    });
    assert(openclawWorkspaceSlash.error, 'apply-openclaw-workspace-file should reject path with slash');

    const openclawWorkspaceApply = await api('apply-openclaw-workspace-file', {
        fileName: 'SOUL.md',
        content: 'workspace-content',
        lineEnding: '\n'
    });
    assert(openclawWorkspaceApply.success === true, 'apply-openclaw-workspace-file failed');
    assert(typeof openclawWorkspaceApply.path === 'string', 'apply-openclaw-workspace-file missing path');

    const openclawWorkspaceRead = await api('get-openclaw-workspace-file', { fileName: 'SOUL.md' });
    assert(openclawWorkspaceRead.exists === true, 'get-openclaw-workspace-file missing after apply');
    assert(openclawWorkspaceRead.content.includes('workspace-content'), 'openclaw workspace content mismatch');
    assert(openclawWorkspaceRead.workspaceDir, 'get-openclaw-workspace-file missing workspaceDir');

    // ========== Get Non-existent Workspace File Tests ==========
    const openclawWorkspaceNonExistent = await api('get-openclaw-workspace-file', { fileName: 'nonexistent.md' });
    assert(openclawWorkspaceNonExistent.exists === false, 'get-openclaw-workspace-file should return exists:false for missing file');

    // ========== Invalid Filename Tests ==========
    const openclawWorkspaceEmptyName = await api('apply-openclaw-workspace-file', {
        fileName: '',
        content: 'x',
        lineEnding: '\n'
    });
    assert(openclawWorkspaceEmptyName.error, 'apply-openclaw-workspace-file should reject empty filename');

    const openclawWorkspaceNull = await api('apply-openclaw-workspace-file', {
        fileName: 'test\x00.md',
        content: 'x',
        lineEnding: '\n'
    });
    assert(openclawWorkspaceNull.error, 'apply-openclaw-workspace-file should reject null character in filename');
};
