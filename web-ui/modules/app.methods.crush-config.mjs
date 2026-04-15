function safeJsonStringify(value) {
    try {
        return JSON.stringify(value, null, 2) + '\n';
    } catch (_) {
        return '';
    }
}

export function createCrushConfigMethods({ api }) {
    return {
        async loadCrushConfig() {
            this.crushConfigLoading = true;
            try {
                const res = await api('get-crush-config', {});
                if (res && res.error) {
                    this.toastError(res.error);
                }
                this.crushConfigPath = (res && res.path) || '';
                this.crushConfigExists = !!(res && res.exists);
                this.crushConfigDraft = (res && typeof res.raw === 'string' && res.raw.trim())
                    ? res.raw
                    : safeJsonStringify(res && res.config ? res.config : {});
            } catch (e) {
                this.toastError(e && e.message ? e.message : String(e));
            } finally {
                this.crushConfigLoading = false;
            }
        },
        async saveCrushConfig() {
            const raw = typeof this.crushConfigDraft === 'string' ? this.crushConfigDraft : '';
            if (!raw.trim()) return;
            this.crushConfigLoading = true;
            try {
                const res = await api('apply-crush-config', { raw });
                if (res && res.error) {
                    this.toastError(res.error);
                    return;
                }
                this.toastSuccess('Saved crush.json');
                await this.loadCrushConfig();
            } catch (e) {
                this.toastError(e && e.message ? e.message : String(e));
            } finally {
                this.crushConfigLoading = false;
            }
        },
        async initCrushConfig() {
            this.crushConfigLoading = true;
            try {
                const res = await api('init-crush-config', { includeKeys: this.crushConfigIncludeKeys === true });
                if (res && res.error) {
                    this.toastError(res.error);
                    return;
                }
                this.toastSuccess(`Initialized (providers: ${(res && res.providerCount) || 0})`);
                await this.loadCrushConfig();
            } catch (e) {
                this.toastError(e && e.message ? e.message : String(e));
            } finally {
                this.crushConfigLoading = false;
            }
        },
        formatCrushConfig() {
            const raw = typeof this.crushConfigDraft === 'string' ? this.crushConfigDraft : '';
            if (!raw.trim()) return;
            try {
                this.crushConfigDraft = safeJsonStringify(JSON.parse(raw));
            } catch (e) {
                this.toastError(`Invalid JSON: ${e.message}`);
            }
        },
        validateCrushConfig() {
            const raw = typeof this.crushConfigDraft === 'string' ? this.crushConfigDraft : '';
            if (!raw.trim()) return;
            try {
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    this.toastError('Config must be a JSON object');
                    return;
                }
                this.toastSuccess('Valid JSON');
            } catch (e) {
                this.toastError(`Invalid JSON: ${e.message}`);
            }
        }
    };
}

