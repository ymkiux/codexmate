import { runLatestOnlyQueue } from '../logic.mjs';

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
            this.currentProvider = name;
            await this.loadModelsForProvider(name);
            if (this.modelsSource === 'error') {
                return;
            }
            if (this.modelsSource === 'remote' && this.models.length > 0 && !this.models.includes(this.currentModel)) {
                this.currentModel = this.models[0];
                this.modelsHasCurrent = true;
            }
            if (getProviderConfigModeMeta(this.configMode)) {
                await this.waitForCodexApplyIdle();
                await this.applyCodexConfigDirect({ silent: true });
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
                : String(value ?? '').trim();
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

        async runHealthCheck() {
            this.healthCheckLoading = true;
            this.healthCheckResult = null;
            try {
                const res = await api('config-health-check', {
                    remote: false
                });
                if (res && typeof res === 'object') {
                    const issues = Array.isArray(res.issues) ? [...res.issues] : [];
                    let remote = res.remote || null;
                    {
                        const providers = (this.providersList || [])
                            .map((provider) => typeof provider === 'string'
                                ? provider.trim()
                                : String((provider && provider.name) || '').trim())
                            .filter(Boolean);
                        const tasks = providers.map(provider =>
                            this.runSpeedTest(provider, { silent: true })
                                .then(result => ({ name: provider, result }))
                                .catch(err => ({
                                    name: provider,
                                    result: { ok: false, error: err && err.message ? err.message : 'Speed test failed' }
                                }))
                        );
                        const pairs = await Promise.all(tasks);
                        const results = {};
                        for (const pair of pairs) {
                            results[pair.name] = pair.result || null;
                            const issue = this.buildSpeedTestIssue(pair.name, pair.result);
                            if (issue) issues.push(issue);
                        }
                        remote = {
                            type: 'speed-test',
                            results
                        };
                    }

                    const ok = issues.length === 0;
                    this.healthCheckResult = {
                        ...res,
                        ok,
                        issues,
                        remote
                    };
                    if (ok) {
                        this.showMessage('检查通过', 'success');
                    }
                } else {
                    this.healthCheckResult = null;
                    this.showMessage('检查失败', 'error');
                }
            } catch (e) {
                this.healthCheckResult = null;
                this.showMessage('检查失败', 'error');
            } finally {
                if (this.configMode === 'claude') {
                    try {
                        const entries = Object.entries(this.claudeConfigs || {});
                        await Promise.all(entries.map(([name, config]) => this.runClaudeSpeedTest(name, config)));
                    } catch (e) {}
                }
                this.healthCheckLoading = false;
            }
        },

        escapeTomlString(value) {
            return String(value || '')
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"');
        },

        async openConfigTemplateEditor(options = {}) {
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
                await this.loadAll(refreshOptions);
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

        closeConfigTemplateModal() {
            this.showConfigTemplateModal = false;
            this.configTemplateContent = '';
        },

        async applyConfigTemplate() {
            if (!this.configTemplateContent || !this.configTemplateContent.trim()) {
                this.showMessage('模板不能为空', 'error');
                return;
            }

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
                this.closeConfigTemplateModal();
                await this.loadAll();
            } catch (e) {
                this.showMessage('应用模板失败', 'error');
            } finally {
                this.configTemplateApplying = false;
            }
        }
    };
}
