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

function sanitizeHealthCheckDetail(detail) {
    const text = String(detail || '').trim();
    if (!text) return '';
    const clipped = text.length > 1600 ? `${text.slice(0, 1600)}...` : text;
    const scrubbed = clipped
        .replace(/(?:[A-Za-z]:\\|\/)[^\s:]+(?:[\\/][^\s:]+)+(?=:\d+)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return scrubbed;
}

function formatHealthCheckErrorMessage(raw, t, lang) {
    const detail = sanitizeHealthCheckDetail(raw);
    const lower = detail.toLowerCase();
    const isEn = typeof lang === 'string' && lang.trim().toLowerCase() === 'en';
    const pick = (key, fallbackZh, fallbackEn) => (typeof t === 'function'
        ? t(key)
        : (isEn ? fallbackEn : fallbackZh));
    if (!detail) {
        return { message: pick('modal.healthCheck.error.unknown', '请求失败：请检查 endpoint、网络与鉴权配置。', 'Request failed. Check endpoint, network, and auth settings.'), detail: '' };
    }
    if (/handshake|sslv3|ssl routines|eproto/.test(lower)) {
        return { message: pick('modal.healthCheck.error.handshake', 'TLS 握手失败：请检查 endpoint 是否支持 HTTPS、证书/协议是否兼容。', 'TLS handshake failed. Check endpoint HTTPS support and certificate/protocol compatibility.'), detail };
    }
    if (/self signed|unable to verify|certificate|cert_|tls/.test(lower)) {
        return { message: pick('modal.healthCheck.error.cert', 'TLS 证书校验失败：可能为自签名证书或证书链不完整。', 'TLS certificate validation failed. The certificate may be self-signed or incomplete.'), detail };
    }
    if (/enotfound|eai_again|dns/.test(lower)) {
        return { message: pick('modal.healthCheck.error.dns', 'DNS 解析失败：请检查域名与网络环境。', 'DNS lookup failed. Check the hostname and network.'), detail };
    }
    if (/econnrefused|refused/.test(lower)) {
        return { message: pick('modal.healthCheck.error.refused', '连接被拒绝：请检查端口是否开放或服务是否在运行。', 'Connection refused. Check whether the service/port is reachable.'), detail };
    }
    if (/timeout|timed out|etimedout/.test(lower)) {
        return { message: pick('modal.healthCheck.error.timeout', '连接超时：请检查网络或 endpoint 是否可达。', 'Request timed out. Check network connectivity or endpoint availability.'), detail };
    }
    return { message: pick('modal.healthCheck.error.unknown', '请求失败：请检查 endpoint、网络与鉴权配置。', 'Request failed. Check endpoint, network, and auth settings.'), detail };
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

        async runHealthCheck() {
            this.healthCheckLoading = true;
            this.healthCheckResult = null;
            let shouldRunClaudeSpeedTests = false;
            try {
                const res = await api('config-health-check', {
                    remote: this.configMode === 'codex'
                });
                if (hasResponseError(res)) {
                    this.healthCheckResult = null;
                    this.showMessage(getResponseMessage(res, '检查失败'), 'error');
                } else if (res && typeof res === 'object') {
                    shouldRunClaudeSpeedTests = true;
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
                        if (remote && typeof remote === 'object') {
                            remote = {
                                ...remote,
                                speedTests: results
                            };
                        } else {
                            remote = {
                                type: 'speed-test',
                                speedTests: results
                            };
                        }
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
                if (shouldRunClaudeSpeedTests && this.configMode === 'claude') {
                    try {
                        const entries = Object.entries(this.claudeConfigs || {});
                        await Promise.all(entries.map(([name, config]) => this.runClaudeSpeedTest(name, config)));
                    } catch (e) {}
                }
                this.healthCheckLoading = false;
            }
        },

        buildDefaultHealthCheckPrompt() {
            return '请简短回复：连接正常。';
        },

        openHealthCheckDialog(options = {}) {
            const providerName = typeof options.providerName === 'string'
                ? options.providerName.trim()
                : '';
            const locked = !!options.locked && !!providerName;
            if (locked && providerName && providerName !== String(this.currentProvider || '').trim()) {
                if (typeof this.showMessage === 'function') {
                    this.showMessage('请先切换到该提供商再进行健康聊天测试', 'info');
                }
                return;
            }
            const nextProvider = providerName
                || String(this.healthCheckDialogSelectedProvider || '').trim()
                || String(this.currentProvider || '').trim()
                || String(((this.displayProvidersList || [])[0] || {}).name || '').trim();

            this.showHealthCheckDialog = true;
            this.healthCheckDialogLockedProvider = locked ? nextProvider : '';
            this.healthCheckDialogSelectedProvider = nextProvider;
            this.healthCheckDialogPrompt = this.buildDefaultHealthCheckPrompt();
            this.healthCheckDialogMessages = [];
            this.healthCheckDialogLastResult = null;
        },

        closeHealthCheckDialog(options = {}) {
            if (this.healthCheckDialogSending && !options.force) {
                return;
            }
            this.showHealthCheckDialog = false;
            this.healthCheckDialogLockedProvider = '';
            this.healthCheckDialogSelectedProvider = '';
            this.healthCheckDialogPrompt = this.buildDefaultHealthCheckPrompt();
            this.healthCheckDialogMessages = [];
            this.healthCheckDialogLastResult = null;
        },

        async sendHealthCheckDialogMessage() {
            if (this.healthCheckDialogSending) {
                return;
            }

            const provider = String(
                this.healthCheckDialogLockedProvider || this.healthCheckDialogSelectedProvider || ''
            ).trim();
            const prompt = String(this.healthCheckDialogPrompt || '').trim();
            if (!provider) {
                this.showMessage('请先选择提供商', 'error');
                return;
            }
            if (!prompt) {
                this.showMessage('请输入消息内容', 'error');
                return;
            }

            this.healthCheckDialogMessages.push({
                id: `user-${Date.now()}`,
                role: 'user',
                text: prompt
            });
            this.healthCheckDialogSending = true;
            this.healthCheckDialogLastResult = null;

            try {
                const res = await api('provider-chat-check', {
                    name: provider,
                    prompt,
                    timeoutMs: 10000
                });
                this.healthCheckDialogLastResult = res;

                if (hasResponseError(res) || res.ok === false) {
                    const rawMessage = getResponseMessage(res, '健康聊天测试失败');
                    const formatted = formatHealthCheckErrorMessage(rawMessage, this.t, this.lang);
                    const message = formatted.message || rawMessage;
                    this.healthCheckDialogMessages.push({
                        id: `assistant-${Date.now()}`,
                        role: 'assistant',
                        text: message,
                        ok: false,
                        status: Number.isFinite(res && res.status) ? res.status : 0,
                        durationMs: Number.isFinite(res && res.durationMs) ? res.durationMs : 0,
                        model: typeof (res && res.model) === 'string' ? res.model : '',
                        rawPreview: formatted.detail || (typeof (res && res.rawPreview) === 'string' ? res.rawPreview : '')
                    });
                    this.showMessage(message, 'error');
                    return;
                }

                const reply = typeof res.reply === 'string' && res.reply.trim()
                    ? res.reply.trim()
                    : '已收到回复，但未解析到可展示文本。';
                this.healthCheckDialogMessages.push({
                    id: `assistant-${Date.now()}`,
                    role: 'assistant',
                    text: reply,
                    ok: true,
                    status: Number.isFinite(res.status) ? res.status : 0,
                    durationMs: Number.isFinite(res.durationMs) ? res.durationMs : 0,
                    model: typeof res.model === 'string' ? res.model : '',
                    rawPreview: typeof res.rawPreview === 'string' ? res.rawPreview : ''
                });
                this.healthCheckDialogPrompt = '';
            } catch (e) {
                const rawMessage = e && e.message ? e.message : '健康聊天测试失败';
                const formatted = formatHealthCheckErrorMessage(rawMessage, this.t, this.lang);
                const message = formatted.message || rawMessage;
                this.healthCheckDialogMessages.push({
                    id: `assistant-${Date.now()}`,
                    role: 'assistant',
                    text: message,
                    ok: false,
                    status: 0,
                    durationMs: 0,
                    model: '',
                    rawPreview: formatted.detail
                });
                this.healthCheckDialogLastResult = { ok: false, error: message };
                this.showMessage(message, 'error');
            } finally {
                this.healthCheckDialogSending = false;
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
