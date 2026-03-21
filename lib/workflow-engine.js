function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getPathValue(source, path) {
    if (!path || typeof path !== 'string') {
        return undefined;
    }
    const parts = path
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean);
    let current = source;
    for (const part of parts) {
        if (current === null || current === undefined) {
            return undefined;
        }
        if (Array.isArray(current)) {
            const index = Number.parseInt(part, 10);
            if (!Number.isFinite(index)) {
                return undefined;
            }
            current = current[index];
            continue;
        }
        if (!isPlainObject(current)) {
            return undefined;
        }
        current = current[part];
    }
    return current;
}

function resolveTemplateString(template, context) {
    if (typeof template !== 'string') {
        return template;
    }
    const direct = template.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
    if (direct) {
        return getPathValue(context, direct[1].trim());
    }

    const pattern = /\{\{\s*([^{}]+?)\s*\}\}/g;
    return template.replace(pattern, (_, rawPath) => {
        const value = getPathValue(context, String(rawPath || '').trim());
        if (value === undefined || value === null) {
            return '';
        }
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch (_) {
                return '';
            }
        }
        return String(value);
    });
}

function resolveTemplateValue(value, context) {
    if (Array.isArray(value)) {
        return value.map((item) => resolveTemplateValue(item, context));
    }
    if (isPlainObject(value)) {
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            result[key] = resolveTemplateValue(item, context);
        }
        return result;
    }
    if (typeof value === 'string') {
        return resolveTemplateString(value, context);
    }
    return value;
}

function evaluateStepCondition(condition, context) {
    if (!condition) {
        return true;
    }
    if (!isPlainObject(condition)) {
        return !!condition;
    }
    const path = typeof condition.path === 'string' ? condition.path.trim() : '';
    if (!path) {
        return true;
    }
    const value = getPathValue(context, path);
    if (Object.prototype.hasOwnProperty.call(condition, 'equals')) {
        return value === condition.equals;
    }
    if (Object.prototype.hasOwnProperty.call(condition, 'notEquals')) {
        return value !== condition.notEquals;
    }
    if (Object.prototype.hasOwnProperty.call(condition, 'truthy')) {
        return condition.truthy ? !!value : !value;
    }
    if (Object.prototype.hasOwnProperty.call(condition, 'exists')) {
        return condition.exists ? value !== undefined : value === undefined;
    }
    return !!value;
}

function isFailurePayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return false;
    }
    if (typeof payload.error === 'string' && payload.error.trim()) {
        return true;
    }
    if (payload.success === false) {
        return true;
    }
    return false;
}

function toIso(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return date.toISOString();
}

function validateWorkflowDefinition(definition, options = {}) {
    const issues = [];
    const knownTools = options.knownTools instanceof Set ? options.knownTools : new Set();

    if (!definition || !isPlainObject(definition)) {
        return { ok: false, issues: [{ code: 'workflow-invalid', message: 'workflow must be an object' }] };
    }

    const id = typeof definition.id === 'string' ? definition.id.trim() : '';
    if (!id) {
        issues.push({ code: 'workflow-id-required', message: 'workflow.id is required' });
    }
    const steps = Array.isArray(definition.steps) ? definition.steps : [];
    if (steps.length === 0) {
        issues.push({ code: 'workflow-steps-required', message: 'workflow.steps must be a non-empty array' });
    }

    const stepIds = new Set();
    for (const step of steps) {
        if (!step || !isPlainObject(step)) {
            issues.push({ code: 'workflow-step-invalid', message: 'workflow step must be an object' });
            continue;
        }
        const stepId = typeof step.id === 'string' ? step.id.trim() : '';
        if (!stepId) {
            issues.push({ code: 'workflow-step-id-required', message: 'workflow step id is required' });
        } else if (stepIds.has(stepId)) {
            issues.push({ code: 'workflow-step-id-duplicate', message: `duplicate step id: ${stepId}` });
        } else {
            stepIds.add(stepId);
        }

        const tool = typeof step.tool === 'string' ? step.tool.trim() : '';
        if (!tool) {
            issues.push({ code: 'workflow-step-tool-required', message: `step ${stepId || '(unknown)'} missing tool` });
        } else if (knownTools.size > 0 && !knownTools.has(tool)) {
            issues.push({ code: 'workflow-step-tool-unknown', message: `step ${stepId || '(unknown)'} unknown tool: ${tool}` });
        }

        if (step.when !== undefined && step.when !== null && !isPlainObject(step.when)) {
            issues.push({ code: 'workflow-step-when-invalid', message: `step ${stepId || '(unknown)'} when must be an object` });
        }
    }

    if (issues.length > 0) {
        return {
            ok: false,
            issues,
            error: issues[0].message
        };
    }

    return { ok: true, issues: [] };
}

async function executeWorkflowDefinition(definition, input = {}, options = {}) {
    const invokeTool = typeof options.invokeTool === 'function'
        ? options.invokeTool
        : async () => ({ error: 'invokeTool is not configured' });
    const allowWrite = options.allowWrite === true;
    const dryRun = options.dryRun === true;

    const startedAtTs = Date.now();
    const context = {
        input: isPlainObject(input) ? input : {},
        steps: {}
    };
    const steps = Array.isArray(definition && definition.steps) ? definition.steps : [];
    const logs = [];
    let overallError = '';
    let lastOutput = null;

    for (const step of steps) {
        const stepId = typeof step.id === 'string' ? step.id.trim() : '';
        const startedStepTs = Date.now();
        const baseLog = {
            id: stepId || '',
            tool: typeof step.tool === 'string' ? step.tool.trim() : '',
            startedAt: toIso(startedStepTs)
        };

        const conditionPass = evaluateStepCondition(step.when, context);
        if (!conditionPass) {
            const skippedLog = {
                ...baseLog,
                status: 'skipped',
                reason: 'condition-not-met',
                endedAt: toIso(Date.now()),
                durationMs: Date.now() - startedStepTs
            };
            logs.push(skippedLog);
            context.steps[stepId] = {
                status: 'skipped',
                output: null,
                error: '',
                args: null
            };
            continue;
        }

        const resolvedArgs = resolveTemplateValue(isPlainObject(step.arguments) ? step.arguments : {}, context);
        const isWriteStep = step.write === true;
        if (isWriteStep && !allowWrite) {
            const error = `write step requires allowWrite: ${stepId || baseLog.tool}`;
            const failedLog = {
                ...baseLog,
                args: resolvedArgs,
                status: 'failed',
                error,
                endedAt: toIso(Date.now()),
                durationMs: Date.now() - startedStepTs
            };
            logs.push(failedLog);
            context.steps[stepId] = {
                status: 'failed',
                output: null,
                error,
                args: resolvedArgs
            };
            overallError = error;
            if (!step.continueOnError) {
                break;
            }
            continue;
        }

        if (isWriteStep && dryRun) {
            const dryRunLog = {
                ...baseLog,
                args: resolvedArgs,
                status: 'skipped',
                reason: 'dry-run-write-step',
                endedAt: toIso(Date.now()),
                durationMs: Date.now() - startedStepTs
            };
            logs.push(dryRunLog);
            context.steps[stepId] = {
                status: 'skipped',
                output: null,
                error: '',
                args: resolvedArgs
            };
            continue;
        }

        let payload;
        let stepError = '';
        try {
            payload = await invokeTool(baseLog.tool, resolvedArgs, {
                step,
                context,
                allowWrite,
                dryRun
            });
            if (isFailurePayload(payload)) {
                stepError = typeof payload.error === 'string' && payload.error.trim()
                    ? payload.error.trim()
                    : `step failed: ${stepId || baseLog.tool}`;
            }
        } catch (error) {
            stepError = error && error.message ? error.message : String(error || 'step execution failed');
            payload = { error: stepError };
        }

        const status = stepError ? 'failed' : 'success';
        const endedAtTs = Date.now();
        const stepLog = {
            ...baseLog,
            args: resolvedArgs,
            status,
            output: payload,
            error: stepError,
            endedAt: toIso(endedAtTs),
            durationMs: endedAtTs - startedStepTs
        };
        logs.push(stepLog);
        context.steps[stepId] = {
            status,
            output: payload,
            error: stepError,
            args: resolvedArgs
        };

        if (!stepError) {
            lastOutput = payload;
        } else {
            overallError = stepError;
            if (!step.continueOnError) {
                break;
            }
        }
    }

    const endedAtTs = Date.now();
    const hasFailed = logs.some((item) => item.status === 'failed');
    const result = {
        success: !hasFailed,
        startedAt: toIso(startedAtTs),
        endedAt: toIso(endedAtTs),
        durationMs: endedAtTs - startedAtTs,
        steps: logs,
        output: lastOutput || null
    };
    if (overallError) {
        result.error = overallError;
    }
    return result;
}

module.exports = {
    getPathValue,
    resolveTemplateValue,
    evaluateStepCondition,
    validateWorkflowDefinition,
    executeWorkflowDefinition
};
