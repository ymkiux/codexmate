export function createDashboardComputed() {
    return {
        agentsDiffHasChanges() {
            if (this.agentsDiffTruncated) {
                return !!this.agentsDiffHasChangesValue;
            }
            const stats = this.agentsDiffStats || {};
            const added = Number(stats.added || 0);
            const removed = Number(stats.removed || 0);
            return added > 0 || removed > 0;
        },
        configTemplateDiffHasChanges() {
            const stats = this.configTemplateDiffStats || {};
            const added = Number(stats.added || 0);
            const removed = Number(stats.removed || 0);
            if (this.configTemplateDiffHasChangesValue !== undefined && this.configTemplateDiffHasChangesValue !== null) {
                return !!this.configTemplateDiffHasChangesValue;
            }
            return added > 0 || removed > 0;
        },
        claudeModelHasList() {
            return this.claudeModelOptions.length > 0;
        },
        claudeModelOptions() {
            const list = Array.isArray(this.claudeModels) ? [...this.claudeModels] : [];
            const current = (this.currentClaudeModel || '').trim();
            if (current && !list.includes(current)) {
                list.unshift(current);
            }
            return list;
        },
        displayCurrentProvider() {
            const switching = String(this.providerSwitchDisplayTarget || '').trim();
            if (switching) return switching;
            const current = String(this.currentProvider || '').trim();
            return current;
        },
        displayProvidersList() {
            const list = Array.isArray(this.providersList) ? this.providersList : [];
            return list.filter((item) => String(item && item.name ? item.name : '').trim().toLowerCase() !== 'codexmate-proxy');
        },
        installTargetCards() {
            const targets = Array.isArray(this.installStatusTargets) ? this.installStatusTargets : [];
            const action = this.normalizeInstallAction(this.installCommandAction);
            return targets.map((target) => {
                const id = target && typeof target.id === 'string' ? target.id : '';
                const termuxCommand = id === 'codex'
                    ? this.getInstallCommand(id, action, 'termux')
                    : '';
                return {
                    ...target,
                    command: this.getInstallCommand(id, action),
                    termuxCommand
                };
            });
        },
        installRegistryPreview() {
            return this.resolveInstallRegistryUrl(this.installRegistryPreset, this.installRegistryCustom);
        },
        inspectorBusyStatus() {
            const tasks = [];
            if (this.loading) tasks.push('初始化');
            if (this.sessionsLoading) tasks.push('会话加载');
            if (this.codexModelsLoading || this.claudeModelsLoading) tasks.push('模型加载');
            if (this.codexApplying || this.configTemplateApplying || this.openclawApplying) tasks.push('配置应用');
            if (this.agentsSaving) tasks.push('AGENTS 保存');
            if (this.skillsLoading || this.skillsDeleting || this.skillsScanningImports || this.skillsImporting || this.skillsZipImporting || this.skillsExporting) tasks.push('Skills 管理');
            if (this.taskOrchestration && (this.taskOrchestration.loading || this.taskOrchestration.planning || this.taskOrchestration.running || this.taskOrchestration.queueAdding || this.taskOrchestration.queueStarting || this.taskOrchestration.retrying || this.taskOrchestration.selectedRunLoading)) {
                tasks.push('任务编排');
            }
            return tasks.length ? tasks.join(' / ') : '空闲';
        },
        inspectorMessageSummary() {
            const value = typeof this.message === 'string' ? this.message.trim() : '';
            return value || '暂无提示';
        },
        inspectorSessionSourceLabel() {
            if (this.sessionFilterSource === 'codex') return 'Codex';
            if (this.sessionFilterSource === 'claude') return 'Claude Code';
            return '全部';
        },
        inspectorSessionPathLabel() {
            const value = typeof this.sessionPathFilter === 'string' ? this.sessionPathFilter.trim() : '';
            return value || '全部路径';
        },
        inspectorSessionQueryLabel() {
            if (!this.isSessionQueryEnabled) return '当前来源不支持';
            const value = typeof this.sessionQuery === 'string' ? this.sessionQuery.trim() : '';
            return value || '未设置';
        },
        inspectorHealthStatus() {
            if (this.initError) return '读取失败';
            if (this.loading) return '初始化中';
            return '正常';
        },
        inspectorHealthTone() {
            if (this.initError) return 'error';
            if (this.loading) return 'warn';
            return 'ok';
        },
        inspectorModelLoadStatus() {
            if (this.codexModelsLoading || this.claudeModelsLoading) {
                return '加载中';
            }
            if (this.modelsSource === 'error' || this.claudeModelsSource === 'error') {
                return '加载异常';
            }
            return '正常';
        },
        installTroubleshootingTips() {
            const platform = this.resolveInstallPlatform();
            if (platform === 'win32') {
                return [
                    'PowerShell 报权限不足（EACCES/EPERM）时，请以管理员身份执行安装命令。',
                    '安装后若仍提示找不到命令，重开终端并执行：where codex / where claude。',
                    '公司网络受限时，可先切换镜像源快捷项（npmmirror / 腾讯云 / 自定义）。'
                ];
            }
            return [
                '出现 EACCES 权限错误时，优先修复 Node 全局目录权限，不建议直接 sudo npm。',
                '安装后若命令未生效，重开终端并执行：which codex / which claude。',
                '公司网络受限时，可先切换镜像源快捷项（npmmirror / 腾讯云 / 自定义）。'
            ];
        }
    };
}
