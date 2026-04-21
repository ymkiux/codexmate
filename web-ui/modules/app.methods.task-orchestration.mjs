function createDefaultTaskOrchestrationState() {
    return {
        loading: false,
        planning: false,
        running: false,
        queueAdding: false,
        queueStarting: false,
        retrying: false,
        target: '',
        title: '',
        notes: '',
        followUpsText: '',
        workflowIdsText: '',
        selectedEngine: 'codex',
        runMode: 'write',
        concurrency: 2,
        autoFixRounds: 1,
        plan: null,
        planFingerprint: '',
        planIssues: [],
        planWarnings: [],
        overviewWarnings: [],
        workflows: [],
        queue: [],
        runs: [],
        selectedRunId: '',
        workspaceTab: 'queue',
        selectedRunDetail: null,
        selectedRunLoading: false,
        selectedRunError: '',
        detailRequestToken: 0,
        lastLoadedAt: '',
        lastError: ''
    };
}

function normalizeLines(text) {
    return String(text || '')
        .split(/\r?\n/g)
        .map((item) => item.trim())
        .filter(Boolean);
}

function normalizePositiveInteger(value, fallback, min = 1, max = 8) {
    const numeric = Number.parseInt(String(value), 10);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function normalizeTaskStatusTone(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'success' || normalized === 'completed') return 'success';
    if (normalized === 'failed' || normalized === 'blocked' || normalized === 'cancelled') return 'error';
    if (normalized === 'running' || normalized === 'queued') return 'warn';
    return 'neutral';
}

function isActiveStatus(status) {
    const normalized = String(status || '').trim().toLowerCase();
    return normalized === 'running' || normalized === 'queued';
}

function normalizeTaskRunMode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'read') return 'read';
    if (normalized === 'dry-run' || normalized === 'dryrun' || normalized === 'plan') return 'dry-run';
    return 'write';
}

function buildRunModeFlags(runMode) {
    const normalized = normalizeTaskRunMode(runMode);
    return {
        runMode: normalized,
        allowWrite: normalized === 'write',
        dryRun: normalized === 'dry-run'
    };
}

export function createTaskOrchestrationMethods(options = {}) {
    const { api } = options;

    return {
        ensureTaskOrchestrationState() {
            const current = this.taskOrchestration;
            if (current && typeof current === 'object' && !Array.isArray(current)) {
                const defaults = createDefaultTaskOrchestrationState();
                for (const [key, value] of Object.entries(defaults)) {
                    if (typeof current[key] === 'undefined') {
                        current[key] = value;
                    }
                }
                current.runMode = normalizeTaskRunMode(current.runMode);
                return current;
            }
            this.taskOrchestration = createDefaultTaskOrchestrationState();
            return this.taskOrchestration;
        },

        buildTaskOrchestrationRequest() {
            const state = this.ensureTaskOrchestrationState();
            const flags = buildRunModeFlags(state.runMode);
            return {
                title: String(state.title || '').trim(),
                target: String(state.target || '').trim(),
                notes: String(state.notes || '').trim(),
                followUps: normalizeLines(state.followUpsText),
                workflowIds: normalizeLines(state.workflowIdsText),
                engine: String(state.selectedEngine || 'codex').trim().toLowerCase() === 'workflow' ? 'workflow' : 'codex',
                allowWrite: flags.allowWrite,
                dryRun: flags.dryRun,
                concurrency: normalizePositiveInteger(state.concurrency, 2, 1, 8),
                autoFixRounds: normalizePositiveInteger(state.autoFixRounds, 1, 0, 5)
            };
        },

        buildTaskOrchestrationFingerprint() {
            const req = this.buildTaskOrchestrationRequest();
            return JSON.stringify({
                title: req.title,
                target: req.target,
                notes: req.notes,
                followUps: req.followUps,
                workflowIds: req.workflowIds,
                engine: req.engine,
                allowWrite: req.allowWrite,
                dryRun: req.dryRun,
                concurrency: req.concurrency,
                autoFixRounds: req.autoFixRounds
            });
        },

        taskRunStatusTone(status) {
            return normalizeTaskStatusTone(status);
        },

        isTaskRunActive(status) {
            return isActiveStatus(status);
        },

        formatTaskNodeDependencies(node) {
            const dependsOn = Array.isArray(node && node.dependsOn) ? node.dependsOn : [];
            return dependsOn.length > 0 ? dependsOn.join(', ') : '无';
        },

        formatTaskNodeLogs(logs) {
            if (!Array.isArray(logs) || logs.length === 0) {
                return '(no logs)';
            }
            return logs.map((item) => `${item && item.at ? item.at : ''} ${item && item.level ? item.level : ''} ${item && item.message ? item.message : ''}`.trim()).join('\n');
        },

        appendTaskWorkflowId(workflowId) {
            const state = this.ensureTaskOrchestrationState();
            const normalizedWorkflowId = typeof workflowId === 'string' ? workflowId.trim() : '';
            if (!normalizedWorkflowId) {
                return;
            }
            const nextWorkflowIds = normalizeLines(state.workflowIdsText);
            if (!nextWorkflowIds.includes(normalizedWorkflowId)) {
                nextWorkflowIds.push(normalizedWorkflowId);
            }
            state.selectedEngine = 'workflow';
            state.workflowIdsText = nextWorkflowIds.join('\n');
        },

        async loadTaskOrchestrationOverview(options = {}) {
            const state = this.ensureTaskOrchestrationState();
            if (state.loading && !options.forceRefresh) {
                return null;
            }
            const silent = !!options.silent;
            state.loading = true;
            state.lastError = '';
            try {
                const res = await api('task-overview', {
                    queueLimit: 20,
                    runLimit: 20
                });
                if (res && res.error) {
                    state.lastError = res.error;
                    if (!silent) {
                        this.showMessage(res.error, 'error');
                    }
                    return res;
                }
                state.workflows = Array.isArray(res && res.workflows) ? res.workflows : [];
                state.queue = Array.isArray(res && res.queue) ? res.queue : [];
                state.runs = Array.isArray(res && res.runs) ? res.runs : [];
                state.overviewWarnings = Array.isArray(res && res.warnings) ? res.warnings : [];
                state.lastLoadedAt = new Date().toISOString();
                if (!state.selectedRunId && state.runs.length > 0) {
                    state.selectedRunId = state.runs[0].runId || '';
                }
                const shouldRefreshSelectedDetail = !!state.selectedRunId
                    && (options.includeDetail !== false
                        || (state.selectedRunDetail && this.isTaskRunActive(state.selectedRunDetail && state.selectedRunDetail.run && state.selectedRunDetail.run.status)));
                if (shouldRefreshSelectedDetail) {
                    await this.loadTaskRunDetail(state.selectedRunId, { silent: true });
                }
                this.syncTaskOrchestrationPolling();
                return res;
            } catch (error) {
                const message = error && error.message ? error.message : '任务编排概览加载失败';
                state.lastError = message;
                if (!silent) {
                    this.showMessage(message, 'error');
                }
                return { error: message };
            } finally {
                state.loading = false;
            }
        },

        async previewTaskPlan(options = {}) {
            const state = this.ensureTaskOrchestrationState();
            if (state.planning) {
                return null;
            }
            state.planning = true;
            try {
                const res = await api('task-plan', this.buildTaskOrchestrationRequest());
                state.plan = res && res.plan ? res.plan : null;
                state.planIssues = Array.isArray(res && res.issues) ? res.issues : [];
                state.planWarnings = Array.isArray(res && res.warnings) ? res.warnings : [];
                state.planFingerprint = state.plan ? this.buildTaskOrchestrationFingerprint() : '';
                if (res && res.error) {
                    if (!options.silent) {
                        this.showMessage(res.error, 'error');
                    }
                    return res;
                }
                if (!options.silent) {
                    this.showMessage('任务计划已更新', 'success');
                }
                return res;
            } catch (error) {
                const message = error && error.message ? error.message : '任务计划生成失败';
                state.plan = null;
                state.planIssues = [];
                state.planWarnings = [];
                if (!options.silent) {
                    this.showMessage(message, 'error');
                }
                return { error: message };
            } finally {
                state.planning = false;
            }
        },

        async runTaskOrchestration() {
            const state = this.ensureTaskOrchestrationState();
            if (state.running) {
                return null;
            }
            state.running = true;
            try {
                const res = await api('task-run', {
                    ...this.buildTaskOrchestrationRequest(),
                    detach: true
                });
                if (res && res.error) {
                    this.showMessage(res.error, 'error');
                    return res;
                }
                state.selectedRunId = res.runId || state.selectedRunId;
                await this.loadTaskOrchestrationOverview({ silent: true, includeDetail: false });
                if (state.selectedRunId) {
                    await this.loadTaskRunDetail(state.selectedRunId, { silent: true });
                }
                this.syncTaskOrchestrationPolling();
                this.showMessage(`任务已启动: ${res.runId || res.taskId || 'unknown'}`, 'success');
                return res;
            } catch (error) {
                const message = error && error.message ? error.message : '任务启动失败';
                this.showMessage(message, 'error');
                return { error: message };
            } finally {
                state.running = false;
            }
        },

        async addTaskOrchestrationToQueue(options = {}) {
            const state = this.ensureTaskOrchestrationState();
            if (state.queueAdding) {
                return null;
            }
            state.queueAdding = true;
            try {
                const res = await api('task-queue-add', this.buildTaskOrchestrationRequest());
                if (res && res.error) {
                    if (!options.silent) {
                        this.showMessage(res.error, 'error');
                    }
                    return res;
                }
                if (!options.deferRefresh) {
                    await this.loadTaskOrchestrationOverview({ silent: true, includeDetail: false });
                }
                if (!options.silent) {
                    this.showMessage(`已加入队列: ${res && res.task ? res.task.taskId : ''}`.trim(), 'success');
                }
                return res;
            } catch (error) {
                const message = error && error.message ? error.message : '加入队列失败';
                if (!options.silent) {
                    this.showMessage(message, 'error');
                }
                return { error: message };
            } finally {
                state.queueAdding = false;
            }
        },

        async planAndRunTaskOrchestration() {
            const state = this.ensureTaskOrchestrationState();
            if (state.running || state.planning) {
                return null;
            }
            if (!String(state.target || '').trim()) {
                return null;
            }
            if (buildRunModeFlags(state.runMode).dryRun) {
                return this.previewTaskPlan({ silent: false });
            }
            const fingerprint = this.buildTaskOrchestrationFingerprint();
            const shouldPreview = !state.plan || state.planFingerprint !== fingerprint;
            if (shouldPreview) {
                const preview = await this.previewTaskPlan({ silent: true });
                if (preview && preview.error) {
                    this.showMessage(preview.error, 'error');
                    return preview;
                }
            }
            if (state.planIssues && state.planIssues.length) {
                this.showMessage('计划存在问题，请先修复再执行', 'error');
                return { error: 'Plan has blocking issues' };
            }
            return this.runTaskOrchestration();
        },

        async queueTaskOrchestrationAndStart() {
            const state = this.ensureTaskOrchestrationState();
            if (state.queueAdding || state.queueStarting || state.planning || state.running) {
                return null;
            }
            if (!String(state.target || '').trim()) {
                return null;
            }
            const queued = await this.addTaskOrchestrationToQueue({ silent: true, deferRefresh: true });
            if (queued && queued.error) {
                this.showMessage(queued.error, 'error');
                return queued;
            }
            return this.startTaskQueueRunner();
        },

        async startTaskQueueRunner() {
            const state = this.ensureTaskOrchestrationState();
            if (state.queueStarting) {
                return null;
            }
            state.queueStarting = true;
            try {
                const res = await api('task-queue-start', { detach: true });
                if (res && res.error) {
                    this.showMessage(res.error, 'error');
                    return res;
                }
                await this.loadTaskOrchestrationOverview({ silent: true, includeDetail: false });
                this.syncTaskOrchestrationPolling();
                this.showMessage(res && res.alreadyRunning ? '队列执行器已在运行' : '队列执行器已启动', 'success');
                return res;
            } catch (error) {
                const message = error && error.message ? error.message : '启动队列失败';
                this.showMessage(message, 'error');
                return { error: message };
            } finally {
                state.queueStarting = false;
            }
        },

        async loadTaskRunDetail(runId, options = {}) {
            const state = this.ensureTaskOrchestrationState();
            const normalizedRunId = String(runId || '').trim();
            if (!normalizedRunId) {
                state.selectedRunDetail = null;
                state.selectedRunId = '';
                state.selectedRunError = '';
                this.syncTaskOrchestrationPolling();
                return null;
            }
            const requestToken = (state.detailRequestToken || 0) + 1;
            const previousRunId = state.selectedRunId;
            state.detailRequestToken = requestToken;
            state.selectedRunLoading = true;
            state.selectedRunId = normalizedRunId;
            if (options.switchToDetail === true || !options.silent) {
                state.workspaceTab = 'detail';
            }
            state.selectedRunError = '';
            if (previousRunId !== normalizedRunId) {
                state.selectedRunDetail = null;
            }
            try {
                const res = await api('task-run-detail', { runId: normalizedRunId });
                if (state.detailRequestToken !== requestToken) {
                    return res;
                }
                if (res && res.error) {
                    state.selectedRunDetail = null;
                    state.selectedRunError = res.error;
                    if (!options.silent) {
                        this.showMessage(res.error, 'error');
                    }
                    return res;
                }
                state.selectedRunDetail = res;
                state.selectedRunError = '';
                this.syncTaskOrchestrationPolling();
                return res;
            } catch (error) {
                const message = error && error.message ? error.message : '加载任务详情失败';
                if (state.detailRequestToken === requestToken) {
                    state.selectedRunDetail = null;
                    state.selectedRunError = message;
                }
                if (!options.silent) {
                    this.showMessage(message, 'error');
                }
                return { error: message };
            } finally {
                if (state.detailRequestToken === requestToken) {
                    state.selectedRunLoading = false;
                }
            }
        },

        async selectTaskRun(runId) {
            return this.loadTaskRunDetail(runId, { silent: false, switchToDetail: true });
        },

        async retryTaskRunFromUi(runId) {
            const state = this.ensureTaskOrchestrationState();
            const normalizedRunId = String(runId || '').trim();
            if (!normalizedRunId || state.retrying) {
                return null;
            }
            state.retrying = true;
            try {
                const res = await api('task-retry', { runId: normalizedRunId, detach: true });
                if (res && res.error) {
                    this.showMessage(res.error, 'error');
                    return res;
                }
                state.selectedRunId = res.runId || state.selectedRunId;
                await this.loadTaskOrchestrationOverview({ silent: true, includeDetail: false });
                if (state.selectedRunId) {
                    await this.loadTaskRunDetail(state.selectedRunId, { silent: true });
                }
                this.syncTaskOrchestrationPolling();
                this.showMessage(`已开始重试: ${res.runId || normalizedRunId}`, 'success');
                return res;
            } catch (error) {
                const message = error && error.message ? error.message : '重试任务失败';
                this.showMessage(message, 'error');
                return { error: message };
            } finally {
                state.retrying = false;
            }
        },

        async cancelTaskRunFromUi(target) {
            const normalizedTarget = String(target || '').trim();
            if (!normalizedTarget) {
                return null;
            }
            try {
                const res = await api('task-cancel', { target: normalizedTarget });
                if (res && res.error) {
                    this.showMessage(res.error, 'error');
                    return res;
                }
                await this.loadTaskOrchestrationOverview({ silent: true, includeDetail: false });
                if (this.taskOrchestration.selectedRunId) {
                    await this.loadTaskRunDetail(this.taskOrchestration.selectedRunId, { silent: true });
                }
                this.syncTaskOrchestrationPolling();
                this.showMessage('已发出取消请求', 'success');
                return res;
            } catch (error) {
                const message = error && error.message ? error.message : '取消任务失败';
                this.showMessage(message, 'error');
                return { error: message };
            }
        },

        taskOrchestrationHasLiveActivity() {
            const state = this.ensureTaskOrchestrationState();
            const queue = Array.isArray(state.queue) ? state.queue : [];
            if (queue.some((item) => isActiveStatus(item && (item.status || item.runStatus)))) {
                return true;
            }
            const detail = state.selectedRunDetail;
            const selectedStatus = detail && detail.run ? detail.run.status : '';
            if (isActiveStatus(selectedStatus)) {
                return true;
            }
            const runs = Array.isArray(state.runs) ? state.runs : [];
            return runs.some((item) => isActiveStatus(item && item.status));
        },

        stopTaskOrchestrationPolling() {
            if (this._taskOrchestrationPollTimer) {
                clearTimeout(this._taskOrchestrationPollTimer);
                this._taskOrchestrationPollTimer = 0;
            }
        },

        syncTaskOrchestrationPolling() {
            this.stopTaskOrchestrationPolling();
            if (this.mainTab !== 'orchestration') {
                return;
            }
            if (!this.taskOrchestrationHasLiveActivity()) {
                return;
            }
            this._taskOrchestrationPollTimer = setTimeout(async () => {
                this._taskOrchestrationPollTimer = 0;
                if (this.mainTab !== 'orchestration') {
                    return;
                }
                await this.loadTaskOrchestrationOverview({ silent: true, includeDetail: true });
            }, 4000);
        },

        resetTaskOrchestrationDraft() {
            const state = this.ensureTaskOrchestrationState();
            state.target = '';
            state.title = '';
            state.notes = '';
            state.followUpsText = '';
            state.workflowIdsText = '';
            state.selectedEngine = 'codex';
            state.runMode = 'write';
            state.concurrency = 2;
            state.autoFixRounds = 1;
            state.plan = null;
            state.planIssues = [];
            state.planWarnings = [];
            state.lastError = '';
            this.syncTaskOrchestrationPolling();
        }
    };
}
