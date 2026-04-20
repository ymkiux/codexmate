const I18N_STORAGE_KEY = 'codexmateLang';

const DICT = Object.freeze({
    zh: {
        // Global
        'lang.zh': '中文',
        'lang.en': 'English',
        'lang.label': '语言',

        // Top tabs
        'tab.docs': '文档',
        'tab.config.codex': 'Codex',
        'tab.config.claude': 'Claude',
        'tab.config.openclaw': 'OpenClaw',
        'tab.sessions': '会话',
        'tab.usage': '用量',
        'tab.orchestration': '任务',
        'tab.market': 'Skills',
        'tab.plugins': '插件',
        'tab.settings': '设置',

        // Side rail section titles
        'side.docs': '文档',
        'side.config': '配置',
        'side.sessions': '会话',
        'side.plugins': '插件',
        'side.system': '系统',
        'side.orchestration': '任务',
        'side.skills': 'Skills',

        // Side rail items
        'side.docs.cliInstall': 'CLI 安装',
        'side.docs.cliInstall.meta': '安装 / 升级 / 卸载',
        'side.config.codex': 'Codex',
        'side.config.codex.meta': 'Provider / Model',
        'side.config.claude': 'Claude Code',
        'side.config.claude.meta': 'Claude Settings',
        'side.config.openclaw': 'OpenClaw',
        'side.config.openclaw.meta': 'JSON5 / AGENTS',
        'side.sessions.browser': '会话浏览',
        'side.sessions.browser.meta': '浏览 / 导出 / 清理',
        'side.plugins.tools': '提示词工具',
        'side.plugins.tools.meta': '模板 / 变量',
        'side.system.settings': '运行设置',
        'side.system.settings.meta': '数据 / 备份',

        // Header titles
        'kicker.config': 'Configuration',
        'kicker.sessions': 'Sessions',
        'kicker.usage': 'Usage',
        'kicker.orchestration': 'Tasks',
        'kicker.market': 'Skills',
        'kicker.plugins': 'Plugins',
        'kicker.docs': 'Docs',
        'kicker.settings': 'Settings',

        'title.config': '本地配置控制台',
        'title.sessions': '会话与导出',
        'title.usage': '本地用量与趋势',
        'title.orchestration': '任务编排',
        'title.market': 'Skills 安装与同步',
        'title.plugins': '插件与模板',
        'title.docs': 'CLI 安装与文档',
        'title.settings': '系统与数据设置',

        'subtitle.config': '管理本地配置与模型。',
        'subtitle.sessions': '浏览与导出会话。',
        'subtitle.usage': '查看近 7 / 30 天用量。',
        'subtitle.orchestration': '规划、排队、执行与回看本地任务。',
        'subtitle.market': '管理本地 Skills。',
        'subtitle.plugins': '管理模板化 prompt 与可复用插件。',
        'subtitle.docs': '查看 CLI 安装命令与排障。',
        'subtitle.settings': '管理下载、目录与回收站。'
    },
    en: {
        // Global
        'lang.zh': '中文',
        'lang.en': 'English',
        'lang.label': 'Language',

        // Top tabs
        'tab.docs': 'Docs',
        'tab.config.codex': 'Codex',
        'tab.config.claude': 'Claude',
        'tab.config.openclaw': 'OpenClaw',
        'tab.sessions': 'Sessions',
        'tab.usage': 'Usage',
        'tab.orchestration': 'Tasks',
        'tab.market': 'Skills',
        'tab.plugins': 'Plugins',
        'tab.settings': 'Settings',

        // Side rail section titles
        'side.docs': 'Docs',
        'side.config': 'Config',
        'side.sessions': 'Sessions',
        'side.plugins': 'Plugins',
        'side.system': 'System',
        'side.orchestration': 'Tasks',
        'side.skills': 'Skills',

        // Side rail items
        'side.docs.cliInstall': 'CLI Install',
        'side.docs.cliInstall.meta': 'Install / Update / Uninstall',
        'side.config.codex': 'Codex',
        'side.config.codex.meta': 'Provider / Model',
        'side.config.claude': 'Claude Code',
        'side.config.claude.meta': 'Claude Settings',
        'side.config.openclaw': 'OpenClaw',
        'side.config.openclaw.meta': 'JSON5 / AGENTS',
        'side.sessions.browser': 'Session Browser',
        'side.sessions.browser.meta': 'Browse / Export / Cleanup',
        'side.plugins.tools': 'Prompt Tools',
        'side.plugins.tools.meta': 'Templates / Variables',
        'side.system.settings': 'Runtime Settings',
        'side.system.settings.meta': 'Data / Backup',

        // Header titles
        'kicker.config': 'Configuration',
        'kicker.sessions': 'Sessions',
        'kicker.usage': 'Usage',
        'kicker.orchestration': 'Tasks',
        'kicker.market': 'Skills',
        'kicker.plugins': 'Plugins',
        'kicker.docs': 'Docs',
        'kicker.settings': 'Settings',

        'title.config': 'Local Configuration Console',
        'title.sessions': 'Sessions & Export',
        'title.usage': 'Local Usage & Trends',
        'title.orchestration': 'Task Orchestration',
        'title.market': 'Skills Install & Sync',
        'title.plugins': 'Plugins & Templates',
        'title.docs': 'CLI Install & Docs',
        'title.settings': 'System & Data Settings',

        'subtitle.config': 'Manage local configs and models.',
        'subtitle.sessions': 'Browse and export sessions.',
        'subtitle.usage': 'View usage for the last 7/30 days.',
        'subtitle.orchestration': 'Plan, queue, run, and review local tasks.',
        'subtitle.market': 'Manage local skills.',
        'subtitle.plugins': 'Manage reusable prompt templates and plugins.',
        'subtitle.docs': 'CLI install commands and troubleshooting.',
        'subtitle.settings': 'Manage downloads, directories, and trash.'
    }
});

function normalizeLang(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized === 'en' ? 'en' : 'zh';
}

function interpolate(template, params) {
    if (!params || typeof params !== 'object') return template;
    return String(template).replace(/\{(\w+)\}/g, (_, key) => {
        const value = params[key];
        return value === undefined || value === null ? '' : String(value);
    });
}

export function createI18nMethods() {
    return {
        normalizeLang,
        initI18n() {
            const saved = typeof localStorage !== 'undefined'
                ? localStorage.getItem(I18N_STORAGE_KEY)
                : '';
            const next = normalizeLang(saved);
            this.lang = next;
            try {
                if (typeof document !== 'undefined' && document.documentElement) {
                    document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN';
                }
            } catch (_) {}
        },
        setLang(nextLang) {
            const next = normalizeLang(nextLang);
            this.lang = next;
            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem(I18N_STORAGE_KEY, next);
                }
            } catch (_) {}
            try {
                if (typeof document !== 'undefined' && document.documentElement) {
                    document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN';
                }
            } catch (_) {}
        },
        t(key, params = null) {
            const lang = normalizeLang(this.lang);
            const table = DICT[lang] || DICT.zh;
            const fallback = DICT.zh;
            const raw = (table && table[key]) || (fallback && fallback[key]) || key;
            return interpolate(raw, params);
        }
    };
}
