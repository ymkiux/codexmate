const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function readJsonFile(filePath, fallback = null) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
        return fallback;
    }
}

function readJsonArrayFile(filePath, fallback = []) {
    if (!fs.existsSync(filePath)) {
        return Array.isArray(fallback) ? [...fallback] : [];
    }
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.trim()) {
            return Array.isArray(fallback) ? [...fallback] : [];
        }
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? parsed : (Array.isArray(fallback) ? [...fallback] : []);
    } catch (e) {
        return Array.isArray(fallback) ? [...fallback] : [];
    }
}

function readJsonObjectFromFile(filePath, fallback = {}) {
    if (!fs.existsSync(filePath)) {
        return { ok: true, exists: false, data: { ...fallback } };
    }

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.trim()) {
            return { ok: true, exists: true, data: { ...fallback } };
        }

        const parsed = JSON.parse(content);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {
                ok: false,
                exists: true,
                error: `配置文件格式错误（根节点必须是对象）: ${filePath}`
            };
        }
        return { ok: true, exists: true, data: parsed };
    } catch (e) {
        return {
            ok: false,
            exists: true,
            error: `配置文件解析失败: ${e.message}`
        };
    }
}

function formatTimestampForFileName(value) {
    const date = value ? new Date(value) : new Date();
    const normalized = Number.isNaN(date.getTime()) ? new Date() : date;
    const pad = (num) => String(num).padStart(2, '0');
    return [
        normalized.getFullYear(),
        pad(normalized.getMonth() + 1),
        pad(normalized.getDate()),
        '-',
        pad(normalized.getHours()),
        pad(normalized.getMinutes()),
        pad(normalized.getSeconds())
    ].join('');
}

function backupFileIfNeededOnce(filePath, backupPrefix = 'codexmate-backup') {
    if (!fs.existsSync(filePath)) {
        return '';
    }

    const dirPath = path.dirname(filePath);
    const baseName = path.basename(filePath);
    const existingPrefix = `${baseName}.${backupPrefix}-`;
    const hasBackup = fs.readdirSync(dirPath).some(fileName =>
        fileName.startsWith(existingPrefix) && fileName.endsWith('.bak')
    );

    if (hasBackup) {
        return '';
    }

    const backupPath = path.join(dirPath, `${existingPrefix}${formatTimestampForFileName()}.bak`);
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
}

function writeJsonAtomic(filePath, data) {
    const dirPath = path.dirname(filePath);
    ensureDir(dirPath);

    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    const content = `${JSON.stringify(data, null, 2)}\n`;

    try {
        fs.writeFileSync(tmpPath, content, 'utf-8');
        if (fs.existsSync(filePath)) {
            const existingMode = fs.statSync(filePath).mode;
            fs.chmodSync(tmpPath, existingMode);
        } else {
            fs.chmodSync(tmpPath, 0o600);
        }
        try {
            fs.renameSync(tmpPath, filePath);
        } catch (renameError) {
            if (process.platform === 'win32') {
                fs.copyFileSync(tmpPath, filePath);
                fs.unlinkSync(tmpPath);
            } else {
                throw renameError;
            }
        }
    } catch (e) {
        if (fs.existsSync(tmpPath)) {
            try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
        throw new Error(`写入 JSON 文件失败: ${e.message}`);
    }
}

module.exports = {
    ensureDir,
    readJsonFile,
    readJsonArrayFile,
    readJsonObjectFromFile,
    backupFileIfNeededOnce,
    writeJsonAtomic,
    formatTimestampForFileName
};
