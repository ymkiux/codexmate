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

module.exports = async function testTaskOrchestration(ctx) {
    const { api, node, cliPath, env, tmpHome } = ctx;

    const planResult = runSync(node, [
        cliPath,
        'task',
        'plan',
        '--target',
        '检查当前配置并输出摘要',
        '--follow-up',
        '整理结论',
        '--json'
    ], { env });
    assert(planResult.status === 0, `task plan failed: ${planResult.stderr || planResult.stdout}`);
    const planPayload = parseJsonOutput(planResult.stdout);
    assert(planPayload.ok === true, 'task plan should validate');
    assert(planPayload.plan && Array.isArray(planPayload.plan.nodes), 'task plan should include nodes');
    assert(planPayload.plan.nodes.length >= 2, 'task plan should include multiple nodes');

    const invalidWorkflowPlanResult = runSync(node, [
        cliPath,
        'task',
        'plan',
        '--target',
        'plain target',
        '--workflow-id',
        'missing-workflow',
        '--engine',
        'workflow',
        '--json'
    ], { env });
    assert(invalidWorkflowPlanResult.status !== 0, 'task plan should fail for unknown workflow ids');
    const invalidWorkflowPlanPayload = parseJsonOutput(invalidWorkflowPlanResult.stdout);
    assert(invalidWorkflowPlanPayload.ok === false, 'invalid workflow plan should be rejected');
    assert(Array.isArray(invalidWorkflowPlanPayload.issues), 'invalid workflow plan should include issues');
    assert(invalidWorkflowPlanPayload.issues.some((item) => String(item.message || '').includes('unknown workflow')), 'invalid workflow plan should mention unknown workflow');

    const runResult = runSync(node, [
        cliPath,
        'task',
        'run',
        '--target',
        '诊断当前配置',
        '--workflow-id',
        'diagnose-config',
        '--engine',
        'workflow',
        '--json'
    ], { env });
    assert(runResult.status === 0, `task run failed: ${runResult.stderr || runResult.stdout}`);
    const runPayload = parseJsonOutput(runResult.stdout);
    assert(runPayload.run && runPayload.run.status === 'success', 'task run should succeed with diagnose-config workflow');
    assert(typeof runPayload.runId === 'string' && runPayload.runId, 'task run should return runId');
    assert(typeof runPayload.taskId === 'string' && runPayload.taskId, 'task run should return taskId');

    const runsResult = runSync(node, [cliPath, 'task', 'runs', '--limit', '10', '--json'], { env });
    assert(runsResult.status === 0, `task runs failed: ${runsResult.stderr || runsResult.stdout}`);
    const runsPayload = parseJsonOutput(runsResult.stdout);
    assert(Array.isArray(runsPayload.runs), 'task runs should return runs array');
    assert(runsPayload.runs.some((item) => item.runId === runPayload.runId), 'task runs should include latest run');

    const queueAddResult = runSync(node, [
        cliPath,
        'task',
        'queue',
        'add',
        '--target',
        '再次诊断当前配置',
        '--workflow-id',
        'diagnose-config',
        '--engine',
        'workflow',
        '--json'
    ], { env });
    assert(queueAddResult.status === 0, `task queue add failed: ${queueAddResult.stderr || queueAddResult.stdout}`);
    const queueAddPayload = parseJsonOutput(queueAddResult.stdout);
    assert(queueAddPayload.ok === true, 'task queue add should succeed');
    assert(queueAddPayload.task && queueAddPayload.task.taskId, 'queue add should return task');

    const queueShowResult = runSync(node, [
        cliPath,
        'task',
        'queue',
        'show',
        queueAddPayload.task.taskId
    ], { env });
    assert(queueShowResult.status === 0, `task queue show failed: ${queueShowResult.stderr || queueShowResult.stdout}`);
    const queueShowPayload = parseJsonOutput(queueShowResult.stdout);
    assert(queueShowPayload.taskId === queueAddPayload.task.taskId, 'task queue show should resolve task');

    const queueStartResult = runSync(node, [
        cliPath,
        'task',
        'queue',
        'start',
        queueAddPayload.task.taskId,
        '--json'
    ], { env });
    assert(queueStartResult.status === 0, `task queue start failed: ${queueStartResult.stderr || queueStartResult.stdout}`);
    const queueStartPayload = parseJsonOutput(queueStartResult.stdout);
    assert(queueStartPayload.ok === true, 'task queue start should succeed');
    assert(queueStartPayload.detail && queueStartPayload.detail.run && queueStartPayload.detail.run.status === 'success', 'queued task should complete successfully');

    const logsResult = runSync(node, [
        cliPath,
        'task',
        'logs',
        queueStartPayload.detail.runId,
        '--json'
    ], { env });
    assert(logsResult.status === 0, `task logs failed: ${logsResult.stderr || logsResult.stdout}`);
    const logsPayload = parseJsonOutput(logsResult.stdout);
    assert(typeof logsPayload.logs === 'string', 'task logs should return log text');
    assert(logsPayload.logs.includes('# workflow-01') || logsPayload.logs.includes('# diagnose-config') || logsPayload.logs.includes('# workflow'), 'task logs should include node heading');

    const queueListResult = runSync(node, [cliPath, 'task', 'queue', 'list', '--json'], { env });
    assert(queueListResult.status === 0, `task queue list failed: ${queueListResult.stderr || queueListResult.stdout}`);
    const queueListPayload = parseJsonOutput(queueListResult.stdout);
    assert(Array.isArray(queueListPayload.tasks), 'task queue list should return tasks array');
    assert(queueListPayload.tasks.some((item) => item.taskId === queueAddPayload.task.taskId), 'task queue list should include queued task record');

    const taskRunsFile = path.join(tmpHome, '.codex', 'codexmate-task-runs.jsonl');
    const taskQueueFile = path.join(tmpHome, '.codex', 'codexmate-task-queue.json');
    assert(fs.existsSync(taskRunsFile), 'task runs file should be created');
    assert(fs.existsSync(taskQueueFile), 'task queue file should be created');

    const apiOverview = await api('task-overview');
    assert(Array.isArray(apiOverview.queue), 'task-overview API should return queue');
    assert(Array.isArray(apiOverview.runs), 'task-overview API should return runs');

    const apiPlan = await api('task-plan', {
        target: '检查配置后输出摘要',
        followUps: ['整理结果']
    });
    assert(apiPlan.ok === true, 'task-plan API should validate');
    assert(apiPlan.plan && Array.isArray(apiPlan.plan.waves), 'task-plan API should return waves');

    const apiQueueAdd = await api('task-queue-add', {
        target: '排队执行配置诊断',
        workflowIds: ['diagnose-config'],
        engine: 'workflow'
    });
    assert(apiQueueAdd.ok === true, 'task-queue-add API should succeed');

    const apiQueueStart = await api('task-queue-start', {
        taskId: apiQueueAdd.task.taskId,
        detach: false
    });
    assert(apiQueueStart.ok === true, 'task-queue-start API should succeed');
    assert(apiQueueStart.detail && apiQueueStart.detail.run && apiQueueStart.detail.run.status === 'success', 'API queue start should execute task');

    const apiRunDetail = await api('task-run-detail', { runId: apiQueueStart.detail.runId });
    assert(apiRunDetail && apiRunDetail.runId === apiQueueStart.detail.runId, 'task-run-detail API should return detail');

    const missingQueueStartResult = runSync(node, [
        cliPath,
        'task',
        'queue',
        'start',
        'missing-task',
        '--json'
    ], { env });
    assert(missingQueueStartResult.status !== 0, 'task queue start should fail for missing task');
    const missingQueueStartPayload = parseJsonOutput(missingQueueStartResult.stdout);
    assert(typeof missingQueueStartPayload.error === 'string' && missingQueueStartPayload.error.includes('task not found'), 'missing task queue start should report not found');

    const invalidRunIdResult = runSync(node, [
        cliPath,
        'task',
        'run',
        '--target',
        '诊断当前配置',
        '--workflow-id',
        'diagnose-config',
        '--engine',
        'workflow',
        '--run-id',
        '../escaped-run',
        '--json'
    ], { env });
    assert(invalidRunIdResult.status !== 0, 'task run should reject unsafe run ids');
    const invalidRunIdPayload = parseJsonOutput(invalidRunIdResult.stdout);
    assert(typeof invalidRunIdPayload.error === 'string' && invalidRunIdPayload.error.includes('unsupported characters'), 'unsafe run id should report validation error');

    const apiRetry = await api('task-retry', {
        runId: apiQueueStart.detail.runId,
        detach: false
    });
    assert(apiRetry && apiRetry.run && apiRetry.run.status === 'success', 'task-retry API should rerun task');

    const apiLogs = await api('task-logs', { runId: apiRetry.runId });
    assert(typeof apiLogs.logs === 'string', 'task-logs API should return logs');

    const apiCancelQueued = await api('task-queue-add', {
        target: '待取消任务',
        workflowIds: ['diagnose-config'],
        engine: 'workflow'
    });
    assert(apiCancelQueued.ok === true, 'second task-queue-add API should succeed');
    const apiCancel = await api('task-cancel', { taskId: apiCancelQueued.task.taskId });
    assert(apiCancel.ok === true, 'task-cancel API should cancel queued task');
};
