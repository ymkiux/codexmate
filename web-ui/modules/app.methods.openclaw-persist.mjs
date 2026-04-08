const DEFAULT_OPENCLAW_CONFIG_NAME = '默认配置';

function buildNormalizedOpenclawConfigs(configs, defaultContent = '') {
    const source = configs && typeof configs === 'object' && !Array.isArray(configs)
        ? configs
        : {};
    const defaultEntry = source[DEFAULT_OPENCLAW_CONFIG_NAME]
        && typeof source[DEFAULT_OPENCLAW_CONFIG_NAME] === 'object'
        && !Array.isArray(source[DEFAULT_OPENCLAW_CONFIG_NAME])
            ? source[DEFAULT_OPENCLAW_CONFIG_NAME]
            : { content: defaultContent };
    const normalized = {
        [DEFAULT_OPENCLAW_CONFIG_NAME]: {
            content: typeof defaultEntry.content === 'string' ? defaultEntry.content : defaultContent
        }
    };
    for (const [name, value] of Object.entries(source)) {
        if (name === DEFAULT_OPENCLAW_CONFIG_NAME) continue;
        normalized[name] = value;
    }
    return normalized;
}

function syncDefaultOpenclawConfigState(vm, content, options = {}) {
    const nextContent = typeof content === 'string' ? content : '';
    vm.openclawConfigs = buildNormalizedOpenclawConfigs(vm.openclawConfigs, nextContent);
    vm.openclawConfigs[DEFAULT_OPENCLAW_CONFIG_NAME] = {
        content: nextContent
    };
    if (typeof options.path === 'string') {
        vm.openclawConfigPath = options.path;
    }
    if (typeof options.exists === 'boolean') {
        vm.openclawConfigExists = options.exists;
    }
    if (options.lineEnding === '\r\n' || options.lineEnding === '\n') {
        vm.openclawLineEnding = options.lineEnding;
    }
    if (!vm.currentOpenclawConfig || !Object.prototype.hasOwnProperty.call(vm.openclawConfigs, vm.currentOpenclawConfig)) {
        vm.currentOpenclawConfig = DEFAULT_OPENCLAW_CONFIG_NAME;
    }
    if (options.persist !== false && typeof vm.saveOpenclawConfigs === 'function') {
        vm.saveOpenclawConfigs();
    }
}

export function createOpenclawPersistMethods(options = {}) {
    const {
        api,
        defaultOpenclawTemplate = ''
    } = options;

    return {
        syncDefaultOpenclawConfigEntry(options = {}) {
            const silent = !!options.silent;
            return api('get-openclaw-config')
                .then((res) => {
                if (res && !res.error) {
                    this.openclawAuthProfilesByProvider = res && res.authProfilesByProvider && typeof res.authProfilesByProvider === 'object' && !Array.isArray(res.authProfilesByProvider)
                        ? res.authProfilesByProvider
                        : {};
                    const nextContent = res.exists && typeof res.content === 'string' && res.content.trim()
                        ? res.content
                        : defaultOpenclawTemplate;
                        syncDefaultOpenclawConfigState(this, nextContent, {
                            path: res.path || this.openclawConfigPath,
                            exists: !!res.exists,
                            lineEnding: res.lineEnding === '\r\n' ? '\r\n' : '\n',
                            persist: true
                        });
                    }
                    return res;
                })
                .catch((e) => {
                    if (!silent) {
                        this.showMessage('加载 OpenClaw 默认配置失败', 'error');
                    }
                    return { error: e && e.message ? e.message : String(e) };
                });
        },

        openOpenclawAddModal() {
            const modalToken = (Number(this.openclawModalLoadToken || 0) + 1);
            this.openclawModalLoadToken = modalToken;
            this.openclawEditorTitle = '添加 OpenClaw 配置';
            this.openclawEditing = {
                name: '',
                content: '',
                lockName: false
            };
            this.openclawConfigPath = '';
            this.openclawConfigExists = false;
            this.openclawLineEnding = '\n';
            this.showOpenclawConfigModal = true;
            void this.loadOpenclawConfigFromFile({
                silent: true,
                force: true,
                fallbackToTemplate: true,
                modalToken,
                expectedEditorContent: ''
            });
        },

        openOpenclawEditModal(name) {
            const existing = this.openclawConfigs[name];
            const isDefaultConfig = name === DEFAULT_OPENCLAW_CONFIG_NAME;
            const modalToken = (Number(this.openclawModalLoadToken || 0) + 1);
            this.openclawModalLoadToken = modalToken;
            this.openclawEditorTitle = `编辑 OpenClaw 配置: ${name}`;
            this.openclawEditing = {
                name,
                content: this.openclawHasContent(existing) ? existing.content : '',
                lockName: true
            };
            this.syncOpenclawStructuredFromText({ silent: true });
            this.showOpenclawConfigModal = true;
            void this.loadOpenclawConfigFromFile({
                silent: true,
                force: isDefaultConfig,
                fallbackToTemplate: isDefaultConfig,
                syncDefaultEntry: isDefaultConfig,
                modalToken,
                expectedEditorContent: this.openclawEditing.content
            });
        },

        closeOpenclawConfigModal(options = {}) {
            const force = !!options.force;
            if (!force && (this.openclawSaving || this.openclawApplying)) {
                return;
            }
            this.openclawModalLoadToken = Number(this.openclawModalLoadToken || 0) + 1;
            this.showOpenclawConfigModal = false;
            this.openclawEditing = { name: '', content: '', lockName: false };
            this.openclawSaving = false;
            this.openclawApplying = false;
            this.resetOpenclawStructured();
            this.resetOpenclawQuick();
        },

        async loadOpenclawConfigFromFile(options = {}) {
            const silent = !!options.silent;
            const force = !!options.force;
            const fallbackToTemplate = options.fallbackToTemplate !== false;
            const syncDefaultEntry = options.syncDefaultEntry === true
                || (this.openclawEditing && this.openclawEditing.lockName && this.openclawEditing.name === DEFAULT_OPENCLAW_CONFIG_NAME);
            const modalToken = Number(options.modalToken || this.openclawModalLoadToken || 0);
            const expectedEditorContent = typeof options.expectedEditorContent === 'string'
                ? options.expectedEditorContent
                : (typeof this.openclawEditing.content === 'string' ? this.openclawEditing.content : '');
            const requestSeq = (Number(this.openclawFileLoadRequestSeq || 0) + 1);
            this.openclawFileLoadRequestSeq = requestSeq;
            this.openclawFileLoading = true;
            try {
                const res = await api('get-openclaw-config');
                if (
                    requestSeq !== Number(this.openclawFileLoadRequestSeq || 0)
                    || modalToken !== Number(this.openclawModalLoadToken || 0)
                ) {
                    return;
                }
                if (res.error) {
                    if (!silent) {
                        this.showMessage(res.error, 'error');
                    }
                    return;
                }
                this.openclawConfigPath = res.path || '';
                this.openclawConfigExists = !!res.exists;
                this.openclawLineEnding = res.lineEnding === '\r\n' ? '\r\n' : '\n';
                this.openclawAuthProfilesByProvider = res && res.authProfilesByProvider && typeof res.authProfilesByProvider === 'object' && !Array.isArray(res.authProfilesByProvider)
                    ? res.authProfilesByProvider
                    : {};
                const hasContent = !!(res.content && res.content.trim());
                const currentContent = typeof this.openclawEditing.content === 'string'
                    ? this.openclawEditing.content
                    : '';
                const editorChangedSinceRequest = currentContent !== expectedEditorContent;
                const shouldOverride = force
                    ? (!currentContent.trim() || !editorChangedSinceRequest)
                    : (!currentContent || !currentContent.trim());
                const fallbackContent = fallbackToTemplate ? defaultOpenclawTemplate : '';
                const nextContent = hasContent ? res.content : fallbackContent;
                if (hasContent && shouldOverride) {
                    this.openclawEditing.content = res.content;
                } else if (!hasContent && shouldOverride && fallbackToTemplate) {
                    this.openclawEditing.content = defaultOpenclawTemplate;
                }
                if (syncDefaultEntry) {
                    syncDefaultOpenclawConfigState(this, nextContent, {
                        path: res.path || '',
                        exists: !!res.exists,
                        lineEnding: this.openclawLineEnding,
                        persist: true
                    });
                }
                this.syncOpenclawStructuredFromText({ silent: true });
                if (!silent) {
                    this.showMessage('加载完成', 'success');
                }
            } catch (e) {
                if (
                    requestSeq !== Number(this.openclawFileLoadRequestSeq || 0)
                    || modalToken !== Number(this.openclawModalLoadToken || 0)
                ) {
                    return;
                }
                if (!silent) {
                    this.showMessage('加载配置失败', 'error');
                }
            } finally {
                if (requestSeq === Number(this.openclawFileLoadRequestSeq || 0)) {
                    this.openclawFileLoading = false;
                }
            }
        },

        persistOpenclawConfig({ closeModal = true } = {}) {
            if (!this.openclawEditing.name || !this.openclawEditing.name.trim()) {
                this.showMessage('请输入名称', 'error');
                return '';
            }
            const name = this.openclawEditing.name.trim();
            if (!this.openclawEditing.lockName && this.openclawConfigs[name]) {
                this.showMessage('名称已存在', 'error');
                return '';
            }
            if (!this.openclawEditing.content || !this.openclawEditing.content.trim()) {
                this.showMessage('配置内容不能为空', 'error');
                return '';
            }

            const hadPreviousConfig = Object.prototype.hasOwnProperty.call(this.openclawConfigs, name);
            const previousConfig = hadPreviousConfig ? this.openclawConfigs[name] : undefined;
            const previousCurrentConfig = this.currentOpenclawConfig;
            this.openclawConfigs[name] = {
                content: this.openclawEditing.content
            };
            this.currentOpenclawConfig = name;
            if (this.saveOpenclawConfigs() === false) {
                if (hadPreviousConfig) {
                    this.openclawConfigs[name] = previousConfig;
                } else {
                    delete this.openclawConfigs[name];
                }
                this.currentOpenclawConfig = previousCurrentConfig;
                return '';
            }
            if (closeModal) {
                this.closeOpenclawConfigModal({ force: true });
            }
            return name;
        },

        async saveOpenclawConfig() {
            if (this.openclawSaving || this.openclawApplying) {
                return;
            }
            if (this.openclawEditing && this.openclawEditing.lockName && this.openclawEditing.name === DEFAULT_OPENCLAW_CONFIG_NAME) {
                this.showMessage('默认配置代表当前系统配置，请使用“保存并应用”', 'info');
                return;
            }
            this.openclawSaving = true;
            try {
                const name = this.persistOpenclawConfig();
                if (!name) return;
                this.showMessage('操作成功', 'success');
            } finally {
                this.openclawSaving = false;
            }
        },

        async saveAndApplyOpenclawConfig() {
            if (this.openclawSaving || this.openclawApplying) {
                return;
            }
            this.openclawApplying = true;
            try {
                const name = this.persistOpenclawConfig({ closeModal: false });
                if (!name) return;
                const config = this.openclawConfigs[name];
                const res = await api('apply-openclaw-config', {
                    content: config.content,
                    lineEnding: this.openclawLineEnding
                });
                if (res.error || res.success === false) {
                    this.showMessage(res.error || '应用配置失败', 'error');
                    return;
                }
                this.openclawConfigPath = res.targetPath || this.openclawConfigPath;
                this.openclawConfigExists = true;
                syncDefaultOpenclawConfigState(this, config.content, {
                    path: this.openclawConfigPath,
                    exists: true,
                    lineEnding: this.openclawLineEnding,
                    persist: true
                });
                const targetTip = res.targetPath ? `（${res.targetPath}）` : '';
                this.showMessage(`已保存并应用 OpenClaw 配置${targetTip}`, 'success');
                this.closeOpenclawConfigModal({ force: true });
            } catch (e) {
                this.showMessage('应用配置失败', 'error');
            } finally {
                this.openclawApplying = false;
            }
        },

        async deleteOpenclawConfig(name) {
            if (name === DEFAULT_OPENCLAW_CONFIG_NAME) {
                return this.showMessage('默认配置始终映射当前系统配置，不可删除', 'info');
            }
            if (Object.keys(this.openclawConfigs).length <= 1) {
                return this.showMessage('至少保留一项', 'error');
            }
            const confirmed = await this.requestConfirmDialog({
                title: '删除 OpenClaw 配置',
                message: `确定删除配置 "${name}"?`,
                confirmText: '删除',
                cancelText: '取消',
                danger: true
            });
            if (!confirmed) return;
            delete this.openclawConfigs[name];
            if (this.currentOpenclawConfig === name) {
                this.currentOpenclawConfig = Object.keys(this.openclawConfigs)[0];
            }
            this.saveOpenclawConfigs();
            this.showMessage('操作成功', 'success');
        },

        async applyOpenclawConfig(name) {
            this.currentOpenclawConfig = name;
            const config = this.openclawConfigs[name];
            if (!this.openclawHasContent(config)) {
                return this.showMessage('配置为空', 'error');
            }
            try {
                const res = await api('apply-openclaw-config', {
                    content: config.content,
                    lineEnding: this.openclawLineEnding
                });
                if (res.error || res.success === false) {
                    this.showMessage(res.error || '应用配置失败', 'error');
                } else {
                    this.openclawConfigPath = res.targetPath || this.openclawConfigPath;
                    this.openclawConfigExists = true;
                    syncDefaultOpenclawConfigState(this, config.content, {
                        path: this.openclawConfigPath,
                        exists: true,
                        lineEnding: this.openclawLineEnding,
                        persist: true
                    });
                    const targetTip = res.targetPath ? `（${res.targetPath}）` : '';
                    this.showMessage(`已应用 OpenClaw 配置: ${name}${targetTip}`, 'success');
                }
            } catch (_) {
                this.showMessage('应用配置失败', 'error');
            }
        }
    };
}
