function normalizeSeverity(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'error' || normalized === 'critical') return 'error';
    if (normalized === 'warn' || normalized === 'warning') return 'warn';
    return 'info';
}

function normalizeLang(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    if (normalized === 'zh' || normalized.startsWith('zh-') || normalized.startsWith('zh_') || normalized.includes('chinese')) {
        return 'zh';
    }
    return 'en';
}

const DOCTOR_I18N = Object.freeze({
    en: Object.freeze({
        severity: Object.freeze({
            error: 'Error',
            warn: 'Warning',
            info: 'Info'
        }),
        area: Object.freeze({
            Doctor: 'Doctor',
            Config: 'Config',
            Observe: 'Observe',
            Operate: 'Operate',
            Reuse: 'Reuse'
        }),
        issue: Object.freeze({
            configNotReady: Object.freeze({
                problem: 'Config is not ready',
                impact: 'Provider/model cannot be read; model listing and requests may fail.'
            }),
            providerUnreachable: Object.freeze({
                impactAuth: 'Auth failure will cause model listing and chat requests to return 401/403.',
                impactNetwork: 'Unreachable provider will cause model listing and chat requests to fail or timeout.',
                message: Object.freeze({
                    'remote-model-probe-unreachable': 'Provider unreachable',
                    'remote-model-probe-auth-failed': 'Provider auth failed',
                    'remote-model-probe-not-found': 'Provider endpoint returned 404',
                    'remote-model-probe-http-error': 'Provider returned HTTP error',
                    'remote-model-probe-error': 'Provider probe failed'
                })
            }),
            configHealthFailed: Object.freeze({
                problem: 'Config health check failed',
                impact: 'Some features may be unavailable or behave unexpectedly.'
            }),
            usageError: Object.freeze({
                problem: 'Usage aggregation failed',
                impact: 'Usage charts and summaries may be unavailable; Doctor usage diagnostics will be incomplete.'
            }),
            usageMissingModel: Object.freeze({
                problem: 'Some sessions miss model metadata',
                impact: 'Usage attribution and cost estimates may be inaccurate.'
            }),
            tasksError: Object.freeze({
                problem: 'Task overview failed',
                impact: 'Task queue and run history may be unavailable.'
            }),
            tasksFailed: Object.freeze({
                problem: 'Failed task runs detected',
                impact: 'Automation pipelines may be blocked; inspect logs and retry after fixing inputs.'
            }),
            skillsError: Object.freeze({
                problem: 'Skills listing failed',
                impact: 'Skills marketplace may be unavailable.'
            }),
            skillsRootMissing: Object.freeze({
                problem: 'Skills directory is missing',
                impact: 'Skills install/scan will be empty; create the directory via Settings/Docs.'
            }),
            skillsMissingFiles: Object.freeze({
                problem: 'Some skills are missing skill.json',
                impact: 'Those skills may not run or sync properly.'
            })
        }),
        action: Object.freeze({
            openConfig: 'Open Config',
            checkProvider: 'Check provider config',
            openUsage: 'Open Usage',
            openSessions: 'Open Sessions',
            openTasks: 'Open Tasks',
            viewTaskLogs: 'View Tasks / Logs',
            openSkills: 'Open Skills'
        }),
        markdown: Object.freeze({
            title: 'Codexmate Doctor Report',
            generated: 'Generated',
            status: 'Status',
            statusOk: 'OK',
            statusNotOk: 'NOT OK',
            issues: 'Issues',
            noIssues: 'No actionable issues found.',
            issuesTitle: 'Issues',
            area: 'Area',
            impact: 'Impact',
            actions: 'Actions',
            open: 'Open',
            recheck: 'Re-check: run doctor again',
            export: Object.freeze({
                json: 'Export: doctor.json',
                md: 'Export: doctor.md'
            })
        })
    }),
    zh: Object.freeze({
        severity: Object.freeze({
            error: '严重',
            warn: '警告',
            info: '提示'
        }),
        area: Object.freeze({
            Doctor: 'Doctor',
            Config: '配置',
            Observe: '观测',
            Operate: '操作',
            Reuse: '复用'
        }),
        issue: Object.freeze({
            configNotReady: Object.freeze({
                problem: '配置文件未就绪',
                impact: '可能导致 provider/model 无法读取，模型列表与请求将不可用。'
            }),
            providerUnreachable: Object.freeze({
                impactAuth: '鉴权失败会导致模型列表/对话请求返回 401/403。',
                impactNetwork: '远端不可达会导致模型列表/对话请求失败或超时。',
                message: Object.freeze({
                    'remote-model-probe-unreachable': 'Provider 不可达',
                    'remote-model-probe-auth-failed': 'Provider 鉴权失败',
                    'remote-model-probe-not-found': 'Provider 返回 404',
                    'remote-model-probe-http-error': 'Provider 返回 HTTP 错误',
                    'remote-model-probe-error': 'Provider 探测失败'
                })
            }),
            configHealthFailed: Object.freeze({
                problem: '配置健康检查未通过',
                impact: '可能导致部分功能不可用或行为不符合预期。'
            }),
            usageError: Object.freeze({
                problem: 'Usage 统计异常',
                impact: 'Usage 页面可能无法展示趋势/汇总，Doctor 的用量诊断也会缺失。'
            }),
            usageMissingModel: Object.freeze({
                problem: '部分会话缺少模型信息',
                impact: '会导致用量归因与成本估算不准确。'
            }),
            tasksError: Object.freeze({
                problem: 'Tasks 状态读取失败',
                impact: '可能导致编排队列/运行记录无法展示。'
            }),
            tasksFailed: Object.freeze({
                problem: '存在失败的任务运行',
                impact: '可能导致自动化流水线中断，需要查看日志并重试或修复输入。'
            }),
            skillsError: Object.freeze({
                problem: 'Skills 列表读取失败',
                impact: '会导致 Skills 页面无法正常展示或安装。'
            }),
            skillsRootMissing: Object.freeze({
                problem: 'Skills 目录不存在',
                impact: '会导致 Skills 安装/扫描为空；可在 Settings/Docs 按指引初始化目录。'
            }),
            skillsMissingFiles: Object.freeze({
                problem: '存在缺失 skill.json 的技能',
                impact: '会导致部分技能无法被运行或同步。'
            })
        }),
        action: Object.freeze({
            openConfig: '打开 Config',
            checkProvider: '检查 Provider 配置',
            openUsage: '打开 Usage',
            openSessions: '打开 Sessions',
            openTasks: '打开 Tasks',
            viewTaskLogs: '查看 Tasks / Logs',
            openSkills: '打开 Skills'
        }),
        markdown: Object.freeze({
            title: 'Codexmate Doctor 报告',
            generated: '生成时间',
            status: '状态',
            statusOk: '通过',
            statusNotOk: '未通过',
            issues: '问题数',
            noIssues: '暂无可操作问题。',
            issuesTitle: '问题列表',
            area: '模块',
            impact: '影响',
            actions: '动作',
            open: '打开',
            recheck: '复检：重新运行 doctor',
            export: Object.freeze({
                json: '导出：doctor.json',
                md: '导出：doctor.md'
            })
        })
    })
});

function getI18n(lang) {
    const normalized = normalizeLang(lang);
    if (normalized === 'en') return DOCTOR_I18N.en;
    if (normalized === 'zh') return DOCTOR_I18N.zh;
    return DOCTOR_I18N.zh;
}

function buildIssue(id, severity, problem, impact, actions = [], data = null, meta = null) {
    const safeMeta = meta && typeof meta === 'object' ? meta : {};
    return {
        id: String(id || '').trim() || 'unknown',
        severity: normalizeSeverity(severity),
        areaKey: typeof safeMeta.areaKey === 'string' && safeMeta.areaKey.trim() ? safeMeta.areaKey.trim() : 'Doctor',
        area: typeof safeMeta.area === 'string' && safeMeta.area.trim() ? safeMeta.area.trim() : 'Doctor',
        severityLabel: typeof safeMeta.severityLabel === 'string' && safeMeta.severityLabel.trim() ? safeMeta.severityLabel.trim() : '',
        problemKey: typeof safeMeta.problemKey === 'string' && safeMeta.problemKey.trim() ? safeMeta.problemKey.trim() : '',
        problemParams: safeMeta.problemParams && typeof safeMeta.problemParams === 'object' ? safeMeta.problemParams : null,
        impactKey: typeof safeMeta.impactKey === 'string' && safeMeta.impactKey.trim() ? safeMeta.impactKey.trim() : '',
        impactParams: safeMeta.impactParams && typeof safeMeta.impactParams === 'object' ? safeMeta.impactParams : null,
        impactTags: Array.isArray(safeMeta.impactTags) ? safeMeta.impactTags.filter(Boolean) : [],
        impactScope: typeof safeMeta.impactScope === 'string' && safeMeta.impactScope.trim() ? safeMeta.impactScope.trim() : '',
        problem: String(problem || '').trim(),
        impact: String(impact || '').trim(),
        actions: Array.isArray(actions) ? actions : [],
        evidence: data && typeof data === 'object' ? data : null,
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
        buildAction('export', { format: 'json' }),
        buildAction('export', { format: 'md' })
    ];
}

function ensureBaseActions(actions = []) {
    const list = Array.isArray(actions) ? [...actions] : [];
    const hasRun = list.some((item) => item && item.type === 'run-check');
    const hasExportJson = list.some((item) => item && item.type === 'export' && item.format === 'json');
    const hasExportMd = list.some((item) => item && item.type === 'export' && (item.format === 'md' || item.format === 'markdown'));
    if (!hasRun) {
        list.push(buildAction('run-check', { id: 'doctor' }));
    }
    if (!hasExportJson) {
        list.push(buildAction('export', { format: 'json' }));
    }
    if (!hasExportMd) {
        list.push(buildAction('export', { format: 'md' }));
    }
    return list;
}

function severityRank(severity) {
    const normalized = normalizeSeverity(severity);
    if (normalized === 'error') return 0;
    if (normalized === 'warn') return 1;
    return 2;
}

function issuePriorityRank(id) {
    const order = [
        'config-not-ready',
        'provider-unreachable',
        'config-health-failed',
        'usage-error',
        'tasks-error',
        'tasks-failed',
        'skills-error',
        'skills-root-missing',
        'skills-missing-files',
        'usage-missing-model'
    ];
    const key = String(id || '').trim();
    const index = order.indexOf(key);
    return index >= 0 ? index : 999;
}

function sortIssues(issues = []) {
    const list = Array.isArray(issues) ? [...issues] : [];
    list.sort((a, b) => {
        const rankA = severityRank(a && a.severity);
        const rankB = severityRank(b && b.severity);
        if (rankA !== rankB) return rankA - rankB;
        const priA = issuePriorityRank(a && a.id);
        const priB = issuePriorityRank(b && b.id);
        if (priA !== priB) return priA - priB;
        const idA = String(a && a.id || '');
        const idB = String(b && b.id || '');
        return idA.localeCompare(idB, 'en-US');
    });
    return list;
}

function renderDoctorMarkdown(report) {
    const safe = report && typeof report === 'object' ? report : {};
    const i18n = getI18n(safe.lang);
    const summary = safe.summary && typeof safe.summary === 'object' ? safe.summary : { total: 0, error: 0, warn: 0, info: 0 };
    const issues = Array.isArray(safe.issues) ? safe.issues : [];
    const lines = [];
    lines.push(`# ${i18n.markdown.title}`);
    lines.push('');
    lines.push(`- ${i18n.markdown.generated}: ${safe.generatedAt || ''}`);
    lines.push(`- ${i18n.markdown.status}: ${safe.ok ? i18n.markdown.statusOk : i18n.markdown.statusNotOk}`);
    lines.push(`- ${i18n.markdown.issues}: ${summary.total || 0} (${i18n.severity.error} ${summary.error || 0}, ${i18n.severity.warn} ${summary.warn || 0}, ${i18n.severity.info} ${summary.info || 0})`);
    lines.push('');
    if (!issues.length) {
        lines.push(i18n.markdown.noIssues);
        lines.push('');
        return lines.join('\n');
    }
    lines.push(`## ${i18n.markdown.issuesTitle}`);
    lines.push('');
    for (const issue of issues) {
        if (!issue || typeof issue !== 'object') continue;
        const severityLabel = issue.severityLabel || (i18n.severity[normalizeSeverity(issue.severity)] || String(issue.severity || '').toUpperCase());
        const header = `### [${severityLabel}] ${issue.problem || issue.id || ''}`;
        lines.push(header);
        if (issue.area) {
            lines.push(`- ${i18n.markdown.area}: ${issue.area}`);
        }
        if (issue.impact) {
            lines.push(`- ${i18n.markdown.impact}: ${issue.impact}`);
        }
        const actions = Array.isArray(issue.actions) ? issue.actions : [];
        if (actions.length) {
            lines.push(`- ${i18n.markdown.actions}:`);
            for (const action of actions) {
                if (!action || typeof action !== 'object') continue;
                if (action.type === 'navigate') {
                    lines.push(`  - ${i18n.markdown.open}: ${action.label || action.target || ''}`);
                    continue;
                }
                if (action.type === 'run-check') {
                    lines.push(`  - ${i18n.markdown.recheck}`);
                    continue;
                }
                if (action.type === 'export') {
                    const fmt = action.format === 'md' ? 'md' : 'json';
                    lines.push(`  - ${fmt === 'md' ? i18n.markdown.export.md : i18n.markdown.export.json}`);
                    continue;
                }
                lines.push(`  - ${action.type}`);
            }
        }
        lines.push('');
    }
    return lines.join('\n');
}

function decorateIssue(issue, lang) {
    if (!issue || typeof issue !== 'object') return issue;
    const i18n = getI18n(lang);
    const areaKey = typeof issue.areaKey === 'string' && issue.areaKey.trim() ? issue.areaKey.trim() : 'Doctor';
    issue.areaKey = areaKey;
    issue.area = i18n.area[areaKey] || areaKey;
    issue.severity = normalizeSeverity(issue.severity);
    issue.severityLabel = i18n.severity[issue.severity] || issue.severityLabel || issue.severity;
    return issue;
}

function resolveProviderProblemText(i18n, remoteIssue) {
    const code = remoteIssue && typeof remoteIssue.code === 'string' ? remoteIssue.code : '';
    const mapped = code && i18n.issue.providerUnreachable.message
        ? i18n.issue.providerUnreachable.message[code]
        : '';
    if (mapped) return mapped;
    const fallback = i18n === DOCTOR_I18N.en ? 'Provider unreachable' : 'Provider 不可用';
    return fallback;
}

function buildNavigateAction(target, labelKey, label, labelParams = null) {
    return buildAction('navigate', {
        target,
        labelKey: String(labelKey || '').trim(),
        labelParams: labelParams && typeof labelParams === 'object' ? labelParams : null,
        label: String(label || '').trim()
    });
}

function buildIssueKeyMap() {
    return {
        configNotReady: {
            problemKey: 'doctor.issue.configNotReady.problem',
            impactKey: 'doctor.issue.configNotReady.impact'
        },
        providerUnreachable: {
            problemKeyPrefix: 'doctor.issue.providerUnreachable.problem.',
            impactAuthKey: 'doctor.issue.providerUnreachable.impactAuth',
            impactNetworkKey: 'doctor.issue.providerUnreachable.impactNetwork'
        },
        configHealthFailed: {
            problemKey: 'doctor.issue.configHealthFailed.problem',
            impactKey: 'doctor.issue.configHealthFailed.impact'
        },
        usageError: {
            problemKey: 'doctor.issue.usageError.problem',
            impactKey: 'doctor.issue.usageError.impact'
        },
        usageMissingModel: {
            problemKey: 'doctor.issue.usageMissingModel.problem',
            impactKey: 'doctor.issue.usageMissingModel.impact'
        },
        tasksError: {
            problemKey: 'doctor.issue.tasksError.problem',
            impactKey: 'doctor.issue.tasksError.impact'
        },
        tasksFailed: {
            problemKey: 'doctor.issue.tasksFailed.problem',
            impactKey: 'doctor.issue.tasksFailed.impact'
        },
        skillsError: {
            problemKey: 'doctor.issue.skillsError.problem',
            impactKey: 'doctor.issue.skillsError.impact'
        },
        skillsRootMissing: {
            problemKey: 'doctor.issue.skillsRootMissing.problem',
            impactKey: 'doctor.issue.skillsRootMissing.impact'
        },
        skillsMissingFiles: {
            problemKey: 'doctor.issue.skillsMissingFiles.problem',
            impactKey: 'doctor.issue.skillsMissingFiles.impact'
        }
    };
}

const ISSUE_KEYS = Object.freeze(buildIssueKeyMap());

function resolveProviderProblemKey(code) {
    const normalized = String(code || '').trim();
    const suffix = normalized || 'unknown';
    return `${ISSUE_KEYS.providerUnreachable.problemKeyPrefix}${suffix}`;
}

function runChecks(context, checks = []) {
    const list = Array.isArray(checks) ? checks : [];
    const issues = [];
    for (const check of list) {
        if (typeof check !== 'function') continue;
        const result = check(context);
        if (!result) continue;
        if (Array.isArray(result)) {
            issues.push(...result.filter(Boolean));
            continue;
        }
        issues.push(result);
    }
    return issues;
}

async function buildDoctorReport(params = {}, deps = {}) {
    const options = params && typeof params === 'object' ? params : {};
    const resolvedLang = normalizeLang(options.lang) || normalizeLang(process.env.LANG) || 'zh';
    const i18n = getI18n(resolvedLang);
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
            const sessions = await listSessionUsage({
                source: 'all',
                limit
            });
            const summary = summarizeUsageIssues(sessions);
            sources.usage = {
                range: range === 'all' ? 'all' : (range === '30d' ? '30d' : '7d'),
                summary,
                sample: (Array.isArray(sessions) ? sessions : [])
                    .slice(0, 10)
                    .map((session) => ({
                        source: session && session.source ? session.source : '',
                        sessionId: session && session.sessionId ? session.sessionId : '',
                        updatedAt: session && session.updatedAt ? session.updatedAt : '',
                        model: session && session.model ? session.model : '',
                        provider: session && session.provider ? session.provider : '',
                        messageCount: session && session.messageCount ? session.messageCount : 0,
                        totalTokens: session && session.totalTokens ? session.totalTokens : 0
                    }))
            };
        } catch (e) {
            sources.usage = { error: e && e.message ? e.message : 'usage probe failed', range: '7d', summary: { total: 0, missingModel: 0 } };
        }
    }

    if (buildTaskOverviewPayload && options.includeTasks !== false) {
        try {
            const overview = buildTaskOverviewPayload({
                queueLimit: 20,
                runLimit: 20
            });
            sources.tasks = {
                summary: summarizeTaskIssues(overview),
                warnings: Array.isArray(overview && overview.warnings) ? overview.warnings : []
            };
        } catch (e) {
            sources.tasks = { error: e && e.message ? e.message : 'task overview failed' };
        }
    }

    if (listSkills && options.includeSkills !== false) {
        const targetApp = typeof options.targetApp === 'string' && options.targetApp.trim()
            ? options.targetApp.trim().toLowerCase()
            : 'codex';
        try {
            const raw = listSkills({ targetApp });
            const summary = summarizeSkillsIssues(raw);
            sources.skills = { targetApp, summary };
        } catch (e) {
            sources.skills = { error: e && e.message ? e.message : 'skills probe failed', targetApp };
        }
    }

    const status = sources.status && typeof sources.status === 'object' ? sources.status : {};
    const baseActions = buildDefaultActions();
    const context = {
        options,
        sources,
        status,
        baseActions,
        i18n
    };

    const issues = runChecks(context, [
        (ctx) => {
            if (ctx.status.configReady !== false && !(typeof ctx.status.configErrorType === 'string' && ctx.status.configErrorType.trim())) {
                return null;
            }
            return buildIssue(
                'config-not-ready',
                'error',
                ctx.i18n.issue.configNotReady.problem,
                ctx.i18n.issue.configNotReady.impact,
                ensureBaseActions([
                    buildNavigateAction('config', 'doctor.action.openConfig', ctx.i18n.action.openConfig)
                ].concat(ctx.baseActions)),
                {
                    configErrorType: ctx.status.configErrorType || '',
                    configNotice: ctx.status.configNotice || ''
                },
                {
                    areaKey: 'Config',
                    problemKey: ISSUE_KEYS.configNotReady.problemKey,
                    impactKey: ISSUE_KEYS.configNotReady.impactKey,
                    impactTags: ['blocked'],
                    impactScope: 'config'
                }
            );
        },
        (ctx) => {
            const configHealth = ctx.sources.configHealth && typeof ctx.sources.configHealth === 'object' ? ctx.sources.configHealth : null;
            if (!configHealth || configHealth.ok !== false) {
                return null;
            }
            const remoteIssue = findConfigHealthRemoteIssue(configHealth.issues || []);
            if (remoteIssue) {
                const impactKey = remoteIssue.code === 'remote-model-probe-auth-failed'
                    ? ISSUE_KEYS.providerUnreachable.impactAuthKey
                    : ISSUE_KEYS.providerUnreachable.impactNetworkKey;
                const impact = remoteIssue.code === 'remote-model-probe-auth-failed'
                    ? ctx.i18n.issue.providerUnreachable.impactAuth
                    : ctx.i18n.issue.providerUnreachable.impactNetwork;
                return buildIssue(
                    'provider-unreachable',
                    'error',
                    resolveProviderProblemText(ctx.i18n, remoteIssue),
                    impact,
                    ensureBaseActions([
                        buildNavigateAction('config', 'doctor.action.checkProvider', ctx.i18n.action.checkProvider)
                    ].concat(ctx.baseActions)),
                    { code: remoteIssue.code || '', statusCode: remoteIssue.statusCode || 0 },
                    {
                        areaKey: 'Config',
                        problemKey: resolveProviderProblemKey(remoteIssue.code),
                        impactKey,
                        impactTags: ['blocked', 'network'],
                        impactScope: 'provider'
                    }
                );
            }
            if (Array.isArray(configHealth.issues) && configHealth.issues.length) {
                return buildIssue(
                    'config-health-failed',
                    'warn',
                    ctx.i18n.issue.configHealthFailed.problem,
                    ctx.i18n.issue.configHealthFailed.impact,
                    ensureBaseActions([
                        buildNavigateAction('config', 'doctor.action.openConfig', ctx.i18n.action.openConfig)
                    ].concat(ctx.baseActions)),
                    { issueCount: configHealth.issues.length },
                    {
                        areaKey: 'Config',
                        problemKey: ISSUE_KEYS.configHealthFailed.problemKey,
                        impactKey: ISSUE_KEYS.configHealthFailed.impactKey,
                        impactTags: ['degraded'],
                        impactScope: 'config'
                    }
                );
            }
            return null;
        },
        (ctx) => {
            if (!ctx.sources.usage || typeof ctx.sources.usage !== 'object') return null;
            if (ctx.sources.usage.error) {
                return buildIssue(
                    'usage-error',
                    'warn',
                    ctx.i18n.issue.usageError.problem,
                    ctx.i18n.issue.usageError.impact,
                    ensureBaseActions([
                        buildNavigateAction('usage', 'doctor.action.openUsage', ctx.i18n.action.openUsage)
                    ].concat(ctx.baseActions)),
                    { error: ctx.sources.usage.error },
                    {
                        areaKey: 'Observe',
                        problemKey: ISSUE_KEYS.usageError.problemKey,
                        impactKey: ISSUE_KEYS.usageError.impactKey,
                        impactTags: ['degraded'],
                        impactScope: 'observe'
                    }
                );
            }
            const summary = ctx.sources.usage.summary && typeof ctx.sources.usage.summary === 'object' ? ctx.sources.usage.summary : { total: 0, missingModel: 0 };
            if (Number(summary.missingModel || 0) <= 0) return null;
            return buildIssue(
                'usage-missing-model',
                'info',
                ctx.i18n.issue.usageMissingModel.problem,
                ctx.i18n.issue.usageMissingModel.impact,
                ensureBaseActions([
                    buildNavigateAction('usage', 'doctor.action.openUsage', ctx.i18n.action.openUsage),
                    buildNavigateAction('sessions', 'doctor.action.openSessions', ctx.i18n.action.openSessions)
                ].concat(ctx.baseActions)),
                summary,
                {
                    areaKey: 'Observe',
                    problemKey: ISSUE_KEYS.usageMissingModel.problemKey,
                    impactKey: ISSUE_KEYS.usageMissingModel.impactKey,
                    impactTags: ['data-quality'],
                    impactScope: 'observe'
                }
            );
        },
        (ctx) => {
            if (!ctx.sources.tasks || typeof ctx.sources.tasks !== 'object') return null;
            if (ctx.sources.tasks.error) {
                return buildIssue(
                    'tasks-error',
                    'warn',
                    ctx.i18n.issue.tasksError.problem,
                    ctx.i18n.issue.tasksError.impact,
                    ensureBaseActions([
                        buildNavigateAction('orchestration', 'doctor.action.openTasks', ctx.i18n.action.openTasks)
                    ].concat(ctx.baseActions)),
                    { error: ctx.sources.tasks.error },
                    {
                        areaKey: 'Operate',
                        problemKey: ISSUE_KEYS.tasksError.problemKey,
                        impactKey: ISSUE_KEYS.tasksError.impactKey,
                        impactTags: ['degraded'],
                        impactScope: 'operate'
                    }
                );
            }
            const summary = ctx.sources.tasks.summary && typeof ctx.sources.tasks.summary === 'object'
                ? ctx.sources.tasks.summary
                : summarizeTaskIssues(ctx.sources.tasks);
            if (Number(summary.failed || 0) <= 0) return null;
            return buildIssue(
                'tasks-failed',
                'warn',
                ctx.i18n.issue.tasksFailed.problem,
                ctx.i18n.issue.tasksFailed.impact,
                ensureBaseActions([
                    buildNavigateAction('orchestration', 'doctor.action.viewTaskLogs', ctx.i18n.action.viewTaskLogs)
                ].concat(ctx.baseActions)),
                {
                    failed: summary.failed || 0,
                    latestFailed: summary.latestFailed
                        ? {
                            runId: summary.latestFailed.runId || '',
                            status: summary.latestFailed.status || '',
                            error: summary.latestFailed.error || ''
                        }
                        : null
                },
                {
                    areaKey: 'Operate',
                    problemKey: ISSUE_KEYS.tasksFailed.problemKey,
                    impactKey: ISSUE_KEYS.tasksFailed.impactKey,
                    impactTags: ['blocked'],
                    impactScope: 'operate'
                }
            );
        },
        (ctx) => {
            if (!ctx.sources.skills || typeof ctx.sources.skills !== 'object') return null;
            if (ctx.sources.skills.error) {
                return buildIssue(
                    'skills-error',
                    'warn',
                    ctx.i18n.issue.skillsError.problem,
                    ctx.i18n.issue.skillsError.impact,
                    ensureBaseActions([
                        buildNavigateAction('market', 'doctor.action.openSkills', ctx.i18n.action.openSkills)
                    ].concat(ctx.baseActions)),
                    { error: ctx.sources.skills.error },
                    {
                        areaKey: 'Reuse',
                        problemKey: ISSUE_KEYS.skillsError.problemKey,
                        impactKey: ISSUE_KEYS.skillsError.impactKey,
                        impactTags: ['degraded'],
                        impactScope: 'reuse'
                    }
                );
            }
            const summary = ctx.sources.skills.summary && typeof ctx.sources.skills.summary === 'object'
                ? ctx.sources.skills.summary
                : summarizeSkillsIssues(ctx.sources.skills);
            if (!summary.exists) {
                return buildIssue(
                    'skills-root-missing',
                    'info',
                    ctx.i18n.issue.skillsRootMissing.problem,
                    ctx.i18n.issue.skillsRootMissing.impact,
                    ensureBaseActions([
                        buildNavigateAction('market', 'doctor.action.openSkills', ctx.i18n.action.openSkills)
                    ].concat(ctx.baseActions)),
                    summary,
                    {
                        areaKey: 'Reuse',
                        problemKey: ISSUE_KEYS.skillsRootMissing.problemKey,
                        impactKey: ISSUE_KEYS.skillsRootMissing.impactKey,
                        impactTags: ['degraded'],
                        impactScope: 'reuse'
                    }
                );
            }
            if (Number(summary.missing || 0) > 0) {
                return buildIssue(
                    'skills-missing-files',
                    'info',
                    ctx.i18n.issue.skillsMissingFiles.problem,
                    ctx.i18n.issue.skillsMissingFiles.impact,
                    ensureBaseActions([
                        buildNavigateAction('market', 'doctor.action.openSkills', ctx.i18n.action.openSkills)
                    ].concat(ctx.baseActions)),
                    summary,
                    {
                        areaKey: 'Reuse',
                        problemKey: ISSUE_KEYS.skillsMissingFiles.problemKey,
                        impactKey: ISSUE_KEYS.skillsMissingFiles.impactKey,
                        impactTags: ['data-quality'],
                        impactScope: 'reuse'
                    }
                );
            }
            return null;
        }
    ]);

    const sortedIssues = sortIssues(issues);
    sortedIssues.forEach((issue) => decorateIssue(issue, resolvedLang));
    const hasError = sortedIssues.some((item) => item && item.severity === 'error');
    const report = {
        schema: 1,
        generatedAt: now,
        lang: resolvedLang,
        ok: !hasError,
        issues: sortedIssues,
        sources
    };
    report.summary = {
        total: sortedIssues.length,
        error: sortedIssues.filter((item) => item.severity === 'error').length,
        warn: sortedIssues.filter((item) => item.severity === 'warn').length,
        info: sortedIssues.filter((item) => item.severity === 'info').length
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
    renderDoctorMarkdown,
    buildAction
};
