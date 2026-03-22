const { assert, runSync, fs, path, os } = require('./helpers');

module.exports = async function testInvalidConfig(ctx) {
    const { node, cliPath } = ctx;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-invalid-config-'));
    const codexDir = path.join(tempHome, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });

    const malformedToml = [
        'model_provider = "openai"',
        'model = "gpt-5.3-codex"',
        '[model_providers.bad name]',
        'name = "bad name"',
        ''
    ].join('\n');

    fs.writeFileSync(path.join(codexDir, 'config.toml'), malformedToml, 'utf-8');

    const env = {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
        CODEXMATE_FORCE_RESET_EXISTING_CONFIG: '0'
    };

    try {
        const statusResult = runSync(node, [cliPath, 'status'], { env });
        const statusOutput = `${statusResult.stdout || ''}\n${statusResult.stderr || ''}`;
        assert(statusResult.status !== 0, 'status should fail when config.toml is invalid');
        assert(statusOutput.includes('配置文件解析失败'), 'status should surface config parse error');

        const listResult = runSync(node, [cliPath, 'list'], { env });
        const listOutput = `${listResult.stdout || ''}\n${listResult.stderr || ''}`;
        assert(listResult.status !== 0, 'list should fail when config.toml is invalid');
        assert(listOutput.includes('配置文件解析失败'), 'list should surface config parse error');
    } finally {
        try {
            if (fs.rmSync) {
                fs.rmSync(tempHome, { recursive: true, force: true });
            } else {
                fs.rmdirSync(tempHome, { recursive: true });
            }
        } catch (_) {}
    }
};
