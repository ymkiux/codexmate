import { ruleAckOwnership } from './ownership.mjs';

export function buildBuiltinRuleAckTemplate(t) {
    const tr = (key, fallback, params = null) => (typeof t === 'function' ? t(key, params) : fallback);
    const line1 = tr('plugins.builtin.ruleAck.line1', '请根据【{{rule}}】，收到请回复');
    const timestamp = new Date().toISOString();
    return {
        id: 'builtin_rule_ack',
        name: tr('plugins.builtin.ruleAck.name', '规则确认回复'),
        description: tr('plugins.builtin.ruleAck.desc', '请根据【{{rule}}】，收到请回复'),
        template: line1,
        createdAt: timestamp,
        updatedAt: timestamp,
        isBuiltin: true,
        createdBy: ruleAckOwnership.createdBy,
        maintainers: ruleAckOwnership.maintainers
    };
}
