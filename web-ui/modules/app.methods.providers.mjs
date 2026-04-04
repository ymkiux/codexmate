export function createProvidersMethods(options = {}) {
    const { api } = options;

    return {
        async addProvider() {
            const rawName = typeof this.newProvider.name === 'string' ? this.newProvider.name : '';
            const rawUrl = typeof this.newProvider.url === 'string' ? this.newProvider.url.trim() : '';
            if (!rawName || !rawUrl) {
                return this.showMessage('名称和URL必填', 'error');
            }
            const name = rawName.trim();
            if (!name) {
                return this.showMessage('名称不能为空', 'error');
            }
            if (name.toLowerCase() === 'local') {
                return this.showMessage('local provider 为系统保留名称，不可新增', 'error');
            }
            if (this.providersList.some(item => item.name === name)) {
                return this.showMessage('名称已存在', 'error');
            }

            try {
                const res = await api('add-provider', {
                    name,
                    url: rawUrl,
                    key: this.newProvider.key || ''
                });
                if (res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }

                this.showMessage('操作成功', 'success');
                this.closeAddModal();
                await this.loadAll();
            } catch (e) {
                this.showMessage('添加失败', 'error');
            }
        },

        getCurrentCodexAuthProfile() {
            const list = Array.isArray(this.codexAuthProfiles) ? this.codexAuthProfiles : [];
            return list.find((item) => !!(item && item.current)) || null;
        },

        isLocalLikeProvider(providerOrName) {
            if (!providerOrName) return false;
            const rawName = typeof providerOrName === 'object'
                ? String(providerOrName.name || '')
                : String(providerOrName);
            const normalized = rawName.trim().toLowerCase();
            return normalized === 'local';
        },

        providerPillState(provider) {
            if (this.isLocalLikeProvider(provider)) {
                const currentProfile = this.getCurrentCodexAuthProfile();
                return currentProfile
                    ? { configured: true, text: '已登录' }
                    : { configured: false, text: '未登录' };
            }
            const configured = !!(provider && provider.hasKey);
            return {
                configured,
                text: configured ? '已配置' : '未配置'
            };
        },

        providerPillConfigured(provider) {
            return this.providerPillState(provider).configured;
        },

        providerPillText(provider) {
            return this.providerPillState(provider).text;
        },

        isReadOnlyProvider(providerOrName) {
            if (!providerOrName) return false;
            if (typeof providerOrName === 'object') {
                return !!providerOrName.readOnly;
            }
            const name = String(providerOrName).trim();
            if (!name) return false;
            const target = (this.providersList || []).find((item) => item && item.name === name);
            return !!(target && target.readOnly);
        },

        isNonDeletableProvider(providerOrName) {
            if (!providerOrName) return false;
            if (typeof providerOrName === 'object') {
                const directName = String(providerOrName.name || '').trim().toLowerCase();
                if (directName === 'local') {
                    return true;
                }
                return !!providerOrName.nonDeletable;
            }
            const name = String(providerOrName).trim();
            if (!name) return false;
            const normalized = name.toLowerCase();
            if (normalized === 'local') {
                return true;
            }
            const target = (this.providersList || []).find((item) => item && item.name === name);
            return !!(target && target.nonDeletable);
        },

        shouldShowProviderDelete(provider) {
            return !this.isReadOnlyProvider(provider) && !this.isNonDeletableProvider(provider);
        },

        shouldShowProviderEdit(provider) {
            return !this.isReadOnlyProvider(provider) && !this.isNonDeletableProvider(provider);
        },

        shouldAllowProviderShare(provider) {
            return !this.isReadOnlyProvider(provider) && !this.isLocalLikeProvider(provider);
        },

        async deleteProvider(name) {
            if (this.isNonDeletableProvider(name)) {
                this.showMessage('该 provider 为保留项，不可删除', 'info');
                return;
            }
            try {
                const res = await api('delete-provider', { name });
                if (res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                if (res.switched && res.provider) {
                    this.showMessage(`已删除提供商，自动切换到 ${res.provider}${res.model ? ` / ${res.model}` : ''}`, 'success');
                } else {
                    this.showMessage('操作成功', 'success');
                }
                await this.loadAll();
            } catch (_) {
                this.showMessage('删除失败', 'error');
            }
        },

        openEditModal(provider) {
            if (!this.shouldShowProviderEdit(provider)) {
                this.showMessage('该 provider 为保留项，不可编辑', 'info');
                return;
            }
            this.editingProvider = {
                name: provider.name,
                url: provider.url || '',
                key: '',
                readOnly: !!provider.readOnly,
                nonEditable: this.isNonDeletableProvider(provider)
            };
            this.showEditModal = true;
        },

        async updateProvider() {
            if (this.editingProvider.readOnly || this.editingProvider.nonEditable) {
                this.showMessage('该 provider 为保留项，不可编辑', 'error');
                this.closeEditModal();
                return;
            }
            const url = typeof this.editingProvider.url === 'string' ? this.editingProvider.url.trim() : '';
            if (!url) {
                return this.showMessage('URL 必填', 'error');
            }

            const name = this.editingProvider.name;
            const params = { name, url };
            if (typeof this.editingProvider.key === 'string' && this.editingProvider.key.trim()) {
                params.key = this.editingProvider.key;
            }
            this.closeEditModal();
            try {
                const res = await api('update-provider', params);
                if (res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                this.showMessage('操作成功', 'success');
                await this.loadAll();
            } catch (e) {
                this.showMessage('更新失败', 'error');
            }
        },

        closeEditModal() {
            this.showEditModal = false;
            this.editingProvider = { name: '', url: '', key: '', readOnly: false, nonEditable: false };
        },

        async resetConfig() {
            if (this.resetConfigLoading) return;
            this.resetConfigLoading = true;
            try {
                const res = await api('reset-config');
                if (res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                const backup = res.backupFile ? `（已备份: ${res.backupFile}）` : '';
                this.showMessage(`配置已重装${backup}`, 'success');
                await this.loadAll();
            } catch (e) {
                this.showMessage('重装失败', 'error');
            } finally {
                this.resetConfigLoading = false;
            }
        },

        async addModel() {
            if (!this.newModelName || !this.newModelName.trim()) {
                return this.showMessage('请输入模型', 'error');
            }
            try {
                const res = await api('add-model', { model: this.newModelName.trim() });
                if (res.error) {
                    this.showMessage(res.error, 'error');
                } else {
                    this.showMessage('操作成功', 'success');
                    this.closeModelModal();
                    await this.loadAll();
                }
            } catch (_) {
                this.showMessage('新增模型失败', 'error');
            }
        },

        async removeModel(model) {
            try {
                const res = await api('delete-model', { model });
                if (res.error) {
                    this.showMessage(res.error, 'error');
                } else {
                    this.showMessage('操作成功', 'success');
                    await this.loadAll();
                }
            } catch (_) {
                this.showMessage('删除模型失败', 'error');
            }
        },

        closeAddModal() {
            this.showAddModal = false;
            this.newProvider = { name: '', url: '', key: '' };
        },

        closeModelModal() {
            this.showModelModal = false;
            this.newModelName = '';
        },

        formatKey(key) {
            if (!key) return '(未设置)';
            if (key.length > 10) {
                return key.substring(0, 3) + '****' + key.substring(key.length - 3);
            }
            return '****';
        },

        displayApiKey(configName) {
            const key = this.claudeConfigs[configName]?.apiKey;
            return this.formatKey(key);
        }
    };
}
