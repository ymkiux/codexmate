const fs = require('fs');
const path = require('path');
const os = require('os');

function resolveCrushConfigPath(env = process.env) {
    // Crush README: $HOME/.config/crush/crush.json (Windows: %LOCALAPPDATA%\\crush\\crush.json)
    const isWin = process.platform === 'win32';
    if (isWin) {
        const base = (env.LOCALAPPDATA || '').trim() || path.join(os.homedir(), 'AppData', 'Local');
        return path.join(base, 'crush', 'crush.json');
    }
    const xdg = (env.XDG_CONFIG_HOME || '').trim();
    const base = xdg || path.join(os.homedir(), '.config');
    return path.join(base, 'crush', 'crush.json');
}

function ensureParentDir(filePath) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
}

function safeReadJsonFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        return { exists: false, raw: '', data: null };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    try {
        const parsed = JSON.parse(raw);
        return { exists: true, raw, data: parsed };
    } catch (e) {
        return { exists: true, raw, data: null, error: `Invalid JSON: ${e.message}` };
    }
}

function buildDefaultCrushConfig() {
    return {
        $schema: 'https://charm.land/crush.json',
        providers: {},
        models: {
            large: { provider: '', model: '' },
            small: { provider: '', model: '' }
        }
    };
}

function buildCrushProvidersFromCodexProviders(modelProviders, options = {}) {
    const includeKeys = options.includeKeys === true;
    const providers = {};
    const source = modelProviders && typeof modelProviders === 'object' && !Array.isArray(modelProviders)
        ? modelProviders
        : {};
    for (const [name, cfg] of Object.entries(source)) {
        if (!cfg || typeof cfg !== 'object') continue;
        const baseUrl = typeof cfg.base_url === 'string' ? cfg.base_url.trim() : '';
        if (!baseUrl) continue;
        const apiKey = typeof cfg.preferred_auth_method === 'string' ? cfg.preferred_auth_method.trim() : '';
        providers[name] = {
            name,
            type: 'openai',
            base_url: baseUrl,
            ...(includeKeys && apiKey ? { api_key: apiKey } : {})
        };
    }
    return providers;
}

function writeCrushConfigFile(filePath, config, options = {}) {
    const pretty = options.pretty !== false;
    const content = pretty ? JSON.stringify(config, null, 2) + '\n' : JSON.stringify(config);
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true, path: filePath };
}

module.exports = {
    resolveCrushConfigPath,
    safeReadJsonFile,
    buildDefaultCrushConfig,
    buildCrushProvidersFromCodexProviders,
    writeCrushConfigFile
};

