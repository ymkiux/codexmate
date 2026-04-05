import {
    buildSpeedTestIssue,
    formatLatency
} from '../logic.mjs';

function clearProgressResetTimer(context, timerKey) {
    if (!context || !timerKey || !context[timerKey]) {
        return;
    }
    clearTimeout(context[timerKey]);
    context[timerKey] = null;
}

function scheduleProgressResetTimer(context, timerKey, progressKey, delayMs = 800) {
    if (!context || !timerKey || !progressKey) {
        return;
    }
    clearProgressResetTimer(context, timerKey);
    context[timerKey] = setTimeout(() => {
        context[progressKey] = 0;
        context[timerKey] = null;
    }, delayMs);
}

export function createRuntimeMethods(options = {}) {
    const { api } = options;

    return {
        formatLatency,

        buildSpeedTestIssue(name, result) {
            return buildSpeedTestIssue(name, result);
        },

        async runSpeedTest(name, options = {}) {
            if (!name || this.speedLoading[name]) return null;
            const silent = !!options.silent;
            this.speedLoading[name] = true;
            try {
                const res = await api('speed-test', { name });
                if (res.error) {
                    this.speedResults[name] = { ok: false, error: res.error };
                    if (!silent) {
                        this.showMessage(res.error, 'error');
                    }
                    return { ok: false, error: res.error };
                }
                this.speedResults[name] = res;
                if (!silent) {
                    const status = res.status ? ` (${res.status})` : '';
                    this.showMessage(`Speed ${name}: ${this.formatLatency(res)}${status}`, 'success');
                }
                return res;
            } catch (e) {
                const message = e && e.message ? e.message : 'Speed test failed';
                this.speedResults[name] = { ok: false, error: message };
                if (!silent) {
                    this.showMessage(message, 'error');
                }
                return { ok: false, error: message };
            } finally {
                this.speedLoading[name] = false;
            }
        },

        async runClaudeSpeedTest(name, config) {
            if (!name || this.claudeSpeedLoading[name]) return null;
            const baseUrl = config && typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '';
            this.claudeSpeedLoading[name] = true;
            try {
                if (!baseUrl) {
                    const res = { ok: false, error: 'Missing base URL' };
                    this.claudeSpeedResults[name] = res;
                    return res;
                }
                const res = await api('speed-test', { url: baseUrl });
                if (res.error) {
                    this.claudeSpeedResults[name] = { ok: false, error: res.error };
                    return { ok: false, error: res.error };
                }
                this.claudeSpeedResults[name] = res;
                return res;
            } catch (e) {
                const message = e && e.message ? e.message : 'Speed test failed';
                const res = { ok: false, error: message };
                this.claudeSpeedResults[name] = res;
                return res;
            } finally {
                this.claudeSpeedLoading[name] = false;
            }
        },

        async downloadClaudeDirectory() {
            if (this.claudeDownloadLoading) return;
            clearProgressResetTimer(this, '__claudeDownloadResetTimer');
            this.claudeDownloadLoading = true;
            this.claudeDownloadProgress = 5;
            this.claudeDownloadTimer = setInterval(() => {
                if (this.claudeDownloadProgress < 90) {
                    this.claudeDownloadProgress += 5;
                }
            }, 400);
            try {
                const res = await api('download-claude-dir');
                if (res && res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                if (!res || res.success !== true || !res.fileName) {
                    this.showMessage('备份失败', 'error');
                    return;
                }
                this.claudeDownloadProgress = 100;
                const downloadUrl = `/download/${encodeURIComponent(res.fileName)}`;
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = res.fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                this.showMessage('备份成功，开始下载', 'success');
            } catch (e) {
                this.showMessage('备份失败：' + (e && e.message ? e.message : '未知错误'), 'error');
            } finally {
                if (this.claudeDownloadTimer) {
                    clearInterval(this.claudeDownloadTimer);
                    this.claudeDownloadTimer = null;
                }
                this.claudeDownloadLoading = false;
                scheduleProgressResetTimer(this, '__claudeDownloadResetTimer', 'claudeDownloadProgress');
            }
        },

        async downloadCodexDirectory() {
            if (this.codexDownloadLoading) return;
            clearProgressResetTimer(this, '__codexDownloadResetTimer');
            this.codexDownloadLoading = true;
            this.codexDownloadProgress = 5;
            this.codexDownloadTimer = setInterval(() => {
                if (this.codexDownloadProgress < 90) {
                    this.codexDownloadProgress += 5;
                }
            }, 400);
            try {
                const res = await api('download-codex-dir');
                if (res && res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                if (!res || res.success !== true || !res.fileName) {
                    this.showMessage('备份失败', 'error');
                    return;
                }
                this.codexDownloadProgress = 100;
                const downloadUrl = `/download/${encodeURIComponent(res.fileName)}`;
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = res.fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                this.showMessage('备份成功，开始下载', 'success');
            } catch (e) {
                this.showMessage('备份失败：' + (e && e.message ? e.message : '未知错误'), 'error');
            } finally {
                if (this.codexDownloadTimer) {
                    clearInterval(this.codexDownloadTimer);
                    this.codexDownloadTimer = null;
                }
                this.codexDownloadLoading = false;
                scheduleProgressResetTimer(this, '__codexDownloadResetTimer', 'codexDownloadProgress');
            }
        },

        triggerClaudeImport() {
            const input = this.$refs.claudeImportInput;
            if (input) {
                input.value = '';
                input.click();
            }
        },

        triggerCodexImport() {
            const input = this.$refs.codexImportInput;
            if (input) {
                input.value = '';
                input.click();
            }
        },

        handleClaudeImportChange(event) {
            const file = event && event.target && event.target.files ? event.target.files[0] : null;
            if (file) {
                void this.importBackupFile('claude', file);
            }
        },

        handleCodexImportChange(event) {
            const file = event && event.target && event.target.files ? event.target.files[0] : null;
            if (file) {
                void this.importBackupFile('codex', file);
            }
        },

        async importBackupFile(type, file) {
            const maxSize = 200 * 1024 * 1024;
            const loadingKey = type === 'claude' ? 'claudeImportLoading' : 'codexImportLoading';
            if (this[loadingKey]) {
                this.resetImportInput(type);
                return;
            }
            if (file.size > maxSize) {
                this.showMessage('备份文件过大，限制 200MB', 'error');
                this.resetImportInput(type);
                return;
            }
            this[loadingKey] = true;
            try {
                const base64 = await this.readFileAsBase64(file);
                const action = type === 'claude' ? 'restore-claude-dir' : 'restore-codex-dir';
                const res = await api(action, {
                    fileName: file.name || `${type}-backup.zip`,
                    fileBase64: base64
                });
                if (res && res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                const backupTip = res && res.backupPath ? `，原配置已备份到临时文件：${res.backupPath}` : '';
                this.showMessage(`导入成功${backupTip}`, 'success');
                try {
                    if (type === 'claude') {
                        await this.refreshClaudeSelectionFromSettings({ silent: true });
                    } else {
                        await this.loadAll();
                    }
                } catch (_) {
                    this.showMessage('导入已完成，但界面刷新失败，请手动刷新', 'error');
                }
            } catch (e) {
                this.showMessage('导入失败：' + (e && e.message ? e.message : '未知错误'), 'error');
            } finally {
                this[loadingKey] = false;
                this.resetImportInput(type);
            }
        },

        readFileAsBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const result = reader.result;
                    if (result instanceof ArrayBuffer) {
                        resolve(this.arrayBufferToBase64(result));
                        return;
                    }
                    if (typeof result === 'string') {
                        const idx = result.indexOf('base64,');
                        resolve(idx >= 0 ? result.slice(idx + 7) : result);
                        return;
                    }
                    reject(new Error('不支持的文件读取结果'));
                };
                reader.onerror = () => reject(new Error('读取文件失败'));
                reader.readAsArrayBuffer(file);
            });
        },

        arrayBufferToBase64(buffer) {
            const bytes = new Uint8Array(buffer);
            const chunkSize = 0x8000;
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i += chunkSize) {
                binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
            }
            return btoa(binary);
        },

        resetImportInput(type) {
            const refName = type === 'claude' ? 'claudeImportInput' : 'codexImportInput';
            const el = this.$refs[refName];
            if (el) {
                el.value = '';
            }
        },

        async loadCodexAuthProfiles(options = {}) {
            const silent = !!options.silent;
            try {
                const res = await api('list-auth-profiles');
                if (res && res.error) {
                    if (!silent) {
                        this.showMessage(res.error, 'error');
                    }
                    return;
                }
                const list = Array.isArray(res && res.profiles) ? res.profiles : [];
                this.codexAuthProfiles = list.sort((a, b) => {
                    if (!!a.current !== !!b.current) {
                        return a.current ? -1 : 1;
                    }
                    return String(a.name || '').localeCompare(String(b.name || ''));
                });
            } catch (e) {
                if (!silent) {
                    this.showMessage('读取认证列表失败', 'error');
                }
            }
        },

        showMessage(text, type) {
            if (this._messageTimer) {
                clearTimeout(this._messageTimer);
            }
            this.message = text;
            this.messageType = type || 'info';
            this._messageTimer = setTimeout(() => {
                this.message = '';
                this._messageTimer = null;
            }, 3000);
        }
    };
}
