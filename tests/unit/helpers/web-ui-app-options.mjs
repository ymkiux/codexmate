import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import {
    projectRoot,
    readExecutableBundledWebUiScript
} from './web-ui-source.mjs';

const require = createRequire(import.meta.url);
const sourceBundle = require(path.join(projectRoot, 'web-ui', 'source-bundle.cjs'));

const HEAD_WEB_UI_ENTRY = 'web-ui/app.js';

function setGlobalOverride(name, value) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value
    });
    return () => {
        if (previous) {
            Object.defineProperty(globalThis, name, previous);
            return;
        }
        delete globalThis[name];
    };
}

export async function withGlobalOverrides(overrides, callback) {
    const restoreStack = [];
    try {
        for (const [name, value] of Object.entries(overrides || {})) {
            restoreStack.push(setGlobalOverride(name, value));
        }
        return await callback();
    } finally {
        while (restoreStack.length) {
            const restore = restoreStack.pop();
            restore();
        }
    }
}

function readHeadProjectFile(relativePath) {
    return execFileSync('git', ['show', `HEAD:${relativePath}`], {
        cwd: projectRoot,
        encoding: 'utf8'
    });
}

function createHeadWebUiFixture() {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-head-web-ui-'));
    const entryPath = path.join(projectRoot, HEAD_WEB_UI_ENTRY);
    const dependencyPaths = sourceBundle.collectJavaScriptFiles(entryPath);

    for (const sourcePath of dependencyPaths) {
        const relativePath = path.relative(projectRoot, sourcePath).replace(/\\/g, '/');
        if (!relativePath.startsWith('web-ui/')) {
            throw new Error(`Unexpected head Web UI dependency outside web-ui/: ${relativePath}`);
        }
        const targetPath = path.join(fixtureRoot, relativePath.replace(/^web-ui[\\/]/, ''));
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, readHeadProjectFile(relativePath), 'utf8');
    }
    return fixtureRoot;
}

function createCaptureDocument(listeners) {
    return {
        body: {
            appendChild() {},
            removeChild() {},
            classList: {
                add() {},
                remove() {},
                toggle() {}
            }
        },
        documentElement: {
            clientWidth: 0
        },
        addEventListener(name, fn) {
            listeners[name] = fn;
        },
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        },
        getElementById() {
            return null;
        },
        createElement() {
            return {
                className: '',
                textContent: '',
                href: '',
                download: '',
                appendChild() {},
                removeAttribute() {},
                click() {},
                setAttribute() {},
                select() {},
                setSelectionRange() {},
                parentNode: {
                    removeChild() {}
                },
                classList: {
                    add() {},
                    remove() {},
                    toggle() {}
                },
                style: {}
            };
        },
        execCommand() {
            return false;
        }
    };
}

async function captureAppOptionsFromScript(scriptSource, label) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `codexmate-bundled-web-ui-${label}-`));
    const tempFile = path.join(tempDir, 'app.bundle.mjs');
    const listeners = Object.create(null);
    let appOptions = null;

    fs.writeFileSync(tempFile, scriptSource, 'utf8');

    try {
        await withGlobalOverrides({
            document: createCaptureDocument(listeners),
            location: {
                origin: 'http://127.0.0.1:3737',
                href: 'http://127.0.0.1:3737/web-ui',
                pathname: '/web-ui',
                search: ''
            },
            window: {
                location: {
                    origin: 'http://127.0.0.1:3737',
                    href: 'http://127.0.0.1:3737/web-ui',
                    pathname: '/web-ui',
                    search: ''
                },
                addEventListener() {},
                removeEventListener() {},
                open() {},
                isSecureContext: false,
                screen: {
                    width: 0,
                    height: 0
                },
                innerWidth: 0,
                matchMedia() {
                    return { matches: false };
                }
            },
            localStorage: {
                getItem() {
                    return null;
                },
                setItem() {},
                removeItem() {}
            },
            navigator: {
                clipboard: {
                    async writeText() {}
                },
                maxTouchPoints: 0,
                userAgent: ''
            },
            fetch: async () => ({
                ok: true,
                status: 200,
                headers: {
                    get() {
                        return 'application/json';
                    }
                },
                async json() {
                    return {};
                },
                async text() {
                    return '';
                }
            }),
            requestAnimationFrame(callback) {
                return setTimeout(() => {
                    callback();
                }, 0);
            },
            cancelAnimationFrame(id) {
                clearTimeout(id);
            },
            ResizeObserver: function ResizeObserver() {
                this.observe = () => {};
                this.disconnect = () => {};
            },
            Vue: {
                createApp(options) {
                    appOptions = options;
                    return {
                        mount() {}
                    };
                }
            }
        }, async () => {
            await import(`${pathToFileURL(tempFile).href}?t=${Date.now()}-${Math.random()}`);
            if (typeof listeners.DOMContentLoaded === 'function') {
                await listeners.DOMContentLoaded();
            }
        });
    } finally {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    }

    if (!appOptions) {
        throw new Error(`Failed to capture app options for ${label}`);
    }
    return appOptions;
}

export async function captureCurrentBundledAppOptions() {
    return captureAppOptionsFromScript(readExecutableBundledWebUiScript(), 'current');
}

export async function captureHeadBundledAppOptions() {
    const fixtureRoot = createHeadWebUiFixture();
    try {
        const scriptSource = sourceBundle.readExecutableBundledWebUiScript(path.join(fixtureRoot, 'app.js'));
        return await captureAppOptionsFromScript(scriptSource, 'head');
    } finally {
        try {
            fs.rmSync(fixtureRoot, { recursive: true, force: true });
        } catch (_) {}
    }
}
