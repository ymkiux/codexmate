const { assert } = require('./helpers');

module.exports = async function testConfig(ctx) {
    const {
        api,
        mockProviderUrl,
        noModelsUrl,
        htmlModelsUrl,
        authFailUrl
    } = ctx;

    const apiStatus = await api('status');
    assert(apiStatus.provider === 'e2e', 'api status provider mismatch');

    const apiList = await api('list');
    assert(Array.isArray(apiList.providers), 'api list missing providers');
    assert(apiList.providers.some(p => p.name === 'e2e'), 'api list missing provider');

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

    const exportResult = await api('export-config', { includeKeys: true });
    assert(exportResult.data, 'export-config missing data');
    assert(exportResult.data.providers && exportResult.data.providers.e2e, 'export-config missing provider');
    assert(exportResult.data.providers.e2e.apiKey === 'sk-test', 'export-config apiKey mismatch');

    const exportNoKeys = await api('export-config', { includeKeys: false });
    assert(exportNoKeys.data, 'export-config(no keys) missing data');
    assert(exportNoKeys.data.providers && exportNoKeys.data.providers.e2e, 'export-config(no keys) missing provider');
    assert(exportNoKeys.data.providers.e2e.apiKey === null, 'export-config(no keys) apiKey should be null');

    const importInvalid = await api('import-config', { payload: null });
    assert(importInvalid.error && importInvalid.error.includes('Invalid import payload'), 'import-config should reject invalid payload');

    const modelsMissing = await api('models', { provider: 'missing' });
    assert(modelsMissing.error, 'models should fail for missing provider');

    const modelsByUrlInvalid = await api('models-by-url', { baseUrl: 'not-a-url' });
    assert(modelsByUrlInvalid.error, 'models-by-url should fail for invalid url');

    const applyEmpty = await api('apply-config-template', { template: '' });
    assert(applyEmpty.error, 'apply-config-template should reject empty template');

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

    const exportProvider = await api('export-provider', { name: 'e2e2' });
    assert(exportProvider.payload, 'export-provider missing payload');
    assert(exportProvider.payload.baseUrl === mockProviderUrl, 'export-provider baseUrl mismatch');
    assert(exportProvider.payload.apiKey === 'sk-e2e2', 'export-provider apiKey mismatch');

    const apiStatusAfter = await api('status');
    assert(apiStatusAfter.provider === 'e2e2', 'api status provider after import mismatch');
    assert(apiStatusAfter.model === 'e2e2-model', 'api status model after import mismatch');

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

    const apiPaths = await api('list-session-paths', { source: 'codex', limit: 10, forceRefresh: true });
    assert(Array.isArray(apiPaths.paths), 'api session paths missing');
    assert(apiPaths.paths.includes('/tmp/e2e'), 'api session paths missing cwd');

    const addProvider = await api('add-provider', { name: 'e2e-api', url: mockProviderUrl, key: 'sk-e2e-api' });
    assert(addProvider.success === true, 'add-provider failed');

    const apiListAfterAdd = await api('list');
    assert(Array.isArray(apiListAfterAdd.providers) && apiListAfterAdd.providers.some(p => p.name === 'e2e-api'), 'add-provider not reflected in list');

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

    const addProviderDup = await api('add-provider', { name: 'e2e-api', url: mockProviderUrl });
    assert(addProviderDup.error, 'add-provider should reject duplicate provider');

    ctx.importPayload = importPayload;
};
