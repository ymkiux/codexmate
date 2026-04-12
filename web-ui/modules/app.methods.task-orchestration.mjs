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
        allowWrite: false,
        dryRun: false,
        concurrency: 2,
        autoFixRounds: 1,
        plan: null,
        planIssues: [],
        planWarnings: [],
        workflows: [],
        queue: [],
        runs: [],
        selectedRunId: '',
        selectedRunDetail: null,
        selectedRunLoading: false,
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

export function createTaskOrchestrationMethods(options = {}) {
    const { api } = options;

    return {
        ensureTaskOrchestrationState() {
            const current = this.taskOrchestration;
            if (current && typeof current === 'object' && !Array.isArray(current)) {
                return current;
            }
            this.taskOrchestration = createDefaultTaskOrchestrationState();
            return this.taskOrchestration;
        },

        buildTaskOrchestrationRequest() {
            const state = this.ensureTaskOrchestrationState();
            return {
                title: String(state.title || '').trim(),
                target: String(state.target || '').trim(),
                notes: String(state.notes || '').trim(),
                followUps: normalizeLines(state.followUpsText),
                workflowIds: normalizeLines(state.workflowIdsText),
                engine: String(state.selectedEngine || 'codex').trim().toLowerCase() === 'workflow' ? 'workflow' : 'codex',
                allowWrite: state.allowWrite === true,
                dryRun: state.dryRun === true,
                concurrency: normalizePositiveInteger(state.concurrency, 2, 1, 8),
                autoFixRounds: normalizePositiveInteger(state.autoFixRounds, 1, 0, 5)
            };
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
                if (Array.isArray(res && res.warnings) && res.warnings.length > 0) {
                    state.planWarnings = res.warnings;
                }
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

        async addTaskOrchestrationToQueue() {
            const state = this.ensureTaskOrchestrationState();
            if (state.queueAdding) {
                return null;
            }
            state.queueAdding = true;
            try {
                const res = await api('task-queue-add', this.buildTaskOrchestrationRequest());
                if (res && res.error) {
                    this.showMessage(res.error, 'error');
                    return res;
                }
                await this.loadTaskOrchestrationOverview({ silent: true, includeDetail: false });
                this.showMessage(`已加入队列: ${res && res.task ? res.task.taskId : ''}`.trim(), 'success');
                return res;
            } catch (error) {
                const message = error && error.message ? error.message : '加入队列失败';
                this.showMessage(message, 'error');
                return { error: message };
            } finally {
                state.queueAdding = false;
            }
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
                this.showMessage('队列执行器已启动', 'success');
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
                this.syncTaskOrchestrationPolling();
                return null;
            }
            state.selectedRunLoading = true;
            state.selectedRunId = normalizedRunId;
            try {
                const res = await api('task-run-detail', { runId: normalizedRunId });
                if (res && res.error) {
                    if (!options.silent) {
                        this.showMessage(res.error, 'error');
                    }
                    return res;
                }
                state.selectedRunDetail = res;
                this.syncTaskOrchestrationPolling();
                return res;
            } catch (error) {
                const message = error && error.message ? error.message : '加载任务详情失败';
                if (!options.silent) {
                    this.showMessage(message, 'error');
                }
                return { error: message };
            } finally {
                state.selectedRunLoading = false;
            }
        },

        async selectTaskRun(runId) {
            return this.loadTaskRunDetail(runId, { silent: false });
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
            this.taskOrchestration = createDefaultTaskOrchestrationState();
            this.stopTaskOrchestrationPolling();
        }
    };
}
