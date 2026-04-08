const PROVIDER_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const RESERVED_LOCAL_PROVIDER_NAME = 'local';
const RESERVED_PROXY_PROVIDER_NAME = 'codexmate-proxy';

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeProviderUrl(value) {
    return normalizeText(value).replace(/\/+$/g, '');
}

function isValidHttpUrl(value) {
    if (!value) return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function isReservedProviderCreationNameInput(name) {
    const normalized = normalizeText(name).toLowerCase();
    return normalized === RESERVED_LOCAL_PROVIDER_NAME || normalized === RESERVED_PROXY_PROVIDER_NAME;
}

function isValidProviderNameInputValue(name) {
    return PROVIDER_NAME_PATTERN.test(normalizeText(name));
}

function isValidProviderUrlInputValue(url) {
    return isValidHttpUrl(normalizeProviderUrl(url));
}

function findProviderByName(list, name) {
    const target = normalizeText(name);
    if (!target) return null;
    return (Array.isArray(list) ? list : []).find((item) => item && normalizeText(item.name) === target) || null;
}

function normalizeProviderDraftState(target) {
    if (!target || typeof target !== 'object') return;
    if (typeof target.name === 'string') {
        target.name = target.name.trim();
    }
    if (typeof target.url === 'string') {
        target.url = normalizeProviderUrl(target.url);
    }
}

function getProviderValidationForContext(vm, mode = 'add') {
    const draft = mode === 'edit' ? vm.editingProvider : vm.newProvider;
    const editingName = mode === 'edit' ? normalizeText(draft && draft.name) : '';
    const name = normalizeText(draft && draft.name);
    const url = normalizeProviderUrl(draft && draft.url);
    const errors = {
        name: '',
        url: ''
    };

    if (mode === 'add') {
        if (!name) {
            errors.name = '名称不能为空';
        } else if (!isValidProviderNameInputValue(name)) {
            errors.name = '名称仅支持字母/数字/._-';
        } else if (isReservedProviderCreationNameInput(name)) {
            errors.name = name.toLowerCase() === RESERVED_LOCAL_PROVIDER_NAME
                ? 'local provider 为系统保留名称，不可新增'
                : 'codexmate-proxy 为保留名称，不可手动添加';
        } else if (findProviderByName(vm.providersList, name)) {
            errors.name = '名称已存在';
        }
    } else if (!editingName) {
        errors.name = '提供商名称不能为空';
    }

    if (!url) {
        errors.url = 'URL 必填';
    } else if (!isValidProviderUrlInputValue(url)) {
        errors.url = 'URL 仅支持 http/https';
    }

    return {
        mode,
        name,
        url,
        errors,
        ok: !errors.name && !errors.url
    };
}

function canSubmitProviderForContext(vm, mode = 'add') {
    if (mode === 'edit' && vm.editingProvider && (vm.editingProvider.readOnly || vm.editingProvider.nonEditable)) {
        return false;
    }
    return getProviderValidationForContext(vm, mode).ok;
}

export function createProvidersMethods(options = {}) {
    const { api } = options;

    return {
        normalizeProviderDraft(mode = 'add') {
            normalizeProviderDraftState(mode === 'edit' ? this.editingProvider : this.newProvider);
        },

        isReservedProviderCreationName(name) {
            return isReservedProviderCreationNameInput(name);
        },

        isValidProviderNameInput(name) {
            return isValidProviderNameInputValue(name);
        },

        isValidProviderUrlInput(url) {
            return isValidProviderUrlInputValue(url);
        },

        findProviderByName(name) {
            return findProviderByName(this.providersList, name);
        },

        getProviderValidation(mode = 'add') {
            return getProviderValidationForContext(this, mode);
        },

        providerFieldError(mode, fieldName) {
            const validation = getProviderValidationForContext(this, mode);
            return validation && validation.errors && typeof validation.errors[fieldName] === 'string'
                ? validation.errors[fieldName]
                : '';
        },

        canSubmitProvider(mode = 'add') {
            return canSubmitProviderForContext(this, mode);
        },

        async addProvider() {
            normalizeProviderDraftState(this.newProvider);
            const validation = getProviderValidationForContext(this, 'add');
            if (!validation.ok) {
                return this.showMessage(validation.errors.name || validation.errors.url || '名称和URL必填', 'error');
            }

            try {
                const res = await api('add-provider', {
                    name: validation.name,
                    url: validation.url,
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
            return normalized === RESERVED_LOCAL_PROVIDER_NAME;
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
                if (directName === RESERVED_LOCAL_PROVIDER_NAME) {
                    return true;
                }
                return !!providerOrName.nonDeletable;
            }
            const name = String(providerOrName).trim();
            if (!name) return false;
            const normalized = name.toLowerCase();
            if (normalized === RESERVED_LOCAL_PROVIDER_NAME) {
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
                url: normalizeProviderUrl(provider.url || ''),
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
            normalizeProviderDraftState(this.editingProvider);
            const validation = getProviderValidationForContext(this, 'edit');
            if (!validation.ok) {
                return this.showMessage(validation.errors.name || validation.errors.url || 'URL 必填', 'error');
            }

            const params = { name: validation.name, url: validation.url };
            if (typeof this.editingProvider.key === 'string' && this.editingProvider.key.trim()) {
                params.key = this.editingProvider.key;
            }
            try {
                const res = await api('update-provider', params);
                if (res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                this.closeEditModal();
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
