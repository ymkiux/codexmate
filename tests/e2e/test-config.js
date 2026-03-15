const { assert } = require('./helpers');

module.exports = async function testConfig(ctx) {
    const {
        api,
        mockProviderUrl,
        noModelsUrl,
        htmlModelsUrl,
        authFailUrl
    } = ctx;

    // ========== Status API Tests ==========
    const apiStatus = await api('status');
    assert(apiStatus.provider === 'e2e', 'api status provider mismatch');
    assert(typeof apiStatus.model === 'string', 'api status model missing');
    assert(typeof apiStatus.configReady === 'boolean', 'api status configReady missing');
    assert('modelReasoningEffort' in apiStatus, 'api status modelReasoningEffort missing');
    assert('serviceTier' in apiStatus, 'api status serviceTier missing');

    // ========== List API Tests ==========
    const apiList = await api('list');
    assert(Array.isArray(apiList.providers), 'api list missing providers');
    assert(apiList.providers.some(p => p.name === 'e2e'), 'api list missing provider');
    assert(apiList.providers.every(p => 'name' in p), 'provider missing name');
    assert(apiList.providers.every(p => 'url' in p), 'provider missing url');
    assert(apiList.providers.every(p => 'hasKey' in p), 'provider missing hasKey');

    // ========== Get Config Template Tests - Service Tier ==========
    const templateOverride = await api('get-config-template', {
        provider: 'shadow',
        model: 'shadow-model',
        serviceTier: 'fast'
    });
    assert(typeof templateOverride.template === 'string', 'get-config-template missing template');
    assert(/^\s*service_tier\s*=\s*"fast"\s*$/m.test(templateOverride.template), 'get-config-template missing service_tier');
    assert(templateOverride.template.includes('model_provider = "shadow"'), 'get-config-template missing provider override');
    assert(templateOverride.template.includes('model = "shadow-model"'), 'get-config-template missing model override');

    const templateStandard = await api('get-config-template', {
        provider: 'shadow',
        model: 'shadow-model',
        serviceTier: 'standard'
    });
    assert(typeof templateStandard.template === 'string', 'get-config-template(standard) missing template');
    assert(!/\s*service_tier\s*=/.test(templateStandard.template), 'get-config-template(standard) should not include service_tier');

    // ========== Get Config Template Tests - Reasoning Effort ==========
    const templateReasoningHigh = await api('get-config-template', {
        provider: 'shadow',
        model: 'shadow-model',
        reasoningEffort: 'high'
    });
    assert(typeof templateReasoningHigh.template === 'string', 'get-config-template(reasoning high) missing template');
    assert(/^\s*model_reasoning_effort\s*=\s*"high"\s*$/m.test(templateReasoningHigh.template), 'get-config-template(reasoning high) missing model_reasoning_effort');

    const templateReasoningMedium = await api('get-config-template', {
        provider: 'shadow',
        model: 'shadow-model',
        reasoningEffort: 'medium'
    });
    assert(typeof templateReasoningMedium.template === 'string', 'get-config-template(reasoning medium) missing template');
    assert(!/\s*model_reasoning_effort\s*=/.test(templateReasoningMedium.template), 'get-config-template(reasoning medium) should not include model_reasoning_effort');

    const templateReasoningLow = await api('get-config-template', {
        provider: 'shadow',
        model: 'shadow-model',
        reasoningEffort: 'low'
    });
    assert(typeof templateReasoningLow.template === 'string', 'get-config-template(reasoning low) missing template');
    assert(!/\s*model_reasoning_effort\s*=/.test(templateReasoningLow.template), 'get-config-template(reasoning low) should not include model_reasoning_effort');

    const templateReasoningXhigh = await api('get-config-template', {
        provider: 'shadow',
        model: 'shadow-model',
        reasoningEffort: 'xhigh'
    });
    assert(typeof templateReasoningXhigh.template === 'string', 'get-config-template(reasoning xhigh) missing template');
    assert(/^\s*model_reasoning_effort\s*=\s*"xhigh"\s*$/m.test(templateReasoningXhigh.template), 'get-config-template(reasoning xhigh) missing model_reasoning_effort');

    // ========== Get Config Template Tests - Combined ==========
    const templateCombined = await api('get-config-template', {
        provider: 'shadow',
        model: 'shadow-model',
        serviceTier: 'fast',
        reasoningEffort: 'high'
    });
    assert(typeof templateCombined.template === 'string', 'get-config-template(combined) missing template');
    assert(/^\s*service_tier\s*=\s*"fast"\s*$/m.test(templateCombined.template), 'get-config-template(combined) missing service_tier');
    assert(/^\s*model_reasoning_effort\s*=\s*"high"\s*$/m.test(templateCombined.template), 'get-config-template(combined) missing model_reasoning_effort');

    const templateCombinedXhigh = await api('get-config-template', {
        provider: 'shadow',
        model: 'shadow-model',
        serviceTier: 'fast',
        reasoningEffort: 'xhigh'
    });
    assert(typeof templateCombinedXhigh.template === 'string', 'get-config-template(combined xhigh) missing template');
    assert(/^\s*service_tier\s*=\s*"fast"\s*$/m.test(templateCombinedXhigh.template), 'get-config-template(combined xhigh) missing service_tier');
    assert(/^\s*model_reasoning_effort\s*=\s*"xhigh"\s*$/m.test(templateCombinedXhigh.template), 'get-config-template(combined xhigh) missing model_reasoning_effort');

    // ========== Export Config Tests ==========
    const exportResult = await api('export-config', { includeKeys: true });
    assert(exportResult.data, 'export-config missing data');
    assert(exportResult.data.providers && exportResult.data.providers.e2e, 'export-config missing provider');
    assert(exportResult.data.providers.e2e.apiKey === 'sk-test', 'export-config apiKey mismatch');
    assert(Array.isArray(exportResult.data.models), 'export-config missing models');
    assert(typeof exportResult.data.currentProvider === 'string', 'export-config missing currentProvider');
    assert(typeof exportResult.data.currentModel === 'string', 'export-config missing currentModel');

    const exportNoKeys = await api('export-config', { includeKeys: false });
    assert(exportNoKeys.data, 'export-config(no keys) missing data');
    assert(exportNoKeys.data.providers && exportNoKeys.data.providers.e2e, 'export-config(no keys) missing provider');
    assert(exportNoKeys.data.providers.e2e.apiKey === null, 'export-config(no keys) apiKey should be null');

    // ========== Import Config Tests ==========
    const importInvalid = await api('import-config', { payload: null });
    assert(importInvalid.error && importInvalid.error.includes('Invalid import payload'), 'import-config should reject invalid payload');

    const importEmpty = await api('import-config', { payload: {} });
    assert(importEmpty.error && importEmpty.error.includes('Invalid import payload'), 'import-config should reject empty payload');

    // ========== Models API Tests ==========
    const modelsMissing = await api('models', { provider: 'missing' });
    assert(modelsMissing.error, 'models should fail for missing provider');

    const modelsEmptyProvider = await api('models', { provider: '' });
    assert(modelsEmptyProvider.error, 'models should fail for empty provider');

    const modelsByUrlInvalid = await api('models-by-url', { baseUrl: 'not-a-url' });
    assert(modelsByUrlInvalid.error, 'models-by-url should fail for invalid url');

    const modelsByUrlEmpty = await api('models-by-url', { baseUrl: '' });
    assert(modelsByUrlEmpty.error, 'models-by-url should fail for empty baseUrl');

    // ========== Apply Config Template Tests ==========
    const applyEmpty = await api('apply-config-template', { template: '' });
    assert(applyEmpty.error, 'apply-config-template should reject empty template');

    const applyWhitespace = await api('apply-config-template', { template: '   \n\n  ' });
    assert(applyWhitespace.error, 'apply-config-template should reject whitespace-only template');

    const applyInvalidToml = await api('apply-config-template', { template: 'invalid toml {{{' });
    assert(applyInvalidToml.error, 'apply-config-template should reject invalid toml');

    const applyNoProvider = await api('apply-config-template', {
        template: 'model = "x"\n[model_providers.x]\nbase_url = "http://example.com"\n'
    });
    assert(applyNoProvider.error, 'apply-config-template should require model_provider');

    const applyNoModel = await api('apply-config-template', {
        template: 'model_provider = "x"\n[model_providers.x]\nbase_url = "http://example.com"\n'
    });
    assert(applyNoModel.error, 'apply-config-template should require model');

    const applyNoProviders = await api('apply-config-template', {
        template: 'model_provider = "x"\nmodel = "y"\n'
    });
    assert(applyNoProviders.error, 'apply-config-template should require model_providers');

    const applyMissingProviderBlock = await api('apply-config-template', {
        template: 'model_provider = "nonexistent"\nmodel = "y"\n[model_providers.x]\nbase_url = "http://example.com"\n'
    });
    assert(applyMissingProviderBlock.error, 'apply-config-template should require matching provider block');

    // ========== Import/Export Provider Tests ==========
    const importPayload = JSON.parse(JSON.stringify(exportResult.data));
    importPayload.providers = {
        ...importPayload.providers,
        e2e2: { baseUrl: mockProviderUrl, apiKey: 'sk-e2e2' },
        e2e3: { baseUrl: noModelsUrl, apiKey: 'sk-e2e3' },
        e2e4: { baseUrl: htmlModelsUrl, apiKey: 'sk-e2e4' }
    };
    importPayload.models = Array.from(new Set([...(importPayload.models || []), 'e2e2-model']));
    importPayload.currentProvider = 'e2e2';
    importPayload.currentModel = 'e2e2-model';
    importPayload.currentModels = { ...(importPayload.currentModels || {}), e2e2: 'e2e2-model' };

    const importResult = await api('import-config', {
        payload: importPayload,
        options: { overwriteProviders: true, applyCurrent: true, applyCurrentModels: true }
    });
    assert(importResult.success === true, 'import-config failed');

    const exportProviderMissing = await api('export-provider', { name: 'ghost' });
    assert(exportProviderMissing.error, 'export-provider should fail for missing provider');

    const exportProviderEmpty = await api('export-provider', { name: '' });
    assert(exportProviderEmpty.error, 'export-provider should fail for empty name');

    const exportProvider = await api('export-provider', { name: 'e2e2' });
    assert(exportProvider.payload, 'export-provider missing payload');
    assert(exportProvider.payload.baseUrl === mockProviderUrl, 'export-provider baseUrl mismatch');
    assert(exportProvider.payload.apiKey === 'sk-e2e2', 'export-provider apiKey mismatch');
    assert(exportProvider.payload.name === 'e2e2', 'export-provider name mismatch');

    // ========== Status After Import Tests ==========
    const apiStatusAfter = await api('status');
    assert(apiStatusAfter.provider === 'e2e2', 'api status provider after import mismatch');
    assert(apiStatusAfter.model === 'e2e2-model', 'api status model after import mismatch');

    // ========== Models Remote Fetch Tests ==========
    const apiModels = await api('models', { provider: 'e2e2' });
    assert(Array.isArray(apiModels.models) && apiModels.models.includes('e2e2-model-2'), 'api models missing remote entry');

    const apiModelsUnlimited = await api('models', { provider: 'e2e3' });
    assert(apiModelsUnlimited.unlimited === true, 'api models unlimited missing');

    const apiModelsHtml = await api('models', { provider: 'e2e4' });
    assert(apiModelsHtml.unlimited === true, 'api models html unlimited missing');

    const apiModelsByUrl = await api('models-by-url', { baseUrl: mockProviderUrl, apiKey: 'sk-e2e2' });
    assert(Array.isArray(apiModelsByUrl.models) && apiModelsByUrl.models.includes('e2e2-model'), 'api models-by-url missing remote entry');

    const apiModelsByUrlUnlimited = await api('models-by-url', { baseUrl: noModelsUrl });
    assert(apiModelsByUrlUnlimited.unlimited === true, 'api models-by-url unlimited missing');

    // ========== Session Paths Tests ==========
    const apiPaths = await api('list-session-paths', { source: 'codex', limit: 10, forceRefresh: true });
    assert(Array.isArray(apiPaths.paths), 'api session paths missing');
    assert(apiPaths.paths.includes('/tmp/e2e'), 'api session paths missing cwd');

    const apiPathsClaude = await api('list-session-paths', { source: 'claude', limit: 10, forceRefresh: true });
    assert(Array.isArray(apiPathsClaude.paths), 'api session paths(claude) missing');

    const apiPathsAll = await api('list-session-paths', { source: 'all', limit: 10, forceRefresh: true });
    assert(Array.isArray(apiPathsAll.paths), 'api session paths(all) missing');

    const apiPathsInvalid = await api('list-session-paths', { source: 'invalid', limit: 10 });
    assert(apiPathsInvalid.error, 'list-session-paths should fail for invalid source');

    // ========== Add Provider Tests ==========
    const addProvider = await api('add-provider', { name: 'e2e-api', url: mockProviderUrl, key: 'sk-e2e-api' });
    assert(addProvider.success === true, 'add-provider failed');

    const apiListAfterAdd = await api('list');
    assert(Array.isArray(apiListAfterAdd.providers) && apiListAfterAdd.providers.some(p => p.name === 'e2e-api'), 'add-provider not reflected in list');

    const addProviderEmptyName = await api('add-provider', { name: '', url: mockProviderUrl });
    assert(addProviderEmptyName.error, 'add-provider should reject empty name');

    const addProviderEmptyUrl = await api('add-provider', { name: 'test-empty-url', url: '' });
    assert(addProviderEmptyUrl.error, 'add-provider should reject empty url');

    const addProviderDup = await api('add-provider', { name: 'e2e-api', url: mockProviderUrl });
    assert(addProviderDup.error, 'add-provider should reject duplicate provider');

    // ========== Update Provider Tests ==========
    const updatedUrl = `${mockProviderUrl}/v2`;
    const updateProvider = await api('update-provider', { name: 'e2e-api', url: updatedUrl, key: 'sk-e2e-api-upd' });
    assert(updateProvider.success === true, 'update-provider failed');

    const apiListAfterUpdate = await api('list');
    const updatedItem = apiListAfterUpdate.providers.find(p => p.name === 'e2e-api');
    assert(updatedItem && updatedItem.url === updatedUrl, 'update-provider url not reflected in list');
    assert(updatedItem && updatedItem.hasKey === true, 'update-provider key not reflected in list');

    const exportProviderNew = await api('export-provider', { name: 'e2e-api' });
    assert(exportProviderNew.payload, 'export-provider(e2e-api) missing payload');
    assert(exportProviderNew.payload.baseUrl === updatedUrl, 'export-provider(e2e-api) baseUrl mismatch');
    assert(exportProviderNew.payload.apiKey === 'sk-e2e-api-upd', 'export-provider(e2e-api) apiKey mismatch');

    const statusAfterAdd = await api('status');
    assert(statusAfterAdd.provider === 'e2e2', 'add-provider should not change current provider');

    const updateMissing = await api('update-provider', { name: 'nonexistent', url: 'http://x.com' });
    assert(updateMissing.error, 'update-provider should fail for missing provider');

    // ========== Delete Provider Tests ==========
    const deleteProviderMissing = await api('delete-provider', { name: 'nonexistent' });
    assert(deleteProviderMissing.error, 'delete-provider should fail for missing provider');

    const deleteProviderEmpty = await api('delete-provider', { name: '' });
    assert(deleteProviderEmpty.error, 'delete-provider should fail for empty name');

    const deleteProviderResult = await api('delete-provider', { name: 'e2e-api' });
    assert(deleteProviderResult.success === true, 'delete-provider failed');

    const apiListAfterDelete = await api('list');
    assert(!apiListAfterDelete.providers.some(p => p.name === 'e2e-api'), 'delete-provider not reflected in list');

    // ========== Recent Configs Tests ==========
    const recentConfigs = await api('get-recent-configs');
    assert(Array.isArray(recentConfigs.items), 'get-recent-configs should return array');

    ctx.importPayload = importPayload;
};
