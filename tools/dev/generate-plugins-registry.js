#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const pluginsDir = path.join(root, 'plugins');
const registryPath = path.join(pluginsDir, 'registry.mjs');

function toCamelCase(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw
        .split(/[^a-zA-Z0-9]+/g)
        .filter(Boolean)
        .map((part, index) => {
            const head = part.slice(0, 1);
            const tail = part.slice(1);
            if (index === 0) return head.toLowerCase() + tail;
            return head.toUpperCase() + tail;
        })
        .join('');
}

function toPascalCase(value) {
    const camel = toCamelCase(value);
    if (!camel) return '';
    return camel.slice(0, 1).toUpperCase() + camel.slice(1);
}

function listPluginFolders() {
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => !name.startsWith('.'))
        .sort((a, b) => a.localeCompare(b, 'en-US'));
}

function isPluginFolder(name) {
    const manifestPath = path.join(pluginsDir, name, 'manifest.mjs');
    const overviewPath = path.join(pluginsDir, name, 'overview.mjs');
    return fs.existsSync(manifestPath) && fs.existsSync(overviewPath);
}

function generatePluginsRegistrySource() {
    const folders = listPluginFolders().filter((name) => isPluginFolder(name));
    const imports = [];
    const entries = [];
    for (const folder of folders) {
        const camel = toCamelCase(folder);
        const pascal = toPascalCase(folder);
        const metaName = `${camel}Meta`;
        const loadName = `load${pascal}Overview`;
        imports.push(`import { pluginMeta as ${metaName} } from './${folder}/manifest.mjs';`);
        imports.push(`import { ${loadName} } from './${folder}/overview.mjs';`);
        entries.push(`    { id: ${metaName}.id, meta: ${metaName}, loadOverview: ${loadName} }`);
    }
    const lines = [
        ...imports,
        '',
        'export const pluginsRegistry = [',
        ...entries.map((line, index) => (index < entries.length - 1 ? `${line},` : line)),
        '];',
        '',
        'export function getFirstPluginId() {',
        "    return pluginsRegistry.length ? pluginsRegistry[0].id : '';",
        '}',
        '',
        'export function getPluginEntry(id) {',
        "    const key = typeof id === 'string' ? id.trim() : '';",
        '    if (!key) return null;',
        '    return pluginsRegistry.find((item) => item && item.id === key) || null;',
        '}',
        ''
    ];
    return lines.join('\n');
}

function writePluginsRegistry() {
    const next = generatePluginsRegistrySource();
    fs.writeFileSync(registryPath, next, 'utf8');
    return next;
}

function main() {
    writePluginsRegistry();
}

if (require.main === module) {
    main();
}

module.exports = {
    generatePluginsRegistrySource,
    writePluginsRegistry
};

