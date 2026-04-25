import { runLatestOnlyQueue } from '../logic.mjs';
import { normalizeConfigTemplateDiffConfirmEnabled } from './config-template-confirm-pref.mjs';

function hasResponseError(response) {
    if (!response || typeof response !== 'object') {
        return false;
    }
    if (typeof response.error === 'string') {
        return response.error.trim().length > 0;
    }
    return response.error !== undefined && response.error !== null && response.error !== false;
}

function getResponseMessage(response, fallback) {
    if (!response || typeof response !== 'object') {
        return fallback;
    }
    for (const key of ['error', 'message', 'detail']) {
        const value = response[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return fallback;
}

export function createCodexConfigMethods(options = {}) {
    const {
        api,
        defaultModelContextWindow = 190000,
        defaultModelAutoCompactTokenLimit = 185000,
        getProviderConfigModeMeta
    } = options;

    return {
        downloadTextFile(fileName, content, mimeType = 'text/markdown;charset=utf-8') {
            const BOM = '\uFEFF';
            const blob = new Blob([BOM + content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.click();
            URL.revokeObjectURL(url);
        },

        async exportSession(session) {
            const key = this.getSessionExportKey(session);
            if (this.sessionExporting[key]) return;

            this.sessionExporting[key] = true;
            try {
                const res = await api('export-session', {
                    source: session.source,
                    sessionId: session.sessionId,
                    filePath: session.filePath
                });
                if (res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }

                const fileName = res.fileName || `${session.source || 'session'}-${session.sessionId || Date.now()}.md`;
                this.downloadTextFile(fileName, res.content || '');
                if (res.truncated) {
                    const maxLabel = res.maxMessages === 'all' ? 'all' : res.maxMessages;
                    this.showMessage(`会话导出完成（已截断：最多 ${maxLabel} 条消息）`, 'info');
                } else {
                    this.showMessage('操作成功', 'success');
                }
            } catch (e) {
                this.showMessage('导出失败', 'error');
            } finally {
                this.sessionExporting[key] = false;
            }
        },

        async quickSwitchProvider(name) {
            const target = String(name || '').trim();
            const visualTarget = String(this.providerSwitchDisplayTarget || '').trim();
            if (!target || target === visualTarget || target === this.pendingProviderSwitch) {
                return;
            }
            if (!this.providerSwitchInProgress && target === this.currentProvider) {
                return;
            }
            await this.switchProvider(target);
        },

        async waitForCodexApplyIdle(maxWaitMs = 20000) {
            const startedAt = Date.now();
            while (this.codexApplying) {
                if ((Date.now() - startedAt) > maxWaitMs) {
                    throw new Error('等待配置应用完成超时');
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        },

        async performProviderSwitch(name) {
            await this.waitForCodexApplyIdle();
            const previousProvider = this.currentProvider;
            const previousModel = this.currentModel;
            const previousModels = Array.isArray(this.models) ? [...this.models] : [];
            const previousModelsSource = this.modelsSource;
            const previousModelsHasCurrent = this.modelsHasCurrent;
            this.currentProvider = name;
            const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

            // 不要把“切换提供商”强绑定到 /models 成功与否：
            // 部分 OpenAI 兼容服务 /models 不可用或很慢，但用户仍希望一次点击即可完成切换。
            // 这里做“短等待 + 后台补齐”：
            // 1) 先启动 models 拉取（静默）
            // 2) 给一个很短的窗口等待它完成，以便能立即选到第一个模型
            // 3) 无论 models 是否成功，先应用 provider 切换
            // 4) models 后续若补齐并发现当前 model 不在列表，则自动切到首个 model 并再应用一次
            const modelsTask = this.loadModelsForProvider(name, { silentError: true })
                .catch(() => {});

            await Promise.race([modelsTask, delay(250)]);

            if (this.modelsSource === 'remote' && this.models.length > 0 && !this.models.includes(this.currentModel)) {
                this.currentModel = this.models[0];
                this.modelsHasCurrent = true;
            }

            if (getProviderConfigModeMeta(this.configMode)) {
                await this.waitForCodexApplyIdle();
                await this.applyCodexConfigDirect({ silent: true });
            }

            await modelsTask;

            if (this.currentProvider === name) {
                if (this.modelsSource === 'remote' && this.models.length > 0 && !this.models.includes(this.currentModel)) {
                    this.currentModel = this.models[0];
                    this.modelsHasCurrent = true;
                    if (getProviderConfigModeMeta(this.configMode)) {
                        await this.waitForCodexApplyIdle();
                        await this.applyCodexConfigDirect({ silent: true });
                    }
                }
            }
        },

        async switchProvider(name) {
            const target = String(name || '').trim();
            if (!target) {
                return;
            }
            if (target === String(this.providerSwitchDisplayTarget || '').trim()) {
                return;
            }
            this.providerSwitchDisplayTarget = target;
            if (this.providerSwitchInProgress) {
                this.pendingProviderSwitch = target;
                return;
            }
            this.providerSwitchInProgress = true;
            let lastError = '';
            try {
                this.pendingProviderSwitch = '';
                const result = await runLatestOnlyQueue(target, {
                    perform: async (queuedTarget) => {
                        this.providerSwitchDisplayTarget = queuedTarget;
                        await this.performProviderSwitch(queuedTarget);
                    },
                    consumePending: () => {
                        const queued = this.pendingProviderSwitch;
                        this.pendingProviderSwitch = '';
                        return queued;
                    }
                });
                if (result && typeof result.lastError === 'string') {
                    lastError = result.lastError;
                }
            } finally {
                this.providerSwitchInProgress = false;
                this.pendingProviderSwitch = '';
                this.providerSwitchDisplayTarget = '';
            }
            if (lastError) {
                this.showMessage(lastError, 'error');
            }
        },

        async onModelChange() {
            await this.applyCodexConfigDirect();
        },

        async onServiceTierChange() {
            await this.applyCodexConfigDirect({ silent: true });
        },

        async onReasoningEffortChange() {
            await this.applyCodexConfigDirect({ silent: true });
        },

        sanitizePositiveIntegerDraft(field) {
            if (!field || typeof this[field] === 'undefined') return;
            const current = typeof this[field] === 'string'
                ? this[field]
                : String(this[field] || '');
            const sanitized = current.replace(/[^\d]/g, '');
            if (sanitized !== current) {
                this[field] = sanitized;
            }
        },

        normalizePositiveIntegerInput(value, label, fallback = '') {
            const fallbackText = fallback === '' ? '' : String(fallback).trim();
            const raw = typeof value === 'string'
                ? value.trim()
                : String(value == null ? '' : value).trim();
            const text = raw || fallbackText;
            if (!text) {
                return { ok: true, value: null, text: '' };
            }
            if (!/^\d+$/.test(text)) {
                return { ok: false, error: `${label} 请输入正整数` };
            }
            const num = Number.parseInt(text, 10);
            if (!Number.isSafeInteger(num) || num <= 0) {
                return { ok: false, error: `${label} 请输入正整数` };
            }
            return { ok: true, value: num, text: String(num) };
        },

        async onModelContextWindowBlur() {
            this.editingCodexBudgetField = '';
            const normalized = this.normalizePositiveIntegerInput(
                this.modelContextWindowInput,
                'model_context_window',
                defaultModelContextWindow
            );
            if (!normalized.ok) {
                this.showMessage(normalized.error, 'error');
                return;
            }
            this.modelContextWindowInput = normalized.text;
            await this.applyCodexConfigDirect({
                silent: true,
                modelContextWindow: normalized.value
            });
        },

        async onModelAutoCompactTokenLimitBlur() {
            this.editingCodexBudgetField = '';
            const normalized = this.normalizePositiveIntegerInput(
                this.modelAutoCompactTokenLimitInput,
                'model_auto_compact_token_limit',
                defaultModelAutoCompactTokenLimit
            );
            if (!normalized.ok) {
                this.showMessage(normalized.error, 'error');
                return;
            }
            this.modelAutoCompactTokenLimitInput = normalized.text;
            await this.applyCodexConfigDirect({
                silent: true,
                modelAutoCompactTokenLimit: normalized.value
            });
        },

        async resetCodexContextBudgetDefaults() {
            this.modelContextWindowInput = String(defaultModelContextWindow);
            this.modelAutoCompactTokenLimitInput = String(defaultModelAutoCompactTokenLimit);
            await this.applyCodexConfigDirect({
                modelContextWindow: defaultModelContextWindow,
                modelAutoCompactTokenLimit: defaultModelAutoCompactTokenLimit
            });
        },

        async runHealthCheck(options = {}) {
            this.healthCheckLoading = true;
            this.healthCheckResult = null;
            this.healthCheckBatchTotal = 0;
            this.healthCheckBatchDone = 0;
            this.healthCheckBatchFailed = 0;
            try {
                const silent = !!(options && options.silent);
                const forceRefresh = !!(options && options.forceRefresh);
                const res = await api('doctor', {
                    remote: true,
                    range: this.sessionsUsageTimeRange,
                    targetApp: this.skillsTargetApp,
                    includeUsage: true,
                    includeTasks: true,
                    includeSkills: true,
                    includeInstall: true,
                    forceRefresh
                });
                if (hasResponseError(res)) {
                    this.healthCheckResult = null;
                    if (!silent) {
                        this.showMessage(getResponseMessage(res, '检查失败'), 'error');
                    }
                } else if (res && typeof res === 'object') {
                    this.healthCheckResult = res;
                    const report = res.report && typeof res.report === 'object' ? res.report : null;
                    const summary = report && report.summary && typeof report.summary === 'object' ? report.summary : null;
                    const total = summary && Number.isFinite(Number(summary.total)) ? Math.max(0, Math.floor(Number(summary.total))) : (Array.isArray(res.issues) ? res.issues.length : 0);
                    const errors = summary && Number.isFinite(Number(summary.error)) ? Math.max(0, Math.floor(Number(summary.error))) : 0;
                    const warns = summary && Number.isFinite(Number(summary.warn)) ? Math.max(0, Math.floor(Number(summary.warn))) : 0;
                    this.healthCheckBatchTotal = total;
                    this.healthCheckBatchDone = total;
                    this.healthCheckBatchFailed = errors + warns;
                    if (!silent && res.ok) {
                        this.showMessage('检查通过', 'success');
                    }
                } else {
                    this.healthCheckResult = null;
                    if (!silent) {
                        this.showMessage('检查失败', 'error');
                    }
                }
            } catch (e) {
                this.healthCheckResult = null;
                if (!(options && options.silent)) {
                    this.showMessage('检查失败', 'error');
                }
            } finally {
                this.healthCheckBatchTotal = this.healthCheckBatchTotal || 0;
                this.healthCheckBatchDone = Math.min(this.healthCheckBatchDone || 0, this.healthCheckBatchTotal || 0);
                this.healthCheckLoading = false;
            }
        },

        escapeTomlString(value) {
            return String(value || '')
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"');
        },

        async openConfigTemplateEditor(options = {}) {
            this.resetConfigTemplateDiffState();
            const modelContextWindow = this.normalizePositiveIntegerInput(
                this.modelContextWindowInput,
                'model_context_window',
                defaultModelContextWindow
            );
            if (!modelContextWindow.ok) {
                this.showMessage(modelContextWindow.error, 'error');
                return;
            }
            const modelAutoCompactTokenLimit = this.normalizePositiveIntegerInput(
                this.modelAutoCompactTokenLimitInput,
                'model_auto_compact_token_limit',
                defaultModelAutoCompactTokenLimit
            );
            if (!modelAutoCompactTokenLimit.ok) {
                this.showMessage(modelAutoCompactTokenLimit.error, 'error');
                return;
            }
            try {
                const res = await api('get-config-template', {
                    provider: this.currentProvider,
                    model: this.currentModel,
                    serviceTier: this.serviceTier,
                    reasoningEffort: this.modelReasoningEffort,
                    modelContextWindow: modelContextWindow.value,
                    modelAutoCompactTokenLimit: modelAutoCompactTokenLimit.value
                });
                if (res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                let template = res.template || '';
                const appendHint = typeof options.appendHint === 'string' ? options.appendHint.trim() : '';
                const appendBlock = typeof options.appendBlock === 'string' ? options.appendBlock.trim() : '';
                if (appendHint) {
                    template = `${template.trimEnd()}\n\n# -------------------------------\n# ${appendHint}\n# -------------------------------\n`;
                }
                if (appendBlock) {
                    template = `${template.trimEnd()}\n\n${appendBlock}\n`;
                }
                this.configTemplateContent = template;
                this.showConfigTemplateModal = true;
            } catch (e) {
                this.showMessage('加载模板失败', 'error');
            }
        },

        async applyCodexConfigDirect(options = {}) {
            if (this.codexApplying) {
                this._pendingCodexApplyOptions = {
                    ...(this._pendingCodexApplyOptions || {}),
                    ...options
                };
                return;
            }

            const provider = (this.currentProvider || '').trim();
            const model = (this.currentModel || '').trim();
            if (!provider || !model) {
                this.showMessage('请选择提供商和模型', 'error');
                return;
            }

            const modelContextWindow = this.normalizePositiveIntegerInput(
                options.modelContextWindow !== undefined ? options.modelContextWindow : this.modelContextWindowInput,
                'model_context_window',
                defaultModelContextWindow
            );
            if (!modelContextWindow.ok) {
                this.showMessage(modelContextWindow.error, 'error');
                return;
            }
            const modelAutoCompactTokenLimit = this.normalizePositiveIntegerInput(
                options.modelAutoCompactTokenLimit !== undefined
                    ? options.modelAutoCompactTokenLimit
                    : this.modelAutoCompactTokenLimitInput,
                'model_auto_compact_token_limit',
                defaultModelAutoCompactTokenLimit
            );
            if (!modelAutoCompactTokenLimit.ok) {
                this.showMessage(modelAutoCompactTokenLimit.error, 'error');
                return;
            }
            this.modelContextWindowInput = modelContextWindow.text;
            this.modelAutoCompactTokenLimitInput = modelAutoCompactTokenLimit.text;

            this.codexApplying = true;
            try {
                const tplRes = await api('get-config-template', {
                    provider,
                    model,
                    serviceTier: this.serviceTier,
                    reasoningEffort: this.modelReasoningEffort,
                    modelContextWindow: modelContextWindow.value,
                    modelAutoCompactTokenLimit: modelAutoCompactTokenLimit.value
                });
                if (tplRes.error) {
                    this.showMessage(
                        (typeof tplRes.error === 'string' && tplRes.error.trim())
                        || (typeof tplRes.message === 'string' && tplRes.message.trim())
                        || (typeof tplRes.detail === 'string' && tplRes.detail.trim())
                        || '获取模板失败',
                        'error'
                    );
                    return;
                }

                const applyRes = await api('apply-config-template', {
                    template: tplRes.template
                });
                if (applyRes.error) {
                    this.showMessage(
                        (typeof applyRes.error === 'string' && applyRes.error.trim())
                        || (typeof applyRes.message === 'string' && applyRes.message.trim())
                        || (typeof applyRes.detail === 'string' && applyRes.detail.trim())
                        || '应用模板失败',
                        'error'
                    );
                    return;
                }

                if (options.silent !== true) {
                    this.showMessage('配置已应用', 'success');
                }

                const refreshOptions = options.silent === true
                    ? { preserveLoading: true }
                    : {};
                try {
                    await this.loadAll(refreshOptions);
                } catch (_) {
                    this.showMessage('配置已应用，但界面刷新失败，请手动刷新', 'error');
                }
            } catch (e) {
                this.showMessage('应用失败', 'error');
            } finally {
                this.codexApplying = false;
                const pendingOptions = this._pendingCodexApplyOptions;
                this._pendingCodexApplyOptions = null;
                if (pendingOptions) {
                    await this.applyCodexConfigDirect(pendingOptions);
                }
            }
        },

        closeConfigTemplateModal(options = {}) {
            const force = !!options.force;
            if (!force && (this.configTemplateApplying || this.configTemplateDiffLoading)) {
                return;
            }
            this.showConfigTemplateModal = false;
            this.configTemplateContent = '';
            this.resetConfigTemplateDiffState();
        },

        resetConfigTemplateDiffState() {
            this.configTemplateDiffVisible = false;
            this.configTemplateDiffLoading = false;
            this.configTemplateDiffError = '';
            this.configTemplateDiffLines = [];
            this.configTemplateDiffStats = { added: 0, removed: 0, unchanged: 0 };
            this.configTemplateDiffHasChangesValue = false;
            this.configTemplateDiffFingerprint = '';
            this._configTemplateDiffPreviewRequestToken = null;
        },

        onConfigTemplateContentInput() {
            if (this.configTemplateDiffVisible || (this.configTemplateDiffLines && this.configTemplateDiffLines.length)) {
                this.resetConfigTemplateDiffState();
            }
        },

        buildConfigTemplateDiffFingerprint() {
            const content = typeof this.configTemplateContent === 'string' ? this.configTemplateContent : '';
            return `${content.length}::${content}`;
        },

        hasConfigTemplateDiffChanges() {
            if (this.configTemplateDiffHasChangesValue !== undefined && this.configTemplateDiffHasChangesValue !== null) {
                return !!this.configTemplateDiffHasChangesValue;
            }
            const stats = this.configTemplateDiffStats && typeof this.configTemplateDiffStats === 'object'
                ? this.configTemplateDiffStats
                : {};
            const added = Number(stats.added || 0);
            const removed = Number(stats.removed || 0);
            return added > 0 || removed > 0;
        },

        async prepareConfigTemplateDiff() {
            const requestFingerprint = this.buildConfigTemplateDiffFingerprint();
            const requestToken = Symbol('config-template-diff-preview');
            this._configTemplateDiffPreviewRequestToken = requestToken;
            this.configTemplateDiffVisible = true;
            this.configTemplateDiffLoading = true;
            this.configTemplateDiffError = '';
            this.configTemplateDiffLines = [];
            this.configTemplateDiffStats = { added: 0, removed: 0, unchanged: 0 };
            this.configTemplateDiffHasChangesValue = false;
            try {
                const shouldApply = () => (
                    this.configTemplateDiffVisible
                    && this._configTemplateDiffPreviewRequestToken === requestToken
                    && this.buildConfigTemplateDiffFingerprint() === requestFingerprint
                );
                const res = await api('preview-config-template-diff', {
                    template: this.configTemplateContent
                });
                if (!shouldApply()) {
                    return;
                }
                if (res.error) {
                    this.configTemplateDiffError = res.error;
                    return;
                }
                const diff = res.diff && typeof res.diff === 'object' ? res.diff : {};
                const lines = Array.isArray(diff.lines) ? diff.lines : [];
                this.configTemplateDiffLines = lines.filter(line => line && line.type);
                const stats = diff.stats && typeof diff.stats === 'object' ? diff.stats : null;
                if (stats) {
                    this.configTemplateDiffStats = {
                        added: Number(stats.added || 0),
                        removed: Number(stats.removed || 0),
                        unchanged: Number(stats.unchanged || 0)
                    };
                } else {
                    const nextStats = { added: 0, removed: 0, unchanged: 0 };
                    for (const line of this.configTemplateDiffLines) {
                        if (line && line.type === 'add') nextStats.added += 1;
                        else if (line && line.type === 'del') nextStats.removed += 1;
                        else nextStats.unchanged += 1;
                    }
                    this.configTemplateDiffStats = nextStats;
                }
                this.configTemplateDiffHasChangesValue = !!diff.hasChanges;
                this.configTemplateDiffFingerprint = requestFingerprint;
            } catch (_) {
                if (this._configTemplateDiffPreviewRequestToken === requestToken) {
                    this.configTemplateDiffError = '生成差异失败';
                }
            } finally {
                if (this._configTemplateDiffPreviewRequestToken === requestToken) {
                    this.configTemplateDiffLoading = false;
                }
            }
        },

        async applyConfigTemplate() {
            if (this.configTemplateApplying) {
                return;
            }
            if (!this.configTemplateContent || !this.configTemplateContent.trim()) {
                this.showMessage('模板不能为空', 'error');
                return;
            }

            // Default to two-step confirmation when the setting is unset.
            // (The normalize helper lives in session-actions; keep a safe fallback here.)
            const shouldUseTwoStepConfirm = normalizeConfigTemplateDiffConfirmEnabled(this.configTemplateDiffConfirmEnabled);

            const performApply = async () => {
                this.configTemplateApplying = true;
                try {
                    const res = await api('apply-config-template', {
                        template: this.configTemplateContent
                    });
                    if (res.error) {
                        this.showMessage(res.error, 'error');
                        return;
                    }
                    this.showMessage('模板已应用', 'success');
                    this.closeConfigTemplateModal({ force: true });
                    try {
                        await this.loadAll();
                    } catch (_) {
                        this.showMessage('模板已应用，但界面刷新失败，请手动刷新', 'error');
                    }
                } catch (e) {
                    this.showMessage('应用模板失败', 'error');
                } finally {
                    this.configTemplateApplying = false;
                }
            };

            // One-step mode: apply immediately unless user explicitly entered the diff preview state.
            if (!shouldUseTwoStepConfirm && !this.configTemplateDiffVisible) {
                await performApply();
                return;
            }

            if (!this.configTemplateDiffVisible) {
                await this.prepareConfigTemplateDiff();
                return;
            }
            if (this.configTemplateDiffLoading) {
                return;
            }
            if (this.configTemplateDiffError) {
                this.showMessage(this.configTemplateDiffError, 'error');
                return;
            }
            const fingerprint = this.buildConfigTemplateDiffFingerprint();
            if (this.configTemplateDiffFingerprint !== fingerprint) {
                await this.prepareConfigTemplateDiff();
                return;
            }
            if (!this.hasConfigTemplateDiffChanges()) {
                this.showMessage('未检测到改动', 'info');
                return;
            }

            await performApply();
        }
    };
}
