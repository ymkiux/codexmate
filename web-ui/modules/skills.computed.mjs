export function createSkillsComputed() {
    return {
        skillsTargetLabel() {
            return this.skillsTargetApp === 'claude' ? 'Claude Code' : 'Codex';
        },
        skillsDefaultRootPath() {
            return this.skillsTargetApp === 'claude' ? '~/.claude/skills' : '~/.codex/skills';
        },
        filteredSkillsList() {
            const list = Array.isArray(this.skillsList) ? this.skillsList : [];
            const keyword = typeof this.skillsKeyword === 'string' ? this.skillsKeyword.trim().toLowerCase() : '';
            const status = typeof this.skillsStatusFilter === 'string' ? this.skillsStatusFilter : 'all';
            return list.filter((item) => {
                const safe = item && typeof item === 'object' ? item : {};
                const hasSkillFile = !!safe.hasSkillFile;
                if (status === 'with-skill-file' && !hasSkillFile) return false;
                if (status === 'missing-skill-file' && hasSkillFile) return false;
                if (!keyword) return true;
                const fields = [
                    safe.name,
                    safe.displayName,
                    safe.description,
                    safe.path
                ];
                return fields.some((value) => typeof value === 'string' && value.toLowerCase().includes(keyword));
            });
        },
        skillsSelectableNames() {
            const list = Array.isArray(this.filteredSkillsList) ? this.filteredSkillsList : [];
            return list
                .map((item) => (item && typeof item.name === 'string' ? item.name.trim() : ''))
                .filter(Boolean);
        },
        skillsConfiguredCount() {
            const list = Array.isArray(this.skillsList) ? this.skillsList : [];
            return list.filter((item) => !!(item && item.hasSkillFile)).length;
        },
        skillsMissingSkillFileCount() {
            const list = Array.isArray(this.skillsList) ? this.skillsList : [];
            return list.filter((item) => !(item && item.hasSkillFile)).length;
        },
        skillsFilterDirty() {
            const keyword = typeof this.skillsKeyword === 'string' ? this.skillsKeyword.trim() : '';
            const status = typeof this.skillsStatusFilter === 'string' ? this.skillsStatusFilter : 'all';
            return keyword.length > 0 || status !== 'all';
        },
        skillsSelectedCount() {
            const selected = Array.isArray(this.skillsSelectedNames) ? this.skillsSelectedNames : [];
            return Array.from(new Set(selected.map((item) => String(item || '').trim()).filter(Boolean))).length;
        },
        skillsVisibleSelectedCount() {
            const selectable = this.skillsSelectableNames;
            const selectedSet = new Set(Array.isArray(this.skillsSelectedNames) ? this.skillsSelectedNames : []);
            return selectable.filter((name) => selectedSet.has(name)).length;
        },
        skillsAllSelected() {
            const selectable = this.skillsSelectableNames;
            if (!selectable.length) return false;
            const selectedSet = new Set(Array.isArray(this.skillsSelectedNames) ? this.skillsSelectedNames : []);
            return selectable.every((name) => selectedSet.has(name));
        },
        skillsImportSelectableKeys() {
            const list = Array.isArray(this.skillsImportList) ? this.skillsImportList : [];
            return list
                .map((item) => this.buildSkillImportKey(item))
                .filter(Boolean);
        },
        skillsImportSelectedCount() {
            const selectable = this.skillsImportSelectableKeys;
            const selectedSet = new Set(Array.isArray(this.skillsImportSelectedKeys) ? this.skillsImportSelectedKeys : []);
            return selectable.filter((key) => selectedSet.has(key)).length;
        },
        skillsImportAllSelected() {
            const selectable = this.skillsImportSelectableKeys;
            if (!selectable.length) return false;
            const selectedSet = new Set(Array.isArray(this.skillsImportSelectedKeys) ? this.skillsImportSelectedKeys : []);
            return selectable.every((key) => selectedSet.has(key));
        },
        skillsImportConfiguredCount() {
            const list = Array.isArray(this.skillsImportList) ? this.skillsImportList : [];
            return list.filter((item) => !!(item && item.hasSkillFile)).length;
        },
        skillsImportMissingSkillFileCount() {
            const list = Array.isArray(this.skillsImportList) ? this.skillsImportList : [];
            return list.filter((item) => !(item && item.hasSkillFile)).length;
        },
        skillsMarketBusy() {
            return !!(
                this.skillsMarketLoading
                || this.skillsLoading
                || this.skillsDeleting
                || this.skillsScanningImports
                || this.skillsImporting
                || this.skillsZipImporting
                || this.skillsExporting
            );
        },
        skillsMarketInstalledPreview() {
            const list = Array.isArray(this.skillsList) ? this.skillsList : [];
            return list.slice(0, 6);
        },
        skillsMarketImportPreview() {
            const list = Array.isArray(this.skillsImportList) ? this.skillsImportList : [];
            return list.slice(0, 6);
        }
    };
}
