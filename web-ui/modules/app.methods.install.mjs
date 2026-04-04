export function createInstallMethods() {
    return {
        normalizeInstallPackageManager(value) {
            const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
            if (normalized === 'pnpm' || normalized === 'bun' || normalized === 'npm') {
                return normalized;
            }
            return 'npm';
        },

        normalizeInstallAction(value) {
            const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
            if (normalized === 'update' || normalized === 'uninstall' || normalized === 'install') {
                return normalized;
            }
            return 'install';
        },

        normalizeInstallRegistryPreset(value) {
            const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
            if (normalized === 'default' || normalized === 'npmmirror' || normalized === 'tencent' || normalized === 'custom') {
                return normalized;
            }
            return 'default';
        },

        normalizeInstallRegistryUrl(value) {
            const normalized = typeof value === 'string' ? value.trim() : '';
            if (!normalized) return '';
            if (!/^https?:\/\//i.test(normalized)) {
                return '';
            }
            return normalized.replace(/\/+$/, '');
        },

        resolveInstallRegistryUrl(presetValue, customValue) {
            const preset = this.normalizeInstallRegistryPreset(presetValue);
            if (preset === 'npmmirror') {
                return 'https://registry.npmmirror.com';
            }
            if (preset === 'tencent') {
                return 'https://mirrors.cloud.tencent.com/npm';
            }
            if (preset === 'custom') {
                return this.normalizeInstallRegistryUrl(customValue);
            }
            return '';
        },

        appendInstallRegistryOption(command, actionName) {
            const base = typeof command === 'string' ? command.trim() : '';
            if (!base) return '';
            const action = this.normalizeInstallAction(actionName);
            if (action === 'uninstall') {
                return base;
            }
            const registry = this.resolveInstallRegistryUrl(this.installRegistryPreset, this.installRegistryCustom);
            if (!registry) {
                return base;
            }
            return `${base} --registry=${registry}`;
        },

        resolveInstallPlatform() {
            const navPlatform = typeof navigator !== 'undefined' && typeof navigator.platform === 'string'
                ? navigator.platform.trim().toLowerCase()
                : '';
            if (navPlatform.includes('win')) return 'win32';
            if (navPlatform.includes('mac')) return 'darwin';
            return 'linux';
        },

        buildInstallCommandMatrix(packageManager) {
            const manager = this.normalizeInstallPackageManager(packageManager);
            const matrix = {
                claude: {
                    install: '',
                    update: '',
                    uninstall: ''
                },
                codex: {
                    install: '',
                    update: '',
                    uninstall: ''
                }
            };
            if (manager === 'pnpm') {
                matrix.claude.install = 'pnpm add -g @anthropic-ai/claude-code';
                matrix.claude.update = 'pnpm up -g @anthropic-ai/claude-code';
                matrix.claude.uninstall = 'pnpm remove -g @anthropic-ai/claude-code';
                matrix.codex.install = 'pnpm add -g @openai/codex';
                matrix.codex.update = 'pnpm up -g @openai/codex';
                matrix.codex.uninstall = 'pnpm remove -g @openai/codex';
                return matrix;
            }
            if (manager === 'bun') {
                matrix.claude.install = 'bun add -g @anthropic-ai/claude-code';
                matrix.claude.update = 'bun update -g @anthropic-ai/claude-code';
                matrix.claude.uninstall = 'bun remove -g @anthropic-ai/claude-code';
                matrix.codex.install = 'bun add -g @openai/codex';
                matrix.codex.update = 'bun update -g @openai/codex';
                matrix.codex.uninstall = 'bun remove -g @openai/codex';
                return matrix;
            }
            matrix.claude.install = 'npm install -g @anthropic-ai/claude-code';
            matrix.claude.update = 'npm update -g @anthropic-ai/claude-code';
            matrix.claude.uninstall = 'npm uninstall -g @anthropic-ai/claude-code';
            matrix.codex.install = 'npm install -g @openai/codex';
            matrix.codex.update = 'npm update -g @openai/codex';
            matrix.codex.uninstall = 'npm uninstall -g @openai/codex';
            return matrix;
        },

        getInstallCommand(targetId, actionName) {
            const targetKey = typeof targetId === 'string' ? targetId.trim() : '';
            if (!targetKey) return '';
            const action = this.normalizeInstallAction(actionName);
            const currentMap = this.buildInstallCommandMatrix(this.installPackageManager);
            const current = currentMap[targetKey] && typeof currentMap[targetKey][action] === 'string'
                ? currentMap[targetKey][action]
                : '';
            return this.appendInstallRegistryOption(current, action);
        },

        setInstallCommandAction(actionName) {
            this.installCommandAction = this.normalizeInstallAction(actionName);
        },

        setInstallRegistryPreset(presetName) {
            this.installRegistryPreset = this.normalizeInstallRegistryPreset(presetName);
        },

        openInstallModal() {
            this.showInstallModal = true;
        },

        closeInstallModal() {
            this.showInstallModal = false;
        }
    };
}
