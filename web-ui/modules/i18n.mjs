import { DICT } from './i18n.dict.mjs';

const I18N_STORAGE_KEY = 'codexmateLang';

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
            const fallbackEn = DICT.en;
            const fallbackZh = DICT.zh;
            const raw = (table && table[key]) || (fallbackEn && fallbackEn[key]) || (fallbackZh && fallbackZh[key]) || key;
            return interpolate(raw, params);
        }
    };
}
