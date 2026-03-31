import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { createSkillsMethods } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'skills.methods.mjs')));
const { createSkillsComputed } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'skills.computed.mjs')));

function buildVm(apiImpl, overrides = {}) {
    const methods = createSkillsMethods({ api: apiImpl });
    const vm = {
        skillsTargetApp: 'codex',
        skillsRootPath: '',
        skillsList: [],
        skillsSelectedNames: [],
        skillsLoading: false,
        skillsDeleting: false,
        skillsKeyword: '',
        skillsStatusFilter: 'all',
        skillsImportList: [],
        skillsImportSelectedKeys: [],
        skillsScanningImports: false,
        skillsImporting: false,
        skillsZipImporting: false,
        skillsExporting: false,
        skillsMarketLoading: false,
        skillsMarketLocalLoadedOnce: false,
        skillsMarketImportLoadedOnce: false,
        showSkillsModal: false,
        messageLog: [],
        showMessage(message, type) {
            this.messageLog.push({ message, type });
        },
        requestConfirmDialog: async () => true,
        $refs: {},
        ...methods,
        ...overrides
    };

    const computed = createSkillsComputed();
    for (const [key, getter] of Object.entries(computed)) {
        Object.defineProperty(vm, key, {
            configurable: true,
            enumerable: true,
            get() {
                return getter.call(vm);
            }
        });
    }

    return vm;
}

test('refreshSkillsList requests generic skills API for current host target', async () => {
    const calls = [];
    const vm = buildVm(async (action, params) => {
        calls.push({ action, params });
        return {
            exists: true,
            root: '/tmp/claude-skills',
            items: [{ name: 'demo-skill', hasSkillFile: true }]
        };
    }, {
        skillsTargetApp: 'claude'
    });

    const ok = await vm.refreshSkillsList({ silent: true });

    assert.strictEqual(ok, true);
    assert.deepStrictEqual(calls, [{
        action: 'list-skills',
        params: { targetApp: 'claude' }
    }]);
    assert.strictEqual(vm.skillsRootPath, '/tmp/claude-skills');
    assert.strictEqual(vm.skillsList.length, 1);
});

test('setSkillsTargetApp resets local state and reloads local market slices only', async () => {
    let receivedOptions = null;
    const vm = buildVm(async () => ({}), {
        skillsTargetApp: 'codex',
        skillsRootPath: '/tmp/codex-skills',
        skillsList: [{ name: 'alpha', hasSkillFile: true }],
        skillsImportList: [{ name: 'beta', sourceApp: 'claude' }]
    });
    vm.loadSkillsMarketOverview = async (options) => {
        receivedOptions = options;
        return true;
    };

    const ok = await vm.setSkillsTargetApp('claude', { silent: false });

    assert.strictEqual(ok, true);
    assert.strictEqual(vm.skillsTargetApp, 'claude');
    assert.deepStrictEqual(vm.skillsList, []);
    assert.deepStrictEqual(vm.skillsImportList, []);
    assert.deepStrictEqual(receivedOptions, {
        forceRefresh: true,
        silent: false
    });
});

test('setSkillsTargetApp returns false while any skills action is in flight', async () => {
    let loadCalled = false;
    const vm = buildVm(async () => ({}), {
        skillsTargetApp: 'codex',
        skillsImporting: true
    });
    vm.loadSkillsMarketOverview = async () => {
        loadCalled = true;
        return true;
    };

    const ok = await vm.setSkillsTargetApp('claude', { silent: false });

    assert.strictEqual(ok, false);
    assert.strictEqual(vm.skillsTargetApp, 'codex');
    assert.strictEqual(loadCalled, false);
});

test('normalizeSkillsTargetApp rejects unsupported explicit targets', () => {
    const vm = buildVm(async () => ({}));

    assert.strictEqual(vm.normalizeSkillsTargetApp(undefined), 'codex');
    assert.strictEqual(vm.normalizeSkillsTargetApp('codex'), 'codex');
    assert.strictEqual(vm.normalizeSkillsTargetApp('claude'), 'claude');
    assert.throws(() => vm.normalizeSkillsTargetApp('Claude'), /Unsupported skills target app/);
    assert.throws(() => vm.normalizeSkillsTargetApp(' claude '), /Unsupported skills target app/);
});

test('setSkillsTargetApp rejects invalid explicit target without mutating state', async () => {
    let loadCalled = false;
    const vm = buildVm(async () => ({}), {
        skillsTargetApp: 'codex',
        skillsRootPath: '/tmp/codex-skills',
        skillsList: [{ name: 'alpha', hasSkillFile: true }]
    });
    vm.loadSkillsMarketOverview = async () => {
        loadCalled = true;
        return true;
    };

    const ok = await vm.setSkillsTargetApp('Claude', { silent: false });

    assert.strictEqual(ok, false);
    assert.strictEqual(vm.skillsTargetApp, 'codex');
    assert.deepStrictEqual(vm.skillsList, [{ name: 'alpha', hasSkillFile: true }]);
    assert.strictEqual(loadCalled, false);
    assert.deepStrictEqual(vm.messageLog, [{
        message: '不支持的 Skills 安装目标：Claude',
        type: 'error'
    }]);
});

test('openSkillsManager rejects invalid explicit target without reopening the modal', async () => {
    let refreshCalls = 0;
    const vm = buildVm(async () => ({}), {
        skillsTargetApp: 'codex',
        showSkillsModal: false
    });
    vm.refreshSkillsList = async () => {
        refreshCalls += 1;
        return true;
    };

    await vm.openSkillsManager({ targetApp: 'Claude' });

    assert.strictEqual(vm.skillsTargetApp, 'codex');
    assert.strictEqual(vm.showSkillsModal, false);
    assert.strictEqual(refreshCalls, 0);
    assert.deepStrictEqual(vm.messageLog, [{
        message: '不支持的 Skills 安装目标：Claude',
        type: 'error'
    }]);
});

test('openSkillsManager keeps market overview state when reopening same target', async () => {
    const refreshCalls = [];
    const vm = buildVm(async () => ({}), {
        skillsTargetApp: 'codex',
        skillsSelectedNames: ['alpha'],
        skillsKeyword: 'demo',
        skillsStatusFilter: 'missing',
        skillsImportList: [{ name: 'beta', sourceApp: 'claude' }],
        skillsImportSelectedKeys: ['claude:beta'],
        skillsMarketLocalLoadedOnce: true,
        skillsMarketImportLoadedOnce: true
    });
    vm.refreshSkillsList = async (options) => {
        refreshCalls.push(options);
        return true;
    };

    await vm.openSkillsManager({ targetApp: 'codex' });

    assert.strictEqual(vm.showSkillsModal, true);
    assert.deepStrictEqual(vm.skillsImportList, [{ name: 'beta', sourceApp: 'claude' }]);
    assert.strictEqual(vm.skillsMarketLocalLoadedOnce, true);
    assert.strictEqual(vm.skillsMarketImportLoadedOnce, true);
    assert.deepStrictEqual(vm.skillsSelectedNames, []);
    assert.deepStrictEqual(vm.skillsImportSelectedKeys, []);
    assert.strictEqual(vm.skillsKeyword, '');
    assert.strictEqual(vm.skillsStatusFilter, 'all');
    assert.deepStrictEqual(refreshCalls, [{ silent: false }]);
});

test('loadSkillsMarketOverview refreshes installed skills and importable sources only', async () => {
    const steps = [];
    const vm = buildVm(async () => ({}));
    vm.refreshSkillsList = async (options) => {
        steps.push(['refresh', options]);
        vm.skillsMarketLocalLoadedOnce = true;
        return true;
    };
    vm.scanImportableSkills = async (options) => {
        steps.push(['scan', options]);
        vm.skillsMarketImportLoadedOnce = true;
        return true;
    };

    const ok = await vm.loadSkillsMarketOverview({ forceRefresh: true, silent: true });

    assert.strictEqual(ok, true);
    assert.deepStrictEqual(steps, [
        ['refresh', { silent: true }],
        ['scan', { silent: true }]
    ]);
    assert.strictEqual(vm.skillsMarketLoading, false);
});

test('scanImportableSkills returns false when another skills action is already running', async () => {
    let apiCalls = 0;
    const vm = buildVm(async () => {
        apiCalls += 1;
        return {};
    }, {
        skillsImporting: true
    });

    const ok = await vm.scanImportableSkills({ silent: true });

    assert.strictEqual(ok, false);
    assert.strictEqual(apiCalls, 0);
});

test('scanImportableSkills returns false while delete is in progress', async () => {
    let apiCalls = 0;
    const vm = buildVm(async () => {
        apiCalls += 1;
        return {};
    }, {
        skillsDeleting: true
    });

    const ok = await vm.scanImportableSkills({ silent: true });

    assert.strictEqual(ok, false);
    assert.strictEqual(apiCalls, 0);
});

test('skills import and export entrypoints return early while delete is in progress', async () => {
    let apiCalls = 0;
    let uploadCalls = 0;
    const vm = buildVm(async () => {
        apiCalls += 1;
        return {};
    }, {
        skillsDeleting: true,
        skillsImportList: [{ name: 'beta', sourceApp: 'claude' }],
        skillsImportSelectedKeys: ['claude:beta'],
        skillsSelectedNames: ['alpha']
    });
    vm.uploadSkillsZipStream = async () => {
        uploadCalls += 1;
        return {};
    };

    await vm.importSelectedSkills();
    await vm.importSkillsFromZipFile({ name: 'skills.zip', size: 1024 });
    await vm.exportSelectedSkills();

    assert.strictEqual(apiCalls, 0);
    assert.strictEqual(uploadCalls, 0);
    assert.deepStrictEqual(vm.messageLog, []);
});

test('skills import entrypoints return early while scan is in progress', async () => {
    let apiCalls = 0;
    let uploadCalls = 0;
    const vm = buildVm(async () => {
        apiCalls += 1;
        return {};
    }, {
        skillsScanningImports: true,
        skillsImportList: [{ name: 'beta', sourceApp: 'claude' }],
        skillsImportSelectedKeys: ['claude:beta']
    });
    vm.uploadSkillsZipStream = async () => {
        uploadCalls += 1;
        return {};
    };

    await vm.importSelectedSkills();
    await vm.importSkillsFromZipFile({ name: 'skills.zip', size: 1024 });

    assert.strictEqual(apiCalls, 0);
    assert.strictEqual(uploadCalls, 0);
    assert.deepStrictEqual(vm.messageLog, []);
});

test('deleteSelectedSkills reports busy state while import sources scan is running', async () => {
    let confirmCalls = 0;
    let apiCalls = 0;
    const vm = buildVm(async () => {
        apiCalls += 1;
        return {};
    }, {
        skillsScanningImports: true,
        skillsSelectedNames: ['alpha'],
        requestConfirmDialog: async () => {
            confirmCalls += 1;
            return true;
        }
    });

    await vm.deleteSelectedSkills();

    assert.strictEqual(confirmCalls, 0);
    assert.strictEqual(apiCalls, 0);
    assert.deepStrictEqual(vm.messageLog, [{
        message: '正在扫描导入源，请稍后再试',
        type: 'error'
    }]);
});

test('deleteSelectedSkills wires confirm dialog disabled state to live scan status', async () => {
    let confirmOptions = null;
    const vm = buildVm(async () => ({}), {
        skillsSelectedNames: ['alpha'],
        requestConfirmDialog: async (options) => {
            confirmOptions = options;
            return false;
        }
    });

    await vm.deleteSelectedSkills();

    assert(confirmOptions, 'confirm dialog should be opened');
    assert.strictEqual(typeof confirmOptions.confirmDisabled, 'function');
    assert.strictEqual(confirmOptions.confirmDisabled.call(vm), false);
    vm.skillsScanningImports = true;
    assert.strictEqual(confirmOptions.confirmDisabled.call(vm), true);
});
