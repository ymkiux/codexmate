const { assert, runSync, fs, path } = require('./helpers');

function parseJsonOutput(rawText) {
    const text = String(rawText || '').trim();
    if (!text) {
        return {};
    }
    try {
        return JSON.parse(text);
    } catch (_) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return JSON.parse(text.slice(start, end + 1));
        }
        throw new Error(`invalid json output: ${text.slice(0, 200)}`);
    }
}

module.exports = async function testWorkflow(ctx) {
    const { api, node, cliPath, env, tmpHome } = ctx;

    const listResult = runSync(node, [cliPath, 'workflow', 'list', '--json'], { env });
    assert(listResult.status === 0, `workflow list failed: ${listResult.stderr || listResult.stdout}`);
    const listPayload = parseJsonOutput(listResult.stdout);
    assert(Array.isArray(listPayload.workflows), 'workflow list should return workflows array');

    const workflowIds = new Set((listPayload.workflows || []).map((item) => item && item.id).filter(Boolean));
    assert(workflowIds.has('diagnose-config'), 'workflow list should include diagnose-config');
    assert(workflowIds.has('safe-provider-switch'), 'workflow list should include safe-provider-switch');
    assert(workflowIds.has('session-issue-pack'), 'workflow list should include session-issue-pack');

    const validateResult = runSync(node, [
        cliPath,
        'workflow',
        'validate',
        'safe-provider-switch',
        '--input',
        '{"provider":"e2e"}',
        '--json'
    ], { env });
    assert(validateResult.status === 0, `workflow validate failed: ${validateResult.stderr || validateResult.stdout}`);
    const validatePayload = parseJsonOutput(validateResult.stdout);
    assert(validatePayload.ok === true, 'workflow validate should succeed with provider input');

    const runDiagnoseResult = runSync(node, [
        cliPath,
        'workflow',
        'run',
        'diagnose-config',
        '--input',
        '{}',
        '--json'
    ], { env });
    assert(runDiagnoseResult.status === 0, `workflow run diagnose-config failed: ${runDiagnoseResult.stderr || runDiagnoseResult.stdout}`);
    const runDiagnosePayload = parseJsonOutput(runDiagnoseResult.stdout);
    assert(runDiagnosePayload.success === true, 'diagnose-config workflow should run successfully');
    assert(Array.isArray(runDiagnosePayload.steps), 'diagnose-config should return steps');
    assert(runDiagnosePayload.steps.length >= 3, 'diagnose-config should execute builtin steps');

    const runBlockedResult = runSync(node, [
        cliPath,
        'workflow',
        'run',
        'safe-provider-switch',
        '--input',
        '{"provider":"e2e","apply":true}',
        '--json'
    ], { env });
    assert(runBlockedResult.status !== 0, 'write workflow run should fail without --allow-write');
    const runBlockedPayload = parseJsonOutput(runBlockedResult.stdout);
    assert(runBlockedPayload.success === false, 'blocked workflow run should be unsuccessful');
    assert(
        typeof runBlockedPayload.error === 'string' && runBlockedPayload.error.includes('allowWrite'),
        'blocked workflow run should report allowWrite error'
    );

    const runsResult = runSync(node, [cliPath, 'workflow', 'runs', '--limit', '10', '--json'], { env });
    assert(runsResult.status === 0, `workflow runs failed: ${runsResult.stderr || runsResult.stdout}`);
    const runsPayload = parseJsonOutput(runsResult.stdout);
    assert(Array.isArray(runsPayload.runs), 'workflow runs should return runs array');
    assert(runsPayload.runs.length >= 2, 'workflow runs should contain recent records');

    const runsFile = path.join(tmpHome, '.codex', 'codexmate-workflow-runs.jsonl');
    assert(fs.existsSync(runsFile), 'workflow runs file should be created');

    const apiList = await api('workflow-list');
    assert(Array.isArray(apiList.workflows), 'workflow-list API should return workflows');

    const apiGet = await api('workflow-get', { id: 'diagnose-config' });
    assert(apiGet && apiGet.workflow && apiGet.workflow.id === 'diagnose-config', 'workflow-get API should return definition');

    const apiValidate = await api('workflow-validate', {
        id: 'safe-provider-switch',
        input: { provider: 'e2e' }
    });
    assert(apiValidate.ok === true, 'workflow-validate API should pass for valid input');

    const apiRun = await api('workflow-run', {
        id: 'diagnose-config',
        input: {}
    });
    assert(apiRun.success === true, 'workflow-run API should run diagnose-config');

    const apiRunBlocked = await api('workflow-run', {
        id: 'safe-provider-switch',
        input: { provider: 'e2e', apply: true }
    });
    assert(apiRunBlocked.success === false, 'workflow-run API should block write step by default');
    assert(
        typeof apiRunBlocked.error === 'string' && apiRunBlocked.error.includes('allowWrite'),
        'workflow-run API should return allowWrite guard error'
    );

    const apiRuns = await api('workflow-runs', { limit: 5 });
    assert(Array.isArray(apiRuns.runs), 'workflow-runs API should return runs array');
    assert(apiRuns.runs.length > 0, 'workflow-runs API should include latest run records');
};
