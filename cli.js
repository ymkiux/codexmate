#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const toml = require('@iarna/toml');
const { exec, execSync } = require('child_process');
const http = require('http');

const PORT = 3737;

// ============================================================================
// 配置
// ============================================================================
const CONFIG_DIR = path.join(os.homedir(), '.codex');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.toml');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');
const MODELS_FILE = path.join(CONFIG_DIR, 'models.json');
const CURRENT_MODELS_FILE = path.join(CONFIG_DIR, 'provider-current-models.json');

const DEFAULT_MODELS = ['gpt-5.1-codex-max', 'gpt-4-turbo', 'gpt-4'];

// ============================================================================
// 工具函数
// ============================================================================
function ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

function readConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        console.error('配置文件不存在:', CONFIG_FILE);
        process.exit(1);
    }
    try {
        const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
        return toml.parse(content);
    } catch (e) {
        console.error('配置文件解析失败:', e.message);
        process.exit(1);
    }
}

function writeConfig(content) {
    try {
        fs.writeFileSync(CONFIG_FILE, content, 'utf-8');
    } catch (e) {
        console.error('写入配置失败:', e.message);
        process.exit(1);
    }
}

function readModels() {
    if (fs.existsSync(MODELS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(MODELS_FILE, 'utf-8'));
        } catch (e) {}
    }
    return [...DEFAULT_MODELS];
}

function writeModels(models) {
    fs.writeFileSync(MODELS_FILE, JSON.stringify(models, null, 2), 'utf-8');
}

function readCurrentModels() {
    if (fs.existsSync(CURRENT_MODELS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CURRENT_MODELS_FILE, 'utf-8'));
        } catch (e) {}
    }
    return {};
}

function writeCurrentModels(data) {
    fs.writeFileSync(CURRENT_MODELS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function updateAuthJson(apiKey) {
    let authData = {};
    if (fs.existsSync(AUTH_FILE)) {
        try {
            const content = fs.readFileSync(AUTH_FILE, 'utf-8');
            if (content.trim()) authData = JSON.parse(content);
        } catch (e) {}
    }
    authData['OPENAI_API_KEY'] = apiKey;
    fs.writeFileSync(AUTH_FILE, JSON.stringify(authData, null, 2), 'utf-8');
}

// ============================================================================
// 命令
// ============================================================================

// 显示当前状态
function cmdStatus() {
    const config = readConfig();
    const current = config.model_provider || '未设置';
    const currentModel = config.model || '未设置';
    const models = readModels();
    const currentModels = readCurrentModels();

    console.log('\n当前状态:');
    console.log('  提供商:', current);
    console.log('  模型:', currentModel);
    console.log('  模型列表:', models.length, '个');
    console.log();
}

// 列出所有提供商
function cmdList() {
    const config = readConfig();
    const providers = config.model_providers || {};
    const current = config.model_provider;

    console.log('\n提供商列表:');
    console.log('┌─────────────────────────────────────────────────────────┐');

    const names = Object.keys(providers);
    if (names.length === 0) {
        console.log('│  (无)                                                         │');
    } else {
        names.forEach(name => {
            const p = providers[name];
            const isCurrent = name === current;
            const marker = isCurrent ? '●' : ' ';
            const key = p.preferred_auth_method || '(无密钥)';
            const displayKey = key.length > 30 ? key.substring(0, 27) + '...' : key;

            console.log(`│ ${marker} ${name.padEnd(20)}  ${displayKey.padEnd(31)} │`);
        });
    }

    console.log('└─────────────────────────────────────────────────────────┘');
    console.log(`总计: ${names.length} 个提供商`);
    console.log();
}

// 列出所有模型
function cmdModels() {
    const models = readModels();
    const currentModels = readCurrentModels();

    console.log('\n可用模型:');
    models.forEach((m, i) => {
        const users = Object.entries(currentModels)
            .filter(([_, model]) => model === m)
            .map(([name, _]) => name);
        const usage = users.length > 0 ? users.join(', ') : '(未使用)';
        console.log(`  ${i + 1}. ${m}`);
        if (users.length > 0) {
            console.log(`     → ${usage}`);
        }
    });
    console.log();
}

// 切换提供商
function cmdSwitch(providerName, silent = false) {
    const config = readConfig();
    const providers = config.model_providers || {};

    if (!providers[providerName]) {
        if (!silent) {
            console.error('错误: 提供商不存在:', providerName);
            console.log('\n可用的提供商:');
            Object.keys(providers).forEach(name => console.log('  -', name));
        }
        throw new Error('提供商不存在');
    }

    // 切换提供商
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const newContent = content.replace(
        /^(model_provider\s*=\s*)(["']).*?(["'])/m,
        `$1$2${providerName}$3`
    );
    writeConfig(newContent);

    // 更新认证信息
    const apiKey = providers[providerName].preferred_auth_method || '';
    updateAuthJson(apiKey);

    // 切换到该提供商的模型
    const currentModels = readCurrentModels();
    const targetModel = currentModels[providerName] || readModels()[0];
    const content2 = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const modelRegex = /^(model\s*=\s*)(["']).*?(["'])/m;
    if (modelRegex.test(content2)) {
        const newContent2 = content2.replace(modelRegex, `$1$2${targetModel}$3`);
        writeConfig(newContent2);
    }

    if (!silent) {
        console.log('✓ 已切换到:', providerName);
        console.log('✓ 当前模型:', targetModel);
        console.log();
    }
    return targetModel;
}

// 切换模型
function cmdUseModel(modelName, silent = false) {
    const models = readModels();
    if (!models.includes(modelName)) {
        if (!silent) {
            console.error('错误: 模型不存在:', modelName);
            console.log('\n可用的模型:');
            models.forEach(m => console.log('  -', m));
        }
        throw new Error('模型不存在');
    }

    const config = readConfig();
    const currentProvider = config.model_provider;
    if (!currentProvider) {
        if (!silent) console.error('错误: 未设置当前提供商');
        throw new Error('未设置当前提供商');
    }

    // 更新模型
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const modelRegex = /^(model\s*=\s*)(["']).*?(["'])/m;
    if (modelRegex.test(content)) {
        const newContent = content.replace(modelRegex, `$1$2${modelName}$3`);
        writeConfig(newContent);
    }

    // 保存当前提供商的模型选择
    const currentModels = readCurrentModels();
    currentModels[currentProvider] = modelName;
    writeCurrentModels(currentModels);

    if (!silent) {
        console.log('✓ 已切换模型:', modelName);
        console.log();
    }
}

// 添加提供商
function cmdAdd(name, baseUrl, apiKey, silent = false) {
    if (!name || !baseUrl) {
        if (!silent) {
            console.error('用法: codexmate add <名称> <URL> [密钥]');
            console.log('\n示例:');
            console.log('  codexmate add 88code https://api.88code.ai/v1 sk-xxx');
        }
        throw new Error('名称和URL必填');
    }

    const config = readConfig();
    if (config.model_providers && config.model_providers[name]) {
        if (!silent) console.error('错误: 提供商已存在:', name);
        throw new Error('提供商已存在');
    }

    const newBlock = `
[model_providers.${name}]
name = "${name}"
base_url = "${baseUrl}"
wire_api = "responses"
requires_openai_auth = false
preferred_auth_method = "${apiKey || ''}"
request_max_retries = 4
stream_max_retries = 10
stream_idle_timeout_ms = 300000
`;

    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    writeConfig(content.trimEnd() + '\n' + newBlock);

    // 初始化当前模型
    const currentModels = readCurrentModels();
    if (!currentModels[name]) {
        currentModels[name] = readModels()[0];
        writeCurrentModels(currentModels);
    }

    if (!silent) {
        console.log('✓ 已添加提供商:', name);
        console.log('  URL:', baseUrl);
        console.log();
    }
}

// 删除提供商
function cmdDelete(name, silent = false) {
    const config = readConfig();
    if (!config.model_providers || !config.model_providers[name]) {
        if (!silent) console.error('错误: 提供商不存在:', name);
        throw new Error('提供商不存在');
    }

    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionRegex = new RegExp(`\\[\\s*model_providers\\s*\\.\\s*${safeName}\\s*\\]`);
    const match = content.match(sectionRegex);
    if (!match) {
        if (!silent) console.error('错误: 无法找到提供商配置块');
        throw new Error('无法找到提供商配置块');
    }

    const startIdx = match.index;
    const rest = content.slice(startIdx + match[0].length);
    const nextIdx = rest.indexOf('[');
    const endIdx = nextIdx === -1 ? content.length : (startIdx + match[0].length + nextIdx);

    const newContent = content.slice(0, startIdx) + content.slice(endIdx);
    writeConfig(newContent.trim());

    // 删除当前模型记录
    const currentModels = readCurrentModels();
    delete currentModels[name];
    writeCurrentModels(currentModels);

    if (!silent) {
        console.log('✓ 已删除提供商:', name);
        console.log();
    }
}

// 添加模型
function cmdAddModel(modelName, silent = false) {
    if (!modelName) {
        if (!silent) console.error('用法: codexmate add-model <模型名称>');
        throw new Error('模型名称必填');
    }

    const models = readModels();
    if (models.includes(modelName)) {
        if (!silent) console.log('模型已存在:', modelName);
        return;
    }

    models.push(modelName);
    writeModels(models);

    if (!silent) {
        console.log('✓ 已添加模型:', modelName);
        console.log();
    }
}

// 删除模型
function cmdDeleteModel(modelName, silent = false) {
    const models = readModels();
    const index = models.indexOf(modelName);
    if (index === -1) {
        if (!silent) console.error('错误: 模型不存在:', modelName);
        throw new Error('模型不存在');
    }

    if (models.length <= 1) {
        if (!silent) console.error('错误: 至少需要保留一个模型');
        throw new Error('至少需要保留一个模型');
    }

    models.splice(index, 1);
    writeModels(models);

    // 检查是否有提供商使用该模型
    const currentModels = readCurrentModels();
    let needsUpdate = false;
    for (const [provider, currentModel] of Object.entries(currentModels)) {
        if (currentModel === modelName) {
            currentModels[provider] = models[0];
            needsUpdate = true;
        }
    }

    if (needsUpdate) {
        writeCurrentModels(currentModels);
    }

    if (!silent) {
        console.log('✓ 已删除模型:', modelName);
        console.log();
    }
}

// 脱敏 key
function maskKey(key) {
    if (!key) return '';
    if (key.length <= 8) return '****';
    return key.substring(0, 4) + '...' + key.substring(key.length - 4);
}

// 应用到系统环境变量
function applyToSystemEnv(config) {
    try {
        const apiKey = config.apiKey || '';

        // Windows 使用 setx 命令设置用户环境变量
        if (process.platform === 'win32') {
            const envVars = [
                ['ANTHROPIC_API_KEY', apiKey],
                ['ANTHROPIC_AUTH_TOKEN', apiKey],
                ['ANTHROPIC_BASE_URL', config.baseUrl || 'https://open.bigmodel.cn/api/anthropic'],
                ['CLAUDE_CODE_USE_KEY', '1'],
                ['ANTHROPIC_MODEL', config.model || 'glm-4.7']
            ];

            for (const [key, value] of envVars) {
                try {
                    execSync(`setx ${key} "${value}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
                } catch (e) {
                    // 静默处理错误
                }
            }

            return { success: true };
        } else {
            return { success: false, error: '仅支持 Windows 系统' };
        }
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// 打开 Web UI
function cmdStart() {
    const htmlPath = path.join(__dirname, 'web-ui.html');
    if (!fs.existsSync(htmlPath)) {
        console.error('错误: web-ui.html 不存在');
        process.exit(1);
    }

    const server = http.createServer((req, res) => {
        if (req.url === '/api') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { action, params } = JSON.parse(body);
                    let result;

                    switch (action) {
                        case 'status':
                            const config = readConfig();
                            result = {
                                provider: config.model_provider || '未设置',
                                model: config.model || '未设置'
                            };
                            break;
                        case 'list':
                            const listConfig = readConfig();
                            const providers = listConfig.model_providers || {};
                            const current = listConfig.model_provider;
                            result = {
                                providers: Object.entries(providers).map(([name, p]) => ({
                                    name,
                                    key: maskKey(p.preferred_auth_method || ''),
                                    current: name === current
                                }))
                            };
                            break;
                        case 'models':
                            result = { models: readModels() };
                            break;
                        case 'switch':
                            const targetModel = cmdSwitch(params.name, true);
                            result = { success: true, targetModel };
                            break;
                        case 'use':
                            cmdUseModel(params.model, true);
                            result = { success: true };
                            break;
                        case 'add':
                            cmdAdd(params.name, params.url, params.key, true);
                            result = { success: true };
                            break;
                        case 'delete':
                            cmdDelete(params.name, true);
                            result = { success: true };
                            break;
                        case 'add-model':
                            cmdAddModel(params.model, true);
                            result = { success: true };
                            break;
                        case 'delete-model':
                            cmdDeleteModel(params.model, true);
                            result = { success: true };
                            break;
                        case 'apply-env':
                            result = applyToSystemEnv(params.config);
                            break;
                        default:
                            result = { error: '未知操作' };
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
        } else {
            const html = fs.readFileSync(htmlPath, 'utf-8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        }
    });

    server.listen(PORT, () => {
        console.log('\n✓ Web UI 已启动: http://localhost:' + PORT);
        console.log('  按 Ctrl+C 退出\n');

        // 打开浏览器
        const platform = process.platform;
        let command;
        const url = `http://localhost:${PORT}`;

        if (platform === 'win32') {
            command = `start "" "${url}"`;
        } else if (platform === 'darwin') {
            command = `open "${url}"`;
        } else {
            command = `xdg-open "${url}"`;
        }

        exec(command, (error) => {
            if (error) console.warn('无法自动打开浏览器，请手动访问:', url);
        });
    });
}

// ============================================================================
// 主程序
// ============================================================================
function main() {
    ensureConfigDir();

    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('\nCodex Mate - Codex 提供商管理工具');
        console.log('\n用法:');
        console.log('  codexmate status           显示当前状态');
        console.log('  codexmate list             列出所有提供商');
        console.log('  codexmate models           列出所有模型');
        console.log('  codexmate switch <名称>    切换提供商');
        console.log('  codexmate use <模型>       切换模型');
        console.log('  codexmate add <名称> <URL> [密钥]');
        console.log('  codexmate delete <名称>    删除提供商');
        console.log('  codexmate add-model <模型> 添加模型');
        console.log('  codexmate delete-model <模型> 删除模型');
        console.log('  codexmate start            启动 Web 界面');
        console.log('');
        process.exit(0);
    }

    const command = args[0];

    switch (command) {
        case 'status': cmdStatus(); break;
        case 'list': cmdList(); break;
        case 'models': cmdModels(); break;
        case 'switch': cmdSwitch(args[1]); break;
        case 'use': cmdUseModel(args[1]); break;
        case 'add': cmdAdd(args[1], args[2], args[3]); break;
        case 'delete': cmdDelete(args[1]); break;
        case 'add-model': cmdAddModel(args[1]); break;
        case 'delete-model': cmdDeleteModel(args[1]); break;
        case 'start': cmdStart(); break;
        default:
            console.error('错误: 未知命令:', command);
            console.log('运行 "codexmate" 查看帮助');
            process.exit(1);
    }
}

main();
