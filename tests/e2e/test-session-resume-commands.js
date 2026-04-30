const path = require('path');
const { pathToFileURL } = require('url');
const { assert } = require('./helpers');

function createWebUiVm(appOptions) {
    const vm = {
        ...(typeof appOptions.data === 'function' ? appOptions.data() : {}),
        $refs: {}
    };
    for (const [name, fn] of Object.entries(appOptions.methods || {})) {
        vm[name] = fn;
    }
    vm.$nextTick = function $nextTick(callback) {
        if (typeof callback === 'function') callback();
    };
    vm.showMessage = function showMessage() {};
    vm.fallbackCopyText = function fallbackCopyText() { return true; };
    return vm;
}

module.exports = async function testSessionResumeCommands(ctx) {
    const { api, claudeSessionId, geminiSessionId, claudeSessionPath, geminiSessionPath } = ctx;

    const helperPath = path.resolve(__dirname, '..', 'unit', 'helpers', 'web-ui-app-options.mjs');
    const { captureCurrentBundledAppOptions } = await import(pathToFileURL(helperPath).href);
    const appOptions = await captureCurrentBundledAppOptions();
    const vm = createWebUiVm(appOptions);

    const claudeSessions = await api('list-sessions', { source: 'claude', limit: 50, forceRefresh: true });
    const claudeEntry = (claudeSessions.sessions || []).find((item) => item && item.sessionId === claudeSessionId);
    assert(claudeEntry, 'resume e2e missing claude session entry');
    assert(vm.isResumeCommandAvailable(claudeEntry) === true, 'claude session should allow resume command');
    assert(vm.buildResumeCommand.call({ ...vm, sessionResumeWithYolo: true }, claudeEntry) === `claude -r ${claudeSessionId}`, 'claude resume command mismatch');

    const claudeNoId = { source: 'claude', sessionId: '', filePath: claudeSessionPath };
    assert(vm.isResumeCommandAvailable(claudeNoId) === true, 'claude should allow resume from filePath');
    assert(vm.buildResumeCommand.call({ ...vm, sessionResumeWithYolo: true }, claudeNoId).includes('claude -r '), 'claude resume command should be generated from filePath');

    const geminiSessions = await api('list-sessions', { source: 'gemini', limit: 50, forceRefresh: true });
    const geminiEntry = (geminiSessions.sessions || []).find((item) => item && item.sessionId === geminiSessionId);
    assert(geminiEntry, 'resume e2e missing gemini session entry');
    assert(vm.isResumeCommandAvailable(geminiEntry) === true, 'gemini session should allow resume command');
    assert(vm.buildResumeCommand.call({ ...vm, sessionResumeWithYolo: true }, geminiEntry) === `gemini -r ${geminiSessionId}`, 'gemini resume command mismatch');

    const geminiNoId = { source: 'gemini', sessionId: '', filePath: geminiSessionPath };
    assert(vm.isResumeCommandAvailable(geminiNoId) === true, 'gemini should allow resume from filePath');
    assert(vm.buildResumeCommand.call({ ...vm, sessionResumeWithYolo: true }, geminiNoId) === `gemini -r ${geminiSessionId}`, 'gemini resume command should be generated from filePath');
};

