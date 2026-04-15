const {
    resolveCrushConfigPathForScope,
    safeReadJsonFile,
    buildDefaultCrushConfig,
    buildCrushProvidersFromCodexProviders,
    writeCrushConfigFile
} = require('../lib/crush-config');

function createCrushController({ readConfigOrVirtualDefault }) {
    const getConfigPath = (params = {}) => resolveCrushConfigPathForScope(params);

    const getCrushConfig = (params = {}) => {
        const filePath = getConfigPath(params);
        const read = safeReadJsonFile(filePath);
        return {
            path: filePath,
            exists: !!read.exists,
            error: read.error || '',
            raw: read.raw || '',
            config: read.data
        };
    };

    const applyCrushConfig = (params = {}) => {
        const filePath = getConfigPath(params);
        const raw = typeof params.raw === 'string' ? params.raw : '';
        if (!raw.trim()) return { error: 'Empty config content' };
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            return { error: `Invalid JSON: ${e.message}` };
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { error: 'Config must be a JSON object' };
        }
        writeCrushConfigFile(filePath, parsed, { pretty: true });
        return { success: true, path: filePath };
    };

    const initCrushConfig = (params = {}) => {
        const filePath = getConfigPath(params);
        const dryRun = params.dryRun === true;
        const base = buildDefaultCrushConfig();
        const codex = readConfigOrVirtualDefault ? readConfigOrVirtualDefault() : null;
        const providers = codex && codex.config ? buildCrushProvidersFromCodexProviders(codex.config.model_providers, {}) : {};
        base.providers = providers;
        const raw = JSON.stringify(base, null, 2) + '\n';
        if (!dryRun) {
            writeCrushConfigFile(filePath, base, { pretty: true });
        }
        return { success: true, path: filePath, providerCount: Object.keys(providers).length, raw };
    };

    const cmdCrush = (args = []) => {
        const sub = (args[0] || 'help').toLowerCase();
        if (sub === 'path') {
            console.log(getConfigPath());
            return;
        }
        if (sub === 'get') {
            const res = getCrushConfig();
            if (res.error) {
                console.error('Error:', res.error);
            }
            console.log(res.raw || JSON.stringify(buildDefaultCrushConfig(), null, 2));
            return;
        }
        if (sub === 'init') {
            const res = initCrushConfig({});
            if (res.error) {
                console.error('Error:', res.error);
                process.exitCode = 1;
                return;
            }
            console.log(`✓ Wrote ${res.path} (providers: ${res.providerCount})`);
            return;
        }
        console.log('Usage: codexmate crush <path|get|init>');
    };

    return {
        getCrushConfig,
        applyCrushConfig,
        initCrushConfig,
        cmdCrush
    };
}

module.exports = { createCrushController };
