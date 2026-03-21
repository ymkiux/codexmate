import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const {
    getPathValue,
    resolveTemplateValue,
    evaluateStepCondition,
    validateWorkflowDefinition,
    executeWorkflowDefinition
} = require(path.join(__dirname, '..', '..', 'lib', 'workflow-engine.js'));

test('workflow engine path/template helpers resolve nested values', () => {
    const context = {
        input: {
            provider: 'e2e',
            flags: { apply: true }
        },
        steps: {
            status: {
                output: {
                    ok: true,
                    provider: 'e2e'
                }
            }
        }
    };

    assert.strictEqual(getPathValue(context, 'input.provider'), 'e2e');
    assert.strictEqual(getPathValue(context, 'steps.status.output.ok'), true);
    assert.strictEqual(getPathValue(context, 'steps.status.output.missing'), undefined);

    const resolved = resolveTemplateValue({
        provider: '{{input.provider}}',
        message: 'provider={{steps.status.output.provider}}',
        apply: '{{input.flags.apply}}'
    }, context);

    assert.deepStrictEqual(resolved, {
        provider: 'e2e',
        message: 'provider=e2e',
        apply: true
    });

    assert.strictEqual(
        evaluateStepCondition({ path: 'input.flags.apply', equals: true }, context),
        true
    );
    assert.strictEqual(
        evaluateStepCondition({ path: 'input.flags.apply', equals: false }, context),
        false
    );
    assert.strictEqual(
        evaluateStepCondition({ path: 'steps.status.output.provider', exists: true }, context),
        true
    );
});

test('validateWorkflowDefinition catches duplicate id and unknown tool', () => {
    const validation = validateWorkflowDefinition({
        id: 'bad-workflow',
        steps: [
            { id: 'step1', tool: 'tool.ok' },
            { id: 'step1', tool: 'tool.unknown' }
        ]
    }, {
        knownTools: new Set(['tool.ok'])
    });

    assert.strictEqual(validation.ok, false);
    assert.ok(Array.isArray(validation.issues) && validation.issues.length >= 2);
    assert.ok(validation.issues.some((item) => item.code === 'workflow-step-id-duplicate'));
    assert.ok(validation.issues.some((item) => item.code === 'workflow-step-tool-unknown'));
});

test('validateWorkflowDefinition allows null step.when', () => {
    const validation = validateWorkflowDefinition({
        id: 'wf-null-when',
        steps: [
            { id: 'step1', tool: 'tool.ok', when: null }
        ]
    }, {
        knownTools: new Set(['tool.ok'])
    });

    assert.strictEqual(validation.ok, true);
});

test('executeWorkflowDefinition supports conditions and continueOnError', async () => {
    const definition = {
        id: 'wf-demo',
        steps: [
            {
                id: 'gather',
                tool: 'tool.gather',
                arguments: {
                    provider: '{{input.provider}}'
                }
            },
            {
                id: 'conditional',
                tool: 'tool.compose',
                when: { path: 'steps.gather.output.ok', equals: true },
                arguments: {
                    message: 'switch-{{steps.gather.output.provider}}'
                }
            },
            {
                id: 'softFail',
                tool: 'tool.fail',
                continueOnError: true,
                arguments: {}
            },
            {
                id: 'afterFail',
                tool: 'tool.echo',
                arguments: {
                    value: '{{steps.conditional.output.text}}'
                }
            }
        ]
    };

    const calls = [];
    const result = await executeWorkflowDefinition(definition, { provider: 'e2e' }, {
        invokeTool: async (toolName, args) => {
            calls.push({ toolName, args });
            if (toolName === 'tool.gather') {
                return { ok: true, provider: args.provider };
            }
            if (toolName === 'tool.compose') {
                return { text: args.message };
            }
            if (toolName === 'tool.fail') {
                return { error: 'expected soft failure' };
            }
            if (toolName === 'tool.echo') {
                return { echoed: args.value };
            }
            return { ok: true };
        }
    });

    assert.strictEqual(calls.length, 4);
    assert.strictEqual(result.success, false, 'workflow should fail when one step fails');
    assert.strictEqual(result.steps[0].status, 'success');
    assert.strictEqual(result.steps[1].status, 'success');
    assert.strictEqual(result.steps[2].status, 'failed');
    assert.strictEqual(result.steps[3].status, 'success');
    assert.deepStrictEqual(result.output, { echoed: 'switch-e2e' });
});

test('executeWorkflowDefinition enforces write guard and dry-run', async () => {
    const definition = {
        id: 'wf-write',
        steps: [
            {
                id: 'read',
                tool: 'tool.read',
                arguments: {}
            },
            {
                id: 'write',
                tool: 'tool.write',
                write: true,
                arguments: {
                    value: 'x'
                }
            }
        ]
    };

    const noWriteCalls = [];
    const blocked = await executeWorkflowDefinition(definition, {}, {
        allowWrite: false,
        invokeTool: async (toolName, args) => {
            noWriteCalls.push({ toolName, args });
            return { ok: true };
        }
    });

    assert.strictEqual(noWriteCalls.length, 1, 'write step should be blocked before invokeTool');
    assert.strictEqual(blocked.success, false);
    assert.ok(String(blocked.error || '').includes('allowWrite'));
    assert.strictEqual(blocked.steps[1].status, 'failed');

    const dryRunCalls = [];
    const dryRun = await executeWorkflowDefinition(definition, {}, {
        allowWrite: true,
        dryRun: true,
        invokeTool: async (toolName, args) => {
            dryRunCalls.push({ toolName, args });
            return { ok: true };
        }
    });

    assert.strictEqual(dryRunCalls.length, 1, 'dry-run should skip write invokeTool');
    assert.strictEqual(dryRun.success, true);
    assert.strictEqual(dryRun.steps[1].status, 'skipped');
    assert.strictEqual(dryRun.steps[1].reason, 'dry-run-write-step');
});
