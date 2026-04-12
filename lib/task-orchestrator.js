function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value, fallback = null) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return fallback;
    }
}

function normalizeText(value, maxLength = 4000) {
    const text = value === undefined || value === null ? '' : String(value).trim();
    if (!text) {
        return '';
    }
    return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeId(value, fallback = '') {
    const text = String(value || '').trim().toLowerCase();
    const normalized = text
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || fallback;
}

function normalizePositiveInteger(value, fallback, min = 1, max = 8) {
    const numeric = Number.parseInt(String(value), 10);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function truncateText(value, maxLength = 240) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function uniqueStringList(input = []) {
    const result = [];
    const seen = new Set();
    for (const item of Array.isArray(input) ? input : []) {
        const text = normalizeText(item, 400);
        if (!text || seen.has(text)) {
            continue;
        }
        seen.add(text);
        result.push(text);
    }
    return result;
}

function splitTargetIntoItems(target) {
    const source = normalizeText(target, 12000);
    if (!source) {
        return [];
    }
    const lines = source
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[-*+•]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
        .filter(Boolean);
    if (lines.length >= 2) {
        return uniqueStringList(lines).slice(0, 6);
    }

    const segments = source
        .split(/[；;。\n]+/g)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.replace(/^[-*+•]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
        .filter(Boolean);
    if (segments.length >= 2) {
        return uniqueStringList(segments).slice(0, 6);
    }

    return [truncateText(source, 220)];
}

function buildTaskTitle(target, explicitTitle = '') {
    const custom = normalizeText(explicitTitle, 160);
    if (custom) {
        return custom;
    }
    const normalizedTarget = normalizeText(target, 400);
    if (!normalizedTarget) {
        return '未命名任务';
    }
    return truncateText(normalizedTarget.replace(/\s+/g, ' '), 96);
}

function computePlanWaves(nodes = []) {
    const list = Array.isArray(nodes) ? nodes : [];
    const byId = new Map();
    const indegree = new Map();
    const outgoing = new Map();
    for (const node of list) {
        const id = normalizeId(node && node.id, '');
        if (!id) continue;
        byId.set(id, node);
        indegree.set(id, 0);
        outgoing.set(id, []);
    }
    for (const node of list) {
        const id = normalizeId(node && node.id, '');
        if (!id) continue;
        const dependsOn = uniqueStringList(node && node.dependsOn).filter((depId) => byId.has(depId));
        indegree.set(id, dependsOn.length);
        for (const depId of dependsOn) {
            outgoing.get(depId).push(id);
        }
    }

    const remaining = new Set(byId.keys());
    const waves = [];
    while (remaining.size > 0) {
        const ready = Array.from(remaining).filter((id) => (indegree.get(id) || 0) === 0);
        if (ready.length === 0) {
            waves.push(Array.from(remaining));
            break;
        }
        ready.sort();
        waves.push(ready);
        for (const id of ready) {
            remaining.delete(id);
            const nextIds = outgoing.get(id) || [];
            for (const nextId of nextIds) {
                indegree.set(nextId, Math.max(0, (indegree.get(nextId) || 0) - 1));
            }
        }
    }

    return waves.map((wave, index) => ({
        index,
        nodeIds: wave,
        label: `Wave ${index + 1}`
    }));
}

function detectDependencyCycle(nodes = []) {
    const list = Array.isArray(nodes) ? nodes : [];
    const graph = new Map();
    for (const node of list) {
        const id = normalizeId(node && node.id, '');
        if (!id) continue;
        graph.set(id, uniqueStringList(node && node.dependsOn).map((depId) => normalizeId(depId, '')).filter(Boolean));
    }
    const visiting = new Set();
    const visited = new Set();
    const visit = (id) => {
        if (visited.has(id)) {
            return false;
        }
        if (visiting.has(id)) {
            return true;
        }
        visiting.add(id);
        const deps = graph.get(id) || [];
        for (const depId of deps) {
            if (!graph.has(depId)) {
                continue;
            }
            if (visit(depId)) {
                return true;
            }
        }
        visiting.delete(id);
        visited.add(id);
        return false;
    };
    for (const id of graph.keys()) {
        if (visit(id)) {
            return true;
        }
    }
    return false;
}

function buildCodexNodePrompt(kind, context = {}) {
    const title = normalizeText(context.title, 160);
    const target = normalizeText(context.target, 4000);
    const item = normalizeText(context.item, 1200);
    const followUp = normalizeText(context.followUp, 1200);
    const dependencySummaries = uniqueStringList(context.dependencySummaries || []).slice(0, 6);
    const allowWrite = context.allowWrite === true;
    const dependencyBlock = dependencySummaries.length > 0
        ? `\n已完成前置摘要:\n${dependencySummaries.map((entry, index) => `${index + 1}. ${entry}`).join('\n')}`
        : '';
    const writeRule = allowWrite
        ? '允许直接修改本地工作区，但必须控制变更范围并完成最小必要验证。'
        : '只允许只读调查，不要修改任何文件，不要执行写入型操作。';

    if (kind === 'analysis') {
        return [
            `任务标题: ${title || '任务分析'}`,
            `任务目标:\n${target}`,
            writeRule,
            '请先调查当前仓库与上下文，给出简洁的现状判断、主要风险、建议执行顺序，以及你认为最小可行的验证方案。',
            '输出请保持简洁，聚焦可执行信息。'
        ].join('\n\n');
    }

    if (kind === 'work') {
        return [
            `任务标题: ${title || '执行子任务'}`,
            `总目标:\n${target}`,
            `当前子任务:\n${item || title || target}`,
            dependencyBlock,
            writeRule,
            '请只处理当前子任务范围，避免越界修改。完成后说明实际改动、验证结果与剩余风险。'
        ].join('\n\n');
    }

    if (kind === 'verify') {
        return [
            `任务标题: ${title || '验证与总结'}`,
            `总目标:\n${target}`,
            dependencyBlock,
            writeRule,
            '请基于当前工作区状态执行最小必要验证，检查明显回归，并输出结果摘要、未完成项和建议下一步。'
        ].join('\n\n');
    }

    return [
        `任务标题: ${title || '后续任务'}`,
        `总目标:\n${target}`,
        dependencyBlock,
        writeRule,
        `追加指令:\n${followUp || item || target}`,
        '请严格围绕上述后续指令继续推进，并给出结果摘要。'
    ].join('\n\n');
}

function normalizeWorkflowCatalog(workflowCatalog = []) {
    const map = new Map();
    for (const item of Array.isArray(workflowCatalog) ? workflowCatalog : []) {
        const id = normalizeId(item && item.id, '');
        if (!id) continue;
        map.set(id, {
            id,
            name: normalizeText(item.name || id, 160) || id,
            description: normalizeText(item.description, 600),
            readOnly: item && item.readOnly !== false
        });
    }
    return map;
}

function buildTaskPlan(request = {}, options = {}) {
    const workflowMap = normalizeWorkflowCatalog(options.workflowCatalog || []);
    const target = normalizeText(request.target, 4000);
    const title = buildTaskTitle(target, request.title);
    const engine = normalizeId(request.engine, 'codex') === 'workflow' ? 'workflow' : 'codex';
    const allowWrite = request.allowWrite === true;
    const dryRun = request.dryRun === true;
    const concurrency = normalizePositiveInteger(request.concurrency, 2, 1, 8);
    const autoFixRounds = normalizePositiveInteger(request.autoFixRounds, 1, 0, 5);
    const requestedWorkflowIds = uniqueStringList(request.workflowIds || [])
        .map((id) => normalizeId(id, ''))
        .filter(Boolean);
    const followUps = uniqueStringList(request.followUps || []);
    const notes = normalizeText(request.notes, 2000);
    const cwd = normalizeText(request.cwd || options.cwd, 1200);
    const nodes = [];
    let nodeSequence = 0;
    const nextNodeId = (prefix) => `${prefix}-${String(++nodeSequence).padStart(2, '0')}`;
    const shouldBuildWorkflowNodes = requestedWorkflowIds.length > 0 || engine === 'workflow';

    if (shouldBuildWorkflowNodes) {
        let previousId = '';
        for (const workflowId of requestedWorkflowIds) {
            const meta = workflowMap.get(workflowId);
            const nodeId = nextNodeId('workflow');
            nodes.push({
                id: nodeId,
                title: meta ? meta.name : workflowId,
                kind: 'workflow',
                workflowId,
                dependsOn: previousId ? [previousId] : [],
                write: !!(meta && meta.readOnly === false),
                retryLimit: 0,
                autoFixRounds,
                input: {
                    target,
                    title,
                    notes
                }
            });
            previousId = nodeId;
        }
    } else {
        const items = splitTargetIntoItems(target);
        const analysisId = nextNodeId('analysis');
        nodes.push({
            id: analysisId,
            title: '现状分析',
            kind: 'codex',
            prompt: buildCodexNodePrompt('analysis', {
                title,
                target,
                allowWrite: false
            }),
            dependsOn: [],
            write: false,
            retryLimit: 0,
            autoFixRounds: 0
        });

        const executionNodeIds = [];
        const workItems = items.length > 0 ? items : [target || title];
        for (const item of workItems) {
            const nodeId = nextNodeId('work');
            executionNodeIds.push(nodeId);
            nodes.push({
                id: nodeId,
                title: truncateText(item, 72) || `执行 ${executionNodeIds.length}`,
                kind: 'codex',
                prompt: buildCodexNodePrompt('work', {
                    title,
                    target,
                    item,
                    allowWrite
                }),
                dependsOn: [analysisId],
                write: allowWrite,
                retryLimit: 0,
                autoFixRounds
            });
        }

        const verifyId = nextNodeId('verify');
        nodes.push({
            id: verifyId,
            title: '验证与总结',
            kind: 'codex',
            prompt: buildCodexNodePrompt('verify', {
                title,
                target,
                allowWrite: false
            }),
            dependsOn: executionNodeIds.slice(),
            write: false,
            retryLimit: 0,
            autoFixRounds: 0
        });
    }

    let followUpDependsOn = nodes.length > 0 ? [nodes[nodes.length - 1].id] : [];
    for (const followUp of followUps) {
        const nodeId = nextNodeId('follow-up');
        nodes.push({
            id: nodeId,
            title: truncateText(followUp, 72) || `Follow-up ${nodes.length + 1}`,
            kind: 'codex',
            prompt: buildCodexNodePrompt('follow-up', {
                title,
                target,
                allowWrite,
                followUp
            }),
            dependsOn: followUpDependsOn,
            write: allowWrite,
            retryLimit: 0,
            autoFixRounds
        });
        followUpDependsOn = [nodeId];
    }

    const plan = {
        id: normalizeId(request.id, ''),
        title,
        target,
        notes,
        cwd,
        engine,
        allowWrite,
        dryRun,
        concurrency,
        autoFixRounds,
        workflowIds: requestedWorkflowIds,
        followUps,
        nodes,
        waves: computePlanWaves(nodes)
    };
    return plan;
}

function validateTaskPlan(plan, options = {}) {
    const issues = [];
    if (!isPlainObject(plan)) {
        return {
            ok: false,
            error: 'task plan must be an object',
            issues: [{ code: 'task-plan-invalid', message: 'task plan must be an object' }]
        };
    }

    const workflowMap = normalizeWorkflowCatalog(options.workflowCatalog || []);
    const engine = normalizeId(plan.engine, 'codex') === 'workflow' ? 'workflow' : 'codex';
    const workflowIds = uniqueStringList(plan.workflowIds || []).map((id) => normalizeId(id, '')).filter(Boolean);
    const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
    if (engine === 'workflow' && workflowIds.length === 0) {
        issues.push({ code: 'task-plan-workflow-required', message: 'workflow engine requires at least one workflowId' });
    }
    if (engine === 'workflow' && nodes.some((node) => normalizeId(node && node.kind, '') !== 'workflow')) {
        issues.push({ code: 'task-plan-engine-mismatch', message: 'workflow engine plan cannot contain non-workflow nodes' });
    }
    if (nodes.length === 0) {
        issues.push({ code: 'task-plan-nodes-required', message: 'task plan must contain at least one node' });
    }
    if (nodes.length === 0) {
        issues.push({ code: 'task-plan-nodes-required', message: 'task plan must contain at least one node' });
    }
    const nodeIds = new Set();
    for (const node of nodes) {
        if (!isPlainObject(node)) {
            issues.push({ code: 'task-node-invalid', message: 'task node must be an object' });
            continue;
        }
        const id = normalizeId(node.id, '');
        if (!id) {
            issues.push({ code: 'task-node-id-required', message: 'task node id is required' });
            continue;
        }
        if (nodeIds.has(id)) {
            issues.push({ code: 'task-node-id-duplicate', message: `duplicate task node id: ${id}` });
            continue;
        }
        nodeIds.add(id);
        const kind = normalizeId(node.kind, '');
        if (kind !== 'workflow' && kind !== 'codex') {
            issues.push({ code: 'task-node-kind-invalid', message: `task node ${id} has unsupported kind: ${node.kind || ''}` });
        }
        if (kind === 'workflow') {
            const workflowId = normalizeId(node.workflowId, '');
            if (!workflowId) {
                issues.push({ code: 'task-node-workflow-required', message: `task node ${id} missing workflowId` });
            } else if (workflowMap.size > 0 && !workflowMap.has(workflowId)) {
                issues.push({ code: 'task-node-workflow-unknown', message: `task node ${id} references unknown workflow: ${workflowId}` });
            }
        }
        if (kind === 'codex' && !normalizeText(node.prompt, 12000)) {
            issues.push({ code: 'task-node-prompt-required', message: `task node ${id} missing prompt` });
        }
    }

    if (issues.length === 0) {
        for (const node of nodes) {
            const id = normalizeId(node.id, '');
            const dependsOn = uniqueStringList(node.dependsOn || []).map((depId) => normalizeId(depId, ''));
            for (const depId of dependsOn) {
                if (!nodeIds.has(depId)) {
                    issues.push({ code: 'task-node-dependency-missing', message: `task node ${id} depends on missing node: ${depId}` });
                }
                if (depId === id) {
                    issues.push({ code: 'task-node-dependency-self', message: `task node ${id} cannot depend on itself` });
                }
            }
        }
    }

    if (issues.length === 0 && detectDependencyCycle(nodes)) {
        issues.push({ code: 'task-plan-cycle-detected', message: 'task plan contains a dependency cycle' });
    }

    return {
        ok: issues.length === 0,
        error: issues[0] ? issues[0].message : '',
        issues
    };
}

function createNodeRunRecord(node, dependencyNodeIds = []) {
    return {
        id: normalizeId(node && node.id, ''),
        title: normalizeText(node && node.title, 160),
        kind: normalizeId(node && node.kind, ''),
        workflowId: normalizeId(node && node.workflowId, ''),
        dependsOn: uniqueStringList(node && node.dependsOn),
        dependencyNodeIds: uniqueStringList(dependencyNodeIds),
        write: node && node.write === true,
        status: 'pending',
        attemptCount: 0,
        autoFixRounds: normalizePositiveInteger(node && node.autoFixRounds, 0, 0, 5),
        retryLimit: normalizePositiveInteger(node && node.retryLimit, 0, 0, 5),
        startedAt: '',
        endedAt: '',
        durationMs: 0,
        summary: '',
        error: '',
        output: null,
        logs: [],
        attempts: []
    };
}

function createRunLog(level, message, extra = {}) {
    return {
        at: new Date().toISOString(),
        level: level || 'info',
        message: normalizeText(message, 1000),
        ...cloneJson(extra, {})
    };
}

async function executeTaskPlan(plan, options = {}) {
    const executeNode = typeof options.executeNode === 'function'
        ? options.executeNode
        : async () => ({ success: false, error: 'executeNode is not configured' });
    const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : null;
    const signal = options.signal || null;
    const startedAtTs = Date.now();
    const concurrency = normalizePositiveInteger(options.concurrency || plan.concurrency, 2, 1, 8);
    const nodeList = Array.isArray(plan && plan.nodes) ? plan.nodes : [];
    const run = {
        status: 'running',
        startedAt: new Date(startedAtTs).toISOString(),
        endedAt: '',
        durationMs: 0,
        concurrency,
        waves: computePlanWaves(nodeList),
        nodes: nodeList.map((node) => createNodeRunRecord(node)),
        logs: [createRunLog('info', 'task run started', { concurrency })],
        summary: '',
        error: ''
    };

    const nodeMap = new Map();
    for (const node of run.nodes) {
        nodeMap.set(node.id, node);
    }

    const emitUpdate = async () => {
        if (!onUpdate) {
            return;
        }
        await onUpdate(cloneJson(run, run));
    };

    const active = new Map();
    let writeLock = false;

    const finalizeNode = (nodeRun, payload, attemptStartedAt, attemptIndex) => {
        const endedAtTs = Date.now();
        const success = !!(payload && payload.success === true);
        const error = success ? '' : normalizeText(payload && payload.error, 2000) || `node failed: ${nodeRun.id}`;
        nodeRun.attempts.push({
            index: attemptIndex,
            startedAt: new Date(attemptStartedAt).toISOString(),
            endedAt: new Date(endedAtTs).toISOString(),
            durationMs: endedAtTs - attemptStartedAt,
            success,
            error,
            summary: truncateText(payload && payload.summary, 400),
            output: cloneJson(payload && payload.output, null),
            logs: cloneJson(payload && payload.logs, [])
        });
        nodeRun.logs = cloneJson(payload && payload.logs, []);
        nodeRun.output = cloneJson(payload && payload.output, null);
        nodeRun.summary = truncateText(payload && payload.summary, 400);
        nodeRun.error = error;
        nodeRun.startedAt = nodeRun.startedAt || new Date(attemptStartedAt).toISOString();
        nodeRun.endedAt = new Date(endedAtTs).toISOString();
        nodeRun.durationMs = endedAtTs - new Date(nodeRun.startedAt).getTime();
        return { success, error };
    };

    const executeOneNode = async (nodeRun, nodeDef, hooks = {}) => {
        nodeRun.status = 'running';
        if (!nodeRun.startedAt) {
            nodeRun.startedAt = new Date().toISOString();
        }
        nodeRun.attemptCount += 1;
        const attemptIndex = nodeRun.attemptCount;
        const attemptStartedAt = Date.now();
        const dependencyResults = (nodeRun.dependsOn || [])
            .map((depId) => nodeMap.get(depId))
            .filter(Boolean)
            .map((dep) => ({
                id: dep.id,
                status: dep.status,
                summary: dep.summary,
                error: dep.error,
                output: cloneJson(dep.output, null)
            }));
        const attemptLogs = [createRunLog('info', `starting node ${nodeRun.id}`, { attempt: attemptIndex })];
        let abortHandler = null;
        try {
            const payload = await executeNode(nodeDef, {
                attempt: attemptIndex,
                maxAttempts: 1 + Math.max(nodeRun.retryLimit, 0) + Math.max(nodeRun.autoFixRounds, 0),
                dependencyResults,
                signal,
                registerAbort(handler) {
                    abortHandler = typeof handler === 'function' ? handler : null;
                    if (typeof hooks.onAbortChange === 'function') {
                        hooks.onAbortChange(abortHandler);
                    }
                },
                previousAttempts: cloneJson(nodeRun.attempts, [])
            });
            attemptLogs.push(...(Array.isArray(payload && payload.logs) ? payload.logs : []));
            const finalized = finalizeNode(nodeRun, {
                ...payload,
                logs: attemptLogs
            }, attemptStartedAt, attemptIndex);
            return {
                success: finalized.success,
                error: finalized.error,
                abortHandler
            };
        } catch (error) {
            const message = error && error.message ? error.message : String(error || 'task node execution failed');
            const finalized = finalizeNode(nodeRun, {
                success: false,
                error: message,
                output: null,
                summary: message,
                logs: attemptLogs.concat(createRunLog('error', message))
            }, attemptStartedAt, attemptIndex);
            return {
                success: false,
                error: finalized.error,
                abortHandler
            };
        }
    };

    const getPendingNodeDefs = () => nodeList.filter((node) => {
        const nodeRun = nodeMap.get(normalizeId(node && node.id, ''));
        return !!nodeRun && nodeRun.status === 'pending';
    });

    const hasFailedDependency = (nodeRun) => (nodeRun.dependsOn || []).some((depId) => {
        const dep = nodeMap.get(depId);
        return dep && (dep.status === 'failed' || dep.status === 'blocked' || dep.status === 'cancelled');
    });

    const isReady = (nodeRun) => (nodeRun.dependsOn || []).every((depId) => {
        const dep = nodeMap.get(depId);
        return dep && (dep.status === 'success' || dep.status === 'skipped');
    });

    const markBlockedNodes = () => {
        for (const nodeRun of run.nodes) {
            if (nodeRun.status !== 'pending') continue;
            if (!hasFailedDependency(nodeRun)) continue;
            nodeRun.status = 'blocked';
            nodeRun.error = 'blocked by failed dependency';
            nodeRun.summary = '前置节点失败，已阻塞';
            nodeRun.startedAt = nodeRun.startedAt || new Date().toISOString();
            nodeRun.endedAt = new Date().toISOString();
            run.logs.push(createRunLog('warn', `node blocked: ${nodeRun.id}`));
        }
    };

    const abortActiveNodes = () => {
        for (const activeRun of active.values()) {
            if (activeRun && typeof activeRun.abort === 'function') {
                try {
                    activeRun.abort();
                } catch (_) {}
            }
        }
    };

    try {
        while (true) {
            if (signal && signal.aborted) {
                abortActiveNodes();
                for (const nodeRun of run.nodes) {
                    if (nodeRun.status === 'pending') {
                        nodeRun.status = 'cancelled';
                        nodeRun.error = 'cancelled before start';
                        nodeRun.summary = '已取消';
                    } else if (nodeRun.status === 'running') {
                        nodeRun.status = 'cancelled';
                        nodeRun.error = 'cancelled while running';
                        nodeRun.summary = '执行中取消';
                    }
                }
                run.logs.push(createRunLog('warn', 'task run cancelled'));
                run.status = 'cancelled';
                break;
            }

            markBlockedNodes();
            const readyNodeDefs = getPendingNodeDefs().filter((node) => {
                const nodeRun = nodeMap.get(normalizeId(node && node.id, ''));
                return nodeRun && isReady(nodeRun);
            });
            let started = false;
            for (const nodeDef of readyNodeDefs) {
                if (active.size >= concurrency) {
                    break;
                }
                const nodeRun = nodeMap.get(normalizeId(nodeDef && nodeDef.id, ''));
                if (!nodeRun) continue;
                const wantsWrite = nodeRun.write === true;
                if (writeLock && wantsWrite) {
                    continue;
                }
                if (wantsWrite && active.size > 0) {
                    continue;
                }
                if (!wantsWrite && writeLock) {
                    continue;
                }
                started = true;
                if (wantsWrite) {
                    writeLock = true;
                }
                const promise = (async () => {
                    let result = null;
                    const maxAttempts = 1 + Math.max(nodeRun.retryLimit, 0) + Math.max(nodeRun.autoFixRounds, 0);
                    for (let attempt = nodeRun.attemptCount + 1; attempt <= maxAttempts; attempt += 1) {
                        result = await executeOneNode(nodeRun, nodeDef, {
                            onAbortChange(handler) {
                                const current = active.get(nodeRun.id);
                                if (current) {
                                    current._abort = typeof handler === 'function' ? handler : null;
                                }
                            }
                        });
                        if (result.success) {
                            nodeRun.status = 'success';
                            run.logs.push(createRunLog('info', `node completed: ${nodeRun.id}`));
                            break;
                        }
                        if (signal && signal.aborted) {
                            nodeRun.status = 'cancelled';
                            nodeRun.summary = '执行中取消';
                            break;
                        }
                        if (attempt < maxAttempts) {
                            nodeRun.status = 'running';
                            run.logs.push(createRunLog('warn', `node retry scheduled: ${nodeRun.id}`, {
                                nextAttempt: attempt + 1,
                                error: nodeRun.error
                            }));
                            continue;
                        }
                        nodeRun.status = 'failed';
                        run.logs.push(createRunLog('error', `node failed: ${nodeRun.id}`, { error: nodeRun.error }));
                    }
                    return {
                        nodeId: nodeRun.id,
                        wantsWrite,
                        abort: result && result.abortHandler ? result.abortHandler : null
                    };
                })();
                active.set(nodeRun.id, {
                    promise,
                    abort() {
                        const current = active.get(nodeRun.id);
                        if (current && typeof current._abort === 'function') {
                            current._abort();
                        }
                    },
                    _abort: null,
                    wantsWrite
                });
                await emitUpdate();
            }

            if (active.size === 0) {
                const pending = run.nodes.some((nodeRun) => nodeRun.status === 'pending');
                if (!pending) {
                    break;
                }
                if (!started) {
                    markBlockedNodes();
                    const stillPending = run.nodes.some((nodeRun) => nodeRun.status === 'pending');
                    if (!stillPending) {
                        break;
                    }
                    run.logs.push(createRunLog('error', 'task run stalled because no nodes can be scheduled'));
                    run.status = 'failed';
                    run.error = 'task run stalled because no nodes can be scheduled';
                    break;
                }
            }

            if (active.size > 0) {
                const settled = await Promise.race(Array.from(active.entries()).map(([nodeId, state]) => state.promise
                    .then((payload) => ({ nodeId, payload }))
                    .catch((error) => ({ nodeId, payload: { error: error && error.message ? error.message : String(error || 'task failed') } }))));
                const settledState = active.get(settled.nodeId);
                active.delete(settled.nodeId);
                if (settledState && settledState.wantsWrite) {
                    writeLock = false;
                }
                await emitUpdate();
            }
        }
    } catch (error) {
        run.status = 'failed';
        run.error = error && error.message ? error.message : String(error || 'task run failed');
        run.logs.push(createRunLog('error', run.error));
    }

    const endedAtTs = Date.now();
    run.endedAt = new Date(endedAtTs).toISOString();
    run.durationMs = endedAtTs - startedAtTs;
    if (!run.status || run.status === 'running') {
        if (run.nodes.some((node) => node.status === 'failed')) {
            run.status = 'failed';
        } else if (run.nodes.some((node) => node.status === 'cancelled')) {
            run.status = 'cancelled';
        } else if (run.nodes.every((node) => node.status === 'success' || node.status === 'skipped')) {
            run.status = 'success';
        } else if (run.nodes.some((node) => node.status === 'blocked')) {
            run.status = 'failed';
        } else {
            run.status = 'failed';
        }
    }
    const lastCompletedNode = [...run.nodes].reverse().find((node) => node.summary || node.error);
    run.summary = truncateText(
        lastCompletedNode && (lastCompletedNode.summary || lastCompletedNode.error)
            ? (lastCompletedNode.summary || lastCompletedNode.error)
            : (run.status === 'success' ? '任务执行完成' : '任务执行失败'),
        400
    );
    if (!run.error && run.status !== 'success') {
        const failedNode = run.nodes.find((node) => node.status === 'failed' || node.status === 'blocked' || node.status === 'cancelled');
        run.error = failedNode ? (failedNode.error || failedNode.summary) : 'task run failed';
    }
    await emitUpdate();
    return run;
}

module.exports = {
    truncateText,
    splitTargetIntoItems,
    computePlanWaves,
    buildTaskPlan,
    validateTaskPlan,
    executeTaskPlan
};
