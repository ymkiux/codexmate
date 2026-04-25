import { pluginOwnership, templateOwnershipById } from '../ownership.mjs';

export function buildBuiltinCommentPolishTemplate(t) {
    const tr = (key, fallback, params = null) => (typeof t === 'function' ? t(key, params) : fallback);
    const line1 = tr('plugins.builtin.commentPolish.line1', '轻微收敛以下代码注释');
    const timestamp = new Date().toISOString();
    const ownership = templateOwnershipById && templateOwnershipById.builtin_comment_polish
        ? templateOwnershipById.builtin_comment_polish
        : pluginOwnership;
    return {
        id: 'builtin_comment_polish',
        name: tr('plugins.builtin.commentPolish.name', '代码注释润色'),
        description: tr('plugins.builtin.commentPolish.desc', '轻微收敛以下代码注释 {{code}}'),
        template: [
            line1,
            '',
            '{{code}}'
        ].join('\n'),
        createdAt: timestamp,
        updatedAt: timestamp,
        isBuiltin: true,
        createdBy: ownership && typeof ownership.createdBy === 'string' ? ownership.createdBy : '',
        maintainers: ownership && Array.isArray(ownership.maintainers) ? ownership.maintainers : []
    };
}
