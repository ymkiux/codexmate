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

function resolveCrushConfigPathForScope(params = {}) {
    const scope = typeof params.scope === 'string' ? params.scope : 'global';
    const cwd = typeof params.cwd === 'string' && params.cwd.trim() ? params.cwd : process.cwd();
    const env = params.env || process.env;
    if (scope === 'project-dot') return path.join(cwd, '.crush.json');
    if (scope === 'project') return path.join(cwd, 'crush.json');
    return resolveCrushConfigPath(env);
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
    const providers = {};
    const source = modelProviders && typeof modelProviders === 'object' && !Array.isArray(modelProviders)
        ? modelProviders
        : {};
    for (const [name, cfg] of Object.entries(source)) {
        if (!cfg || typeof cfg !== 'object') continue;
        const baseUrl = typeof cfg.base_url === 'string' ? cfg.base_url.trim() : '';
        if (!baseUrl) continue;
        const envKey = `${String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
        providers[name] = {
            name,
            type: 'openai',
            base_url: baseUrl,
            api_key: `$${envKey}`
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
    resolveCrushConfigPathForScope,
    safeReadJsonFile,
    buildDefaultCrushConfig,
    buildCrushProvidersFromCodexProviders,
    writeCrushConfigFile
};
