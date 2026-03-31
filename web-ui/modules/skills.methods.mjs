function createUnsupportedSkillsTargetAppError(app) {
    return new Error(`Unsupported skills target app: ${String(app)}`);
}

function showUnsupportedSkillsTargetMessage(vm, app) {
    vm.showMessage(`不支持的 Skills 安装目标：${String(app)}`, 'error');
}

export function createSkillsMethods({ api }) {
    return {
        normalizeSkillsTargetApp(app) {
            if (app == null) {
                return 'codex';
            }
            if (app === 'codex' || app === 'claude') {
                return app;
            }
            throw createUnsupportedSkillsTargetAppError(app);
        },

        resetSkillsTargetState() {
            this.skillsSelectedNames = [];
            this.skillsKeyword = '';
            this.skillsStatusFilter = 'all';
            this.skillsRootPath = '';
            this.skillsList = [];
            this.skillsImportList = [];
            this.skillsImportSelectedKeys = [];
            this.skillsMarketLocalLoadedOnce = false;
            this.skillsMarketImportLoadedOnce = false;
        },

        async setSkillsTargetApp(app, options = {}) {
            if (
                this.skillsLoading
                || this.skillsDeleting
                || this.skillsScanningImports
                || this.skillsImporting
                || this.skillsZipImporting
                || this.skillsExporting
                || this.skillsMarketLoading
            ) {
                return false;
            }
            let nextTarget;
            try {
                nextTarget = this.normalizeSkillsTargetApp(app);
            } catch (error) {
                showUnsupportedSkillsTargetMessage(this, app);
                return false;
            }
            const refresh = !(options && options.refresh === false);
            const silent = !!(options && options.silent);
            if (nextTarget !== this.skillsTargetApp) {
                this.skillsTargetApp = nextTarget;
                this.resetSkillsTargetState();
            }
            if (!refresh) {
                return true;
            }
            return await this.loadSkillsMarketOverview({
                forceRefresh: true,
                silent
            });
        },

        async openSkillsManager(options = {}) {
            let targetApp;
            try {
                targetApp = this.normalizeSkillsTargetApp(options && options.targetApp ? options.targetApp : this.skillsTargetApp);
            } catch (error) {
                showUnsupportedSkillsTargetMessage(this, options && options.targetApp);
                return false;
            }
            const targetChanged = targetApp !== this.skillsTargetApp;
            if (targetChanged) {
                this.skillsTargetApp = targetApp;
                this.resetSkillsTargetState();
            } else {
                this.skillsSelectedNames = [];
                this.skillsKeyword = '';
                this.skillsStatusFilter = 'all';
                this.skillsImportSelectedKeys = [];
            }
            this.showSkillsModal = true;
            await this.refreshSkillsList({ silent: false });
        },

        closeSkillsModal() {
            const busy = !!(
                this.skillsLoading
                || this.skillsDeleting
                || this.skillsScanningImports
                || this.skillsImporting
                || this.skillsZipImporting
                || this.skillsExporting
            );
            if (busy) return;
            this.showSkillsModal = false;
            this.skillsSelectedNames = [];
            this.skillsImportSelectedKeys = [];
        },

        async refreshSkillsList(options = {}) {
            this.skillsLoading = true;
            try {
                const res = await api('list-skills', {
                    targetApp: this.skillsTargetApp
                });
                if (res.error) {
                    this.skillsRootPath = '';
                    this.skillsList = [];
                    this.skillsSelectedNames = [];
                    this.showMessage(res.error, 'error');
                    return false;
                }
                const exists = res.exists !== false;
                if (!exists) {
                    this.skillsRootPath = res.root || '';
                    this.skillsList = [];
                    this.skillsSelectedNames = [];
                    if (!options.silent) {
                        this.showMessage(`${this.skillsTargetLabel} skills 目录不存在，已按空列表显示`, 'info');
                    }
                    return true;
                }
                this.skillsRootPath = res.root || '';
                this.skillsList = Array.isArray(res.items) ? res.items : [];
                const currentNames = new Set((Array.isArray(this.skillsList) ? this.skillsList : [])
                    .map((item) => (item && typeof item.name === 'string' ? item.name.trim() : ''))
                    .filter(Boolean));
                this.skillsSelectedNames = (Array.isArray(this.skillsSelectedNames) ? this.skillsSelectedNames : [])
                    .filter((name) => currentNames.has(name));
                return true;
            } catch (e) {
                this.skillsRootPath = '';
                this.skillsList = [];
                this.skillsSelectedNames = [];
                this.showMessage('加载 skills 失败', 'error');
                return false;
            } finally {
                this.skillsLoading = false;
            }
        },

        async loadSkillsMarketOverview(options = {}) {
            if (this.skillsMarketLoading) return false;
            const silent = !!(options && options.silent);
            const forceRefresh = !!(options && options.forceRefresh);
            this.skillsMarketLoading = true;
            let localLoaded = this.skillsMarketLocalLoadedOnce === true;
            let importLoaded = this.skillsMarketImportLoadedOnce === true;
            try {
                if (forceRefresh || !localLoaded) {
                    localLoaded = await this.refreshSkillsList({ silent });
                    this.skillsMarketLocalLoadedOnce = localLoaded;
                }
                if (forceRefresh || !importLoaded) {
                    importLoaded = await this.scanImportableSkills({ silent });
                    this.skillsMarketImportLoadedOnce = importLoaded;
                }
                return !!(localLoaded && importLoaded);
            } finally {
                this.skillsMarketLoading = false;
            }
        },

        resetSkillsFilters() {
            this.skillsKeyword = '';
            this.skillsStatusFilter = 'all';
        },

        toggleAllSkillsSelection() {
            const selectable = this.skillsSelectableNames;
            if (this.skillsAllSelected) {
                const selectedSet = new Set(Array.isArray(this.skillsSelectedNames) ? this.skillsSelectedNames : []);
                selectable.forEach((name) => selectedSet.delete(name));
                this.skillsSelectedNames = Array.from(selectedSet);
                return;
            }
            const selectedSet = new Set(Array.isArray(this.skillsSelectedNames) ? this.skillsSelectedNames : []);
            selectable.forEach((name) => selectedSet.add(name));
            this.skillsSelectedNames = Array.from(selectedSet);
        },

        buildSkillImportKey(item) {
            const safe = item && typeof item === 'object' ? item : {};
            const sourceApp = typeof safe.sourceApp === 'string' ? safe.sourceApp.trim().toLowerCase() : '';
            const name = typeof safe.name === 'string' ? safe.name.trim() : '';
            if (!sourceApp || !name) return '';
            return `${sourceApp}:${name}`;
        },

        toggleAllSkillsImportSelection() {
            const selectable = this.skillsImportSelectableKeys;
            if (this.skillsImportAllSelected) {
                this.skillsImportSelectedKeys = [];
                return;
            }
            this.skillsImportSelectedKeys = [...selectable];
        },

        async scanImportableSkills(options = {}) {
            if (this.skillsDeleting || this.skillsScanningImports || this.skillsImporting || this.skillsZipImporting || this.skillsExporting) return false;
            const silent = !!(options && options.silent);
            this.skillsScanningImports = true;
            try {
                const res = await api('scan-unmanaged-skills', {
                    targetApp: this.skillsTargetApp
                });
                if (res.error) {
                    this.skillsImportList = [];
                    this.skillsImportSelectedKeys = [];
                    if (!silent) {
                        this.showMessage(res.error, 'error');
                    }
                    return false;
                }
                this.skillsImportList = Array.isArray(res.items) ? res.items : [];
                const availableKeys = new Set(this.skillsImportSelectableKeys);
                this.skillsImportSelectedKeys = (Array.isArray(this.skillsImportSelectedKeys) ? this.skillsImportSelectedKeys : [])
                    .filter((key) => availableKeys.has(key));
                if (!silent && this.skillsImportList.length === 0) {
                    this.showMessage('未扫描到可导入 skill', 'info');
                } else if (!silent) {
                    this.showMessage(`扫描到 ${this.skillsImportList.length} 个可导入 skill`, 'success');
                }
                return true;
            } catch (e) {
                this.skillsImportList = [];
                this.skillsImportSelectedKeys = [];
                if (!silent) {
                    this.showMessage('扫描可导入 skill 失败', 'error');
                }
                return false;
            } finally {
                this.skillsScanningImports = false;
            }
        },

        async importSelectedSkills() {
            if (this.skillsDeleting || this.skillsImporting || this.skillsZipImporting || this.skillsExporting) return;
            const selectedSet = new Set(Array.isArray(this.skillsImportSelectedKeys) ? this.skillsImportSelectedKeys : []);
            const selectedItems = (Array.isArray(this.skillsImportList) ? this.skillsImportList : [])
                .filter((item) => selectedSet.has(this.buildSkillImportKey(item)))
                .map((item) => ({
                    name: item.name,
                    sourceApp: item.sourceApp
                }));
            if (!selectedItems.length) {
                this.showMessage('请先选择要导入的 skill', 'error');
                return;
            }

            this.skillsImporting = true;
            try {
                const res = await api('import-skills', {
                    targetApp: this.skillsTargetApp,
                    items: selectedItems
                });
                if (res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                const importedCount = Array.isArray(res.imported) ? res.imported.length : 0;
                const failedCount = Array.isArray(res.failed) ? res.failed.length : 0;
                if (failedCount > 0 && importedCount > 0) {
                    this.showMessage(`已导入 ${importedCount} 个，失败 ${failedCount} 个`, 'error');
                } else if (failedCount > 0) {
                    const first = res.failed[0] && res.failed[0].error ? res.failed[0].error : '导入失败';
                    this.showMessage(first, 'error');
                } else {
                    this.showMessage(`已导入 ${importedCount} 个 skill 到 ${this.skillsTargetLabel}`, 'success');
                }
                await this.refreshSkillsList({ silent: true });
            } catch (e) {
                this.showMessage('导入 skill 失败', 'error');
            } finally {
                this.skillsImporting = false;
                await this.scanImportableSkills({ silent: true });
            }
        },

        triggerSkillsZipImport() {
            const input = this.$refs.skillsZipImportInput;
            if (input) {
                input.value = '';
                input.click();
            }
        },

        handleSkillsZipImportChange(event) {
            const file = event && event.target && event.target.files ? event.target.files[0] : null;
            if (file) {
                void this.importSkillsFromZipFile(file);
            }
        },

        resetSkillsZipImportInput() {
            const el = this.$refs.skillsZipImportInput;
            if (el) {
                el.value = '';
            }
        },

        async uploadSkillsZipStream(file) {
            const fileName = (file && typeof file.name === 'string' && file.name.trim())
                ? file.name.trim()
                : `${this.skillsTargetApp}-skills.zip`;
            const response = await fetch(`/api/import-skills-zip?targetApp=${encodeURIComponent(this.skillsTargetApp)}`, {
                method: 'POST',
                headers: {
                    'x-codexmate-file-name': encodeURIComponent(fileName)
                },
                body: file
            });
            let payload = {};
            try {
                payload = await response.json();
            } catch (_) {
                payload = {
                    error: response.ok
                        ? 'ZIP 导入响应无效'
                        : `上传失败（HTTP ${response.status}）`
                };
            }
            if (!response.ok && !payload.error) {
                payload.error = `上传失败（HTTP ${response.status}）`;
            }
            return payload;
        },

        async importSkillsFromZipFile(file) {
            if (this.skillsDeleting || this.skillsZipImporting || this.skillsImporting || this.skillsExporting) return;
            const maxSize = 20 * 1024 * 1024;
            if (file.size > maxSize) {
                this.showMessage('ZIP 文件过大，限制 20MB', 'error');
                this.resetSkillsZipImportInput();
                return;
            }
            this.skillsZipImporting = true;
            try {
                const res = await this.uploadSkillsZipStream(file);
                if (res && res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                const importedCount = Array.isArray(res && res.imported) ? res.imported.length : 0;
                const failedCount = Array.isArray(res && res.failed) ? res.failed.length : 0;
                if (failedCount > 0 && importedCount > 0) {
                    this.showMessage(`已导入 ${importedCount} 个，失败 ${failedCount} 个`, 'error');
                } else if (failedCount > 0) {
                    const first = res.failed[0] && res.failed[0].error ? res.failed[0].error : '导入失败';
                    this.showMessage(first, 'error');
                } else {
                    this.showMessage(`已导入 ${importedCount} 个 skill 到 ${this.skillsTargetLabel}`, 'success');
                }
                await this.refreshSkillsList({ silent: true });
            } catch (e) {
                this.showMessage('ZIP 导入失败', 'error');
            } finally {
                this.skillsZipImporting = false;
                this.resetSkillsZipImportInput();
                await this.scanImportableSkills({ silent: true });
            }
        },

        async exportSelectedSkills() {
            if (this.skillsDeleting || this.skillsExporting || this.skillsZipImporting || this.skillsImporting) return;
            const selected = Array.isArray(this.skillsSelectedNames)
                ? Array.from(new Set(this.skillsSelectedNames.map((item) => String(item || '').trim()).filter(Boolean)))
                : [];
            if (!selected.length) {
                this.showMessage('请先选择要导出的 skill', 'error');
                return;
            }
            this.skillsExporting = true;
            try {
                const res = await api('export-skills', {
                    targetApp: this.skillsTargetApp,
                    names: selected
                });
                if (res && res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                if (!res || !res.fileName) {
                    this.showMessage('导出失败：未生成压缩包', 'error');
                    return;
                }
                const exportedCount = Array.isArray(res.exported) ? res.exported.length : 0;
                const failedCount = Array.isArray(res.failed) ? res.failed.length : 0;
                const downloadUrl = typeof res.downloadPath === 'string' && res.downloadPath.trim()
                    ? res.downloadPath.trim()
                    : `/download/${encodeURIComponent(res.fileName)}`;
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = res.fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                if (failedCount > 0) {
                    this.showMessage(`已导出 ${exportedCount} 个，失败 ${failedCount} 个`, 'error');
                } else {
                    this.showMessage(`已从 ${this.skillsTargetLabel} 导出 ${exportedCount} 个 skill`, 'success');
                }
            } catch (e) {
                this.showMessage('导出 skill 失败', 'error');
            } finally {
                this.skillsExporting = false;
            }
        },

        async deleteSelectedSkills() {
            if (this.skillsDeleting || this.skillsZipImporting || this.skillsExporting || this.skillsImporting) return;
            const selected = Array.isArray(this.skillsSelectedNames)
                ? Array.from(new Set(this.skillsSelectedNames.map((item) => String(item || '').trim()).filter(Boolean)))
                : [];
            if (!selected.length) {
                this.showMessage('请先选择要删除的 skill', 'error');
                return;
            }
            const confirmed = await this.requestConfirmDialog({
                title: '删除 Skills',
                message: `确认从 ${this.skillsTargetLabel} 删除 ${selected.length} 个 skill 吗？此操作不可撤销。`,
                confirmText: '删除',
                cancelText: '取消',
                danger: true
            });
            if (!confirmed) {
                return;
            }

            this.skillsDeleting = true;
            try {
                const res = await api('delete-skills', {
                    targetApp: this.skillsTargetApp,
                    names: selected
                });
                if (res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }

                const deletedCount = Array.isArray(res.deleted) ? res.deleted.length : 0;
                const failedList = Array.isArray(res.failed) ? res.failed : [];
                const failedCount = failedList.length;
                if (failedCount > 0 && deletedCount > 0) {
                    this.showMessage(`已删除 ${deletedCount} 个，失败 ${failedCount} 个`, 'error');
                } else if (failedCount > 0) {
                    const first = failedList[0] && failedList[0].error ? failedList[0].error : '删除失败';
                    this.showMessage(first, 'error');
                } else {
                    this.showMessage(`已从 ${this.skillsTargetLabel} 删除 ${deletedCount} 个 skill`, 'success');
                }
                await this.refreshSkillsList({ silent: true });
            } catch (e) {
                this.showMessage('删除 skill 失败', 'error');
            } finally {
                this.skillsDeleting = false;
                await this.scanImportableSkills({ silent: true });
            }
        }
    };
}
