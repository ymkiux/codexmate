function normalizeSeverity(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'error' || normalized === 'critical') return 'error';
    if (normalized === 'warn' || normalized === 'warning') return 'warn';
    return 'info';
}

function buildIssue(id, severity, problem, impact, actions = [], data = null) {
    return {
        id: String(id || '').trim() || 'unknown',
        severity: normalizeSeverity(severity),
        problem: String(problem || '').trim(),
        impact: String(impact || '').trim(),
        actions: Array.isArray(actions) ? actions : [],
        data: data && typeof data === 'object' ? data : null
    };
}

function buildAction(type, payload = {}) {
    const normalizedType = String(type || '').trim();
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    return {
        type: normalizedType,
        ...safePayload
    };
}

function findConfigHealthRemoteIssue(issues = []) {
    const list = Array.isArray(issues) ? issues : [];
    const remoteCodes = new Set([
        'remote-model-probe-unreachable',
        'remote-model-probe-auth-failed',
        'remote-model-probe-not-found',
        'remote-model-probe-http-error',
        'remote-model-probe-error'
    ]);
    return list.find((issue) => issue && typeof issue.code === 'string' && remoteCodes.has(issue.code)) || null;
}

function summarizeSkillsIssues(payload) {
    const safe = payload && typeof payload === 'object' ? payload : {};
    const exists = safe.exists !== false;
    const items = Array.isArray(safe.items) ? safe.items : [];
    const missing = items.filter((item) => item && item.hasSkillFile === false).length;
    return { exists, total: items.length, missing, root: safe.root || '' };
}

function summarizeUsageIssues(sessions = []) {
    const list = Array.isArray(sessions) ? sessions : [];
    let missingModel = 0;
    for (const session of list) {
        if (!session || typeof session !== 'object') continue;
        const model = typeof session.model === 'string' ? session.model.trim() : '';
        if (!model) missingModel += 1;
    }
    return { total: list.length, missingModel };
}

function summarizeTaskIssues(taskOverview) {
    const safe = taskOverview && typeof taskOverview === 'object' ? taskOverview : {};
    const queue = Array.isArray(safe.queue) ? safe.queue : [];
    const runs = Array.isArray(safe.runs) ? safe.runs : [];
    const failedRuns = runs.filter((run) => {
        if (!run || typeof run !== 'object') return false;
        const status = String(run.status || '').trim().toLowerCase();
        return status === 'failed' || status === 'blocked' || status === 'cancelled';
    });
    const runningRuns = runs.filter((run) => {
        if (!run || typeof run !== 'object') return false;
        const status = String(run.status || '').trim().toLowerCase();
        return status === 'running' || status === 'queued';
    });
    return {
        queue: queue.length,
        runs: runs.length,
        running: runningRuns.length,
        failed: failedRuns.length,
        latestFailed: failedRuns.length ? failedRuns[0] : null
    };
}

function buildDefaultActions() {
    return [
        buildAction('run-check', { id: 'doctor' }),
        buildAction('export', { format: 'json' })
    ];
}

async function buildDoctorReport(params = {}, deps = {}) {
    const options = params && typeof params === 'object' ? params : {};
    const now = new Date().toISOString();
    const getStatusPayload = typeof deps.getStatusPayload === 'function' ? deps.getStatusPayload : () => null;
    const buildInstallStatusReport = typeof deps.buildInstallStatusReport === 'function' ? deps.buildInstallStatusReport : () => null;
    const buildConfigHealthReport = typeof deps.buildConfigHealthReport === 'function' ? deps.buildConfigHealthReport : null;
    const listSessionUsage = typeof deps.listSessionUsage === 'function' ? deps.listSessionUsage : null;
    const buildTaskOverviewPayload = typeof deps.buildTaskOverviewPayload === 'function' ? deps.buildTaskOverviewPayload : null;
    const listSkills = typeof deps.listSkills === 'function' ? deps.listSkills : null;

    const sources = {
        status: null,
        install: null,
        configHealth: null,
        usage: null,
        tasks: null,
        skills: null
    };

    sources.status = getStatusPayload();
    if (options.includeInstall !== false) {
        sources.install = buildInstallStatusReport();
    }

    if (buildConfigHealthReport) {
        try {
            sources.configHealth = await buildConfigHealthReport({
                remote: options.remote !== false
            });
        } catch (e) {
            sources.configHealth = { ok: false, error: e && e.message ? e.message : 'config health check failed', issues: [] };
        }
    }

    if (listSessionUsage && options.includeUsage !== false) {
        try {
            const range = typeof options.range === 'string' ? options.range.trim().toLowerCase() : '';
            const limit = range === 'all' ? 2000 : (range === '30d' ? 1200 : 600);
            sources.usage = {
                sessions: await listSessionUsage({
                    source: 'all',
                    limit
                }),
                range: range === 'all' ? 'all' : (range === '30d' ? '30d' : '7d')
            };
        } catch (e) {
            sources.usage = { error: e && e.message ? e.message : 'usage probe failed', sessions: [], range: '7d' };
        }
    }

    if (buildTaskOverviewPayload && options.includeTasks !== false) {
        try {
            sources.tasks = buildTaskOverviewPayload({
                queueLimit: 20,
                runLimit: 20
            });
        } catch (e) {
            sources.tasks = { error: e && e.message ? e.message : 'task overview failed' };
        }
    }

    if (listSkills && options.includeSkills !== false) {
        const targetApp = typeof options.targetApp === 'string' && options.targetApp.trim()
            ? options.targetApp.trim().toLowerCase()
            : 'codex';
        try {
            sources.skills = listSkills({ targetApp });
            sources.skills.targetApp = targetApp;
        } catch (e) {
            sources.skills = { error: e && e.message ? e.message : 'skills probe failed', targetApp };
        }
    }

    const issues = [];
    const status = sources.status && typeof sources.status === 'object' ? sources.status : {};
    const baseActions = buildDefaultActions();

    if (status.configReady === false || (typeof status.configErrorType === 'string' && status.configErrorType.trim())) {
        issues.push(buildIssue(
            'config-not-ready',
            'error',
            '配置文件未就绪',
            '可能导致 provider/model 无法读取，模型列表与请求将不可用。',
            [
                buildAction('navigate', { target: 'config', label: '打开 Config' }),
                ...baseActions
            ],
            {
                configErrorType: status.configErrorType || '',
                configNotice: status.configNotice || ''
            }
        ));
    }

    const configHealth = sources.configHealth && typeof sources.configHealth === 'object' ? sources.configHealth : null;
    if (configHealth && configHealth.ok === false) {
        const remoteIssue = findConfigHealthRemoteIssue(configHealth.issues || []);
        if (remoteIssue) {
            const impact = remoteIssue.code === 'remote-model-probe-auth-failed'
                ? '鉴权失败会导致模型列表/对话请求返回 401/403。'
                : '远端不可达会导致模型列表/对话请求失败或超时。';
            issues.push(buildIssue(
                'provider-unreachable',
                'error',
                remoteIssue.message || 'Provider 不可用',
                impact,
                [
                    buildAction('navigate', { target: 'config', label: '检查 Provider 配置' }),
                    ...baseActions
                ],
                { code: remoteIssue.code || '', statusCode: remoteIssue.statusCode || 0 }
            ));
        } else if (Array.isArray(configHealth.issues) && configHealth.issues.length) {
            issues.push(buildIssue(
                'config-health-failed',
                'warn',
                '配置健康检查未通过',
                '可能导致部分功能不可用或行为不符合预期。',
                [
                    buildAction('navigate', { target: 'config', label: '打开 Config' }),
                    ...baseActions
                ],
                { issueCount: configHealth.issues.length }
            ));
        }
    }

    if (sources.usage && typeof sources.usage === 'object') {
        if (sources.usage.error) {
            issues.push(buildIssue(
                'usage-error',
                'warn',
                'Usage 统计异常',
                'Usage 页面可能无法展示趋势/汇总，Doctor 的用量诊断也会缺失。',
                [
                    buildAction('navigate', { target: 'usage', label: '打开 Usage' }),
                    ...baseActions
                ],
                { error: sources.usage.error }
            ));
        } else {
            const summary = summarizeUsageIssues(sources.usage.sessions);
            if (summary.missingModel > 0) {
                issues.push(buildIssue(
                    'usage-missing-model',
                    'info',
                    '部分会话缺少模型信息',
                    '会导致用量归因与成本估算不准确。',
                    [
                        buildAction('navigate', { target: 'usage', label: '打开 Usage' }),
                        buildAction('navigate', { target: 'sessions', label: '打开 Sessions' }),
                        ...baseActions
                    ],
                    summary
                ));
            }
        }
    }

    if (sources.tasks && typeof sources.tasks === 'object') {
        if (sources.tasks.error) {
            issues.push(buildIssue(
                'tasks-error',
                'warn',
                'Tasks 状态读取失败',
                '可能导致编排队列/运行记录无法展示。',
                [
                    buildAction('navigate', { target: 'orchestration', label: '打开 Tasks' }),
                    ...baseActions
                ],
                { error: sources.tasks.error }
            ));
        } else {
            const summary = summarizeTaskIssues(sources.tasks);
            if (summary.failed > 0) {
                issues.push(buildIssue(
                    'tasks-failed',
                    'warn',
                    '存在失败的任务运行',
                    '可能导致自动化流水线中断，需要查看日志并重试或修复输入。',
                    [
                        buildAction('navigate', { target: 'orchestration', label: '查看 Tasks / Logs' }),
                        ...baseActions
                    ],
                    {
                        failed: summary.failed,
                        latestFailed: summary.latestFailed
                            ? {
                                runId: summary.latestFailed.runId || '',
                                status: summary.latestFailed.status || '',
                                error: summary.latestFailed.error || ''
                            }
                            : null
                    }
                ));
            }
        }
    }

    if (sources.skills && typeof sources.skills === 'object') {
        if (sources.skills.error) {
            issues.push(buildIssue(
                'skills-error',
                'warn',
                'Skills 列表读取失败',
                '会导致 Skills 页面无法正常展示或安装。',
                [
                    buildAction('navigate', { target: 'market', label: '打开 Skills' }),
                    ...baseActions
                ],
                { error: sources.skills.error }
            ));
        } else {
            const summary = summarizeSkillsIssues(sources.skills);
            if (!summary.exists) {
                issues.push(buildIssue(
                    'skills-root-missing',
                    'info',
                    'Skills 目录不存在',
                    '会导致 Skills 安装/扫描为空；可在 Settings/Docs 按指引初始化目录。',
                    [
                        buildAction('navigate', { target: 'market', label: '打开 Skills' }),
                        ...baseActions
                    ],
                    summary
                ));
            } else if (summary.missing > 0) {
                issues.push(buildIssue(
                    'skills-missing-files',
                    'info',
                    '存在缺失 skill.json 的技能',
                    '会导致部分技能无法被运行或同步。',
                    [
                        buildAction('navigate', { target: 'market', label: '打开 Skills' }),
                        ...baseActions
                    ],
                    summary
                ));
            }
        }
    }

    const hasError = issues.some((item) => item && item.severity === 'error');
    const report = {
        schema: 1,
        generatedAt: now,
        ok: !hasError,
        issues,
        sources
    };
    report.summary = {
        total: issues.length,
        error: issues.filter((item) => item.severity === 'error').length,
        warn: issues.filter((item) => item.severity === 'warn').length,
        info: issues.filter((item) => item.severity === 'info').length
    };
    return report;
}

function buildDoctorLegacyPayload(report) {
    const safe = report && typeof report === 'object' ? report : {};
    const issues = Array.isArray(safe.issues) ? safe.issues : [];
    const legacyIssues = issues
        .map((item) => ({
            code: item && item.id ? item.id : 'unknown',
            message: item && item.problem ? item.problem : ''
        }))
        .filter((item) => item.message);
    const configHealth = safe.sources && safe.sources.configHealth && typeof safe.sources.configHealth === 'object'
        ? safe.sources.configHealth
        : null;
    const remote = configHealth && configHealth.remote ? configHealth.remote : null;
    return {
        ok: safe.ok !== false,
        issues: legacyIssues,
        remote,
        report: safe
    };
}

module.exports = {
    buildDoctorReport,
    buildDoctorLegacyPayload,
    buildAction
};

