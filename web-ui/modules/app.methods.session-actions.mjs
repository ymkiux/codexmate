export function createSessionActionMethods(options = {}) {
    const {
        api,
        apiBase
    } = options;

    return {
        getSessionStandaloneContext() {
            try {
                const url = new URL(window.location.href);
                if (url.pathname !== '/session') {
                    return { requested: false, params: null, error: '' };
                }

                const source = (url.searchParams.get('source') || '').trim().toLowerCase();
                const sessionId = (url.searchParams.get('sessionId') || url.searchParams.get('id') || '').trim();
                const filePath = (url.searchParams.get('filePath') || url.searchParams.get('path') || '').trim();
                let error = '';
                if (!source) {
                    error = '缺少 source 参数';
                } else if (source !== 'codex' && source !== 'claude') {
                    error = 'source 仅支持 codex 或 claude';
                }
                if (!sessionId && !filePath) {
                    error = error ? `${error}，还缺少 sessionId 或 filePath` : '缺少 sessionId 或 filePath 参数';
                }

                if (error) {
                    return { requested: true, params: null, error };
                }

                return {
                    requested: true,
                    params: {
                        source,
                        sessionId,
                        filePath
                    },
                    error: ''
                };
            } catch (_) {
                return { requested: false, params: null, error: '' };
            }
        },

        initSessionStandalone() {
            const context = this.getSessionStandaloneContext();
            if (!context.requested) return;

            this.sessionStandalone = true;
            this.mainTab = 'sessions';
            this.prepareSessionTabRender();

            if (context.error || !context.params) {
                this.sessionStandaloneError = `会话链接参数不完整：${context.error || '参数解析失败'}`;
                return;
            }

            const sourceLabel = context.params.source === 'codex' ? 'Codex' : 'Claude Code';
            this.activeSession = {
                source: context.params.source,
                sourceLabel,
                sessionId: context.params.sessionId,
                filePath: context.params.filePath,
                title: context.params.sessionId || context.params.filePath || '会话'
            };
            this.activeSessionMessages = [];
            this.activeSessionDetailError = '';
            this.activeSessionDetailClipped = false;
            this.cancelSessionTimelineSync();
            this.sessionTimelineActiveKey = '';
            this.clearSessionTimelineRefs();
            this.sessionStandaloneError = '';
            this.sessionStandaloneText = '';
            this.sessionStandaloneTitle = this.activeSession.title || '会话';
            this.sessionStandaloneSourceLabel = sourceLabel;
            this.loadSessionStandalonePlain();
        },

        buildSessionStandaloneUrl(session) {
            if (!session) return '';
            const source = typeof session.source === 'string' ? session.source.trim().toLowerCase() : '';
            if (!source || (source !== 'codex' && source !== 'claude')) return '';
            const sessionId = typeof session.sessionId === 'string' ? session.sessionId.trim() : '';
            const filePath = typeof session.filePath === 'string' ? session.filePath.trim() : '';
            if (!sessionId && !filePath) return '';
            const origin = window.location.origin && window.location.origin !== 'null'
                ? window.location.origin
                : (typeof apiBase === 'string' ? apiBase.trim() : '');
            if (!origin) return '';
            const params = new URLSearchParams();
            params.set('source', source);
            if (sessionId) params.set('sessionId', sessionId);
            if (filePath) params.set('filePath', filePath);
            return `${origin}/session?${params.toString()}`;
        },

        openSessionStandalone(session) {
            const url = this.buildSessionStandaloneUrl(session);
            if (!url) {
                this.showMessage('无法生成链接', 'error');
                return;
            }
            window.open(url, '_blank', 'noopener');
        },

        getSessionExportKey(session) {
            return `${session.source || 'unknown'}:${session.sessionId || ''}:${session.filePath || ''}`;
        },

        isResumeCommandAvailable(session) {
            if (!session) return false;
            const source = String(session.source || '').trim().toLowerCase();
            const sessionId = typeof session.sessionId === 'string' ? session.sessionId.trim() : '';
            return source === 'codex' && !!sessionId;
        },

        isCloneAvailable(session) {
            if (!session) return false;
            const source = String(session.source || '').trim().toLowerCase();
            const sessionId = typeof session.sessionId === 'string' ? session.sessionId.trim() : '';
            const filePath = typeof session.filePath === 'string' ? session.filePath.trim() : '';
            return source === 'codex' && (!!sessionId || !!filePath);
        },

        isDeleteAvailable(session) {
            if (!session) return false;
            const source = String(session.source || '').trim().toLowerCase();
            if (source !== 'codex' && source !== 'claude') return false;
            const sessionId = typeof session.sessionId === 'string' ? session.sessionId.trim() : '';
            const filePath = typeof session.filePath === 'string' ? session.filePath.trim() : '';
            return !!sessionId || !!filePath;
        },

        buildResumeCommand(session) {
            const sessionId = session && session.sessionId ? String(session.sessionId).trim() : '';
            const arg = this.quoteResumeArg(sessionId);
            if (this.sessionResumeWithYolo) {
                return `codex --yolo resume ${arg}`;
            }
            return `codex resume ${arg}`;
        },

        quoteShellArg(value) {
            const text = typeof value === 'string' ? value : String(value || '');
            if (!text) return "''";
            if (/^[a-zA-Z0-9._-]+$/.test(text)) return text;
            const escaped = text.replace(/'/g, "'\\''");
            return `'${escaped}'`;
        },

        quoteResumeArg(value) {
            return this.quoteShellArg(value);
        },

        fallbackCopyText(text) {
            let textarea = null;
            try {
                textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'fixed';
                textarea.style.top = '-9999px';
                textarea.style.left = '-9999px';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                textarea.setSelectionRange(0, textarea.value.length);
                return document.execCommand('copy');
            } catch (_) {
                return false;
            } finally {
                if (textarea && textarea.parentNode) {
                    textarea.parentNode.removeChild(textarea);
                }
            }
        },

        copyAgentsContent() {
            const text = typeof this.agentsContent === 'string' ? this.agentsContent : '';
            if (!text) {
                this.showMessage('没有可复制内容', 'info');
                return;
            }
            const ok = this.fallbackCopyText(text);
            if (ok) {
                this.showMessage('已复制', 'success');
                return;
            }
            this.showMessage('复制失败', 'error');
        },

        exportAgentsContent() {
            const text = typeof this.agentsContent === 'string' ? this.agentsContent : '';
            if (!text) {
                this.showMessage('没有可导出内容', 'info');
                return;
            }
            const now = new Date();
            const year = String(now.getFullYear());
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hour = String(now.getHours()).padStart(2, '0');
            const minute = String(now.getMinutes()).padStart(2, '0');
            const second = String(now.getSeconds()).padStart(2, '0');
            const fileName = `agent-${year}${month}${day}-${hour}${minute}${second}.txt`;
            this.downloadTextFile(fileName, text, 'text/plain;charset=utf-8');
            this.showMessage(`已导出 ${fileName}`, 'success');
        },

        async copyInstallCommand(cmd) {
            const text = typeof cmd === 'string' ? cmd.trim() : '';
            if (!text) {
                this.showMessage('没有可复制内容', 'info');
                return;
            }
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                    this.showMessage('已复制命令', 'success');
                    return;
                }
            } catch (_) {}
            const ok = this.fallbackCopyText(text);
            if (ok) {
                this.showMessage('已复制命令', 'success');
                return;
            }
            this.showMessage('复制失败', 'error');
        },

        async copyResumeCommand(session) {
            if (!this.isResumeCommandAvailable(session)) {
                this.showMessage('不支持此操作', 'error');
                return;
            }
            const command = this.buildResumeCommand(session);
            const ok = this.fallbackCopyText(command);
            if (ok) {
                this.showMessage('已复制', 'success');
                return;
            }
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(command);
                    this.showMessage('已复制', 'success');
                    return;
                }
            } catch (_) {}
            this.showMessage('复制失败', 'error');
        },

        buildProviderShareCommand(payload) {
            if (!payload || typeof payload !== 'object') return '';
            const name = typeof payload.name === 'string' ? payload.name.trim() : '';
            const baseUrl = typeof payload.baseUrl === 'string' ? payload.baseUrl.trim() : '';
            const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey : '';
            const model = typeof payload.model === 'string' ? payload.model.trim() : '';
            if (!name || !baseUrl) return '';

            const nameArg = this.quoteShellArg(name);
            const urlArg = this.quoteShellArg(baseUrl);
            const keyArg = apiKey ? this.quoteShellArg(apiKey) : '';
            const switchCmd = `codexmate switch ${nameArg}`;
            const addCmd = apiKey
                ? `codexmate add ${nameArg} ${urlArg} ${keyArg}`
                : `codexmate add ${nameArg} ${urlArg}`;
            const modelCmd = model ? ` && codexmate use ${this.quoteShellArg(model)}` : '';
            return `${addCmd} && ${switchCmd}${modelCmd}`;
        },

        buildClaudeShareCommand(payload) {
            if (!payload || typeof payload !== 'object') return '';
            const baseUrl = typeof payload.baseUrl === 'string' ? payload.baseUrl.trim() : '';
            const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey : '';
            const model = typeof payload.model === 'string' && payload.model.trim()
                ? payload.model.trim()
                : 'glm-4.7';
            if (!baseUrl || !apiKey) return '';
            const urlArg = this.quoteShellArg(baseUrl);
            const keyArg = this.quoteShellArg(apiKey);
            const modelArg = this.quoteShellArg(model);
            return `codexmate claude ${urlArg} ${keyArg} ${modelArg}`;
        },

        async copyProviderShareCommand(provider) {
            const name = provider && typeof provider.name === 'string' ? provider.name.trim() : '';
            if (!name) {
                this.showMessage('参数无效', 'error');
                return;
            }
            if (!this.shouldAllowProviderShare(provider)) {
                this.showMessage('本地入口不可分享', 'info');
                return;
            }
            if (this.providerShareLoading[name]) {
                return;
            }
            this.providerShareLoading[name] = true;
            try {
                const res = await api('export-provider', { name });
                if (res && res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                const command = this.buildProviderShareCommand(res && res.payload ? res.payload : null);
                if (!command) {
                    this.showMessage('生成命令失败', 'error');
                    return;
                }
                const ok = this.fallbackCopyText(command);
                if (ok) {
                    this.showMessage('已复制', 'success');
                    return;
                }
                try {
                    if (navigator.clipboard && window.isSecureContext) {
                        await navigator.clipboard.writeText(command);
                        this.showMessage('已复制', 'success');
                        return;
                    }
                } catch (_) {}
                this.showMessage('复制失败', 'error');
            } catch (_) {
                this.showMessage('生成命令失败', 'error');
            } finally {
                this.providerShareLoading[name] = false;
            }
        },

        async copyClaudeShareCommand(name) {
            const config = this.claudeConfigs[name];
            if (!config) {
                this.showMessage('配置不存在', 'error');
                return;
            }
            if (this.claudeShareLoading[name]) return;
            this.claudeShareLoading[name] = true;
            try {
                const res = await api('export-claude-share', { config });
                if (res && res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }
                const command = this.buildClaudeShareCommand(res && res.payload ? res.payload : null);
                if (!command) {
                    this.showMessage('生成命令失败', 'error');
                    return;
                }
                const ok = this.fallbackCopyText(command);
                if (ok) {
                    this.showMessage('已复制', 'success');
                    return;
                }
                try {
                    if (navigator.clipboard && window.isSecureContext) {
                        await navigator.clipboard.writeText(command);
                        this.showMessage('已复制', 'success');
                        return;
                    }
                } catch (_) {}
                this.showMessage('复制失败', 'error');
            } catch (_) {
                this.showMessage('生成命令失败', 'error');
            } finally {
                this.claudeShareLoading[name] = false;
            }
        },

        async cloneSession(session) {
            if (!this.isCloneAvailable(session)) {
                this.showMessage('不支持此操作', 'error');
                return;
            }
            const key = this.getSessionExportKey(session);
            if (this.sessionCloning[key]) {
                return;
            }
            this.sessionCloning[key] = true;
            try {
                const res = await api('clone-session', {
                    source: session.source,
                    sessionId: session.sessionId,
                    filePath: session.filePath
                });
                if (res.error) {
                    this.showMessage(res.error, 'error');
                    return;
                }

                this.showMessage('操作成功', 'success');
                try {
                    await this.loadSessions();
                    if (res.sessionId) {
                        const matched = this.sessionsList.find(item => item.source === 'codex' && item.sessionId === res.sessionId);
                        if (matched) {
                            await this.selectSession(matched);
                        }
                    }
                } catch (_) {
                    // The clone already succeeded remotely; keep the success result.
                }
            } catch (_) {
                this.showMessage('克隆失败', 'error');
            } finally {
                this.sessionCloning[key] = false;
            }
        },

        async deleteSession(session) {
            if (!this.isDeleteAvailable(session)) {
                this.showMessage('不支持此操作', 'error');
                return;
            }
            const key = this.getSessionExportKey(session);
            if (this.sessionDeleting[key]) {
                return;
            }
            this.sessionDeleting[key] = true;
            try {
                const res = await api('trash-session', {
                    source: session.source,
                    sessionId: session.sessionId,
                    filePath: session.filePath
                });
                if (!res || res.error) {
                    this.showMessage((res && res.error) || '删除失败', 'error');
                    return;
                }
                this.removeSessionPin(session);
                this.invalidateSessionTrashRequests();
                this.showMessage('已移入回收站', 'success');
                if (this.sessionTrashLoadedOnce) {
                    this.prependSessionTrashItem(this.buildSessionTrashItemFromSession(session, res), {
                        totalCount: res && res.totalCount !== undefined ? res.totalCount : undefined
                    });
                } else {
                    this.sessionTrashTotalCount = this.normalizeSessionTrashTotalCount(
                        res && res.totalCount !== undefined
                            ? res.totalCount
                            : (this.normalizeSessionTrashTotalCount(this.sessionTrashTotalCount, this.sessionTrashItems) + 1),
                        this.sessionTrashItems
                    );
                }
                try {
                    await this.removeSessionFromCurrentList(session);
                } catch (_) {
                    // The delete already succeeded remotely; keep the success result.
                }
            } catch (_) {
                this.showMessage('删除失败', 'error');
            } finally {
                this.sessionDeleting[key] = false;
            }
        }
    };
}
