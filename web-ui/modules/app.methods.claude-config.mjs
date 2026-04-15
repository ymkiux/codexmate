export function createClaudeConfigMethods(options = {}) {
    const { api } = options;

    const normalizePresetDraft = (draft) => {
        const target = draft && typeof draft === 'object' ? draft : null;
        if (!target) return;
        const preset = typeof target.preset === 'string' ? target.preset.trim().toLowerCase() : '';
        const isBedrock = preset === 'aws-bedrock-aksk' || preset === 'aws-bedrock-api-key';

        if (isBedrock) {
            const region = (target.awsRegion || '').trim() || 'us-west-2';
            target.awsRegion = region;
            target.baseUrl = `https://bedrock-runtime.${region}.amazonaws.com`;
            if (!target.model || target.model.trim() === '' || target.model === 'glm-4.7') {
                target.model = 'global.anthropic.claude-opus-4-6-v1';
            }
            if (preset === 'aws-bedrock-aksk') {
                target.apiKey = '';
            }
            return;
        }

        if (!target.baseUrl || !target.baseUrl.trim()) {
            target.baseUrl = 'https://open.bigmodel.cn/api/anthropic';
        }
        if (!target.model || !target.model.trim()) {
            target.model = 'glm-4.7';
        }
    };

    return {
        switchClaudeConfig(name) {
            this.currentClaudeConfig = name;
            this.refreshClaudeModelContext();
        },

        onClaudeModelChange() {
            const name = this.currentClaudeConfig;
            if (!name) {
                this.showMessage('请先选择配置', 'error');
                return;
            }
            const model = (this.currentClaudeModel || '').trim();
            if (!model) {
                this.showMessage('请输入模型', 'error');
                return;
            }
            const existing = this.claudeConfigs[name] || {};
            this.currentClaudeModel = model;
            this.claudeConfigs[name] = this.mergeClaudeConfig(existing, { model });
            this.saveClaudeConfigs();
            this.updateClaudeModelsCurrent();
            {
                const config = this.claudeConfigs[name];
                const preset = typeof config.preset === 'string' ? config.preset.trim() : '';
                if (preset === 'aws-bedrock-aksk') {
                    if (!config.hasKey) {
                        this.showMessage('请先补全 AWS Region / Access Key / Secret Key', 'error');
                        return;
                    }
                } else if (!config.apiKey && !config.externalCredentialType) {
                    this.showMessage('请先配置 API Key', 'error');
                    return;
                }
            }
            this.applyClaudeConfig(name);
        },

        saveClaudeConfigs() {
            localStorage.setItem('claudeConfigs', JSON.stringify(this.claudeConfigs));
        },

        openEditConfigModal(name) {
            const config = this.claudeConfigs[name];
            this.editingConfig = {
                name: name,
                apiKey: config.apiKey || '',
                baseUrl: config.baseUrl || '',
                model: config.model || '',
                preset: config.preset || '',
                awsRegion: config.awsRegion || 'us-west-2',
                awsAccessKeyId: config.awsAccessKeyId || '',
                awsSecretAccessKey: config.awsSecretAccessKey || ''
            };
            this.showEditConfigModal = true;
        },

        updateConfig() {
            const name = this.editingConfig.name;
            this.claudeConfigs[name] = this.mergeClaudeConfig(this.claudeConfigs[name], this.editingConfig);
            this.saveClaudeConfigs();
            this.showMessage('操作成功', 'success');
            this.closeEditConfigModal();
            if (name === this.currentClaudeConfig) {
                this.refreshClaudeModelContext();
            }
        },

        closeEditConfigModal() {
            this.showEditConfigModal = false;
            this.editingConfig = {
                name: '',
                apiKey: '',
                baseUrl: '',
                model: '',
                preset: '',
                awsRegion: 'us-west-2',
                awsAccessKeyId: '',
                awsSecretAccessKey: ''
            };
        },

        async saveAndApplyConfig() {
            const name = this.editingConfig.name;
            normalizePresetDraft(this.editingConfig);
            this.claudeConfigs[name] = this.mergeClaudeConfig(this.claudeConfigs[name], this.editingConfig);
            this.saveClaudeConfigs();

            const config = this.claudeConfigs[name];
            if (!config.apiKey && config.preset !== 'aws-bedrock-aksk') {
                this.showMessage('已保存，未应用', 'info');
                this.closeEditConfigModal();
                if (name === this.currentClaudeConfig) {
                    this.refreshClaudeModelContext();
                }
                return;
            }
            if (config.preset === 'aws-bedrock-aksk' && !config.hasKey) {
                this.showMessage('请先补全 AWS Region / Access Key / Secret Key', 'error');
                return;
            }

            try {
                const res = await api('apply-claude-config', { config });
                if (res.error || res.success === false) {
                    this.showMessage(res.error || '应用配置失败', 'error');
                } else {
                    this.currentClaudeConfig = name;
                    const targetTip = res.targetPath ? `（${res.targetPath}）` : '';
                    this.showMessage(`已保存并应用到 Claude 配置${targetTip}`, 'success');
                    this.closeEditConfigModal();
                    this.refreshClaudeModelContext();
                }
            } catch (_) {
                this.showMessage('应用配置失败', 'error');
            }
        },

        addClaudeConfig() {
            if (!this.newClaudeConfig.name || !this.newClaudeConfig.name.trim()) {
                return this.showMessage('请输入名称', 'error');
            }
            const name = this.newClaudeConfig.name.trim();
            if (this.claudeConfigs[name]) {
                return this.showMessage('名称已存在', 'error');
            }
            normalizePresetDraft(this.newClaudeConfig);
            const duplicateName = this.findDuplicateClaudeConfigName(this.newClaudeConfig);
            if (duplicateName) {
                return this.showMessage('配置已存在', 'info');
            }

            this.claudeConfigs[name] = this.mergeClaudeConfig({}, this.newClaudeConfig);

            this.currentClaudeConfig = name;
            this.saveClaudeConfigs();
            this.showMessage('操作成功', 'success');
            this.closeClaudeConfigModal();
            this.refreshClaudeModelContext();
        },

        async deleteClaudeConfig(name) {
            if (Object.keys(this.claudeConfigs).length <= 1) {
                return this.showMessage('至少保留一项', 'error');
            }
            const confirmed = await this.requestConfirmDialog({
                title: '删除 Claude 配置',
                message: `确定删除配置 "${name}"?`,
                confirmText: '删除',
                cancelText: '取消',
                danger: true
            });
            if (!confirmed) return;

            delete this.claudeConfigs[name];
            if (this.currentClaudeConfig === name) {
                this.currentClaudeConfig = Object.keys(this.claudeConfigs)[0];
            }
            this.saveClaudeConfigs();
            this.showMessage('操作成功', 'success');
            this.refreshClaudeModelContext();
        },

        async applyClaudeConfig(name) {
            this.currentClaudeConfig = name;
            this.refreshClaudeModelContext();
            const config = this.claudeConfigs[name];

            if (config.preset === 'aws-bedrock-aksk' && !config.hasKey) {
                return this.showMessage('请先补全 AWS Region / Access Key / Secret Key', 'error');
            }
            if (!config.apiKey && config.preset !== 'aws-bedrock-aksk') {
                if (config.externalCredentialType) {
                    return this.showMessage('检测到外部 Claude 认证状态；当前仅支持展示，若需由 codexmate 接管请补充 API Key', 'info');
                }
                return this.showMessage('请先配置 API Key', 'error');
            }

            try {
                const res = await api('apply-claude-config', { config });
                if (res.error || res.success === false) {
                    this.showMessage(res.error || '应用配置失败', 'error');
                } else {
                    const targetTip = res.targetPath ? `（${res.targetPath}）` : '';
                    this.showMessage(`已应用配置到 Claude 设置: ${name}${targetTip}`, 'success');
                }
            } catch (_) {
                this.showMessage('应用配置失败', 'error');
            }
        },

        closeClaudeConfigModal() {
            this.showClaudeConfigModal = false;
            this.newClaudeConfig = {
                name: '',
                apiKey: '',
                baseUrl: 'https://open.bigmodel.cn/api/anthropic',
                model: 'glm-4.7',
                preset: '',
                awsRegion: 'us-west-2',
                awsAccessKeyId: '',
                awsSecretAccessKey: ''
            };
        }
    };
}
