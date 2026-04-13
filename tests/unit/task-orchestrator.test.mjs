import assert from 'assert';
import test from 'node:test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
    splitTargetIntoItems,
    computePlanWaves,
    buildTaskPlan,
    validateTaskPlan,
    executeTaskPlan
} = require('../../lib/task-orchestrator.js');

test('splitTargetIntoItems prefers explicit line items', () => {
    const items = splitTargetIntoItems('修复以下问题\n- 更新导航\n- 新增 API\n- 补测试');
    assert.deepStrictEqual(items, ['修复以下问题', '更新导航', '新增 API', '补测试']);
});

test('computePlanWaves groups dependencies into waves', () => {
    const waves = computePlanWaves([
        { id: 'inspect', dependsOn: [] },
        { id: 'work-a', dependsOn: ['inspect'] },
        { id: 'work-b', dependsOn: ['inspect'] },
        { id: 'verify', dependsOn: ['work-a', 'work-b'] }
    ]);
    assert.deepStrictEqual(waves.map((wave) => wave.nodeIds), [
        ['inspect'],
        ['work-a', 'work-b'],
        ['verify']
    ]);
});

test('buildTaskPlan generates codex orchestration nodes and follow-ups', () => {
    const plan = buildTaskPlan({
        target: '实现任务编排 Tab\n- 新增前端面板\n- 扩展 CLI',
        allowWrite: true,
        concurrency: 3,
        followUps: ['继续处理 review 评论']
    });
    assert.strictEqual(plan.engine, 'codex');
    assert.strictEqual(plan.allowWrite, true);
    assert.strictEqual(plan.concurrency, 3);
    assert.ok(Array.isArray(plan.nodes));
    assert.ok(plan.nodes.some((node) => node.kind === 'codex'));
    assert.ok(plan.nodes.some((node) => node.title.includes('验证')));
    assert.strictEqual(plan.followUps.length, 1);
    assert.strictEqual(plan.nodes[plan.nodes.length - 1].kind, 'codex');
});

test('buildTaskPlan can map workflow ids onto sequential workflow nodes', () => {
    const plan = buildTaskPlan({
        target: '诊断并切换 provider',
        workflowIds: ['diagnose-config', 'safe-provider-switch'],
        engine: 'workflow'
    }, {
        workflowCatalog: [
            { id: 'diagnose-config', name: '诊断配置', readOnly: true },
            { id: 'safe-provider-switch', name: '安全切换', readOnly: false }
        ]
    });
    assert.strictEqual(plan.nodes.length, 2);
    assert.strictEqual(plan.nodes[0].kind, 'workflow');
    assert.deepStrictEqual(plan.nodes[1].dependsOn, [plan.nodes[0].id]);
    assert.strictEqual(plan.nodes[1].write, true);
});

test('buildTaskPlan keeps workflow follow-ups inside the final workflow node payload', () => {
    const plan = buildTaskPlan({
        target: '诊断并整理结果',
        workflowIds: ['diagnose-config', 'safe-provider-switch'],
        engine: 'workflow',
        followUps: ['整理结论', '输出建议']
    }, {
        workflowCatalog: [
            { id: 'diagnose-config', name: '诊断配置', readOnly: true },
            { id: 'safe-provider-switch', name: '安全切换', readOnly: false }
        ]
    });
    assert.strictEqual(plan.nodes.length, 2);
    assert.strictEqual(plan.nodes.every((node) => node.kind === 'workflow'), true);
    assert.deepStrictEqual(plan.nodes[1].input.followUps, ['整理结论', '输出建议']);
});


test('validateTaskPlan rejects unknown workflow ids instead of silently falling back', () => {
    const plan = buildTaskPlan({
        target: '诊断配置',
        workflowIds: ['missing-workflow'],
        engine: 'workflow'
    }, {
        workflowCatalog: [
            { id: 'diagnose-config', name: '诊断配置', readOnly: true }
        ]
    });
    assert.strictEqual(plan.engine, 'workflow');
    assert.strictEqual(plan.nodes.length, 1);
    assert.strictEqual(plan.nodes[0].kind, 'workflow');
    const validation = validateTaskPlan(plan, {
        workflowCatalog: [
            { id: 'diagnose-config', name: '诊断配置', readOnly: true }
        ]
    });
    assert.strictEqual(validation.ok, false);
    assert.ok(validation.issues.some((item) => item.code === 'task-node-workflow-unknown'));
});

test('validateTaskPlan rejects dependency cycles', () => {
    const result = validateTaskPlan({
        nodes: [
            { id: 'a', kind: 'codex', prompt: 'a', dependsOn: ['b'] },
            { id: 'b', kind: 'codex', prompt: 'b', dependsOn: ['a'] }
        ]
    });
    assert.strictEqual(result.ok, false);
    assert.ok(result.issues.some((item) => item.code === 'task-plan-cycle-detected'));
});

test('executeTaskPlan respects dependency blocking and concurrency', async () => {
    const callOrder = [];
    const run = await executeTaskPlan({
        concurrency: 2,
        nodes: [
            { id: 'inspect', kind: 'codex', prompt: 'inspect', dependsOn: [], write: false },
            { id: 'work-a', kind: 'codex', prompt: 'work-a', dependsOn: ['inspect'], write: false },
            { id: 'work-b', kind: 'codex', prompt: 'work-b', dependsOn: ['inspect'], write: false },
            { id: 'verify', kind: 'codex', prompt: 'verify', dependsOn: ['work-a', 'work-b'], write: false }
        ]
    }, {
        concurrency: 2,
        async executeNode(node, ctx) {
            callOrder.push({ id: node.id, deps: ctx.dependencyResults.map((item) => item.id) });
            return {
                success: true,
                summary: `${node.id} ok`,
                output: { id: node.id },
                logs: []
            };
        }
    });
    assert.strictEqual(run.status, 'success');
    assert.deepStrictEqual(callOrder[0], { id: 'inspect', deps: [] });
    assert.ok(callOrder.some((item) => item.id === 'work-a'));
    assert.ok(callOrder.some((item) => item.id === 'work-b'));
    assert.deepStrictEqual(callOrder.find((item) => item.id === 'work-a')?.deps, ['inspect']);
    assert.deepStrictEqual(callOrder.find((item) => item.id === 'work-b')?.deps, ['inspect']);
    assert.deepStrictEqual([...(callOrder.find((item) => item.id === 'verify')?.deps || [])].sort(), ['work-a', 'work-b']);
    assert.strictEqual(run.nodes.find((node) => node.id === 'verify').status, 'success');
});

test('executeTaskPlan retries failed nodes within auto-fix rounds', async () => {
    const attempts = new Map();
    const run = await executeTaskPlan({
        nodes: [
            { id: 'work', kind: 'codex', prompt: 'work', dependsOn: [], write: false, autoFixRounds: 1 }
        ]
    }, {
        async executeNode(node) {
            const current = (attempts.get(node.id) || 0) + 1;
            attempts.set(node.id, current);
            if (current === 1) {
                return {
                    success: false,
                    error: 'first try failed',
                    summary: 'failed'
                };
            }
            return {
                success: true,
                summary: 'recovered'
            };
        }
    });
    assert.strictEqual(run.status, 'success');
    assert.strictEqual(run.nodes[0].attemptCount, 2);
    assert.strictEqual(run.nodes[0].summary, 'recovered');
});

test('executeTaskPlan marks downstream nodes blocked when dependency fails', async () => {
    const run = await executeTaskPlan({
        nodes: [
            { id: 'fail', kind: 'codex', prompt: 'fail', dependsOn: [], write: false },
            { id: 'after', kind: 'codex', prompt: 'after', dependsOn: ['fail'], write: false }
        ]
    }, {
        async executeNode(node) {
            if (node.id === 'fail') {
                return {
                    success: false,
                    error: 'boom',
                    summary: 'boom'
                };
            }
            return { success: true, summary: 'ok' };
        }
    });
    assert.strictEqual(run.status, 'failed');
    assert.strictEqual(run.nodes.find((node) => node.id === 'fail').status, 'failed');
    assert.strictEqual(run.nodes.find((node) => node.id === 'after').status, 'blocked');
});


test('executeTaskPlan keeps payload logs without duplicating them', async () => {
    const run = await executeTaskPlan({
        nodes: [
            { id: 'work', kind: 'codex', prompt: 'work', dependsOn: [], write: false }
        ]
    }, {
        async executeNode() {
            return {
                success: true,
                summary: 'ok',
                logs: [{ level: 'info', message: 'payload log' }]
            };
        }
    });
    const nodeLogs = run.nodes[0].logs || [];
    assert.strictEqual(nodeLogs.filter((item) => item.message === 'payload log').length, 1);
});
