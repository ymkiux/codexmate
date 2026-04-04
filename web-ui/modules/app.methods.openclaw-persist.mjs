export function createOpenclawPersistMethods(options = {}) {
    const {
        api,
        defaultOpenclawTemplate = ''
    } = options;

    return {
        openOpenclawAddModal() {
            this.openclawEditorTitle = '添加 OpenClaw 配置';
            this.openclawEditing = {
                name: '',
                content: '',
                lockName: false
            };
            this.openclawConfigPath = '';
            this.openclawConfigExists = false;
            this.openclawLineEnding = '\n';
            void this.loadOpenclawConfigFromFile({ silent: true, force: true, fallbackToTemplate: true });
            this.showOpenclawConfigModal = true;
        },

        openOpenclawEditModal(name) {
            this.openclawEditorTitle = `编辑 OpenClaw 配置: ${name}`;
            this.openclawEditing = {
                name,
                content: '',
                lockName: true
            };
            void this.loadOpenclawConfigFromFile({ silent: true, force: true, fallbackToTemplate: true });
            this.showOpenclawConfigModal = true;
        },

        closeOpenclawConfigModal() {
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
            this.openclawFileLoading = true;
            try {
                const res = await api('get-openclaw-config');
                if (res.error) {
                    if (!silent) {
                        this.showMessage(res.error, 'error');
                    }
                    return;
                }
                this.openclawConfigPath = res.path || '';
                this.openclawConfigExists = !!res.exists;
                this.openclawLineEnding = res.lineEnding === '\r\n' ? '\r\n' : '\n';
                const hasContent = !!(res.content && res.content.trim());
                const shouldOverride = force || !this.openclawEditing.content || !this.openclawEditing.content.trim();
                if (hasContent && shouldOverride) {
                    this.openclawEditing.content = res.content;
                } else if (!hasContent && shouldOverride && fallbackToTemplate) {
                    this.openclawEditing.content = defaultOpenclawTemplate;
                }
                this.syncOpenclawStructuredFromText({ silent: true });
                if (!silent) {
                    this.showMessage('加载完成', 'success');
                }
            } catch (e) {
                if (!silent) {
                    this.showMessage('加载配置失败', 'error');
                }
            } finally {
                this.openclawFileLoading = false;
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

            this.openclawConfigs[name] = {
                content: this.openclawEditing.content
            };
            this.currentOpenclawConfig = name;
            this.saveOpenclawConfigs();
            if (closeModal) {
                this.closeOpenclawConfigModal();
            }
            return name;
        },

        async saveOpenclawConfig() {
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
                const targetTip = res.targetPath ? `（${res.targetPath}）` : '';
                this.showMessage(`已保存并应用 OpenClaw 配置${targetTip}`, 'success');
                this.closeOpenclawConfigModal();
            } catch (e) {
                this.showMessage('应用配置失败', 'error');
            } finally {
                this.openclawApplying = false;
            }
        },

        async deleteOpenclawConfig(name) {
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
            const res = await api('apply-openclaw-config', {
                content: config.content,
                lineEnding: this.openclawLineEnding
            });
            if (res.error || res.success === false) {
                this.showMessage(res.error || '应用配置失败', 'error');
            } else {
                this.openclawConfigPath = res.targetPath || this.openclawConfigPath;
                this.openclawConfigExists = true;
                const targetTip = res.targetPath ? `（${res.targetPath}）` : '';
                this.showMessage(`已应用 OpenClaw 配置: ${name}${targetTip}`, 'success');
            }
        }
    };
}
