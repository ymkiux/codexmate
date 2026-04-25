export const PROVIDER_CONFIG_MODE_META = Object.freeze({
    codex: Object.freeze({
        label: 'Codex',
        modelPlaceholder: '例如: gpt-5.3-codex',
        statusConfigLabel: 'Codex 提供商',
        statusModelLabel: 'Codex 模型'
    })
});

export const CONFIG_MODE_SET = new Set([
    ...Object.keys(PROVIDER_CONFIG_MODE_META),
    'claude',
    'openclaw'
]);

export function getProviderConfigModeMeta(mode) {
    return PROVIDER_CONFIG_MODE_META[mode] || null;
}

export function createConfigModeComputed() {
    return {
        isProviderConfigMode() {
            return !!getProviderConfigModeMeta(this.configMode);
        },
        isCodexConfigMode() {
            return this.configMode === 'codex';
        },
        activeProviderModeMeta() {
            return getProviderConfigModeMeta(this.configMode) || PROVIDER_CONFIG_MODE_META.codex;
        },
        activeProviderModeLabel() {
            return this.activeProviderModeMeta.label;
        },
        activeProviderModelPlaceholder() {
            return this.activeProviderModeMeta.modelPlaceholder;
        },
        activeProviderConfigChipLabel() {
            return this.activeProviderModeMeta.statusConfigLabel;
        },
        activeProviderModelChipLabel() {
            return this.activeProviderModeMeta.statusModelLabel;
        },
        activeProviderBridgeHint() {
            if (!this.isProviderConfigMode || this.isCodexConfigMode) {
                return '';
            }
            return `${this.activeProviderModeLabel} 当前复用 Codex Provider / Model 管理链路。`;
        },
        inspectorMainTabLabel() {
            if (this.mainTab === 'dashboard') return '概览';
            if (this.mainTab === 'config') return '配置中心';
            if (this.mainTab === 'sessions') return '会话浏览';
            if (this.mainTab === 'usage') return 'Usage';
            if (this.mainTab === 'market') return '技能市场';
            if (this.mainTab === 'docs') return '文档';
            if (this.mainTab === 'settings') return '设置';
            return '未知';
        },
        inspectorConfigModeLabel() {
            const providerMeta = getProviderConfigModeMeta(this.configMode);
            if (providerMeta) return providerMeta.label;
            if (this.configMode === 'claude') return 'Claude Code';
            if (this.configMode === 'openclaw') return 'OpenClaw';
            return '未选择';
        },
        inspectorCurrentConfigLabel() {
            if (getProviderConfigModeMeta(this.configMode)) {
                const provider = typeof this.currentProvider === 'string' ? this.currentProvider.trim() : '';
                return provider || '未选择';
            }
            if (this.configMode === 'claude') {
                const config = typeof this.currentClaudeConfig === 'string' ? this.currentClaudeConfig.trim() : '';
                return config || '未选择';
            }
            if (this.configMode === 'openclaw') {
                const openclaw = typeof this.currentOpenclawConfig === 'string' ? this.currentOpenclawConfig.trim() : '';
                return openclaw || '未选择';
            }
            return '未选择';
        },
        inspectorCurrentModelLabel() {
            if (getProviderConfigModeMeta(this.configMode)) {
                const model = typeof this.currentModel === 'string' ? this.currentModel.trim() : '';
                return model || '未选择';
            }
            if (this.configMode === 'claude') {
                const model = typeof this.currentClaudeModel === 'string' ? this.currentClaudeModel.trim() : '';
                return model || '未选择';
            }
            if (this.configMode === 'openclaw') {
                const model = this.openclawStructured && typeof this.openclawStructured.agentPrimary === 'string'
                    ? this.openclawStructured.agentPrimary.trim()
                    : '';
                return model || '按配置文件';
            }
            return '未选择';
        },
        inspectorTemplateStatus() {
            if (this.mainTab !== 'config') return '--';
            if (this.configMode === 'codex') {
                if (this.configTemplateApplying || this.codexApplying) {
                    return '模板应用中';
                }
                return '模板可编辑（手动确认应用）';
            }
            if (getProviderConfigModeMeta(this.configMode)) {
                if (this.codexApplying) {
                    return 'Provider / Model 应用中';
                }
                return '复用 Codex Provider / Model';
            }
            if (this.configMode === 'claude') {
                return '即时写入 Claude settings';
            }
            if (this.configMode === 'openclaw') {
                if (this.openclawApplying || this.openclawSaving) {
                    return 'OpenClaw 保存/应用中';
                }
                return 'JSON5 可保存并应用';
            }
            return '未选择';
        }
    };
}
