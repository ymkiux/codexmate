const { assert } = require('./helpers');

module.exports = async function testOpenclaw(ctx) {
    const { api } = ctx;

    const openclawReadEmpty = await api('get-openclaw-config');
    assert(openclawReadEmpty.exists === false, 'openclaw config should not exist initially');

    const openclawInvalid = await api('apply-openclaw-config', { content: '', lineEnding: '\n' });
    assert(openclawInvalid.success === false, 'apply-openclaw-config should reject empty content');

    const openclawContent = [
        '{',
        '  "agent": { "model": "gpt-4.1" },',
        '  "agents": { "defaults": { "workspace": "~/.openclaw/workspace" } }',
        '}'
    ].join('\n');
    const openclawApply = await api('apply-openclaw-config', { content: openclawContent, lineEnding: '\n' });
    assert(openclawApply.success === true, `apply-openclaw-config failed${openclawApply && openclawApply.error ? `: ${openclawApply.error}` : ''}`);
    const openclawReadAfter = await api('get-openclaw-config');
    assert(openclawReadAfter.exists === true, 'openclaw config should exist after apply');

    const openclawAgentsBefore = await api('get-openclaw-agents-file');
    assert(openclawAgentsBefore.path, 'get-openclaw-agents-file missing path');
    const openclawAgentsApply = await api('apply-openclaw-agents-file', { content: 'openclaw-agents', lineEnding: '\n' });
    assert(openclawAgentsApply.success === true, 'apply-openclaw-agents-file failed');
    const openclawAgentsAfter = await api('get-openclaw-agents-file');
    assert(openclawAgentsAfter.exists === true, 'openclaw agents should exist after apply');
    assert(openclawAgentsAfter.content.includes('openclaw-agents'), 'openclaw agents content mismatch');

    const openclawWorkspaceInvalid = await api('apply-openclaw-workspace-file', {
        fileName: 'bad.txt',
        content: 'x',
        lineEnding: '\n'
    });
    assert(openclawWorkspaceInvalid.error, 'apply-openclaw-workspace-file should reject invalid name');

    const openclawWorkspaceApply = await api('apply-openclaw-workspace-file', {
        fileName: 'SOUL.md',
        content: 'workspace-content',
        lineEnding: '\n'
    });
    assert(openclawWorkspaceApply.success === true, 'apply-openclaw-workspace-file failed');
    const openclawWorkspaceRead = await api('get-openclaw-workspace-file', { fileName: 'SOUL.md' });
    assert(openclawWorkspaceRead.exists === true, 'get-openclaw-workspace-file missing after apply');
    assert(openclawWorkspaceRead.content.includes('workspace-content'), 'openclaw workspace content mismatch');
};
