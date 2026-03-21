const { spawn } = require('child_process');
const toml = require('@iarna/toml');
const { assert, runSync, fs, path, os, waitForServer, postJson } = require('./helpers');

module.exports = async function testConfig(ctx) {
    const {
        api,
        env,
        node,
        cliPath,
        tmpHome,
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

    const addProviderLocal = await api('add-provider', { name: 'LOCAL', url: mockProviderUrl });
    assert(addProviderLocal.error, 'add-provider should reject reserved local name');

    const addProviderInvalidName = await api('add-provider', { name: 'bad name', url: mockProviderUrl });
    assert(addProviderInvalidName.error, 'add-provider should reject invalid provider name');
    const apiListAfterInvalidName = await api('list');
    assert(
        !apiListAfterInvalidName.providers.some((item) => item && item.name === 'bad name'),
        'add-provider invalid name should not pollute provider list'
    );
    const apiStatusAfterInvalidName = await api('status');
    assert(apiStatusAfterInvalidName.provider, 'status should remain readable after invalid add-provider');

    const dottedProviderName = 'e2e.dot';
    const cliAddDotted = runSync(node, [cliPath, 'add', dottedProviderName, mockProviderUrl, 'sk-e2e-dot'], { env });
    assert(cliAddDotted.status === 0, `cli add dotted provider failed: ${cliAddDotted.stderr || cliAddDotted.stdout}`);
    const cliListAfterDotAdd = runSync(node, [cliPath, 'list'], { env });
    assert(cliListAfterDotAdd.status === 0, 'cli list failed after adding dotted provider');
    assert(cliListAfterDotAdd.stdout.includes(dottedProviderName), 'dotted provider should be listed with original name');
    const dottedUpdatedUrl = `${mockProviderUrl}/dot-v2`;
    const updateDottedProvider = await api('update-provider', { name: dottedProviderName, url: dottedUpdatedUrl, key: 'sk-e2e-dot-upd' });
    assert(updateDottedProvider.success === true, 'update-provider should support dotted provider name');
    const apiListAfterDottedUpdate = await api('list');
    const dottedUpdatedItem = apiListAfterDottedUpdate.providers.find((item) => item.name === dottedProviderName);
    assert(dottedUpdatedItem && dottedUpdatedItem.url === dottedUpdatedUrl, 'dotted provider update should change url');
    const cliSwitchDotted = runSync(node, [cliPath, 'switch', dottedProviderName], { env });
    assert(cliSwitchDotted.status === 0, `cli switch dotted provider failed: ${cliSwitchDotted.stderr || cliSwitchDotted.stdout}`);
    const cliSwitchBack = runSync(node, [cliPath, 'switch', 'e2e2'], { env });
    assert(cliSwitchBack.status === 0, `cli switch back failed: ${cliSwitchBack.stderr || cliSwitchBack.stdout}`);
    const deleteDottedProvider = await api('delete-provider', { name: dottedProviderName });
    assert(deleteDottedProvider.success === true, 'delete-provider should remove dotted provider');

    const legacyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-legacy-dot-'));
    const legacyEnv = {
        ...env,
        HOME: legacyHome,
        USERPROFILE: legacyHome,
        CODEXMATE_FORCE_RESET_EXISTING_CONFIG: '0'
    };
    const legacyCodexDir = path.join(legacyHome, '.codex');
    fs.mkdirSync(legacyCodexDir, { recursive: true });
    const legacyConfig = [
        'model_provider = "openai"',
        'model = "gpt-5.3-codex"',
        '',
        '[model_providers.openai]',
        'name = "openai"',
        'base_url = "https://api.openai.com/v1"',
        'wire_api = "responses"',
        'requires_openai_auth = false',
        'preferred_auth_method = ""',
        'request_max_retries = 4',
        'stream_max_retries = 10',
        'stream_idle_timeout_ms = 300000',
        '',
        '[model_providers.foo.bar]',
        'name = "foo.bar"',
        'base_url = "https://api.example.com/v1"',
        'wire_api = "responses"',
        'requires_openai_auth = false',
        'preferred_auth_method = "sk-legacy"',
        'request_max_retries = 4',
        'stream_max_retries = 10',
        'stream_idle_timeout_ms = 300000',
        ''
    ].join('\n');
    fs.writeFileSync(path.join(legacyCodexDir, 'config.toml'), legacyConfig, 'utf-8');

    const legacyList = runSync(node, [cliPath, 'list'], { env: legacyEnv });
    assert(legacyList.status === 0, `legacy list failed: ${legacyList.stderr || legacyList.stdout}`);
    assert(legacyList.stdout.includes('foo.bar'), 'legacy dotted provider should be recovered in list');
    const legacySwitch = runSync(node, [cliPath, 'switch', 'foo.bar'], { env: legacyEnv });
    assert(legacySwitch.status === 0, `legacy dotted provider switch failed: ${legacySwitch.stderr || legacySwitch.stdout}`);

    const legacyPort = 29000 + Math.floor(Math.random() * 1000);
    const legacyConfigPath = path.join(legacyCodexDir, 'config.toml');
    let legacyServer = null;
    try {
        legacyServer = spawn(node, [cliPath, 'run'], {
            env: { ...legacyEnv, CODEXMATE_PORT: String(legacyPort) },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        legacyServer.stdout.on('data', () => {});
        legacyServer.stderr.on('data', () => {});
        await waitForServer(legacyPort);

        const legacyApi = (action, params) => postJson(legacyPort, { action, params }, 2000);
        const legacyAddDup = await legacyApi('add-provider', {
            name: 'foo.bar',
            url: 'https://dup.example.com/v1',
            key: 'sk-dup'
        });
        assert(legacyAddDup.error, 'legacy duplicate add-provider should be rejected');
        const legacyConfigAfterDup = fs.readFileSync(legacyConfigPath, 'utf-8');
        const providerSectionRegex = /^[ \t]*\[\s*model_providers\s*\.\s*(?:"foo\.bar"|'foo\.bar'|foo\.bar)\s*\][ \t]*(?:#.*)?$/gm;
        const legacyDupSections = legacyConfigAfterDup.match(providerSectionRegex) || [];
        assert(legacyDupSections.length === 1, 'legacy duplicate add-provider should not create extra foo.bar sections');

        const dualSection = [
            '',
            '[model_providers."foo.bar"]',
            'name = "foo.bar"',
            'base_url = "https://quoted.example.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = "sk-quoted"',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            ''
        ].join('\n');
        fs.appendFileSync(legacyConfigPath, dualSection, 'utf-8');

        const legacyUpdateDual = await legacyApi('update-provider', {
            name: 'foo.bar',
            url: 'https://updated.example.com/v1',
            key: 'sk-updated'
        });
        assert(legacyUpdateDual.success === true, 'dual-definition update-provider should succeed');
        const configAfterDualUpdate = fs.readFileSync(legacyConfigPath, 'utf-8');
        assert(configAfterDualUpdate.includes('https://api.example.com/v1'), 'dual-definition update should keep legacy section url');
        assert(!configAfterDualUpdate.includes('https://quoted.example.com/v1'), 'dual-definition update should sync quoted section url');
        const quotedFooBarBlock = configAfterDualUpdate.match(
            /(?:^|\n)\s*\[model_providers\."foo\.bar"\][\s\S]*?(?=\n\s*\[|$)/
        )?.[0];
        assert(quotedFooBarBlock, 'dual-definition update should keep the quoted foo.bar section');
        assert(
            quotedFooBarBlock.includes('base_url = "https://updated.example.com/v1"'),
            'dual-definition update should rewrite the quoted foo.bar url'
        );
        assert(
            quotedFooBarBlock.includes('preferred_auth_method = "sk-updated"'),
            'dual-definition update should rewrite the quoted foo.bar key'
        );

        const legacyDeleteDual = await legacyApi('delete-provider', { name: 'foo.bar' });
        assert(legacyDeleteDual.success === true, 'dual-definition delete-provider should succeed');
        const configAfterDualDelete = fs.readFileSync(legacyConfigPath, 'utf-8');
        const remainingDualSections = configAfterDualDelete.match(providerSectionRegex) || [];
        assert(remainingDualSections.length === 1, 'dual-definition delete-provider should remove the exact matched foo.bar section');
        const remainingLegacyBlock = configAfterDualDelete.match(
            /(?:^|\n)\s*\[model_providers\.foo\.bar\][\s\S]*?(?=\n\s*\[|$)/
        )?.[0];
        assert(remainingLegacyBlock, 'dual-definition first delete should leave the legacy foo.bar block');
        assert(
            !/(?:^|\n)\s*\[model_providers\."foo\.bar"\]/.test(configAfterDualDelete),
            'dual-definition first delete should remove the quoted foo.bar block'
        );
        const legacyListAfterDualDelete = await legacyApi('list');
        assert(
            legacyListAfterDualDelete.providers.some((item) => item && item.name === 'foo.bar'),
            'dual-definition delete-provider should keep remaining foo.bar section available'
        );
        const legacyDeleteDualRemaining = await legacyApi('delete-provider', { name: 'foo.bar' });
        assert(legacyDeleteDualRemaining.success === true, 'dual-definition second delete-provider should remove remaining section');
        const configAfterDualDeleteAll = fs.readFileSync(legacyConfigPath, 'utf-8');
        const finalDualSections = configAfterDualDeleteAll.match(providerSectionRegex) || [];
        assert(finalDualSections.length === 0, 'dual-definition second delete-provider should remove all foo.bar sections');
        const legacyListAfterDualDeleteAll = await legacyApi('list');
        assert(
            !legacyListAfterDualDeleteAll.providers.some((item) => item && item.name === 'foo.bar'),
            'dual-definition second delete-provider should remove foo.bar from provider list'
        );

        const commentMarkerConfig = [
            '# [model_providers."foo.bar"] comment marker only',
            'model_provider = "openai"',
            'model = "gpt-5.3-codex"',
            '',
            '[model_providers.openai]',
            'name = "openai"',
            'base_url = "https://api.openai.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = ""',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            '',
            '[model_providers."foo.bar"]',
            'name = "foo.bar"',
            'base_url = "https://api.example.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = "sk-comment"',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            ''
        ].join('\n');
        fs.writeFileSync(legacyConfigPath, commentMarkerConfig, 'utf-8');
        const deleteWithCommentMarker = await legacyApi('delete-provider', { name: 'foo.bar' });
        assert(deleteWithCommentMarker.success === true, 'delete-provider should ignore comment markers');
        const configAfterCommentDelete = fs.readFileSync(legacyConfigPath, 'utf-8');
        assert(configAfterCommentDelete.includes('model_provider = "openai"'), 'comment-marker delete should keep model_provider line');
        assert(configAfterCommentDelete.includes('[model_providers.openai]'), 'comment-marker delete should keep openai section');
        const commentDeleteSections = configAfterCommentDelete.match(providerSectionRegex) || [];
        assert(commentDeleteSections.length === 0, 'comment-marker delete should remove foo.bar section only');

        const inlineCommentConfig = [
            'model_provider = "foo.bar"',
            'model = "gpt-5.3-codex"',
            '',
            '[model_providers."foo.bar"]',
            'name = "foo.bar"',
            'base_url = "https://api.example.com/v1" # keep-base-comment',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = "sk-old" # keep-key-comment',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            '',
            '[model_providers.openai]',
            'name = "openai"',
            'base_url = "https://api.openai.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = ""',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            ''
        ].join('\n');
        fs.writeFileSync(legacyConfigPath, inlineCommentConfig, 'utf-8');
        const updateWithInlineComment = await legacyApi('update-provider', {
            name: 'foo.bar',
            url: 'https://updated-inline.example.com/v1',
            key: 'sk-inline-new'
        });
        assert(updateWithInlineComment.success === true, 'update-provider should keep inline comments');
        const configAfterInlineCommentUpdate = fs.readFileSync(legacyConfigPath, 'utf-8');
        assert(
            configAfterInlineCommentUpdate.includes('base_url = "https://updated-inline.example.com/v1" # keep-base-comment'),
            'update-provider should preserve base_url inline comment'
        );
        assert(
            configAfterInlineCommentUpdate.includes('preferred_auth_method = "sk-inline-new" # keep-key-comment'),
            'update-provider should preserve preferred_auth_method inline comment'
        );

        const multilineStringConfig = [
            'model_provider = "foo"',
            'model = "gpt-5.3-codex"',
            '',
            '[model_providers.foo]',
            'name = "foo"',
            'base_url = "https://api.example.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = """sk-old',
            'line-2""" # keep-triple-comment',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            '',
            '[model_providers.openai]',
            'name = "openai"',
            'base_url = "https://api.openai.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = ""',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            ''
        ].join('\n');
        fs.writeFileSync(legacyConfigPath, multilineStringConfig, 'utf-8');
        const updateMultilineString = await legacyApi('update-provider', {
            name: 'foo',
            key: 'sk-triple-updated'
        });
        assert(updateMultilineString.success === true, 'update-provider should handle multiline TOML string values');
        const configAfterMultilineUpdate = fs.readFileSync(legacyConfigPath, 'utf-8');
        assert(
            configAfterMultilineUpdate.includes('preferred_auth_method = "sk-triple-updated" # keep-triple-comment'),
            'update-provider should safely replace multiline TOML string and preserve comment'
        );
        assert(
            !configAfterMultilineUpdate.includes('line-2"""'),
            'update-provider should remove previous multiline TOML string tail'
        );
        const parsedAfterMultilineUpdate = toml.parse(configAfterMultilineUpdate);
        assert(
            parsedAfterMultilineUpdate
            && parsedAfterMultilineUpdate.model_providers
            && parsedAfterMultilineUpdate.model_providers.foo
            && parsedAfterMultilineUpdate.model_providers.foo.preferred_auth_method === 'sk-triple-updated',
            'update-provider multiline rewrite should keep config.toml parseable and value readable'
        );
        const cliListAfterMultiline = runSync(node, [cliPath, 'list'], { env: legacyEnv });
        assert(
            cliListAfterMultiline.status === 0,
            `multiline string update should keep config parseable: ${cliListAfterMultiline.stderr || cliListAfterMultiline.stdout}`
        );
        assert(
            cliListAfterMultiline.stdout.includes('foo'),
            'multiline string update should keep provider readable in a fresh process'
        );

        const escapedTripleQuoteConfig = [
            'model_provider = "foo"',
            'model = "gpt-5.3-codex"',
            '',
            '[model_providers.foo]',
            'name = "foo"',
            'base_url = "https://api.example.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = """sk-old\\"""marker',
            'line-2""" # keep-escaped-triple-comment',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            '',
            '[model_providers.openai]',
            'name = "openai"',
            'base_url = "https://api.openai.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = ""',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            ''
        ].join('\n');
        fs.writeFileSync(legacyConfigPath, escapedTripleQuoteConfig, 'utf-8');
        const updateEscapedTripleQuote = await legacyApi('update-provider', {
            name: 'foo',
            key: 'sk-escaped-triple-updated'
        });
        assert(
            updateEscapedTripleQuote.success === true,
            'update-provider should support multiline strings containing escaped triple quotes'
        );
        const configAfterEscapedTripleUpdate = fs.readFileSync(legacyConfigPath, 'utf-8');
        assert(
            configAfterEscapedTripleUpdate.includes('preferred_auth_method = "sk-escaped-triple-updated" # keep-escaped-triple-comment'),
            'escaped triple-quote multiline update should preserve inline comment'
        );
        const parsedAfterEscapedTripleUpdate = toml.parse(configAfterEscapedTripleUpdate);
        assert(
            parsedAfterEscapedTripleUpdate
            && parsedAfterEscapedTripleUpdate.model_providers
            && parsedAfterEscapedTripleUpdate.model_providers.foo
            && parsedAfterEscapedTripleUpdate.model_providers.foo.preferred_auth_method === 'sk-escaped-triple-updated',
            'escaped triple-quote multiline rewrite should keep config.toml parseable and value readable'
        );

        const multilineLiteralTrailingBackslashConfig = [
            'model_provider = "foo"',
            'model = "gpt-5.3-codex"',
            '',
            '[model_providers.foo]',
            'name = "foo"',
            'base_url = "https://api.example.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            "preferred_auth_method = '''sk-old\\''' # keep-literal-triple-comment",
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            '',
            '[model_providers.openai]',
            'name = "openai"',
            'base_url = "https://api.openai.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = ""',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            ''
        ].join('\n');
        fs.writeFileSync(legacyConfigPath, multilineLiteralTrailingBackslashConfig, 'utf-8');
        const updateMultilineLiteralTrailingBackslash = await legacyApi('update-provider', {
            name: 'foo',
            key: 'sk-literal-triple-updated'
        });
        assert(
            updateMultilineLiteralTrailingBackslash.success === true,
            'update-provider should handle multiline literal strings with trailing backslashes'
        );
        const configAfterMultilineLiteralTrailingBackslashUpdate = fs.readFileSync(legacyConfigPath, 'utf-8');
        assert(
            configAfterMultilineLiteralTrailingBackslashUpdate.includes('preferred_auth_method = "sk-literal-triple-updated" # keep-literal-triple-comment'),
            'multiline literal rewrite should preserve inline comment'
        );
        const parsedAfterMultilineLiteralTrailingBackslashUpdate = toml.parse(configAfterMultilineLiteralTrailingBackslashUpdate);
        assert(
            parsedAfterMultilineLiteralTrailingBackslashUpdate
            && parsedAfterMultilineLiteralTrailingBackslashUpdate.model_providers
            && parsedAfterMultilineLiteralTrailingBackslashUpdate.model_providers.foo
            && parsedAfterMultilineLiteralTrailingBackslashUpdate.model_providers.foo.preferred_auth_method === 'sk-literal-triple-updated',
            'multiline literal rewrite should keep config.toml parseable and value readable'
        );

        const missingFieldConfig = [
            'model_provider = "foo"',
            'model = "gpt-5.3-codex"',
            '',
            '[model_providers.foo]',
            'name = "foo"',
            'base_url = "https://api.example.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            '',
            '[model_providers.openai]',
            'name = "openai"',
            'base_url = "https://api.openai.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = ""',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            ''
        ].join('\n');
        fs.writeFileSync(legacyConfigPath, missingFieldConfig, 'utf-8');
        const updateMissingField = await legacyApi('update-provider', {
            name: 'foo',
            key: 'sk-added-field'
        });
        assert(updateMissingField.success === true, 'update-provider should append missing preferred_auth_method field');
        const configAfterMissingFieldUpdate = fs.readFileSync(legacyConfigPath, 'utf-8');
        assert(
            configAfterMissingFieldUpdate.includes('preferred_auth_method = "sk-added-field"'),
            'update-provider should append preferred_auth_method when field is missing'
        );
        const parsedAfterMissingFieldUpdate = toml.parse(configAfterMissingFieldUpdate);
        assert(
            parsedAfterMissingFieldUpdate
            && parsedAfterMissingFieldUpdate.model_providers
            && parsedAfterMissingFieldUpdate.model_providers.foo
            && parsedAfterMissingFieldUpdate.model_providers.foo.preferred_auth_method === 'sk-added-field',
            'missing-field rewrite should keep config.toml parseable and value readable'
        );
        const exportMissingFieldProvider = await legacyApi('export-provider', { name: 'foo' });
        assert(
            exportMissingFieldProvider.payload && exportMissingFieldProvider.payload.apiKey === 'sk-added-field',
            'appended preferred_auth_method should be readable via export-provider'
        );

        const nestedMetadataConfig = [
            'model_provider = "foo"',
            'model = "gpt-5.3-codex"',
            '',
            '[model_providers.foo]',
            'name = "foo"',
            'base_url = "https://api.example.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = "sk-foo"',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            '',
            '[model_providers.foo.metadata]',
            'name = "metadata"',
            'base_url = "https://metadata.example.com/v1"',
            'owner = "team-a"',
            ''
        ].join('\n');
        fs.writeFileSync(legacyConfigPath, nestedMetadataConfig, 'utf-8');
        const nestedMetadataList = await legacyApi('list');
        assert(
            nestedMetadataList.providers.some((item) => item && item.name === 'foo'),
            'nested metadata config should keep foo provider'
        );
        assert(
            !nestedMetadataList.providers.some((item) => item && item.name === 'foo.metadata'),
            'nested metadata should not be promoted to provider'
        );

        const topLevelMetadataNamespaceConfig = [
            'model_provider = "foo"',
            'model = "gpt-5.3-codex"',
            '',
            '[model_providers.foo]',
            'name = "foo"',
            'base_url = "https://api.example.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = "sk-foo"',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            '',
            '[model_providers.metadata.foo]',
            'base_url = "https://metadata-foo.example.com/v1"',
            'wire_api = "responses"',
            'preferred_auth_method = "sk-metadata-foo"',
            ''
        ].join('\n');
        fs.writeFileSync(legacyConfigPath, topLevelMetadataNamespaceConfig, 'utf-8');
        const topLevelMetadataList = await legacyApi('list');
        assert(
            topLevelMetadataList.providers.some((item) => item && item.name === 'metadata.foo'),
            'top-level metadata namespace should still recover nested provider'
        );
        assert(
            !topLevelMetadataList.providers.some((item) => item && item.name === 'metadata'),
            'top-level metadata namespace root should not be exposed as provider'
        );
        const topLevelMetadataExport = await legacyApi('export-provider', { name: 'metadata.foo' });
        assert(
            topLevelMetadataExport.payload && topLevelMetadataExport.payload.baseUrl === 'https://metadata-foo.example.com/v1',
            'top-level metadata namespace recovered provider should be exportable'
        );
        assert(
            topLevelMetadataExport.payload && topLevelMetadataExport.payload.apiKey === 'sk-metadata-foo',
            'top-level metadata namespace recovered provider should keep api key'
        );

        const dottedNestedProviderConfig = [
            'model_provider = "foo"',
            'model = "gpt-5.3-codex"',
            '',
            '[model_providers.foo]',
            'name = "foo"',
            'base_url = "https://api.example.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = "sk-foo"',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            '',
            "[ model_providers . foo . 'bar.metadata' ]",
            'base_url = "https://bar-metadata.example.com/v1"',
            'wire_api = "responses"',
            'preferred_auth_method = "sk-bar-metadata"',
            ''
        ].join('\n');
        fs.writeFileSync(legacyConfigPath, dottedNestedProviderConfig, 'utf-8');
        const dottedNestedProviderList = await legacyApi('list');
        assert(
            dottedNestedProviderList.providers.some((item) => item && item.name === 'foo.bar.metadata'),
            'nested provider keys containing dot suffix should not be filtered as metadata'
        );
        const dottedNestedProviderUpdate = await legacyApi('update-provider', {
            name: 'foo.bar.metadata',
            url: 'https://bar-metadata-updated.example.com/v1',
            key: 'sk-bar-metadata-updated'
        });
        assert(
            dottedNestedProviderUpdate.success === true,
            'nested provider with dotted segment should support update-provider'
        );
        const dottedNestedProviderExport = await legacyApi('export-provider', { name: 'foo.bar.metadata' });
        assert(
            dottedNestedProviderExport.payload && dottedNestedProviderExport.payload.baseUrl === 'https://bar-metadata-updated.example.com/v1',
            'nested provider with dotted segment should update baseUrl'
        );
        assert(
            dottedNestedProviderExport.payload && dottedNestedProviderExport.payload.apiKey === 'sk-bar-metadata-updated',
            'nested provider with dotted segment should update apiKey'
        );

        const ambiguousNestedProviderConfig = [
            'model_provider = "foo"',
            'model = "gpt-5.3-codex"',
            '',
            '[model_providers.foo]',
            'name = "foo"',
            'base_url = "https://api.example.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = "sk-foo"',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            '',
            "[ model_providers . foo . 'bar.baz' ]",
            'base_url = "https://primary.example.com/v1"',
            'wire_api = "responses"',
            'preferred_auth_method = "sk-primary"',
            '',
            '[model_providers."foo.bar".baz]',
            'base_url = "https://alt.example.com/v1"',
            'wire_api = "responses"',
            'preferred_auth_method = "sk-alt"',
            ''
        ].join('\n');
        fs.writeFileSync(legacyConfigPath, ambiguousNestedProviderConfig, 'utf-8');
        const ambiguousList = await legacyApi('list');
        const ambiguousMatches = ambiguousList.providers.filter((item) => item && item.name === 'foo.bar.baz');
        assert(ambiguousMatches.length === 1, 'ambiguous nested provider config should expose exactly one flattened provider entry');
        const ambiguousUpdate = await legacyApi('update-provider', {
            name: 'foo.bar.baz',
            url: 'https://primary-updated.example.com/v1',
            key: 'sk-primary-updated'
        });
        assert(ambiguousUpdate.success === true, 'ambiguous nested provider update should succeed');
        const configAfterAmbiguousUpdate = fs.readFileSync(legacyConfigPath, 'utf-8');
        const primaryBlockMatch = configAfterAmbiguousUpdate.match(
            /(?:^|\n)\s*\[\s*model_providers\s*\.\s*foo\s*\.\s*'bar\.baz'\s*\][\s\S]*?(?=\n\s*\[|$)/
        );
        assert(primaryBlockMatch, 'primary nested provider block should exist after ambiguous update');
        assert(
            primaryBlockMatch[0].includes('base_url = "https://primary-updated.example.com/v1"'),
            'ambiguous update should target primary nested provider block url'
        );
        assert(
            primaryBlockMatch[0].includes('preferred_auth_method = "sk-primary-updated"'),
            'ambiguous update should target primary nested provider block key'
        );
        const alternateBlockMatch = configAfterAmbiguousUpdate.match(
            /(?:^|\n)\s*\[\s*model_providers\s*\.\s*"foo\.bar"\s*\.\s*baz\s*\][\s\S]*?(?=\n\s*\[|$)/
        );
        assert(alternateBlockMatch, 'alternate nested provider block should exist after ambiguous update');
        assert(
            alternateBlockMatch[0].includes('base_url = "https://alt.example.com/v1"'),
            'ambiguous update should not rewrite alternate nested provider block url'
        );
        assert(
            alternateBlockMatch[0].includes('preferred_auth_method = "sk-alt"'),
            'ambiguous update should not rewrite alternate nested provider block key'
        );

        const ipv6Config = [
            'model_provider = "foo"',
            'model = "gpt-5.3-codex"',
            '',
            '[model_providers.foo]',
            'name = "foo"',
            'base_url = "https://[2001:db8::1]/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = "sk-ipv6"',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            '',
            '[model_providers.openai]',
            'name = "openai"',
            'base_url = "https://api.openai.com/v1"',
            'wire_api = "responses"',
            'requires_openai_auth = false',
            'preferred_auth_method = ""',
            'request_max_retries = 4',
            'stream_max_retries = 10',
            'stream_idle_timeout_ms = 300000',
            ''
        ].join('\n');
        fs.writeFileSync(legacyConfigPath, ipv6Config, 'utf-8');
        const ipv6Update = await legacyApi('update-provider', {
            name: 'foo',
            url: 'https://api2.example.com/v1',
            key: 'sk-ipv6-updated'
        });
        assert(ipv6Update.success === true, 'ipv6 update-provider should succeed');
        const configAfterIpv6Update = fs.readFileSync(legacyConfigPath, 'utf-8');
        assert(configAfterIpv6Update.includes('base_url = "https://api2.example.com/v1"'), 'ipv6 update should update provider url');
        assert(!configAfterIpv6Update.includes('[2001:db8::1]/v1"'), 'ipv6 update should not corrupt provider block');
        const ipv6Delete = await legacyApi('delete-provider', { name: 'foo' });
        assert(ipv6Delete.success === true, 'ipv6 delete-provider should succeed');
        const configAfterIpv6Delete = fs.readFileSync(legacyConfigPath, 'utf-8');
        assert(configAfterIpv6Delete.includes('model_provider = "openai"'), 'ipv6 delete should keep fallback model_provider');
        assert(configAfterIpv6Delete.includes('[model_providers.openai]'), 'ipv6 delete should keep openai section');
        assert(!configAfterIpv6Delete.includes('[2001:db8::1]/v1"'), 'ipv6 delete should not leave corrupted leftovers');
    } finally {
        if (legacyServer) {
            const waitExit = new Promise((resolve) => {
                legacyServer.once('exit', () => resolve());
                if (legacyServer.exitCode !== null || legacyServer.signalCode) {
                    resolve();
                }
            });
            try {
                legacyServer.kill('SIGINT');
            } catch (e) {}
            await waitExit;
        }
    }

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

    // quotedApiKey is the runtime value used for API update/export round-trip.
    // configPath/configAfterQuotedUpdate validates the persisted TOML line where
    // quotes/backslashes are escaped for TOML syntax.
    const quotedApiKey = 'sk-e2e-"quoted"-\\\\path';
    const updateProviderQuoted = await api('update-provider', { name: 'e2e-api', key: quotedApiKey });
    assert(updateProviderQuoted.success === true, 'update-provider should handle quoted API key');
    const exportProviderQuoted = await api('export-provider', { name: 'e2e-api' });
    assert(exportProviderQuoted.payload, 'export-provider(e2e-api quoted) missing payload');
    assert(exportProviderQuoted.payload.apiKey === quotedApiKey, 'quoted API key should round-trip');
    assert(exportProviderQuoted.payload.baseUrl === updatedUrl, 'quoted API key update should not change provider baseUrl');
    const configPath = path.join(tmpHome, '.codex', 'config.toml');
    const configAfterQuotedUpdate = fs.readFileSync(configPath, 'utf-8');
    const e2eApiBlockMatch = configAfterQuotedUpdate.match(
        /(?:^|\n)\s*\[model_providers\.(?:"e2e-api"|'e2e-api'|e2e-api)\][\s\S]*?(?=\n\s*\[|$)/
    );
    assert(e2eApiBlockMatch, 'config.toml should contain e2e-api provider block after quoted update');
    const e2eApiBlock = e2eApiBlockMatch[0];
    const e2eApiBlockHeaderMatch = e2eApiBlock.match(
        /\[\s*model_providers\.(?:"([^"]+)"|'([^']+)'|([^\]\s]+))\s*\]/
    );
    const e2eApiProviderKey = e2eApiBlockHeaderMatch
        && (e2eApiBlockHeaderMatch[1] || e2eApiBlockHeaderMatch[2] || e2eApiBlockHeaderMatch[3]);
    const parsedAfterQuotedUpdate = toml.parse(configAfterQuotedUpdate);
    assert(
        parsedAfterQuotedUpdate
        && parsedAfterQuotedUpdate.model_providers
        && e2eApiProviderKey
        && parsedAfterQuotedUpdate.model_providers[e2eApiProviderKey]
        && parsedAfterQuotedUpdate.model_providers[e2eApiProviderKey].preferred_auth_method === quotedApiKey,
        'quoted API key rewrite should keep config.toml parseable and runtime value readable'
    );
    // Expected TOML fragment:
    // preferred_auth_method = "sk-e2e-\\\"quoted\\\"-\\\\\\\\path"
    assert(
        e2eApiBlock.includes('preferred_auth_method = "sk-e2e-\\"quoted\\"-\\\\\\\\path"'),
        'quoted API key should be escaped in config.toml'
    );
    const cliListAfterQuoted = runSync(node, [cliPath, 'list'], { env });
    assert(
        cliListAfterQuoted.status === 0,
        `quoted API key should keep config parseable: ${cliListAfterQuoted.stderr || cliListAfterQuoted.stdout}`
    );
    assert(
        cliListAfterQuoted.stdout.includes('e2e-api'),
        'quoted API key should keep provider readable in fresh process'
    );

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
